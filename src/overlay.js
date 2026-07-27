import { state } from './state.js';
import { ovCtx, HANDLE_RADIUS, TAU } from './canvas.js';
import { cubicBezier, drawPenPath, drawPenHandles } from './bezier.js';

const GOLD = 'rgba(242,184,75,0.85)';
const GOLD_DIM = 'rgba(242,184,75,0.35)';
const GOLD_BBOX = 'rgba(242,184,75,0.4)';
const GOLD_BRIGHT = 'rgba(242,184,75,0.95)';
const DARK = '#1a1c22';
const CONSTRAINT_HIT_MARGIN = 8;
const PEN_ANCHOR_HIT = 15;
const PEN_HANDLE_HIT = 12;

export function drawArrowHead(ctx, x, y, angle, size) {
  ctx.save();
  ctx.translate(x, y); ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-size, -size * 0.5);
  ctx.lineTo(-size, size * 0.5);
  ctx.closePath();
  ctx.fillStyle = GOLD;
  ctx.fill();
  ctx.restore();
}

function getConstraintBBox(s) {
  if (s.type === 'arrow' || s.type === 'wave') {
    const x = Math.min(s.x1, s.x2) - s.radius;
    const y = Math.min(s.y1, s.y2) - s.radius;
    const w = Math.abs(s.x2 - s.x1) + s.radius * 2;
    const h = Math.abs(s.y2 - s.y1) + s.radius * 2;
    return { x, y, w, h };
  }
  return { x: s.cx - s.radius, y: s.cy - s.radius, w: s.radius * 2, h: s.radius * 2 };
}

export function drawOverlay() {
  ovCtx.clearRect(0, 0, state.CW, state.CH);
  if (state.selectedLayerId == null) return;
  const layer = state.layers.find(l => l.id === state.selectedLayerId);
  if (!layer) return;
  if (layer.type === 'constraint') {
    const s = layer.shape;
    ovCtx.strokeStyle = GOLD;
    ovCtx.lineWidth = 2;
    if (s.type === 'arrow') {
      ovCtx.beginPath();
      ovCtx.moveTo(s.x1, s.y1);
      ovCtx.lineTo(s.x2, s.y2);
      ovCtx.stroke();
      const ang = Math.atan2(s.y2 - s.y1, s.x2 - s.x1);
      drawArrowHead(ovCtx, s.x2, s.y2, ang, 14);
      ovCtx.setLineDash([4, 4]);
      ovCtx.strokeStyle = GOLD_DIM;
      ovCtx.beginPath(); ovCtx.arc(s.x1, s.y1, s.radius, 0, TAU); ovCtx.stroke();
      ovCtx.beginPath(); ovCtx.arc(s.x2, s.y2, s.radius, 0, TAU); ovCtx.stroke();
      ovCtx.setLineDash([]);
      for (const [hx, hy] of [[s.x1, s.y1], [s.x2, s.y2]]) {
        ovCtx.fillStyle = GOLD_BRIGHT;
        ovCtx.strokeStyle = DARK;
        ovCtx.lineWidth = 2;
        ovCtx.beginPath();
        ovCtx.rect(hx - HANDLE_RADIUS, hy - HANDLE_RADIUS, HANDLE_RADIUS * 2, HANDLE_RADIUS * 2);
        ovCtx.fill(); ovCtx.stroke();
      }
    } else if (s.type === 'circle' || s.type === 'swirl' || s.type === 'radial') {
      ovCtx.setLineDash([5, 4]);
      ovCtx.beginPath(); ovCtx.arc(s.cx, s.cy, s.radius, 0, TAU); ovCtx.stroke();
      ovCtx.setLineDash([]);
      ovCtx.beginPath(); ovCtx.arc(s.cx, s.cy, 4, 0, TAU);
      ovCtx.fillStyle = GOLD_BRIGHT; ovCtx.fill();
    } else if (s.type === 'wave') {
      ovCtx.beginPath();
      ovCtx.moveTo(s.x1, s.y1);
      ovCtx.lineTo(s.x2, s.y2);
      ovCtx.stroke();
      ovCtx.setLineDash([4, 4]);
      ovCtx.strokeStyle = GOLD_DIM;
      ovCtx.beginPath(); ovCtx.arc(s.x1, s.y1, s.radius, 0, TAU); ovCtx.stroke();
      ovCtx.beginPath(); ovCtx.arc(s.x2, s.y2, s.radius, 0, TAU); ovCtx.stroke();
      ovCtx.setLineDash([]);
      for (const [hx, hy] of [[s.x1, s.y1], [s.x2, s.y2]]) {
        ovCtx.fillStyle = GOLD_BRIGHT;
        ovCtx.strokeStyle = DARK;
        ovCtx.lineWidth = 2;
        ovCtx.beginPath();
        ovCtx.rect(hx - HANDLE_RADIUS, hy - HANDLE_RADIUS, HANDLE_RADIUS * 2, HANDLE_RADIUS * 2);
        ovCtx.fill(); ovCtx.stroke();
      }
    }
    const bb = getConstraintBBox(s);
    ovCtx.strokeStyle = GOLD_BBOX;
    ovCtx.lineWidth = 1;
    ovCtx.setLineDash([3, 3]);
    ovCtx.strokeRect(bb.x, bb.y, bb.w, bb.h);
    ovCtx.setLineDash([]);
  } else if (layer.type === 'pen' && layer.anchors && layer.anchors.length >= 2) {
    ovCtx.strokeStyle = GOLD;
    ovCtx.lineWidth = 2;
    drawPenPath(ovCtx, layer.anchors, layer.closed);
    drawPenHandles(ovCtx, layer.anchors, { handleRadius: 5, anchorSize: 5 });
  }
}

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

export function hitTestConstraint(px, py) {
  for (let i = state.layers.length - 1; i >= 0; i--) {
    const layer = state.layers[i];
    if (!layer.visible) continue;
    if (layer.type === 'constraint') {
      const s = layer.shape;
      if (s.type === 'arrow' || s.type === 'wave') {
        const dist = distToSegment(px, py, s.x1, s.y1, s.x2, s.y2);
        if (dist < s.radius + CONSTRAINT_HIT_MARGIN) return layer;
      } else if (s.type === 'circle' || s.type === 'swirl' || s.type === 'radial') {
        const d = Math.hypot(px - s.cx, py - s.cy);
        if (d <= s.radius + CONSTRAINT_HIT_MARGIN) return layer;
      }
    } else if (layer.type === 'pen' && layer.anchors && layer.anchors.length >= 2) {
      for (const a of layer.anchors) {
        if (Math.hypot(px - a.x, py - a.y) < PEN_ANCHOR_HIT) return layer;
        if ((a.h1x !== a.x || a.h1y !== a.y) && Math.hypot(px - a.h1x, py - a.h1y) < PEN_HANDLE_HIT) return layer;
        if ((a.h2x !== a.x || a.h2y !== a.y) && Math.hypot(px - a.h2x, py - a.h2y) < PEN_HANDLE_HIT) return layer;
      }
      const segs = layer.closed ? layer.anchors.length : layer.anchors.length - 1;
      for (let i = 0; i < segs; i++) {
        const a = layer.anchors[i], b = layer.anchors[(i + 1) % layer.anchors.length];
        for (let t = 0; t <= 1; t += 0.02) {
          const bx = cubicBezier(t, a.x, a.h2x, b.h1x, b.x);
          const by = cubicBezier(t, a.y, a.h2y, b.h1y, b.y);
          if (Math.hypot(px - bx, py - by) < PEN_ANCHOR_HIT) return layer;
        }
      }
    }
  }
  return null;
}

export function hitArrowHandle(px, py, s) {
  if (Math.hypot(px - s.x1, py - s.y1) <= HANDLE_RADIUS + 4) return 'p1';
  if (Math.hypot(px - s.x2, py - s.y2) <= HANDLE_RADIUS + 4) return 'p2';
  return null;
}
