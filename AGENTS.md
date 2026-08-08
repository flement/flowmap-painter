# Flow Map Studio

A browser-based flow map editor. Users paint directional flow fields using brushes, bezier pen paths, geometric constraints (arrows, circles, swirls, radial, wave), and flood fill. The flow map is stored as an RGBA image where R encodes horizontal direction and G encodes vertical direction (128 = neutral). A Three.js demo visualizes the flow map as animated water.

## Tech Stack

- **Build**: Vite 8, no framework (vanilla JS, ES modules)
- **Runtime dep**: Three.js (lazy-loaded via dynamic `import('three')` in demo only)
- **Styling**: Single CSS file, no preprocessor
- **No tests, no linter configured**

## Commands

```
pnpm dev       # Vite dev server
pnpm build     # Production build to dist/
pnpm preview   # Serve dist/ locally
```

## Architecture

### Module Graph (src/)

```
main.js  ──> state.js, canvas.js, rendering.js, layers.js, ui.js, preview.js
                  │
                  ▼
            ┌─────────────────────────────────────────────────┐
            │  state.js  (no deps)                            │
            │  Shared mutable state object. Every module      │
            │  imports `state` and reads/writes properties.   │
            └─────────────────────────────────────────────────┘

            bezier.js  (no deps)          Pure math: cubic bezier evaluation,
                                          path sampling, pen anchor hit-test,
                                          drawPenPath(), drawPenHandles().

            canvas.js  → state            DOM refs for 4 stacked canvases,
                                          setStageSize(), clamp8(), TAU, HANDLE_RADIUS.

            overlay.js → state, canvas,   Selection overlay drawing, hit-testing
                          bezier           for constraints and pen paths.
                                           Named color constants and hit-test thresholds.

            rendering.js → state, canvas,  Flow map compositing, blur, stamping.
                           bezier, overlay

            layers.js → state, canvas,     Layer CRUD, layer panel UI (thumbnails,
                         bezier,            drag-reorder, visibility toggle, delete),
                         rendering,         per-layer property editors.
                         overlay, tools, ui

            preview.js → state, canvas,    All pointer event handlers (pointerdown/
                          bezier,           move/up/leave), pen tool, brush painting,
                          rendering,        preview drawing, coordinate mapping.
                          overlay,          Data-driven scroll wheel adjustment.
                          layers, ui        finishPenPath(), clearPreview(), getPos().

            tools.js → state, ui           setTool(), tool button wiring, CW/CCW toggle.
                          (circular)

            autoflow.js → state, canvas,   Image-to-flow generation: rgbToHsv,
                          rendering, ui     getWaterMask(), drawHueBar(),
                          (circular)        updateWaterPreview(), initAutoflow().

            project.js → state, canvas,    Serialization: serializeProject(),
                          layers            saveToStorage(), debouncedSave(),
                                            loadProject(), uint8ToBase64/base64ToUint8.

            ui.js → state, canvas,         Toast notifications, HUD, undo/redo,
                     rendering, overlay,    canvas format picker, panel resize,
                     layers, tools,        opacity sliders, tool options bindings,
                     autoflow, project,    keyboard shortcuts, blur, image loading,
                     preview, demo         reset/export, slider bindings.

            demo.js → state, canvas,       Three.js water visualization modal.
                       rendering, ui        Lazy-loads three from esm.sh CDN.

            main.js → all above            Imports side-effect modules (ui.js,
                                            preview.js) to attach event listeners,
                                            runs init sequence.
```

### Circular Imports

`layers.js` → `ui.js` → `tools.js` → `preview.js` (non-critical path, all cross-calls happen in callbacks).

`autoflow.js` → `ui.js` → `autoflow.js` (safe — all cross-calls in callbacks, works in ES modules).

Never call an imported function at module top-level.

### Canvas Stack (bottom to top)

All 4 canvases are stacked via CSS in `#stage`. They share the same pixel dimensions (`state.CW × state.CH`) and display dimensions (scaled by `setStageSize`).

| Canvas | Purpose | Context |
|---|---|---|
| `imgCanvas` | Reference image loaded by user | `imgCtx` (2d) |
| `flowCanvas` | Composited flow map (the export target) | `flowCtx` (2d, willReadFrequently) |
| `overlayCanvas` | Selection indicators (handles, bounding boxes) | `ovCtx` (2d) |
| `previewCanvas` | Transient previews (hover cursor, drag in-progress) | `pvCtx` (2d) |

`previewCanvas` is the topmost and receives all pointer events.

### Flow Map Encoding

Each pixel stores a direction as `[R, G, 128, 255]`:
- **R channel**: horizontal flow. 128 = no horizontal component. <128 = leftward. >128 = rightward.
- **G channel**: vertical flow. 128 = no vertical component. <128 = upward. >128 = downward.
- Neutral/empty pixels are `[128, 128, 128, 255]`.

`dirToTarget(dirx, diry)` converts a unit direction vector to `[R, G]` target values, respecting `state.invertX`/`state.invertY`.

### Layer Types

All layers live in `state.layers` (bottom-to-top order). Each has `{ id, type, name, visible }`.

| Type | Shape | How it paints |
|---|---|---|
| `brush` | Raw pixel `Uint8ClampedArray` (CW×CH×4) | Direct pixel copy (non-neutral pixels overwrite) |
| `pen` | Bezier path: `anchors[]` with `{x,y,h1x,h1y,h2x,h2y}`, `closed`, sampled `points[]` | Stamps along sampled path using `stampInto()` |
| `constraint` | `shape` object with type-specific geometry | Stamps using `renderConstraintTo()` |
| `mask` | `maskData` ImageData + optional `rawMaskData` | Scales flow data by mask intensity |

#### Constraint shapes

- **arrow**: `{ x1,y1, x2,y2, radius, strength, feather }` — stamps along line from p1→p2
- **circle**: `{ cx,cy, radius, strength, feather, rotationDir }` — stamps tangential vectors (CW/CCW)
- **swirl**: same as circle + `{ spiralFactor, cyclone, cycloneEye, cycloneEyeSoft, cycloneEyewall, cycloneDecay, cycloneBands, cycloneBandAmp }` — when `cyclone` is on, uses a modified-Rankine cyclone profile: calm eye (`cycloneEye` × radius) rising to a wind maximum at the eyewall (`cycloneEyewall` × radius, peak broadness set by `cycloneEyeSoft`), power-law decay beyond (`cycloneDecay` exponent), optional spiral rainbands (`cycloneBands` count, `cycloneBandAmp` intensity), plus inflow that grows with radius so the spiral tightens toward the core; when off, falls back to the uniform spiral
- **radial**: `{ cx,cy, radius, strength, feather, rotationDir }` — stamps outward/inward from center
- **wave**: `{ x1,y1, x2,y2, radius, strength, feather, frequency, amplitude, offset }` — sinusoidal wave path with perpendicular displacement

### Rendering Pipeline

`renderComposite()` in `rendering.js`:
1. Creates fresh `ImageData`, fills with neutral gray
2. Iterates layers bottom-to-top, compositing each visible layer's contribution into `state.flowData`
3. Writes `flowImageData` to `flowCanvas` via `putImageData`
4. Calls `drawOverlay()` to refresh selection indicators on `overlayCanvas`
5. Calls `debouncedSave()` to persist to localStorage (debounced 300ms)

Call `renderComposite()` after any mutation to layers, tool parameters, or canvas size.

`blurOnce()` performs a separable 3-tap box blur (horizontal pass → vertical pass) on `state.flowData` in-place.

### Pen Tool Flow

1. **pointerdown** (first click): Creates a new pen layer in `state.layers`, pushes to `state.penAnchors`
2. **pointermove** (after first click): Drags the bezier handle (`h2`/`h1`) of the last anchor
3. **pointerdown** (subsequent): Appends new anchor; if close to first anchor (dist < 10), closes path
4. **Escape** or switching tool: Calls `finishPenPath()` — if ≥2 anchors, finalizes layer properties; otherwise removes incomplete layer

Each anchor: `{ x, y, h1x, h1y, h2x, h2y }` — `h1` is the incoming handle, `h2` is the outgoing handle. Handles mirror across the anchor point when first created.

### Select Tool

Select tool supports:
- **Constraint drag**: moves entire shape (preserves relative endpoints for arrows)
- **Arrow endpoint drag**: detected via `hitArrowHandle()`, moves individual endpoint
- **Pen anchor drag**: moves anchor + both handles
- **Pen handle drag**: moves handle, mirrors opposite handle
- **Pen path drag**: moves entire path (when clicking between anchors)
- **Alt+click pen anchor**: deletes anchor (if >2 remain)
- **Shift+click path**: inserts new anchor at nearest point on curve

### Keyboard Shortcuts

| Key | Action |
|---|---|
| V | Select |
| B | Brush |
| E | Eraser |
| P | Pen |
| F | Fill |
| A | Arrow |
| C | Circle |
| S | Swirl |
| D | Radial |
| W | Wave |
| Ctrl/Cmd+Z | Undo |
| Escape | Finish/cancel pen path |
| Delete/Backspace | Delete selected layer |

### Scroll Shortcuts

All tools support scroll-wheel adjustment. Scroll without modifiers changes size/radius. Hold Shift to adjust strength, or Ctrl/Cmd to adjust feather. The HUD shows a color-coded progress bar for strength/feather values (green <50%, yellow 50–80%, red >80%).

The scroll handler is data-driven via `SCROLL_PARAMS` table in `preview.js`, keyed by modifier (shift/ctrl/none) and tool category (fill/brushLike/constraint).

### Fill Tool

Click and drag to set the fill direction. On release, `floodFillBrush()` performs a stack-based flood fill on the active brush layer. It compares R/G values of neighboring pixels against the click-point using `state.fillTolerance` (0–127) and blends matching pixels toward the drag direction using `state.fillStrength`.

### Brush Tool

 The brush paints the gesture direction at each stamp; `Smooth` low-passes the cursor position (EMA, `alpha = 1 - brushSmooth`, clamped to ≥0.05); `Fixed direction` substitutes a constant vector for the gesture direction. Per-stroke state lives in a module-local `stroke` object in `preview.js`, not in `state`. `Size` is a **diameter** — the stamp radius is `brushSize / 2`.

- **Direction**: normalized delta of the smoothed cursor over the last `DIR_CHORD` (4) px of travel, updated only once the cursor has moved ≥4px (prevents jitter and neutral-colored stroke starts). Fixed direction bypasses this.
- **Painting**: `strokePaint()` stamps `stampBrush()` along the segment between consecutive smoothed points every `radius × 0.5` px. On a direction change, the stamp color is interpolated from the previous segment's color to the new direction's color across the segment, so turns get fluid color transitions (like the pen's bezier points).
- **Opacity**: `blendInto` caps layer alpha at the max stamp value (`max(current, a255)`) — no self-darkening from overlapping stamps, and erasing then re-painting works. The stamp color always blends toward the newest stamp, so overpainting recolors cleanly.
- **Eraser**: `eraseInto()` sets `alpha *= (1 - a)` for every pixel in the stamp, independent of the stroke map — it only reveals lower layers.

### Undo System

`pushUndo()` snapshots all layers (deep-copy for non-brush, `.slice()` for brush pixel data) onto `state.undoStack` (max 30). Call before any destructive operation.

### Public API (key exports by module)

**state.js**: `state` — the shared state object (includes `brushSize`, `brushStrength`, `brushFeather`, `brushSmooth`, `brushFixed`, `brushFixedR`, `brushFixedG`, `fillTolerance`, `waveFrequency`, `waveAmplitude`, `waveOffset`, `rotationDir`, `spiralFactor`, `cyclone`, `cycloneEye`, `cycloneEyeSoft`, `cycloneEyewall`, `cycloneDecay`, `cycloneBands`, `cycloneBandAmp`)

**bezier.js**: `cubicBezier(t, p0, p1, p2, p3)`, `sampleBezierSeg(a, b, count)`, `samplePenPath(anchors, closed)`, `hitPenAnchor(px, py, anchors, threshold)`, `insertPenAnchor(anchors, px, py)`, `drawPenPath(ctx, anchors, closed)`, `drawPenHandles(ctx, anchors, opts)`

**canvas.js**: `stage`, `imgCanvas`, `flowCanvas`, `overlayCanvas`, `previewCanvas`, `imgCtx`, `flowCtx`, `ovCtx`, `pvCtx`, `TAU`, `HANDLE_RADIUS`, `clamp8(v)`, `setStageSize(w, h)`

**rendering.js**: `blendInto(target, x, y, targetR, targetG, amount)`, `dirToTarget(dirx, diry)`, `stampInto(target, cx, cy, dirx, diry, radius, strength, feather)`, `stampBrush(target, cx, cy, targetR, targetG, radius, strength, feather)`, `eraseInto(target, cx, cy, radius, strength, feather)`, `rotationalVector(dx, dy, d, rotDir, spiral)`, `renderConstraintTo(target, c)`, `renderPenStrokeTo(target, stroke)`, `floodFillBrush(target, startX, startY, dirx, diry, strength, tolerance)`, `renderComposite()`, `blurOnce()`

**overlay.js**: `drawArrowHead(ctx, x, y, angle, size)`, `drawOverlay()`, `hitTestConstraint(px, py)`, `hitArrowHandle(px, py, s)`

**layers.js**: `makeBrushLayer()`, `refreshLayerPanel()`, `hideLayerProps()`, `updateLayerProps(layer)`, `selectLayer(id)`

**preview.js**: `getPos(e)`, `clearPreview()`, `finishPenPath()`

**tools.js**: `setTool(t)`

**autoflow.js**: `initAutoflow()`, `updateWaterPreview()`

**project.js**: `STORAGE_KEY`, `serializeProject()`, `saveToStorage()`, `debouncedSave()`, `loadProject(json)`

**ui.js**: `toast(msg)`, `showHUD(clientX, clientY, text, bar)`, `hideHUD()`, `pushUndo()`

**demo.js**: `launchDemo()`

### DOM Elements (by ID)

Referenced in `index.html`. Key elements that JS touches:

- `stage` — container div for the 4 stacked canvases
- `imgCanvas`, `flowCanvas`, `overlayCanvas`, `previewCanvas` — the canvas elements
- `rpanel`, `panelResize` — right panel and its resize handle
- `layerList`, `layerProps` — layer panel list and per-layer property editor
- `toolOptions` — tool options container in right panel
- `brushOpts`, `shapeOpts`, `selectOpts`, `fillOpts` — tool-specific option sections
- `rotationDirPanel`, `spiralPanel` — rotation/spiral UI sections
- `wavePanel`, `waveAmpPanel`, `waveOffPanel` — wave shape UI sections
- `hud`, `hudBar`, `hudBarFill`, `coordsDisplay` — floating HUD with progress bar and coordinate readout
- `demoModal`, `demoCanvas`, `demoClose`, `demoRestart` — Three.js demo modal
- `constraintRadius`, `constraintStrength`, `constraintFeather` — constraint tool sliders

### Adding a New Tool

1. Add tool key to `index.html` toolbar with `data-tool="name"` and SVG icon
2. Add keyboard shortcut to the map in `ui.js`
3. Add tool-specific options section in `index.html` (if needed), wire visibility in `setTool()` (tools.js)
4. Add pointer event handling in `preview.js` (pointerdown/move/up branches)
5. Add rendering support in `rendering.js` if the tool produces new layer types
6. Add layer type handling in `layers.js` for thumbnails and property editors

### Adding a New Layer Type

1. Define the layer shape in `preview.js` where the layer is created
2. Add rendering case in `rendering.js` `renderComposite()` switch
3. Add thumbnail rendering in `layers.js` `generateLayerThumb()`
4. Add property editor in `layers.js` `updateLayerProps()`
5. Add hit-testing in `overlay.js` `hitTestConstraint()` if selectable

## Gotchas

- `flowCtx` is created with `{ willReadFrequently: true }` — required for `putImageData` performance
- `setStageSize` resizes all 4 canvases to the same pixel dimensions and scales them to fit the viewport
- Brush pixel data is a flat `Uint8ClampedArray` (CW×CH×4), not an `ImageData` — indices are `(y * CW + x) * 4`
- The demo modal lazy-loads Three.js from `https://esm.sh/three@0.172.0` via importmap in `index.html`
- `constraintRadius`/`constraintStrength`/`constraintFeather` are shared across all constraint tools (arrow, circle, swirl, radial, wave), not just arrows
- Serialization lives in `project.js`; `rendering.js` calls `debouncedSave()` at end of `renderComposite()`
- `TAU` (2π) is defined in `canvas.js` — use it instead of `Math.PI * 2`
