# Flow Map Studio

A browser-based tool for painting RGB-encoded flow direction maps. Paint directional constraints onto a canvas and export a PNG where the R and G channels encode horizontal and vertical flow direction.

## What it does

Flow maps encode surface direction as color: **R = horizontal**, **G = vertical**, **128 = neutral**. This tool lets you paint those maps interactively using brushes, pen paths, and geometric constraints (arrows, circles, swirls).

## Tools

| Tool | Key | Description |
|------|-----|-------------|
| **Select** | `V` | Click to select constraints or pen paths. Drag to move. Drag endpoint handles on arrows. Alt+click to delete pen anchors. Click on a pen path to insert a new anchor point. |
| **Brush** | `B` | Paint flow direction by dragging. Direction follows your stroke. |
| **Eraser** | `E` | Paint neutral (128,128) to erase flow data. |
| **Pen** | `P` | Click to place anchor points. Drag while clicking to create bezier handles (curves like Figma/Photoshop). Click the first point to close the path. `Escape` to finish an open path. |
| **Arrow** | `A` | Click and drag to create a directional constraint along a line segment. |
| **Circle** | `C` | Click and drag to create a rotational flow constraint (CW/CCW). |
| **Swirl** | `S` | Like Circle but with an adjustable spiral factor. |

## Layers

The right panel shows all layers (bottom-to-top). Three types:

- **Brush** - Raw pixel data painted freely
- **Pen** - Bezier path with sampled direction stamps
- **Constraint** (Arrow/Circle/Swirl) - Geometric flow shapes

Each layer has a visibility toggle and delete button. Click a layer to select it.

## Right Panel

- **Resizable** - Drag the handle between the canvas and panel to resize (180-500px)
- **Top half** - Tool-specific options (brush size/strength/feather, constraint radius, etc.)
- **Bottom half** - Layer list

## Features

- **Reference image** - Load an image as a background overlay with adjustable opacity
- **Flow opacity** - Control the visibility of the painted flow data
- **Blur** - Apply Gaussian blur passes to soften the flow map
- **Encoding options** - Invert R/G channels for different pipeline conventions
- **Undo** - `Ctrl+Z` (up to 30 steps)
- **Export** - Export the flow map as a PNG
- **Demo** - Three.js particle visualization of the flow field

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `V` | Select tool |
| `B` | Brush tool |
| `E` | Eraser tool |
| `P` | Pen tool |
| `A` | Arrow tool |
| `C` | Circle tool |
| `S` | Swirl tool |
| `Delete` / `Backspace` | Delete selected layer |
| `Escape` | Finish pen path |
| `Ctrl+Z` | Undo |

## Architecture

### File structure

```
index.html          - All HTML markup (191 lines)
src/main.js         - Entire application logic (~1325 lines, single file, vanilla JS)
src/style.css       - All styles (~256 lines)
vite.config.js      - Vite config, only externalizes `three`
```

No framework. No component system. No state management library. Everything is vanilla DOM manipulation in one JS file.

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

// Constraint layer (arrow/circle/swirl)
{ id, type: 'constraint', name: 'Arrow'|'Circle'|'Swirl', visible,
  shape: {
    type: 'arrow',   x1, y1, x2, y2, radius, strength, feather
    type: 'circle',  cx, cy, radius, strength, feather, rotationDir
    type: 'swirl',   cx, cy, radius, strength, feather, rotationDir, spiralFactor
  }}
```

### Rendering pipeline

`renderComposite()` rebuilds the entire `flowCanvas` from scratch every call:

1. Fill with neutral gray (128,128,128,255)
2. For each visible layer (bottom-to-top):
   - **Brush**: copy non-neutral pixels directly into `flowData`
   - **Pen**: call `renderPenStrokeTo()` which samples bezier curves → stamps each point
   - **Constraint**: call `renderConstraintTo()` which stamps along the shape geometry
3. `putImageData()` onto `flowCanvas`
4. Call `drawOverlay()` to update selection indicators

### Key functions (src/main.js)

| Function | Line | Purpose |
|----------|------|---------|
| `stampInto()` | 68 | Core renderer: writes a feathered circle of direction data into a pixel buffer |
| `renderComposite()` | 140 | Rebuilds the entire flow canvas from all layers |
| `drawOverlay()` | 163 | Draws selection handles, bezier control points, bounding boxes |
| `hitTestConstraint()` | ~212 | Top-to-bottom hit test for constraints and pen paths |
| `hitArrowHandle()` | ~240 | Hit test for arrow endpoint square handles |
| `samplePenPath()` | ~250 | Samples bezier anchors into `{x,y,dirx,diry}` points for rendering |
| `insertPenAnchor()` | ~270 | Inserts a new anchor point on a pen path at the nearest spot |
| `refreshLayerPanel()` | ~503 | Rebuilds the layer list DOM from scratch |
| `selectLayer()` | ~550 | Sets selected layer, switches to select tool, redraws overlay |
| `setTool()` | ~616 | Switches active tool, shows/hides option panels, finishes pen paths |
| `pushUndo()` | ~275 | Snapshots all layers to undo stack (brush data copied, others JSON-serialized) |
| `drawPenPreviewBezier()` | ~864 | Draws pen path preview with anchors, handles, and bezier curves |
| `renderPenStrokeTo()` | 129 | Renders a pen layer by sampling bezier curves and stamping each point |

### Event flow

All pointer events go to `previewCanvas` (z-index 3, topmost). `getPos(e)` converts screen → canvas coords. The `pointerdown`/`pointermove`/`pointerup` handlers branch on `currentTool`:

- **Brush/Eraser**: stamps into the active brush layer's pixel buffer
- **Pen**: manages `penAnchors[]` array, creates bezier handles on drag, calls `finishPenPath()` on Escape or tool switch
- **Arrow/Circle/Swirl**: draws preview during drag, creates constraint layer on pointerup
- **Select**: hit tests, then branches into arrow endpoint dragging, pen anchor/handle dragging, or whole-shape moving

### Non-obvious patterns

- `flowData` is the single source of truth for rendered output. It's rebuilt from layers every time.
- Undo serializes layers to JSON (brush data `.slice()`ed separately). 30-step limit.
- The right panel is resizable via a 4px drag handle that sets `--rpanel-w` CSS variable.
- Pen bezier handles are symmetric: dragging h2 mirrors to h1 (`h1 = 2*anchor - h2`).
- `hitTestConstraint()` checks pen paths by sampling bezier segments at t=0.05 intervals.
- Brush layers are never hit-tested by select tool — only constraints and pen paths are selectable.

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

Output goes to `dist/`.
