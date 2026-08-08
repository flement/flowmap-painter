# Tools Reference

All tools live in the left toolbar. Keyboard shortcuts are shown in each tool's tooltip.

| Key | Tool | Purpose |
|---|---|---|
| V | Select | Select/move layers, edit pen paths & constraints |
| B | Brush | Paint flow from gesture direction |
| E | Eraser | Erase the active brush layer (reveals layers below) |
| P | Pen | Draw bezier flow paths |
| F | Fill | Flood-fill a connected region with one direction |
| A | Arrow | Straight-line flow field |
| C | Circle | Tangential (rotational) flow |
| S | Swirl | Rotational flow with spiral + optional cyclone profile |
| D | Radial | Flow radiating out from / into a center |
| W | Wave | Sinusoidal flow path |
| I | Inspect | Read the flow direction at the cursor (pipette) |

## Select (V)

Click a constraint, pen path, or other selectable layer to select it. Clicking empty
canvas deselects. Selecting a layer in the Layers panel auto-switches the tool
(brush layers → Brush, everything else → Select).

- **Drag a shape** to move it (arrows/waves keep their relative endpoints).
- **Arrows / waves**: drag the endpoint handles to reshape.
- **Pen paths**: drag an anchor to move it (both handles follow); drag a handle to
  reshape the curve (opposite handle mirrors); drag between anchors to move the whole path.
- **Alt+click an anchor** deletes it (kept only if >2 anchors remain).
- **Shift+click the path** inserts a new anchor at the nearest curve point.
- **Delete/Backspace** removes the selected layer.

## Brush (B)

Paints a soft, feathered flow stamp following your cursor's direction of travel. Paints
into the selected brush layer (or the top visible brush layer; a brush layer is created
if none exists).

Options:
- **Size** — stamp diameter (radius = size / 2).
- **Strength** — 0–1 opacity per stamp.
- **Feather** — soft edge width as a fraction of the radius.
- **Smooth** — EMA low-pass on the cursor path (0% raw, 100% heavily smoothed).
- **Fixed direction** — paint a constant direction instead of the gesture direction.
  When enabled, set the **R** (horizontal) and **G** (vertical) values directly; the
  preview swatch shows the resulting color and arrow.

Direction is only captured once the cursor has moved 4px (prevents jitter). On direction
changes the stamp color interpolates across the segment for smooth turns.

## Eraser (E)

Like the brush, but reduces the active brush layer's alpha — it only reveals lower
layers, it never touches other layer types. Painting back over erased areas rebuilds them.

## Pen (P)

Draws a cubic bezier path. The direction at each point follows the curve's tangent.

1. **Click** to drop the first anchor.
2. **Drag** to shape the outgoing handle.
3. **Click** to add the next anchor (a mirrored handle is created automatically).
4. **Click the first anchor** (within 10px) to close the path, or press **Escape** /
   switch tools to finish.

Stroke thickness/strength/feather are taken from the current brush settings. Editing is
done with the Select tool.

## Arrow (A)

Click-drag to stamp a straight-line flow field along the drag vector, with feathered
stamp radius at both ends. Per-shape options (radius/strength/feather) can be tweaked
afterwards in the layer's Properties panel.

## Circle (C)

Click-drag to set the center and radius of a circular flow. Flow is tangential to the
circle, either clockwise or counterclockwise (Direction toggle). The center itself is a
calm point.

## Swirl (S)

Click-drag to define a spiral flow. Builds on Circle with:

- **Spiral** — tangential vs. inward radial mix (−1..+1). Negative spirals outward.
- **Cyclone profile** — a modified-Rankine wind profile instead of uniform spiral:
  - **Eye size** — calm center radius (fraction of the total radius).
  - **Eye softness** — how abruptly wind rises from the eye to the eyewall.
  - **Eyewall** — radius of peak wind (fraction of total radius).
  - **Decay** — power-law falloff of wind beyond the eyewall.
  - **Rainbands** — number of spiral band modulations.
  - **Band strength** — amplitude of the band modulation.
  - Spiral inflow grows with radius, tightening the spiral toward the core.

## Radial (D)

Click-drag to define the center and radius. Flow points straight out from (or straight
in to) the center — toggle **Out**/**In**.

## Wave (W)

Click-drag to define the wave axis. Flow is sinusoidal, displaced perpendicular to the
axis:

- **Frequency** — number of full sine cycles along the axis.
- **Amplitude** — peak perpendicular displacement in px.
- **Offset** — phase shift.

Stamps along the curve with a small radius, so overlapping waves layer additively.

## Fill (F)

Click-drag to set a direction; on release the tool flood-fills the connected region of
similar R/G values on the active brush layer. Clicking without dragging fills downward.

- **Strength** — 0–1 blend amount.
- **Tolerance** — max R/G difference (0–127) a neighbor may have to be included.

The fill reads the *composited* map but writes only to the active brush layer.

## Inspect (I)

Read-only pipette. Hovering shows the composited flow at the cursor as a 100px direction
arrow and the raw R/G values in the HUD. Clicks and wheel-scroll are no-ops. No layer is
created or modified.

## Shared interactions

**Scroll-wheel adjustment** — with the pointer over the canvas:

| Modifier | Brush / Eraser / Pen | Fill | Constraints |
|---|---|---|---|
| — | Size | Tolerance | Radius |
| Shift | Strength | Strength | Strength |
| Ctrl/Cmd | Feather | Tolerance | Feather |

The HUD shows the current value with a color-coded bar (green <50%, yellow 50–80%, red
>80%).

**HUD** — a floating readout near the cursor shows size/radius/strength and, while
painting, the current R/G direction values.

**Undo** — Ctrl/Cmd+Z undoes the last destructive action (max 30 steps).

**Layer panel** — bottom half of the right panel. Add Brush/Blur/Mask layers, reorder by
dragging, toggle visibility, or delete. Selecting a layer switches the active tool.

- **Blur layer** — applies `passes` box-blur passes to the whole composited map after all
  lower layers. Because it blurs everything, a visible blur layer defeats partial
  (dirty-rect) rendering.
- **Mask layer** — scales existing flow toward neutral by image intensity. Options:
  threshold, invert, and coastal foam (width/strength) that orients flow along mask edges.

**Demo** — the Demo button opens a Three.js modal visualizing the flow map as animated
water. Lazy-loads the bundled `three` npm package on first use.
