// ============================================================
// AUTO-FLOW FROM IMAGE — DISABLED
// To restore: uncomment the body below, then uncomment the
// `import { initAutoflow, updateWaterPreview } from './autoflow.js';`
// and `initAutoflow();` in ui.js, and the auto-flow section in
// index.html (Reference panel).
// ============================================================
/*
import { state } from './state.js';
import { imgCanvas, imgCtx, clamp8 } from './canvas.js';
import { blurOnce, renderComposite } from './rendering.js';
import { makeBrushLayer, refreshLayerPanel } from './layers.js';
import { pushUndo, toast } from './ui.js';

function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0, s = max === 0 ? 0 : d / max, v = max;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return [h * 360, s, v];
}

function hueInWaterRange(hue, center, range) {
  const half = range / 2;
  const diff = Math.abs(hue - center);
  return Math.min(diff, 360 - diff) <= half;
}

function getWaterMask(w, h, src, center, range) {
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i++) {
    const [hue, sat, val] = rgbToHsv(src[i * 4], src[i * 4 + 1], src[i * 4 + 2]);
    mask[i] = (sat > 0.15 && val > 0.1 && hueInWaterRange(hue, center, range)) ? 1 : 0;
  }
  return mask;
}

const waterPreviewCanvas = document.getElementById('waterPreview');
const waterPreviewCtx = waterPreviewCanvas.getContext('2d');
const hueBarCanvas = document.getElementById('waterHueBar');
const hueBarCtx = hueBarCanvas.getContext('2d');

function drawHueBar() {
  const w = hueBarCanvas.width, h = hueBarCanvas.height;
  const imgData = hueBarCtx.createImageData(w, h);
  const d = imgData.data;
  const center = parseInt(document.getElementById('waterHue').value, 10);
  const range = parseInt(document.getElementById('waterRange').value, 10);
  for (let x = 0; x < w; x++) {
    const hue = (x / w) * 360;
    const inRange = hueInWaterRange(hue, center, range);
    for (let y = 0; y < h; y++) {
      const i = (y * w + x) * 4;
      const hh = hue / 60, c = 1, x2 = c * (1 - Math.abs(hh % 2 - 1));
      let r, g, b;
      if (hh < 1) { r = c; g = x2; b = 0; }
      else if (hh < 2) { r = x2; g = c; b = 0; }
      else if (hh < 3) { r = 0; g = c; b = x2; }
      else if (hh < 4) { r = 0; g = x2; b = c; }
      else if (hh < 5) { r = x2; g = 0; b = c; }
      else { r = c; g = 0; b = x2; }
      d[i] = r * 255 * (inRange ? 1 : 0.25);
      d[i + 1] = g * 255 * (inRange ? 1 : 0.25);
      d[i + 2] = b * 255 * (inRange ? 1 : 0.25);
      d[i + 3] = 255;
    }
  }
  hueBarCtx.putImageData(imgData, 0, 0);
  const lx1 = ((center - range / 2 + 360) % 360) / 360 * w;
  const lx2 = ((center + range / 2) % 360) / 360 * w;
  hueBarCtx.strokeStyle = '#fff';
  hueBarCtx.lineWidth = 1;
  if (lx1 < lx2) {
    hueBarCtx.strokeRect(lx1, 0, lx2 - lx1, h);
  } else {
    hueBarCtx.strokeRect(0, 0, lx2, h);
    hueBarCtx.strokeRect(lx1, 0, w - lx1, h);
  }
}

export function updateWaterPreview() {
  const w = state.CW, h = state.CH;
  if (w === 0 || h === 0) return;
  const src = imgCtx.getImageData(0, 0, w, h).data;
  const center = parseInt(document.getElementById('waterHue').value, 10);
  const range = parseInt(document.getElementById('waterRange').value, 10);
  const mask = getWaterMask(w, h, src, center, range);
  drawHueBar();

  const pw = 80, ph = 56;
  const imgData = waterPreviewCtx.createImageData(pw, ph);
  const d = imgData.data;
  const sx = w / pw, sy = h / ph;
  for (let py = 0; py < ph; py++) {
    for (let px = 0; px < pw; px++) {
      const si = Math.floor(py * sy) * w + Math.floor(px * sx);
      const di = (py * pw + px) * 4;
      if (mask[si]) {
        d[di] = 40; d[di + 1] = 120; d[di + 2] = 220; d[di + 3] = 255;
      } else {
        const r = src[si * 4], g = src[si * 4 + 1], b = src[si * 4 + 2];
        d[di] = r * 0.4; d[di + 1] = g * 0.4; d[di + 2] = b * 0.4; d[di + 3] = 255;
      }
    }
  }
  waterPreviewCtx.putImageData(imgData, 0, 0);
}

export function initAutoflow() {
  const autoGenBtn = document.getElementById('autoGenBtn');
  document.getElementById('waterHue').addEventListener('input', e => {
    document.getElementById('waterHueVal').textContent = e.target.value + '\u00B0';
    updateWaterPreview();
  });
  document.getElementById('waterRange').addEventListener('input', e => {
    document.getElementById('waterRangeVal').textContent = e.target.value + '\u00B0';
    updateWaterPreview();
  });
  document.getElementById('autoBlur').addEventListener('input', e => {
    document.getElementById('autoBlurVal').textContent = e.target.value;
  });

  autoGenBtn.addEventListener('click', () => {
    if (imgCanvas.width === 0 || imgCanvas.height === 0) { toast('Load an image first'); return; }
    pushUndo();
    const w = state.CW, h = state.CH;
    const src = imgCtx.getImageData(0, 0, w, h).data;
    const center = parseInt(document.getElementById('waterHue').value, 10);
    const range = parseInt(document.getElementById('waterRange').value, 10);
    const mask = getWaterMask(w, h, src, center, range);

    const gray = new Float32Array(w * h);
    for (let i = 0; i < gray.length; i++) gray[i] = (src[i * 4] * 0.299 + src[i * 4 + 1] * 0.587 + src[i * 4 + 2] * 0.114) / 255;

    const layer = makeBrushLayer();
    const d = layer.data;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (!mask[i]) continue;
        const gx = -gray[i - w - 1] - 2 * gray[i - 1] - gray[i + w - 1]
                 + gray[i - w + 1] + 2 * gray[i + 1] + gray[i + w + 1];
        const gy = -gray[i - w - 1] - 2 * gray[i - w] - gray[i - w + 1]
                 + gray[i + w - 1] + 2 * gray[i + w] + gray[i + w + 1];
        const mag = Math.hypot(gx, gy);
        if (mag < 0.01) continue;
        const dx = -gy / mag, dy = gx / mag;
        const s = Math.min(mag * 4, 1);
        const pi = i * 4;
        d[pi] = clamp8(128 + dx * 127 * s);
        d[pi + 1] = clamp8(128 - dy * 127 * s);
      }
    }
    layer.name = 'Auto-flow';
    state.layers.push(layer);
    const passes = parseInt(document.getElementById('autoBlur').value, 10);
    for (let p = 0; p < passes; p++) blurOnce();
    refreshLayerPanel();
    renderComposite();
    toast('Flow map generated from image');
  });
}
*/
