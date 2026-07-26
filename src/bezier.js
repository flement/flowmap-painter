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
