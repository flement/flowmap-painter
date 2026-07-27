export function cubicBezier(t, p0, p1, p2, p3) {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

export function sampleBezierSeg(a, b, count) {
  const out = [];
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    out.push({
      x: cubicBezier(t, a.x, a.h2x, b.h1x, b.x),
      y: cubicBezier(t, a.y, a.h2y, b.h1y, b.y),
    });
  }
  return out;
}

export function samplePenPath(anchors, closed) {
  if (anchors.length < 2) return [];
  const segs = closed ? anchors.length : anchors.length - 1;
  const pts = [];
  for (let i = 0; i < segs; i++) {
    const a = anchors[i], b = anchors[(i + 1) % anchors.length];
    const samples = sampleBezierSeg(a, b, Math.max(1, Math.floor(Math.hypot(b.x - a.x, b.y - a.y) / 8)));
    if (i > 0) samples.shift();
    pts.push(...samples);
  }
  for (let i = 0; i < pts.length; i++) {
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(pts.length - 1, i + 1)];
    const dx = next.x - prev.x, dy = next.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    pts[i].dirx = dx / len;
    pts[i].diry = dy / len;
  }
  return pts;
}

const TAU = Math.PI * 2;

export function drawPenPath(ctx, anchors, closed) {
  if (anchors.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(anchors[0].x, anchors[0].y);
  for (let i = 1; i < anchors.length; i++) {
    const a = anchors[i - 1], b = anchors[i];
    ctx.bezierCurveTo(a.h2x, a.h2y, b.h1x, b.h1y, b.x, b.y);
  }
  if (closed && anchors.length > 2) {
    const a = anchors[anchors.length - 1], b = anchors[0];
    ctx.bezierCurveTo(a.h2x, a.h2y, b.h1x, b.h1y, b.x, b.y);
  }
  ctx.stroke();
}

export function drawPenHandles(ctx, anchors, opts = {}) {
  const { handleRadius = 4, anchorSize = 5, firstColor = 'rgba(242,184,75,0.95)', otherColor = 'rgba(255,255,255,0.9)' } = opts;
  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i];
    if (a.h1x !== a.x || a.h1y !== a.y) {
      ctx.strokeStyle = 'rgba(61,220,151,0.6)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(a.h1x, a.h1y); ctx.stroke();
      ctx.beginPath(); ctx.arc(a.h1x, a.h1y, handleRadius, 0, TAU);
      ctx.fillStyle = 'rgba(61,220,151,0.9)'; ctx.fill();
      ctx.strokeStyle = '#1a1c22'; ctx.lineWidth = 1; ctx.stroke();
    }
    if (a.h2x !== a.x || a.h2y !== a.y) {
      ctx.strokeStyle = 'rgba(61,220,151,0.6)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(a.h2x, a.h2y); ctx.stroke();
      ctx.beginPath(); ctx.arc(a.h2x, a.h2y, handleRadius, 0, TAU);
      ctx.fillStyle = 'rgba(61,220,151,0.9)'; ctx.fill();
      ctx.strokeStyle = '#1a1c22'; ctx.lineWidth = 1; ctx.stroke();
    }
    ctx.fillStyle = i === 0 ? firstColor : otherColor;
    ctx.strokeStyle = '#1a1c22'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.rect(a.x - anchorSize, a.y - anchorSize, anchorSize * 2, anchorSize * 2);
    ctx.fill(); ctx.stroke();
  }
}

export function hitPenAnchor(px, py, anchors, threshold) {
  for (let i = anchors.length - 1; i >= 0; i--) {
    if (Math.hypot(px - anchors[i].x, py - anchors[i].y) <= threshold) return i;
  }
  return -1;
}

export function insertPenAnchor(anchors, px, py) {
  let bestSeg = -1, bestDist = Infinity;
  for (let i = 0; i < anchors.length - 1; i++) {
    const a = anchors[i], b = anchors[i + 1];
    for (let t = 0; t <= 1; t += 0.02) {
      const bx = cubicBezier(t, a.x, a.h2x, b.h1x, b.x);
      const by = cubicBezier(t, a.y, a.h2y, b.h1y, b.y);
      const d = Math.hypot(px - bx, py - by);
      if (d < bestDist) { bestDist = d; bestSeg = i + 1; }
    }
  }
  if (bestSeg < 0 || bestDist > 20) return false;
  anchors.splice(bestSeg, 0, { x: px, y: py, h1x: px, h1y: py, h2x: px, h2y: py });
  return true;
}
