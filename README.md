# Flow Map Studio

A browser-based tool for painting RGB-encoded flow direction maps. Paint directional constraints onto a canvas and export a PNG where the R and G channels encode horizontal and vertical flow direction.

## What it does

Flow maps encode surface direction as color: **R = horizontal**, **G = vertical**, **128 = neutral**. This tool lets you paint those maps interactively using brushes, pen paths, and geometric constraints (arrows, circles, swirls, radial, wave).

## Tools

| Tool | Key | Description |
|------|-----|-------------|
| **Select** | `V` | Click to select constraints or pen paths. Drag to move. Drag endpoint handles on arrows. Alt+click to delete pen anchors. Click on a pen path to insert a new anchor point. |
| **Brush** | `B` | Paint flow direction by dragging. Direction follows your stroke. |
| **Eraser** | `E` | Paint neutral (128,128) to erase flow data. |
| **Pen** | `P` | Click to place anchor points. Drag while clicking to create bezier handles (curves like Figma/Photoshop). Click the first point to close the path. `Escape` to finish an open path. |
| **Fill** | `F` | Click and drag to flood fill an area with a direction. |
| **Arrow** | `A` | Click and drag to create a directional constraint along a line segment. |
| **Circle** | `C` | Click and drag to create a rotational flow constraint (CW/CCW). |
| **Swirl** | `S` | Like Circle but with an adjustable spiral factor. |
| **Radial** | `D` | Click and drag to create a radial flow constraint (outward/inward from center). |
| **Wave** | `W` | Click and drag to create a sinusoidal wave flow path with perpendicular displacement. |

## Layers

The right panel shows all layers (bottom-to-top). Four types:

- **Brush** - Raw pixel data painted freely
- **Pen** - Bezier path with sampled direction stamps
- **Constraint** (Arrow/Circle/Swirl/Radial/Wave) - Geometric flow shapes
- **Mask** - Image-based mask that scales flow intensity

Each layer has a visibility toggle and delete button. Click a layer to select it.

## Right Panel

- **Resizable** - Drag the handle between the canvas and panel to resize (180-500px)
- **Top half** - Tool-specific options (brush size/strength/feather, constraint radius/strength/feather, etc.)
- **Bottom half** - Layer list

## Features

- **Reference image** - Load an image as a background overlay with adjustable opacity
- **Flow opacity** - Control the visibility of the painted flow data
- **Blur** - Apply blur passes to soften the flow map
- **Encoding options** - Invert R/G channels for different pipeline conventions
- **Undo** - `Ctrl+Z` (up to 30 steps)
- **Export** - Export the flow map as a PNG
- **Project save/load** - Save and restore your work as a JSON file, auto-persists to localStorage
- **Auto-flow** - Generate a flow map from a loaded reference image (water mask detection)
- **Demo** - Three.js particle visualization of the flow field

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `V` | Select tool |
| `B` | Brush tool |
| `E` | Eraser tool |
| `P` | Pen tool |
| `F` | Fill tool |
| `A` | Arrow tool |
| `C` | Circle tool |
| `S` | Swirl tool |
| `D` | Radial tool |
| `W` | Wave tool |
| `Delete` / `Backspace` | Delete selected layer |
| `Escape` | Finish pen path |
| `Ctrl+Z` | Undo |

## Architecture

### File structure

```
index.html          - HTML markup
src/main.js         - Entry point, init sequence, imports side-effect modules
src/state.js        - Shared mutable state object (no deps)
src/canvas.js       - DOM refs for 4 stacked canvases, setStageSize(), TAU, HANDLE_RADIUS
src/bezier.js       - Pure math: cubic bezier, path sampling, pen anchor hit-test,
                      drawPenPath(), drawPenHandles()
src/overlay.js      - Selection overlay drawing, hit-testing, named color constants
src/rendering.js    - Flow map compositing, blur, stamping
src/layers.js       - Layer CRUD, layer panel UI, thumbnails, property editors
src/preview.js      - All pointer event handlers, pen tool, brush painting, scroll wheel
src/tools.js        - setTool(), tool button wiring, CW/CCW toggle
src/ui.js           - Toast, HUD, undo/redo, resize, panel, image loading, keyboard shortcuts
src/autoflow.js     - Image-to-flow generation (water mask, hue bar)
src/project.js      - Serialization, localStorage persistence, save/load
src/demo.js         - Three.js water visualization modal
src/style.css       - All styles
vite.config.js      - Vite config, externalizes `three`
```

### Canvas stack (4 layered canvases)

```
imgCanvas       - Reference image (bottom)
flowCanvas      - The actual flow map pixel data
overlayCanvas   - Selection indicators, bounding boxes (pointer-events: none)
previewCanvas   - Hover/interaction previews (receives all pointer events)
```

All canvases are sized identically via `setStageSize()`. The visible `#stage` div is CSS-scaled to fit the viewport; canvas pixel coordinates are computed from screen coords via `getPos()`.

### Flow encoding

Pixels encode direction as RGB color:

```
R = 128 + dirx * 127    (horizontal: 0=left, 128=neutral, 255=right)
G = 128 - diry * 127    (vertical: 0=up, 128=neutral, 255=down)
B = 128 (always)
A = 255 (always)
```

Key functions: `dirToTarget(dirx, diry)` → `[R, G]`, `blendInto()` → writes one pixel, `stampInto()` → writes a circular area with feathered edge.

### Data models

```js
// Brush layer
{ id, type: 'brush', name: 'Brush', visible, data: Uint8ClampedArray(CW*CH*4) }

// Pen layer (bezier)
{ id, type: 'pen', name: 'Pen Path', visible,
  anchors: [{ x, y, h1x, h1y, h2x, h2y }],  // h1=incoming handle, h2=outgoing handle
  closed: boolean,
  points: [{ x, y, dirx, diry }],             // sampled from anchors for rendering
  radius, strength, feather }

// Constraint layer
{ id, type: 'constraint', name: 'Arrow'|'Circle'|'Swirl'|'Radial'|'Wave', visible,
  shape: {
    type: 'arrow',   x1, y1, x2, y2, radius, strength, feather
    type: 'circle',  cx, cy, radius, strength, feather, rotationDir
    type: 'swirl',   cx, cy, radius, strength, feather, rotationDir, spiralFactor
    type: 'radial',  cx, cy, radius, strength, feather, rotationDir
    type: 'wave',    x1, y1, x2, y2, radius, strength, feather, frequency, amplitude, offset
  }}

// Mask layer
{ id, type: 'mask', name: 'Mask', visible, maskData: ImageData, rawMaskData: ImageData|null }
```

### Rendering pipeline

`renderComposite()` rebuilds the entire `flowCanvas` from scratch every call:

1. Fill with neutral gray (128,128,128,255)
2. For each visible layer (bottom-to-top):
   - **Brush**: copy non-neutral pixels directly into `flowData`
   - **Pen**: call `renderPenStrokeTo()` which samples bezier curves → stamps each point
   - **Constraint**: call `renderConstraintTo()` which stamps along the shape geometry
   - **Mask**: scale existing flow data by mask intensity per-pixel
3. `putImageData()` onto `flowCanvas`
4. Call `drawOverlay()` to update selection indicators
5. Call `debouncedSave()` to persist to localStorage

### Module responsibilities

| Module | Purpose |
|--------|---------|
| `state.js` | Shared mutable state (no imports) |
| `canvas.js` | DOM refs, `setStageSize()`, `clamp8()`, `TAU`, `HANDLE_RADIUS` |
| `bezier.js` | Cubic bezier math, path sampling, `drawPenPath()`, `drawPenHandles()` |
| `overlay.js` | Selection drawing, hit-testing, named color/threshold constants |
| `rendering.js` | Flow compositing, blur, `stampInto()`, `floodFillBrush()` |
| `layers.js` | Layer CRUD, panel UI, thumbnails, property editors |
| `preview.js` | Pointer events, pen tool, brush painting, scroll wheel, hover preview |
| `tools.js` | `setTool()`, tool button wiring |
| `ui.js` | Toast, HUD, undo/redo, resize, image loading, keyboard shortcuts |
| `autoflow.js` | Image-to-flow generation |
| `project.js` | Serialization, localStorage persistence |
| `demo.js` | Three.js water visualization |

### Event flow

All pointer events go to `previewCanvas` (z-index 3, topmost). `getPos(e)` converts screen → canvas coords. The `pointerdown`/`pointermove`/`pointerup` handlers branch on `currentTool`:

- **Brush/Eraser**: stamps into the active brush layer's pixel buffer
- **Pen**: manages `penAnchors[]` array, creates bezier handles on drag, calls `finishPenPath()` on Escape or tool switch
- **Arrow/Circle/Swirl/Radial/Wave**: draws preview during drag, creates constraint layer on pointerup
- **Select**: hit tests, then branches into arrow endpoint dragging, pen anchor/handle dragging, or whole-shape moving

### Non-obvious patterns

- `flowData` is the single source of truth for rendered output. It's rebuilt from layers every time.
- Undo serializes layers to JSON (brush data `.slice()`ed separately). 30-step limit.
- The right panel is resizable via a 4px drag handle that sets `--rpanel-w` CSS variable.
- Pen bezier handles are symmetric: dragging h2 mirrors to h1 (`h1 = 2*anchor - h2`).
- `hitTestConstraint()` checks pen paths by sampling bezier segments at t=0.02 intervals.
- Brush layers are never hit-tested by select tool — only constraints and pen paths are selectable.
- `constraintRadius`/`constraintStrength`/`constraintFeather` are shared across all constraint tools.
- Scroll wheel is data-driven via `SCROLL_PARAMS` table, keyed by modifier and tool category.

## Development

```bash
pnpm install
pnpm dev
```

## Build

```bash
pnpm build
```

Output goes to `dist/`.
