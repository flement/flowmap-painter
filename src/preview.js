import { state } from './state.js';
import { previewCanvas, pvCtx, TAU } from './canvas.js';
import { samplePenPath, hitPenAnchor, insertPenAnchor, drawPenPath, drawPenHandles } from './bezier.js';
import { renderComposite, stampInto, rotationalVector, floodFillBrush } from './rendering.js';
import { drawOverlay, drawArrowHead, hitTestConstraint, hitArrowHandle } from './overlay.js';
import { makeBrushLayer, refreshLayerPanel, selectLayer, hideLayerProps } from './layers.js';
import { pushUndo, showHUD, hideHUD } from './ui.js';

const MIN_HANDLE = 12;

function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

export function getPos(e) {
  const rect = previewCanvas.getBoundingClientRect();
  const sx = state.CW / rect.width, sy = state.CH / rect.height;
  return { x: (e.clientX - rect.left) * sx, y: (e.clientY - rect.top) * sy };
}

export function clearPreview() { pvCtx.clearRect(0, 0, state.CW, state.CH); }

function flowAt(p) {
  if (!state.flowData) return null;
  const x = Math.round(p.x), y = Math.round(p.y);
  if (x < 0 || x >= state.CW || y < 0 || y >= state.CH) return null;
  const i = (y * state.CW + x) * 4;
  return { r: state.flowData[i], g: state.flowData[i + 1] };
}

function drawFlowArrow(x, y, r, g) {
  const dirx = (r - 128) / 127 * (state.invertX ? -1 : 1);
  const diry = -(g - 128) / 127 * (state.invertY ? -1 : 1);
  if (Math.abs(dirx) < 0.05 && Math.abs(diry) < 0.05) {
    pvCtx.strokeStyle = 'rgba(255,255,255,0.7)';
    pvCtx.beginPath(); pvCtx.arc(x, y, 3, 0, TAU); pvCtx.stroke();
    return;
  }
  const len = 100;
  const ex = x + dirx * len, ey = y + diry * len;
  pvCtx.strokeStyle = 'rgba(61,220,151,0.95)';
  pvCtx.lineWidth = 2;
  pvCtx.beginPath(); pvCtx.moveTo(x, y); pvCtx.lineTo(ex, ey); pvCtx.stroke();
  drawArrowHead(pvCtx, ex, ey, Math.atan2(diry, dirx), 8);
}

function drawHoverPreview(p) {
  clearPreview();
  pvCtx.lineWidth = 1.5;
  if (state.currentTool === 'brush' || state.currentTool === 'eraser') {
    const r = state.brushSize;
    const feather = state.brushFeather;
    const strength = state.brushStrength;
    if (state.currentTool === 'brush') {
      pvCtx.fillStyle = state.brushFixed
        ? 'rgba(' + state.brushFixedR + ',' + state.brushFixedG + ',128,' + (strength * 0.15).toFixed(2) + ')'
        : 'rgba(242,184,75,' + (strength * 0.15).toFixed(2) + ')';
      pvCtx.beginPath();
      pvCtx.arc(p.x, p.y, r, 0, TAU);
      pvCtx.fill();
      if (feather > 0) {
        const inner = r * (1 - feather);
        pvCtx.strokeStyle = 'rgba(242,184,75,0.35)';
        pvCtx.setLineDash([3, 4]);
        pvCtx.beginPath();
        pvCtx.arc(p.x, p.y, inner, 0, TAU);
        pvCtx.stroke();
        pvCtx.setLineDash([]);
      }
    }
    pvCtx.strokeStyle = state.currentTool === 'eraser' ? 'rgba(255,93,115,0.8)' : 'rgba(242,184,75,0.8)';
    pvCtx.beginPath();
    pvCtx.arc(p.x, p.y, r, 0, TAU);
    pvCtx.stroke();
  } else if (state.currentTool === 'pen') {
    if (state.penAnchors.length > 0) drawPenPreviewBezier();
    pvCtx.strokeStyle = 'rgba(242,184,75,0.8)';
    pvCtx.beginPath();
    pvCtx.arc(p.x, p.y, 6, 0, TAU);
    pvCtx.stroke();
    pvCtx.fillStyle = 'rgba(242,184,75,0.15)';
    pvCtx.fill();
    previewCanvas.style.cursor = 'crosshair';
  } else if (state.currentTool === 'fill') {
    pvCtx.strokeStyle = 'rgba(242,184,75,0.8)';
    pvCtx.lineWidth = 2;
    pvCtx.beginPath();
    pvCtx.arc(p.x, p.y, 10, 0, TAU);
    pvCtx.stroke();
    pvCtx.fillStyle = 'rgba(242,184,75,0.2)';
    pvCtx.fill();
    previewCanvas.style.cursor = 'crosshair';
  } else if (state.currentTool === 'pipette') {
    const v = flowAt(p);
    previewCanvas.style.cursor = 'crosshair';
    pvCtx.strokeStyle = 'rgba(242,184,75,0.9)';
    pvCtx.lineWidth = 1.5;
    pvCtx.beginPath(); pvCtx.arc(p.x, p.y, 9, 0, TAU); pvCtx.stroke();
    pvCtx.beginPath();
    pvCtx.moveTo(p.x - 13, p.y); pvCtx.lineTo(p.x - 4, p.y);
    pvCtx.moveTo(p.x + 4, p.y); pvCtx.lineTo(p.x + 13, p.y);
    pvCtx.moveTo(p.x, p.y - 13); pvCtx.lineTo(p.x, p.y - 4);
    pvCtx.moveTo(p.x, p.y + 4); pvCtx.lineTo(p.x, p.y + 13);
    pvCtx.stroke();
    if (v) drawFlowArrow(p.x, p.y, v.r, v.g);
  } else if (state.currentTool !== 'select') {
    pvCtx.strokeStyle = 'rgba(242,184,75,0.5)';
    pvCtx.setLineDash([5, 4]);
    pvCtx.beginPath();
    pvCtx.arc(p.x, p.y, state.constraintRadius, 0, TAU);
    pvCtx.stroke();
    pvCtx.setLineDash([]);
    pvCtx.beginPath();
    pvCtx.arc(p.x, p.y, 2.5, 0, TAU);
    pvCtx.fillStyle = 'rgba(242,184,75,0.9)';
    pvCtx.fill();
  } else {
    const hit = hitTestConstraint(p.x, p.y);
    if (hit && hit.shape && (hit.shape.type === 'arrow' || hit.shape.type === 'wave')) {
      const handle = hitArrowHandle(p.x, p.y, hit.shape);
      previewCanvas.style.cursor = handle ? 'crosshair' : (hit ? 'grab' : 'default');
    } else {
      previewCanvas.style.cursor = hit ? 'grab' : 'default';
    }
  }
}

function drawArrowPreview(s, p) {
  clearPreview();
  pvCtx.strokeStyle = 'rgba(242,184,75,0.95)';
  pvCtx.lineWidth = 2.5;
  pvCtx.beginPath(); pvCtx.moveTo(s.x, s.y); pvCtx.lineTo(p.x, p.y); pvCtx.stroke();
  const len = Math.hypot(p.x - s.x, p.y - s.y);
  if (len > 4) drawArrowHead(pvCtx, p.x, p.y, Math.atan2(p.y - s.y, p.x - s.x), 12);
  pvCtx.setLineDash([4, 4]);
  pvCtx.strokeStyle = 'rgba(242,184,75,0.35)';
  pvCtx.beginPath(); pvCtx.arc(s.x, s.y, state.constraintRadius, 0, TAU); pvCtx.stroke();
  if (len > 4) { pvCtx.beginPath(); pvCtx.arc(p.x, p.y, state.constraintRadius, 0, TAU); pvCtx.stroke(); }
  pvCtx.setLineDash([]);
}

function drawRotationalPreview(center, p, tool) {
  clearPreview();
  const radius = Math.hypot(p.x - center.x, p.y - center.y);
  pvCtx.strokeStyle = 'rgba(242,184,75,0.8)';
  pvCtx.setLineDash([5, 4]); pvCtx.lineWidth = 1.5;
  pvCtx.beginPath(); pvCtx.arc(center.x, center.y, radius, 0, TAU); pvCtx.stroke();
  pvCtx.setLineDash([]);
  pvCtx.beginPath(); pvCtx.arc(center.x, center.y, 3, 0, TAU);
  pvCtx.fillStyle = 'rgba(242,184,75,0.95)'; pvCtx.fill();
  if (radius < 6) return;
  const isRadial = tool === 'radial';
  const radialDir = tool === 'radial' ? state.rotationDir : 0;
  const spiral = tool === 'swirl' ? state.spiralFactor : 0;
  for (let i = 0; i < 8; i++) {
    const ang = (i / 8) * TAU;
    const dx = Math.cos(ang) * radius, dy = Math.sin(ang) * radius;
    let vx, vy;
    if (isRadial) {
      vx = (dx / radius) * radialDir;
      vy = (dy / radius) * radialDir;
    } else {
      [vx, vy] = rotationalVector(dx, dy, radius, state.rotationDir, spiral);
    }
    const px = center.x + dx, py = center.y + dy;
    pvCtx.strokeStyle = 'rgba(61,220,151,0.9)'; pvCtx.lineWidth = 2;
    pvCtx.beginPath(); pvCtx.moveTo(px, py); pvCtx.lineTo(px + vx * 16, py + vy * 16); pvCtx.stroke();
    drawArrowHead(pvCtx, px + vx * 16, py + vy * 16, Math.atan2(vy, vx), 6);
  }
}

function drawWavePreview(s, p) {
  clearPreview();
  const dx = p.x - s.x, dy = p.y - s.y;
  const len = Math.hypot(dx, dy);
  if (len < 4) return;
  const dirx = dx / len, diry = dy / len;
  const perpX = -diry, perpY = dirx;
  const freq = state.waveFrequency || 1;
  const amp = state.waveAmplitude || Math.round(state.constraintRadius * 0.3);
  const off = state.waveOffset || 0;
  pvCtx.strokeStyle = 'rgba(242,184,75,0.9)';
  pvCtx.lineWidth = 2;
  pvCtx.beginPath();
  const steps = Math.max(20, Math.ceil(len / 4));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const baseX = s.x + dx * t, baseY = s.y + dy * t;
    const waveOffset = Math.sin(t * freq * TAU + off) * amp;
    const px = baseX + perpX * waveOffset, py = baseY + perpY * waveOffset;
    if (i === 0) pvCtx.moveTo(px, py); else pvCtx.lineTo(px, py);
  }
  pvCtx.stroke();
  pvCtx.setLineDash([4, 4]);
  pvCtx.strokeStyle = 'rgba(242,184,75,0.35)';
  pvCtx.beginPath(); pvCtx.arc(s.x, s.y, state.constraintRadius, 0, TAU); pvCtx.stroke();
  if (len > 4) { pvCtx.beginPath(); pvCtx.arc(p.x, p.y, state.constraintRadius, 0, TAU); pvCtx.stroke(); }
  pvCtx.setLineDash([]);
}

function drawPenPreviewBezier() {
  clearPreview();
  if (state.penAnchors.length === 0) return;
  if (state.penAnchors.length >= 2) {
    pvCtx.strokeStyle = 'rgba(242,184,75,0.9)';
    pvCtx.lineWidth = 2;
    drawPenPath(pvCtx, state.penAnchors, state.penClosed);
  }
  drawPenHandles(pvCtx, state.penAnchors, { handleRadius: 3, anchorSize: 4 });
}

export function finishPenPath() {
  if (state.penAnchors.length < 2) {
    if (state.penActiveLayerId != null) {
      const idx = state.layers.findIndex(l => l.id === state.penActiveLayerId);
      if (idx >= 0) state.layers.splice(idx, 1);
    }
    state.penAnchors = []; state.penClosed = false; state.penActiveLayerId = null;
    clearPreview();
    refreshLayerPanel();
    renderComposite();
    return;
  }
  const layer = state.layers.find(l => l.id === state.penActiveLayerId);
  if (layer) {
    layer.anchors = state.penAnchors.map(a => ({ ...a }));
    layer.closed = state.penClosed;
    layer.points = samplePenPath(layer.anchors, state.penClosed);
    layer.radius = state.brushSize;
    layer.strength = state.brushStrength;
    layer.feather = state.brushFeather;
  }
  state.penAnchors = []; state.penClosed = false; state.penActiveLayerId = null;
  refreshLayerPanel();
  renderComposite();
  clearPreview();
}

function hudTextFor(dirx, diry) {
  const [r, g] = [128 + dirx * 127 * (state.invertX ? -1 : 1), 128 - diry * 127 * (state.invertY ? -1 : 1)];
  return 'R:' + Math.round(r) + '  G:' + Math.round(g);
}

export function fixedBrushDir() {
  return [
    (state.brushFixedR - 128) / 127 * (state.invertX ? -1 : 1),
    -(state.brushFixedG - 128) / 127 * (state.invertY ? -1 : 1),
  ];
}

function findActiveBrushLayer() {
  for (let i = state.layers.length - 1; i >= 0; i--) {
    if (state.layers[i].type === 'brush' && state.layers[i].visible) return state.layers[i];
  }
  if (state.layers.length === 0 || state.layers[0].type !== 'brush') {
    const layer = makeBrushLayer();
    state.layers.push(layer);
    refreshLayerPanel();
  }
  return state.layers[0];
}

function queueRender() {
  if (!state.renderQueued) {
    state.renderQueued = true;
    requestAnimationFrame(() => { state.renderQueued = false; renderComposite(); });
  }
}

previewCanvas.addEventListener('pointerdown', e => {
  if (state.currentTool === 'pipette') return;
  previewCanvas.setPointerCapture(e.pointerId);
  const p = getPos(e);
  state.dragging = true;

  if (state.currentTool === 'select') {
    const hit = hitTestConstraint(p.x, p.y);
    if (hit) {
      if (state.selectedLayerId !== hit.id) selectLayer(hit.id);
      state.selectDragLayer = hit;
      state.selectDragStart = { x: p.x, y: p.y };
      pushUndo();
      if (hit.type === 'pen' && hit.anchors) {
        const idx = hitPenAnchor(p.x, p.y, hit.anchors, 12);
        if (idx >= 0) {
          if (e.altKey) {
            if (hit.anchors.length > 2) {
              hit.anchors.splice(idx, 1);
              hit.points = samplePenPath(hit.anchors, hit.closed);
              renderComposite();
            }
            state.selectDragLayer = null;
            return;
          }
          state.selectDragPenIdx = idx;
          state.selectDragPenPart = 'anchor';
          previewCanvas.style.cursor = 'move';
          const a = hit.anchors[idx];
          if (Math.hypot(a.h2x - a.x, a.h2y - a.y) < MIN_HANDLE && Math.hypot(a.h1x - a.x, a.h1y - a.y) < MIN_HANDLE) {
            a.h2x = a.x + MIN_HANDLE * 2; a.h2y = a.y;
            a.h1x = a.x - MIN_HANDLE * 2; a.h1y = a.y;
          }
        } else {
          let handleHit = false;
          for (let i = 0; i < hit.anchors.length; i++) {
            const a = hit.anchors[i];
            if (Math.hypot(p.x - a.h1x, p.y - a.h1y) < 12) {
              state.selectDragPenIdx = i; state.selectDragPenPart = 'h1';
              handleHit = true; break;
            }
            if (Math.hypot(p.x - a.h2x, p.y - a.h2y) < 12) {
              state.selectDragPenIdx = i; state.selectDragPenPart = 'h2';
              handleHit = true; break;
            }
          }
          if (!handleHit) {
            if (e.shiftKey) {
              if (insertPenAnchor(hit.anchors, p.x, p.y)) {
                hit.points = samplePenPath(hit.anchors, hit.closed);
                renderComposite();
              }
              state.selectDragLayer = null;
            } else {
              state.selectDragOffset = { dx: p.x - hit.anchors[0].x, dy: p.y - hit.anchors[0].y };
              previewCanvas.style.cursor = 'grabbing';
            }
          }
        }
      } else {
        const s = hit.shape;
        if (s.type === 'arrow' || s.type === 'wave') {
          const handle = hitArrowHandle(p.x, p.y, s);
          if (handle) {
            state.selectDragEndpoint = handle;
            previewCanvas.style.cursor = 'crosshair';
          } else {
            state.selectDragOffset = { dx: p.x - s.x1, dy: p.y - s.y1 };
            previewCanvas.style.cursor = 'grabbing';
          }
        } else {
          state.selectDragOffset = { dx: p.x - s.cx, dy: p.y - s.cy };
          previewCanvas.style.cursor = 'grabbing';
        }
      }
    } else {
      state.selectedLayerId = null;
      drawOverlay();
      refreshLayerPanel();
      hideLayerProps();
    }
  } else if (state.currentTool === 'brush' || state.currentTool === 'eraser') {
    pushUndo();
    state.brushPath = [{ x: p.x, y: p.y }];
    state.smoothX = p.x; state.smoothY = p.y;
    const layer = findActiveBrushLayer();
    state.lastPaintPos = p;
    if (state.currentTool === 'eraser') {
      stampInto(layer.data, p.x, p.y, 0, 0, state.brushSize, state.brushStrength, state.brushFeather);
      renderComposite();
    }
  } else if (state.currentTool === 'pen') {
    if (state.penAnchors.length === 0) {
      pushUndo();
      state.penAnchors = [{ x: p.x, y: p.y, h1x: p.x - MIN_HANDLE, h1y: p.y, h2x: p.x + MIN_HANDLE, h2y: p.y }];
      state.penClosed = false;
      state.penDraggingHandle = true;
      const layer = {
        id: state.nextId++, type: 'pen', name: 'Pen Path', visible: true,
        points: [], anchors: state.penAnchors, closed: false,
        radius: state.brushSize, strength: state.brushStrength, feather: state.brushFeather,
      };
      state.layers.push(layer);
      state.penActiveLayerId = layer.id;
      refreshLayerPanel();
      renderComposite();
    } else {
      if (state.penAnchors.length > 2 && Math.hypot(p.x - state.penAnchors[0].x, p.y - state.penAnchors[0].y) < 10) {
        state.penClosed = true;
        finishPenPath();
        return;
      }
      const prev = state.penAnchors[state.penAnchors.length - 1];
      const dx = p.x - prev.x, dy = p.y - prev.y;
      const dist = Math.hypot(dx, dy);
      const len = Math.max(MIN_HANDLE, dist / 3);
      const ux = dist ? dx / dist : 0, uy = dist ? dy / dist : 0;
      if (Math.hypot(prev.h2x - prev.x, prev.h2y - prev.y) < MIN_HANDLE) {
        prev.h2x = prev.x + ux * len; prev.h2y = prev.y + uy * len;
      }
      state.penAnchors.push({ x: p.x, y: p.y, h1x: p.x - ux * len, h1y: p.y - uy * len, h2x: p.x + ux * len, h2y: p.y + uy * len });
      state.penDraggingHandle = true;
      const layer = state.layers.find(l => l.id === state.penActiveLayerId);
      if (layer) {
        layer.anchors = state.penAnchors;
        layer.closed = state.penClosed;
        layer.points = samplePenPath(state.penAnchors, state.penClosed);
        renderComposite();
      }
    }
    drawPenPreviewBezier();
  } else {
    state.dragStart = p;
  }
});

previewCanvas.addEventListener('pointermove', e => {
  const p = getPos(e);
  document.getElementById('coordsDisplay').textContent = `x:${Math.round(p.x)} y:${Math.round(p.y)}`;
  if (!state.dragging) {
    drawHoverPreview(p);
    if (state.currentTool !== 'select') {
      if (state.currentTool === 'brush' || state.currentTool === 'eraser') showHUD(e.clientX, e.clientY, 'size ' + state.brushSize + 'px');
      else if (state.currentTool === 'pen') showHUD(e.clientX, e.clientY, state.penAnchors.length > 0 ? `${state.penAnchors.length} anchors \u00B7 click to add` : 'Click to start path');
      else if (state.currentTool === 'fill') showHUD(e.clientX, e.clientY, 'Strength: ' + state.fillStrength.toFixed(2) + ' \u00B7 Tolerance: ' + state.fillTolerance + ' \u00B7 Click & drag');
      else if (state.currentTool === 'pipette') {
        const v = flowAt(p);
        showHUD(e.clientX, e.clientY, v ? 'R:' + v.r + '  G:' + v.g : 'outside canvas');
      }
      else showHUD(e.clientX, e.clientY, 'radius ' + state.constraintRadius + 'px');
    } else {
      const hit = hitTestConstraint(p.x, p.y);
      showHUD(e.clientX, e.clientY, hit ? 'Click to select \u00B7 Drag to move' : 'Click a constraint to select');
    }
    return;
  }

  if (state.currentTool === 'select' && state.selectDragLayer) {
    const moved = Math.hypot(p.x - state.selectDragStart.x, p.y - state.selectDragStart.y);
    if (moved > 2) {
      if (state.selectDragLayer.type === 'pen' && state.selectDragLayer.anchors) {
        if (state.selectDragPenPart) {
          const a = state.selectDragLayer.anchors[state.selectDragPenIdx];
          if (state.selectDragPenPart === 'anchor') {
            const ddx = p.x - a.x, ddy = p.y - a.y;
            a.x = p.x; a.y = p.y;
            a.h1x += ddx; a.h1y += ddy;
            a.h2x += ddx; a.h2y += ddy;
          } else if (state.selectDragPenPart === 'h1') {
            a.h1x = p.x; a.h1y = p.y;
            a.h2x = 2 * a.x - p.x; a.h2y = 2 * a.y - p.y;
          } else if (state.selectDragPenPart === 'h2') {
            a.h2x = p.x; a.h2y = p.y;
            a.h1x = 2 * a.x - p.x; a.h1y = 2 * a.y - p.y;
          }
        } else if (state.selectDragOffset) {
          const newFirstX = p.x - state.selectDragOffset.dx;
          const newFirstY = p.y - state.selectDragOffset.dy;
          const ddx = newFirstX - state.selectDragLayer.anchors[0].x;
          const ddy = newFirstY - state.selectDragLayer.anchors[0].y;
          for (const a of state.selectDragLayer.anchors) {
            a.x += ddx; a.y += ddy;
            a.h1x += ddx; a.h1y += ddy;
            a.h2x += ddx; a.h2y += ddy;
          }
        }
        state.selectDragLayer.points = samplePenPath(state.selectDragLayer.anchors, state.selectDragLayer.closed);
        queueRender();
      } else {
        const s = state.selectDragLayer.shape;
        if (s.type === 'arrow' || s.type === 'wave') {
          if (state.selectDragEndpoint === 'p1') {
            s.x1 = p.x; s.y1 = p.y;
          } else if (state.selectDragEndpoint === 'p2') {
            s.x2 = p.x; s.y2 = p.y;
          } else {
            const nx1 = p.x - state.selectDragOffset.dx, ny1 = p.y - state.selectDragOffset.dy;
            const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
            s.x1 = nx1; s.y1 = ny1;
            s.x2 = nx1 + dx; s.y2 = ny1 + dy;
          }
        } else {
          s.cx = p.x - state.selectDragOffset.dx;
          s.cy = p.y - state.selectDragOffset.dy;
        }
        queueRender();
        showHUD(e.clientX, e.clientY, `Move ${s.type} (${Math.round(p.x)}, ${Math.round(p.y)})`);
      }
    }
  } else if (state.currentTool === 'brush' || state.currentTool === 'eraser') {
    if (state.lastPaintPos) {
      if (state.currentTool === 'brush') {
        const alpha = Math.max(1 - state.brushSmooth, 0.05);
        state.smoothX += (p.x - state.smoothX) * alpha;
        state.smoothY += (p.y - state.smoothY) * alpha;
        state.brushPath.push({ x: state.smoothX, y: state.smoothY });
      } else {
        state.brushPath.push({ x: p.x, y: p.y });
      }
      if (state.brushPath.length > 8) state.brushPath.shift();
      const n = state.brushPath.length;
      if (n >= 2) {
        const pts = state.brushPath;
        const i0 = Math.max(0, n - 3);
        const c0 = pts[i0], c1 = pts[n - 2], c2 = pts[n - 1], c3 = pts[n - 1];
        const dist = Math.hypot(c2.x - c1.x, c2.y - c1.y);
        if (dist > 0.4) {
          const steps = Math.max(1, Math.ceil(dist / 2));
          const layer = findActiveBrushLayer();
          const fixed = state.currentTool === 'brush' && state.brushFixed ? fixedBrushDir() : null;
          for (let s = 0; s <= steps; s++) {
            const t = s / steps;
            const x = catmullRom(c0.x, c1.x, c2.x, c3.x, t);
            const y = catmullRom(c0.y, c1.y, c2.y, c3.y, t);
            const eps = 0.01;
            const ta = Math.max(0, t - eps), tb = Math.min(1, t + eps);
            const tx = catmullRom(c0.x, c1.x, c2.x, c3.x, tb) - catmullRom(c0.x, c1.x, c2.x, c3.x, ta);
            const ty = catmullRom(c0.y, c1.y, c2.y, c3.y, tb) - catmullRom(c0.y, c1.y, c2.y, c3.y, ta);
            const tlen = Math.hypot(tx, ty) || 1;
            const dirx = state.currentTool === 'eraser' ? 0 : (fixed ? fixed[0] : tx / tlen);
            const diry = state.currentTool === 'eraser' ? 0 : (fixed ? fixed[1] : ty / tlen);
            stampInto(layer.data, x, y, dirx, diry, state.brushSize, state.brushStrength, state.brushFeather);
          }
        }
      }
      state.lastPaintPos = p;
      queueRender();
      if (state.currentTool === 'brush') {
        if (state.brushFixed) {
          showHUD(e.clientX, e.clientY, 'R:' + state.brushFixedR + '  G:' + state.brushFixedG);
        } else {
          const n2 = state.brushPath.length;
          if (n2 >= 2) {
            const ddx = state.brushPath[n2 - 1].x - state.brushPath[n2 - 2].x;
            const ddy = state.brushPath[n2 - 1].y - state.brushPath[n2 - 2].y;
            const dl = Math.hypot(ddx, ddy) || 1;
            showHUD(e.clientX, e.clientY, hudTextFor(ddx / dl, ddy / dl));
          }
        }
      } else {
        showHUD(e.clientX, e.clientY, 'eraser');
      }
    }
    drawHoverPreview(p);
  } else if (state.currentTool === 'pen') {
    if (state.penAnchors.length > 0 && state.penDraggingHandle) {
      previewCanvas.style.cursor = 'crosshair';
      const last = state.penAnchors[state.penAnchors.length - 1];
      const hdist = Math.hypot(p.x - last.x, p.y - last.y);
      if (hdist >= MIN_HANDLE) {
        last.h2x = p.x; last.h2y = p.y;
        last.h1x = 2 * last.x - p.x; last.h1y = 2 * last.y - p.y;
      }
      const layer = state.layers.find(l => l.id === state.penActiveLayerId);
      if (layer) {
        layer.anchors = state.penAnchors;
        layer.points = samplePenPath(state.penAnchors, state.penClosed);
        queueRender();
      }
      drawPenPreviewBezier();
    } else if (state.penAnchors.length > 0) {
      drawPenPreviewBezier();
    }
    if (state.penAnchors.length > 0) {
      showHUD(e.clientX, e.clientY, state.penClosed ? 'Path closed' : `${state.penAnchors.length} anchors \u00B7 click to add \u00B7 click first to close`);
    }
  } else if (state.currentTool === 'arrow') {
    drawArrowPreview(state.dragStart, p);
    const dx = p.x - state.dragStart.x, dy = p.y - state.dragStart.y, len = Math.hypot(dx, dy) || 1;
    showHUD(e.clientX, e.clientY, hudTextFor(dx / len, dy / len));
  } else if (state.currentTool === 'circle' || state.currentTool === 'swirl' || state.currentTool === 'radial') {
    drawRotationalPreview(state.dragStart, p, state.currentTool);
    showHUD(e.clientX, e.clientY, 'radius ' + Math.round(Math.hypot(p.x - state.dragStart.x, p.y - state.dragStart.y)) + 'px');
  } else if (state.currentTool === 'wave') {
    drawWavePreview(state.dragStart, p);
    showHUD(e.clientX, e.clientY, hudTextFor((p.x - state.dragStart.x) / (Math.hypot(p.x - state.dragStart.x, p.y - state.dragStart.y) || 1), (p.y - state.dragStart.y) / (Math.hypot(p.x - state.dragStart.x, p.y - state.dragStart.y) || 1)));
  } else if (state.currentTool === 'fill') {
    if (state.dragStart) {
      clearPreview();
      pvCtx.strokeStyle = 'rgba(242,184,75,0.9)';
      pvCtx.lineWidth = 2;
      pvCtx.beginPath();
      pvCtx.moveTo(state.dragStart.x, state.dragStart.y);
      pvCtx.lineTo(p.x, p.y);
      pvCtx.stroke();
      const len = Math.hypot(p.x - state.dragStart.x, p.y - state.dragStart.y);
      if (len > 4) drawArrowHead(pvCtx, p.x, p.y, Math.atan2(p.y - state.dragStart.y, p.x - state.dragStart.x), 12);
      showHUD(e.clientX, e.clientY, hudTextFor((p.x - state.dragStart.x) / (len || 1), (p.y - state.dragStart.y) / (len || 1)));
    }
  }
});

previewCanvas.addEventListener('pointerleave', () => {
  if (!state.dragging) { clearPreview(); hideHUD(); }
});

function adjustParam(e, key, min, max, step, scale, label, fmt, barFn) {
  const v = Math.max(min, Math.min(max, state[key] + (e.deltaY > 0 ? -step : step)));
  state[key] = v;
  const el = document.getElementById(key);
  const valEl = document.getElementById(key + 'Val');
  if (el) el.value = scale ? v * scale : v;
  if (valEl) valEl.textContent = fmt(v);
  showHUD(e.clientX, e.clientY, label + ' ' + fmt(v), barFn ? barFn(v) : undefined);
}

const SCROLL_PARAMS = {
  shift: {
    fill:        { key: 'fillStrength',        min: 0.05, max: 1,   step: 0.02, scale: 100, label: 'strength', fmt: v => v.toFixed(2), bar: v => v },
    brushLike:   { key: 'brushStrength',       min: 0.05, max: 1,   step: 0.02, scale: 100, label: 'strength', fmt: v => v.toFixed(2), bar: v => v, hover: true },
    constraint:  { key: 'constraintStrength',  min: 0.05, max: 1,   step: 0.02, scale: 100, label: 'strength', fmt: v => v.toFixed(2), bar: v => v },
  },
  ctrl: {
    fill:        { key: 'fillTolerance',       min: 0,    max: 127, step: 1,    scale: 0,   label: 'tolerance', fmt: v => '' + v,       bar: v => v / 127 },
    brushLike:   { key: 'brushFeather',        min: 0,    max: 1,   step: 0.02, scale: 100, label: 'feather',   fmt: v => v.toFixed(2), bar: v => v, hover: true },
    constraint:  { key: 'constraintFeather',   min: 0,    max: 1,   step: 0.02, scale: 100, label: 'feather',   fmt: v => v.toFixed(2), bar: v => v },
  },
  none: {
    fill:        { key: 'fillTolerance',       min: 0,    max: 127, step: 1,    scale: 0,   label: 'tolerance', fmt: v => '' + v,       bar: v => v / 127, hover: true },
    brushLike:   { key: 'brushSize',           min: 4,    max: 150, step: 2,    scale: 0,   label: 'size',      fmt: v => v + ' px',   hover: true },
    constraint:  { key: 'constraintRadius',    min: 10,   max: 400, step: 5,    scale: 0,   label: 'radius',    fmt: v => v + ' px',   hover: true },
  },
};

previewCanvas.addEventListener('wheel', e => {
  e.preventDefault();
  const t = state.currentTool;
  if (t === 'pipette') return;
  const cat = t === 'fill' ? 'fill' : (t === 'brush' || t === 'eraser' || t === 'pen') ? 'brushLike' : 'constraint';
  if (t !== 'fill' && cat !== 'brushLike' && cat !== 'constraint') return;
  const mode = e.shiftKey ? 'shift' : (e.ctrlKey || e.metaKey) ? 'ctrl' : 'none';
  const p = SCROLL_PARAMS[mode][cat];
  adjustParam(e, p.key, p.min, p.max, p.step, p.scale, p.label, p.fmt, p.bar);
  if (p.hover) drawHoverPreview(getPos(e));
}, { passive: false });

document.addEventListener('pointerup', e => {
  if (!state.dragging) return;
  state.dragging = false;

  if (state.currentTool === 'select') {
    if (state.selectDragLayer) {
      state.selectDragLayer = null;
      state.selectDragOffset = null;
      state.selectDragStart = null;
      state.selectDragEndpoint = null;
      state.selectDragPenIdx = -1;
      state.selectDragPenPart = null;
      previewCanvas.style.cursor = 'default';
    }
  } else if (state.currentTool === 'arrow') {
    const p = getPos(e);
    pushUndo();
    state.layers.push({
      id: state.nextId++, type: 'constraint', name: 'Arrow', visible: true,
      shape: { type: 'arrow', x1: state.dragStart.x, y1: state.dragStart.y, x2: p.x, y2: p.y,
        radius: state.constraintRadius, strength: state.constraintStrength, feather: state.constraintFeather },
    });
    refreshLayerPanel();
    renderComposite();
  } else if (state.currentTool === 'circle' || state.currentTool === 'swirl' || state.currentTool === 'radial') {
    const p = getPos(e);
    const radius = Math.hypot(p.x - state.dragStart.x, p.y - state.dragStart.y);
    if (radius > 4) {
      pushUndo();
      const names = { circle: 'Circle', swirl: 'Swirl', radial: 'Radial' };
      state.layers.push({
        id: state.nextId++, type: 'constraint', name: names[state.currentTool], visible: true,
        shape: { type: state.currentTool, cx: state.dragStart.x, cy: state.dragStart.y, radius,
          strength: state.constraintStrength, feather: state.constraintFeather, rotationDir: state.rotationDir,
          spiralFactor: state.currentTool === 'swirl' ? state.spiralFactor : 0 },
      });
      refreshLayerPanel();
      renderComposite();
    }
  } else if (state.currentTool === 'wave') {
    const p = getPos(e);
    const len = Math.hypot(p.x - state.dragStart.x, p.y - state.dragStart.y);
    if (len > 4) {
      pushUndo();
      state.layers.push({
        id: state.nextId++, type: 'constraint', name: 'Wave', visible: true,
        shape: { type: 'wave', x1: state.dragStart.x, y1: state.dragStart.y, x2: p.x, y2: p.y,
          radius: state.constraintRadius, strength: state.constraintStrength, feather: state.constraintFeather,
          frequency: state.waveFrequency, amplitude: state.waveAmplitude, offset: state.waveOffset },
      });
      refreshLayerPanel();
      renderComposite();
    }
  } else if (state.currentTool === 'fill') {
    const p = getPos(e);
    const dx = p.x - state.dragStart.x, dy = p.y - state.dragStart.y;
    const len = Math.hypot(dx, dy);
    const dirx = len > 4 ? dx / len : 0;
    const diry = len > 4 ? dy / len : -1;
    pushUndo();
    const layer = findActiveBrushLayer();
    floodFillBrush(layer.data, state.dragStart.x, state.dragStart.y, dirx, diry, state.fillStrength, state.fillTolerance);
    renderComposite();
  } else if (state.currentTool === 'brush' || state.currentTool === 'eraser') {
    renderComposite();
  } else if (state.currentTool === 'pen') {
    state.penDraggingHandle = false;
    if (state.penAnchors.length >= 2) {
      const last = state.penAnchors[state.penAnchors.length - 1];
      const d1 = Math.hypot(last.h1x - last.x, last.h1y - last.y);
      const d2 = Math.hypot(last.h2x - last.x, last.h2y - last.y);
      if (d1 < 5 && d2 < 5) {
        const prev = state.penAnchors[state.penAnchors.length - 2];
        const dx = last.x - prev.x, dy = last.y - prev.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 1) {
          const len = Math.max(MIN_HANDLE, dist / 3);
          const ux = dx / dist, uy = dy / dist;
          last.h1x = last.x - ux * len; last.h1y = last.y - uy * len;
          last.h2x = last.x + ux * len; last.h2y = last.y + uy * len;
        }
      }
    }
    drawPenPreviewBezier();
    state.dragStart = null; state.lastPaintPos = null;
    return;
  }
  clearPreview();
  hideHUD();
  state.dragStart = null; state.lastPaintPos = null;
});
