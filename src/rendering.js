import { state } from './state.js';
import { clamp8, flowCtx, TAU } from './canvas.js';
import { samplePenPath } from './bezier.js';
import { drawOverlay } from './overlay.js';
import { debouncedSave } from './project.js';

export function blendInto(target, x, y, targetR, targetG, amount) {
  if (x < 0 || x >= state.CW || y < 0 || y >= state.CH || amount <= 0) return;
  const i = (y * state.CW + x) * 4;
  const a255 = Math.round(amount * 255);
  target[i] = clamp8(target[i] + (targetR - target[i]) * amount);
  target[i + 1] = clamp8(target[i + 1] + (targetG - target[i + 1]) * amount);
  target[i + 2] = 128;
  if (a255 > target[i + 3]) target[i + 3] = a255;
}

export function dirToTarget(dirx, diry) {
  const tr = 128 + dirx * 127 * (state.invertX ? -1 : 1);
  const tg = 128 - diry * 127 * (state.invertY ? -1 : 1);
  return [tr, tg];
}

export function stampInto(target, cx, cy, dirx, diry, radius, strength, feather) {
  const [targetR, targetG] = dirToTarget(dirx, diry);
  stampBrush(target, cx, cy, targetR, targetG, radius, strength, feather);
}

export function stampBrush(target, cx, cy, targetR, targetG, radius, strength, feather) {
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
      const t = d <= edge0 ? 0 : (d - edge0) / denom;
      const a = strength * (1 - t * t * (3 - 2 * t));
      blendInto(target, x, y, targetR, targetG, a);
    }
  }
}

export function eraseInto(target, cx, cy, radius, strength, feather) {
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
      const t = d <= edge0 ? 0 : (d - edge0) / denom;
      const a = strength * (1 - t * t * (3 - 2 * t));
      if (a <= 0) continue;
      const i = (y * state.CW + x) * 4;
      target[i + 3] = Math.round(target[i + 3] * (1 - a));
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
    const isSwirl = c.type === 'swirl';
    const spiral = isSwirl ? c.spiralFactor : 0;
    const cyclone = isSwirl && c.cyclone !== false;
    const eye = cyclone ? c.radius * (c.cycloneEye ?? 0.12) : 0;
    const soft = cyclone ? Math.max(0, Math.min(1, c.cycloneEyeSoft ?? 0.5)) : 0;
    const rMax = cyclone ? c.radius * Math.max(c.cycloneEyewall ?? 0.25, c.cycloneEye ?? 0.12) : 0;
    const decay = cyclone ? (c.cycloneDecay ?? 0.6) : 0;
    const bands = cyclone ? (c.cycloneBands ?? 0) : 0;
    const bandAmp = cyclone ? (c.cycloneBandAmp ?? 0.3) : 0;
    const riseSpan = rMax - eye;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const dx = x - c.cx, dy = y - c.cy;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > c.radius || d < 0.75) continue;
        let a;
        if (cyclone) {
          if (d < eye) {
            const t = d / eye;
            const calm = 1 - t * t * (3 - 2 * t);
            blendInto(target, x, y, 128, 128, c.strength * calm);
            continue;
          }
          let t;
          if (d < rMax) {
            const u = riseSpan > 0 ? Math.min(1, (d - eye) / riseSpan) : 1;
            t = Math.pow(u, soft * 2);
          } else {
            t = Math.pow(rMax / Math.max(rMax, d), decay);
          }
          if (d > edge0) {
            const tt = (d - edge0) / denom;
            t *= 1 - tt * tt * (3 - 2 * tt);
          }
          if (bands > 0 && bandAmp > 0) {
            const mod = 1 + bandAmp * Math.sin(Math.atan2(dy, dx) - (d / c.radius) * bands * TAU);
            t *= mod > 0 ? mod : 0;
          }
          a = c.strength * t;
        } else {
          a = d <= edge0 ? c.strength : c.strength * (1 - (d - edge0) / denom);
        }
        const [vx, vy] = rotationalVector(dx, dy, d, c.rotationDir, cyclone ? spiral * (d / c.radius) : spiral);
        const [targetR, targetG] = dirToTarget(vx, vy);
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
  const spacing = Math.max(4, stroke.radius * 0.5);
  let lastX = null, lastY = null;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (lastX !== null && (p.x - lastX) * (p.x - lastX) + (p.y - lastY) * (p.y - lastY) < spacing * spacing) continue;
    stampInto(target, p.x, p.y, p.dirx, p.diry, stroke.radius, stroke.strength, stroke.feather);
    lastX = p.x; lastY = p.y;
  }
}

export function floodFillBrush(target, startX, startY, dirx, diry, strength, tolerance) {
  const w = state.CW, h = state.CH;
  startX = Math.round(startX); startY = Math.round(startY);
  if (startX < 0 || startX >= w || startY < 0 || startY >= h) return;
  const src = state.flowData || new Uint8Array(target);
  const visited = new Uint8Array(w * h);
  const [targetR, targetG] = dirToTarget(dirx, diry);
  const startIdx = (startY * w + startX) * 4;
  const startR = src[startIdx], startG = src[startIdx + 1];
  const stack = [startX, startY];
  while (stack.length > 0) {
    const y = stack.pop(), x = stack.pop();
    const key = y * w + x;
    if (visited[key]) continue;
    const i = key * 4;
    if (Math.abs(src[i] - startR) > tolerance || Math.abs(src[i + 1] - startG) > tolerance) continue;
    visited[key] = 1;
    blendInto(target, x, y, targetR, targetG, strength);
    if (x > 0) stack.push(x - 1, y);
    if (x < w - 1) stack.push(x + 1, y);
    if (y > 0) stack.push(x, y - 1);
    if (y < h - 1) stack.push(x, y + 1);
  }
}

export function renderCoastFoam(layer) {
  const md = layer.maskData;
  const W = md.width, H = md.height;
  const mdata = md.data;
  const bin = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) bin[i] = mdata[i * 4] > 0 ? 1 : 0;
  const dist = new Float32Array(W * H);
  const INF = 1e6;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const v = bin[i];
      const edge = (x > 0 && bin[i - 1] !== v) || (x < W - 1 && bin[i + 1] !== v)
                || (y > 0 && bin[i - W] !== v) || (y < H - 1 && bin[i + W] !== v);
      dist[i] = edge ? 0 : INF;
    }
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      let d = dist[i];
      if (x > 0 && dist[i - 1] + 1 < d) d = dist[i - 1] + 1;
      if (y > 0 && dist[i - W] + 1 < d) d = dist[i - W] + 1;
      if (x > 0 && y > 0 && dist[i - W - 1] + 1.4142 < d) d = dist[i - W - 1] + 1.4142;
      if (x < W - 1 && y > 0 && dist[i - W + 1] + 1.4142 < d) d = dist[i - W + 1] + 1.4142;
      dist[i] = d;
    }
  }
  for (let y = H - 1; y >= 0; y--) {
    for (let x = W - 1; x >= 0; x--) {
      const i = y * W + x;
      let d = dist[i];
      if (x < W - 1 && dist[i + 1] + 1 < d) d = dist[i + 1] + 1;
      if (y < H - 1 && dist[i + W] + 1 < d) d = dist[i + W] + 1;
      if (x < W - 1 && y < H - 1 && dist[i + W + 1] + 1.4142 < d) d = dist[i + W + 1] + 1.4142;
      if (x > 0 && y < H - 1 && dist[i + W - 1] + 1.4142 < d) d = dist[i + W - 1] + 1.4142;
      dist[i] = d;
    }
  }
  const N = layer.coastWidth;
  const strength = layer.coastStrength == null ? 0.8 : layer.coastStrength;
  for (let y = 0; y < state.CH; y++) {
    for (let x = 0; x < state.CW; x++) {
      const mx = Math.floor(x * W / state.CW), my = Math.floor(y * H / state.CH);
      const mi = my * W + mx;
      if (!bin[mi]) continue;
      const d = dist[mi];
      if (d <= 0 || d > N) continue;
      const xm = mx > 0 ? mi - 1 : mi + 1, xp = mx < W - 1 ? mi + 1 : mi - 1;
      const ym = my > 0 ? mi - W : mi + W, yp = my < H - 1 ? mi + W : mi - W;
      const gx = dist[xp] - dist[xm], gy = dist[yp] - dist[ym];
      const len = Math.hypot(gx, gy) || 1;
      const [tr, tg] = dirToTarget(gx / len, gy / len);
      const amt = mdata[mi * 4] / 255;
      blendInto(state.flowData, x, y, tr, tg, strength * (N - d + 1) / N * amt);
    }
  }
}

function applyBrushPixel(flow, ld, i) {
  const a = ld[i + 3];
  if (a <= 0) return;
  if (a >= 255) {
    flow[i] = ld[i];
    flow[i + 1] = ld[i + 1];
  } else {
    const amt = a / 255;
    flow[i] = clamp8(flow[i] + (ld[i] - flow[i]) * amt);
    flow[i + 1] = clamp8(flow[i + 1] + (ld[i + 1] - flow[i + 1]) * amt);
  }
}

function fillNeutral(data, x0, y0, x1, y1) {
  for (let y = y0; y <= y1; y++) {
    let i = (y * state.CW + x0) * 4;
    for (let x = x0; x <= x1; x++, i += 4) {
      data[i] = 128; data[i + 1] = 128; data[i + 2] = 128; data[i + 3] = 255;
    }
  }
}

export function renderComposite(dirty = null) {
  if (!state.flowImageData || state.flowImageData.width !== state.CW || state.flowImageData.height !== state.CH) {
    state.flowImageData = flowCtx.createImageData(state.CW, state.CH);
    state.flowData = state.flowImageData.data;
  }
  const flow = state.flowData;
  const partial = dirty !== null && !state.layers.some(l => l.visible && l.type !== 'brush');
  if (partial) {
    fillNeutral(flow, dirty.x0, dirty.y0, dirty.x1, dirty.y1);
  } else {
    fillNeutral(flow, 0, 0, state.CW - 1, state.CH - 1);
  }
  for (const layer of state.layers) {
    if (!layer.visible) continue;
    if (layer.type === 'brush') {
      const ld = layer.data;
      if (partial) {
        for (let y = dirty.y0; y <= dirty.y1; y++) {
          let i = (y * state.CW + dirty.x0) * 4;
          for (let x = dirty.x0; x <= dirty.x1; x++, i += 4) {
            applyBrushPixel(flow, ld, i);
          }
        }
      } else {
        for (let i = 0; i < flow.length; i += 4) applyBrushPixel(flow, ld, i);
      }
    } else if (layer.type === 'pen') {
      renderPenStrokeTo(flow, layer);
    } else if (layer.type === 'constraint') {
      renderConstraintTo(flow, layer.shape);
    } else if (layer.type === 'mask' && layer.maskData) {
      for (let y = 0; y < state.CH; y++) {
        for (let x = 0; x < state.CW; x++) {
          const fi = (y * state.CW + x) * 4;
          const mx = Math.floor(x * layer.maskData.width / state.CW);
          const my = Math.floor(y * layer.maskData.height / state.CH);
          const mi = (my * layer.maskData.width + mx) * 4;
          const amt = layer.maskData.data[mi] / 255;
          flow[fi] = clamp8(128 + (flow[fi] - 128) * amt);
          flow[fi + 1] = clamp8(128 + (flow[fi + 1] - 128) * amt);
        }
      }
      if (layer.coastEnabled && layer.coastWidth > 0) renderCoastFoam(layer);
    } else if (layer.type === 'blur' && layer.passes > 0) {
      for (let p = 0; p < layer.passes; p++) blurOnce();
    }
  }
  if (partial) {
    flowCtx.putImageData(state.flowImageData, 0, 0, dirty.x0, dirty.y0, dirty.x1 - dirty.x0 + 1, dirty.y1 - dirty.y0 + 1);
  } else {
    flowCtx.putImageData(state.flowImageData, 0, 0);
  }
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

window.__fs = window.__fs || {};
window.__fs.renderComposite = renderComposite;
