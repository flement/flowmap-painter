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
main.js  ──> state.js, canvas.js, rendering.js, layers.js, ui.js, interaction.js
                  │
                  ▼
            ┌─────────────────────────────────────────────────┐
            │  state.js  (no deps)                            │
            │  Shared mutable state object. Every module      │
            │  imports `state` and reads/writes properties.   │
            └─────────────────────────────────────────────────┘

            bezier.js  (no deps)          Pure math: cubic bezier evaluation,
                                          path sampling, pen anchor hit-test.

            canvas.js  → state            DOM refs for 4 stacked canvases,
                                          setStageSize(), clamp8().

            overlay.js → state, canvas,   Selection overlay drawing, hit-testing
                          bezier           for constraints and pen paths.

            rendering.js → state, canvas,  Flow map compositing, blur, stamping.
                           bezier, overlay

            layers.js → state, bezier,     Layer CRUD, layer panel UI (thumbnails,
                         rendering,         drag-reorder, visibility toggle, delete),
                         overlay, ui        per-layer property editors.

            interaction.js → state, canvas, All pointer event handlers (pointerdown/
                            bezier,          move/up/leave), pen tool, brush painting,
                            rendering,       preview drawing, coordinate mapping.
                            overlay,
                            layers, ui

            ui.js → state, canvas,         Toast notifications, HUD, undo/redo,
                     rendering, overlay,    canvas format picker, panel resize,
                     layers, interaction,   opacity sliders, tool switching,
                     demo                   keyboard shortcuts, blur, image loading,
                                            reset, export, slider bindings.

            demo.js → state, canvas,       Three.js water visualization modal.
                       rendering, ui        Lazy-loads three from esm.sh CDN.

            main.js → all above            Imports side-effect modules (ui.js,
                                            interaction.js) to attach event listeners,
                                            runs init sequence.
```

### Circular Imports

`layers.js` ↔ `ui.js` and `ui.js` ↔ `interaction.js` have circular imports. This works because all cross-module calls happen inside event handler callbacks (after all modules finish evaluating). Never call an imported function at module top-level.

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

#### Constraint shapes

- **arrow**: `{ x1,y1, x2,y2, radius, strength, feather }` — stamps along line from p1→p2
- **circle**: `{ cx,cy, radius, strength, feather, rotationDir }` — stamps tangential vectors (CW/CCW)
- **swirl**: same as circle + `{ spiralFactor }` — mixes tangential + radial vectors
- **radial**: `{ cx,cy, radius, strength, feather, rotationDir }` — stamps outward/inward from center
- **wave**: `{ x1,y1, x2,y2, radius, strength, feather, frequency, amplitude, offset }` — sinusoidal wave path with perpendicular displacement

### Rendering Pipeline

`renderComposite()` in `rendering.js`:
1. Creates fresh `ImageData`, fills with neutral gray
2. Iterates layers bottom-to-top, compositing each visible layer's contribution into `state.flowData`
3. Writes `flowImageData` to `flowCanvas` via `putImageData`
4. Calls `drawOverlay()` to refresh selection indicators on `overlayCanvas`

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

### Fill Tool

Click and drag to set the fill direction. On release, `floodFillBrush()` performs a stack-based flood fill on the active brush layer. It compares R/G values of neighboring pixels against the click-point using `state.fillTolerance` (0–127) and blends matching pixels toward the drag direction using `state.brushStrength`.

### Brush Tool (Catmull-Rom)

The brush tool uses Catmull-Rom spline interpolation for smooth curves. Points are buffered in `state.brushPath` (up to 8). On each pointermove, the last 3–4 points are fed to `catmullRom()` to compute position and tangent direction. Stamps are placed every 2px along the spline segment, with direction derived from the spline tangent.

### Undo System

`pushUndo()` snapshots all layers (deep-copy for non-brush, `.slice()` for brush pixel data) onto `state.undoStack` (max 30). Call before any destructive operation.

### Public API (key exports by module)

**state.js**: `state` — the shared state object (includes `brushPath`, `fillTolerance`, `waveFrequency`, `waveAmplitude`, `waveOffset`, `rotationDir`, `spiralFactor`)

**bezier.js**: `cubicBezier(t, p0, p1, p2, p3)`, `sampleBezierSeg(a, b, count)`, `samplePenPath(anchors, closed)`, `hitPenAnchor(px, py, anchors, threshold)`, `insertPenAnchor(anchors, px, py)`

**canvas.js**: `stage`, `imgCanvas`, `flowCanvas`, `overlayCanvas`, `previewCanvas`, `imgCtx`, `flowCtx`, `ovCtx`, `pvCtx`, `HANDLE_RADIUS`, `clamp8(v)`, `setStageSize(w, h)`

**rendering.js**: `blendInto(target, x, y, targetR, targetG, amount)`, `dirToTarget(dirx, diry)`, `stampInto(target, cx, cy, dirx, diry, radius, strength, feather)`, `rotationalVector(dx, dy, d, rotDir, spiral)`, `renderConstraintTo(target, c)`, `renderPenStrokeTo(target, stroke)`, `floodFillBrush(target, startX, startY, dirx, diry, strength, tolerance)`, `renderComposite()`, `blurOnce()`, `serializeProject()`, `saveToStorage()`

**overlay.js**: `drawArrowHead(ctx, x, y, angle, size)`, `drawOverlay()`, `hitTestConstraint(px, py)`, `hitArrowHandle(px, py, s)`

**layers.js**: `makeBrushLayer()`, `refreshLayerPanel()`, `hideLayerProps()`, `updateLayerProps(layer)`, `selectLayer(id)`

**interaction.js**: `getPos(e)`, `clearPreview()`, `finishPenPath()`

**ui.js**: `toast(msg)`, `showHUD(clientX, clientY, text, bar)`, `hideHUD()`, `pushUndo()`, `setTool(t)`, `loadProject(json)`

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

### Adding a New Tool

1. Add tool key to `index.html` toolbar with `data-tool="name"` and SVG icon
2. Add keyboard shortcut to the map in `ui.js` (`{ 'key': 'toolname' }`)
3. Add tool-specific options section in `index.html` (if needed), wire visibility in `setTool()`
4. Add pointer event handling in `interaction.js` (pointerdown/move/up branches)
5. Add rendering support in `rendering.js` if the tool produces new layer types
6. Add layer type handling in `layers.js` for thumbnails and property editors

### Adding a New Layer Type

1. Define the layer shape in `interaction.js` where the layer is created
2. Add rendering case in `rendering.js` `renderComposite()` switch
3. Add thumbnail rendering in `layers.js` `generateLayerThumb()`
4. Add property editor in `layers.js` `updateLayerProps()`
5. Add hit-testing in `overlay.js` `hitTestConstraint()` if selectable

## Gotchas

- `flowCtx` is created with `{ willReadFrequently: true }` — required for `putImageData` performance
- `setStageSize` resizes all 4 canvases to the same pixel dimensions and scales them to fit the viewport
- The `queueRender()` function in `interaction.js` coalesces rapid renders into a single `requestAnimationFrame` — use it during drag operations, call `renderComposite()` directly for final state
- Brush pixel data is a flat `Uint8ClampedArray` (CW×CH×4), not an `ImageData` — indices are `(y * CW + x) * 4`
- The demo modal lazy-loads Three.js from `https://esm.sh/three@0.172.0` via importmap in `index.html`
