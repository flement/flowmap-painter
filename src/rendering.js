import { state } from './state.js';
import { clamp8, flowCtx, TAU } from './canvas.js';
import { samplePenPath } from './bezier.js';
import { drawOverlay } from './overlay.js';
import { debouncedSave } from './project.js';

export function blendInto(target, x, y, targetR, targetG, amount) {
  if (x < 0 || x >= state.CW || y < 0 || y >= state.CH || amount <= 0) return;
  const i = (y * state.CW + x) * 4;
  const oldR = target[i], oldG = target[i + 1];
  target[i] = clamp8(oldR + (targetR - oldR) * amount);
  target[i + 1] = clamp8(oldG + (targetG - oldG) * amount);
  target[i + 2] = 128;
  target[i + 3] = 255;
}

export function dirToTarget(dirx, diry) {
  const tr = 128 + dirx * 127 * (state.invertX ? -1 : 1);
  const tg = 128 - diry * 127 * (state.invertY ? -1 : 1);
  return [tr, tg];
}

export function stampInto(target, cx, cy, dirx, diry, radius, strength, feather) {
  const [targetR, targetG] = dirToTarget(dirx, diry);
  const r2 = radius * radius;
  const edge0 = radius * (1 - feather);
  const denom = Math.max(1, radius - edge0);
  const minX = Math.max(0, Math.floor(cx - radius)), maxX = Math.min(state.CW - 1, Math.ceil(cx + radius));
  const minY = Math.max(0, Math.floor(cy - radius)), maxY = Math.min(state.CH - 1, Math.ceil(cy + radius));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const dx = x - cx, dy = y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      const d = Math.sqrt(d2);
      const a = d <= edge0 ? strength : strength * (1 - (d - edge0) / denom);
      blendInto(target, x, y, targetR, targetG, a);
    }
  }
}

export function rotationalVector(dx, dy, d, rotDir, spiral) {
  const r = Math.max(d, 1.0);
  const invR = 1.0 / r;
  const tx = -dy * rotDir * invR;
  const ty = dx * rotDir * invR;
  const radialIn = -spiral;
  let vx = tx + dx * invR * radialIn;
  let vy = ty + dy * invR * radialIn;
  const vlen = Math.hypot(vx, vy) || 1;
  return [vx / vlen, vy / vlen];
}

export function renderConstraintTo(target, c) {
  if (c.type === 'arrow') {
    const dx = c.x2 - c.x1, dy = c.y2 - c.y1;
    const len = Math.hypot(dx, dy);
    if (len < 4) return;
    const dirx = dx / len, diry = dy / len;
    const spacing = Math.max(4, c.radius * 0.5);
    const steps = Math.max(1, Math.ceil(len / spacing));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      stampInto(target, c.x1 + dx * t, c.y1 + dy * t, dirx, diry, c.radius, c.strength, c.feather);
    }
  } else if (c.type === 'radial') {
    const edge0 = c.radius * (1 - c.feather);
    const denom = Math.max(1, c.radius - edge0);
    const minX = Math.max(0, Math.floor(c.cx - c.radius)), maxX = Math.min(state.CW - 1, Math.ceil(c.cx + c.radius));
    const minY = Math.max(0, Math.floor(c.cy - c.radius)), maxY = Math.min(state.CH - 1, Math.ceil(c.cy + c.radius));
    const dir = c.rotationDir;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const dx = x - c.cx, dy = y - c.cy;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > c.radius || d < 0.75) continue;
        const ux = dx / d, uy = dy / d;
        const [targetR, targetG] = dirToTarget(ux * dir, uy * dir);
        const a = d <= edge0 ? c.strength : c.strength * (1 - (d - edge0) / denom);
        blendInto(target, x, y, targetR, targetG, a);
      }
    }
  } else if (c.type === 'wave') {
    const dx = c.x2 - c.x1, dy = c.y2 - c.y1;
    const len = Math.hypot(dx, dy);
    if (len < 4) return;
    const dirx = dx / len, diry = dy / len;
    const perpX = -diry, perpY = dirx;
    const freq = c.frequency || 1;
    const amp = c.amplitude || 0;
    const off = c.offset || 0;
    const stampR = c.radius * 0.4;
    const steps = Math.max(20, Math.ceil(len / 4));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const baseX = c.x1 + dx * t, baseY = c.y1 + dy * t;
      const waveOffset = Math.sin(t * freq * TAU + off) * amp;
      const px = baseX + perpX * waveOffset, py = baseY + perpY * waveOffset;
      stampInto(target, px, py, dirx, diry, stampR, c.strength, c.feather);
    }
  } else if (c.type === 'circle' || c.type === 'swirl') {
    const edge0 = c.radius * (1 - c.feather);
    const denom = Math.max(1, c.radius - edge0);
    const minX = Math.max(0, Math.floor(c.cx - c.radius)), maxX = Math.min(state.CW - 1, Math.ceil(c.cx + c.radius));
    const minY = Math.max(0, Math.floor(c.cy - c.radius)), maxY = Math.min(state.CH - 1, Math.ceil(c.cy + c.radius));
    const spiral = c.type === 'swirl' ? c.spiralFactor : 0;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const dx = x - c.cx, dy = y - c.cy;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > c.radius || d < 0.75) continue;
        const [vx, vy] = rotationalVector(dx, dy, d, c.rotationDir, spiral);
        const [targetR, targetG] = dirToTarget(vx, vy);
        const a = d <= edge0 ? c.strength : c.strength * (1 - (d - edge0) / denom);
        blendInto(target, x, y, targetR, targetG, a);
      }
    }
  }
}

export function renderPenStrokeTo(target, stroke) {
  let pts = stroke.points;
  if (stroke.anchors && stroke.anchors.length >= 2) {
    pts = samplePenPath(stroke.anchors, stroke.closed);
  }
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    stampInto(target, p.x, p.y, p.dirx, p.diry, stroke.radius, stroke.strength, stroke.feather);
  }
}

export function floodFillBrush(target, startX, startY, dirx, diry, strength, tolerance) {
  const w = state.CW, h = state.CH;
  startX = Math.round(startX); startY = Math.round(startY);
  if (startX < 0 || startX >= w || startY < 0 || startY >= h) return;
  const original = new Uint8Array(target);
  const visited = new Uint8Array(w * h);
  const [targetR, targetG] = dirToTarget(dirx, diry);
  const startIdx = (startY * w + startX) * 4;
  const startR = original[startIdx], startG = original[startIdx + 1];
  const stack = [startX, startY];
  while (stack.length > 0) {
    const y = stack.pop(), x = stack.pop();
    const key = y * w + x;
    if (visited[key]) continue;
    const i = key * 4;
    if (Math.abs(original[i] - startR) > tolerance || Math.abs(original[i + 1] - startG) > tolerance) continue;
    visited[key] = 1;
    blendInto(target, x, y, targetR, targetG, strength);
    if (x > 0) stack.push(x - 1, y);
    if (x < w - 1) stack.push(x + 1, y);
    if (y > 0) stack.push(x, y - 1);
    if (y < h - 1) stack.push(x, y + 1);
  }
}

export function renderComposite() {
  state.flowImageData = flowCtx.createImageData(state.CW, state.CH);
  state.flowData = state.flowImageData.data;
  for (let i = 0; i < state.flowData.length; i += 4) {
    state.flowData[i] = 128; state.flowData[i + 1] = 128; state.flowData[i + 2] = 128; state.flowData[i + 3] = 255;
  }
  for (const layer of state.layers) {
    if (!layer.visible) continue;
    if (layer.type === 'brush') {
      for (let i = 0; i < state.flowData.length; i += 4) {
        const dr = layer.data[i] - 128, dg = layer.data[i + 1] - 128;
        if (dr !== 0 || dg !== 0) {
          const amt = Math.max(Math.abs(dr), Math.abs(dg)) / 127;
          state.flowData[i] = clamp8(128 + dr * amt + (state.flowData[i] - 128) * (1 - amt));
          state.flowData[i + 1] = clamp8(128 + dg * amt + (state.flowData[i + 1] - 128) * (1 - amt));
        }
      }
    } else if (layer.type === 'pen') {
      renderPenStrokeTo(state.flowData, layer);
    } else if (layer.type === 'constraint') {
      renderConstraintTo(state.flowData, layer.shape);
    } else if (layer.type === 'mask' && layer.maskData) {
      for (let y = 0; y < state.CH; y++) {
        for (let x = 0; x < state.CW; x++) {
          const fi = (y * state.CW + x) * 4;
          const mx = Math.floor(x * layer.maskData.width / state.CW);
          const my = Math.floor(y * layer.maskData.height / state.CH);
          const mi = (my * layer.maskData.width + mx) * 4;
          const amt = layer.maskData.data[mi] / 255;
          state.flowData[fi] = clamp8(128 + (state.flowData[fi] - 128) * amt);
          state.flowData[fi + 1] = clamp8(128 + (state.flowData[fi + 1] - 128) * amt);
        }
      }
    }
  }
  flowCtx.putImageData(state.flowImageData, 0, 0);
  drawOverlay();
  debouncedSave();
}

export function blurOnce() {
  const tmp = new Float32Array(state.CW * state.CH * 2);
  for (let y = 0; y < state.CH; y++) {
    const row = y * state.CW;
    for (let x = 0; x < state.CW; x++) {
      const xm = x > 0 ? x - 1 : 0, xp = x < state.CW - 1 ? x + 1 : state.CW - 1;
      const i0 = (row + xm) * 4, i1 = (row + x) * 4, i2 = (row + xp) * 4;
      const r = (state.flowData[i0] + state.flowData[i1] + state.flowData[i2]) / 3;
      const g = (state.flowData[i0 + 1] + state.flowData[i1 + 1] + state.flowData[i2 + 1]) / 3;
      const ti = (row + x) * 2;
      tmp[ti] = r; tmp[ti + 1] = g;
    }
  }
  for (let x = 0; x < state.CW; x++) {
    for (let y = 0; y < state.CH; y++) {
      const ym = y > 0 ? y - 1 : 0, yp = y < state.CH - 1 ? y + 1 : state.CH - 1;
      const t0 = (ym * state.CW + x) * 2, t1 = (y * state.CW + x) * 2, t2 = (yp * state.CW + x) * 2;
      const r = (tmp[t0] + tmp[t1] + tmp[t2]) / 3;
      const g = (tmp[t0 + 1] + tmp[t1 + 1] + tmp[t2 + 1]) / 3;
      const di = (y * state.CW + x) * 4;
      state.flowData[di] = clamp8(r); state.flowData[di + 1] = clamp8(g); state.flowData[di + 2] = 128; state.flowData[di + 3] = 255;
    }
  }
}
