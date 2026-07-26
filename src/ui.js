import { state } from './state.js';
import { imgCanvas, flowCanvas, previewCanvas, imgCtx, setStageSize, clamp8 } from './canvas.js';
import { renderComposite, blurOnce, stampInto, dirToTarget, serializeProject } from './rendering.js';
import { drawOverlay } from './overlay.js';
import { makeBrushLayer, makeMaskLayer, refreshLayerPanel, hideLayerProps, selectLayer } from './layers.js';
import { finishPenPath, clearPreview } from './interaction.js';
import { launchDemo } from './demo.js';

// ==================== Toast ====================
const toastEl = document.createElement('div');
toastEl.className = 'toast';
document.body.appendChild(toastEl);
let toastTimer = null;
export function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1800);
}

// ==================== HUD ====================
const hud = document.getElementById('hud');
const hudText = document.getElementById('hudText');
const hudBar = document.getElementById('hudBar');
const hudBarFill = document.getElementById('hudBarFill');
export function showHUD(clientX, clientY, text, bar) {
  hud.style.display = 'block';
  hud.style.left = (clientX + 14) + 'px';
  hud.style.top = (clientY + 14) + 'px';
  hudText.textContent = text;
  if (bar != null) {
    const pct = Math.round(Math.max(0, Math.min(1, bar)) * 100);
    hudBar.style.display = 'block';
    hudBarFill.style.width = pct + '%';
    hudBarFill.style.background = bar < 0.5 ? '#3ddc97' : bar < 0.8 ? '#f2b44b' : '#ff6b6b';
  } else {
    hudBar.style.display = 'none';
  }
}
export function hideHUD() { hud.style.display = 'none'; }

// ==================== Project Load ====================
function base64ToUint8(str) {
  const bin = atob(str);
  const arr = new Uint8ClampedArray(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

export function loadProject(json) {
  try {
    const data = typeof json === 'string' ? JSON.parse(json) : json;
    setStageSize(data.CW, data.CH);
    if (data.invertX != null) state.invertX = data.invertX;
    if (data.invertY != null) state.invertY = data.invertY;
    const newLayers = [];
    for (const l of data.layers) {
      if (l.type === 'brush') {
        const layer = makeBrushLayer();
        layer.data.set(base64ToUint8(l.data));
        Object.assign(layer, { id: l.id, name: l.name, visible: l.visible });
        newLayers.push(layer);
      } else if (l.type === 'mask' && l.maskData) {
        const md = l.maskData;
        const maskData = new ImageData(base64ToUint8(md.d), md.w, md.h);
        const rawMd = l.rawMaskData;
        const rawMaskData = rawMd ? new ImageData(base64ToUint8(rawMd.d), rawMd.w, rawMd.h) : null;
        newLayers.push({ ...l, maskData, rawMaskData });
      } else {
        newLayers.push(JSON.parse(JSON.stringify(l)));
      }
    }
    state.layers.length = 0;
    for (const l of newLayers) state.layers.push(l);
    state.nextId = Math.max(state.nextId, ...state.layers.map(l => l.id)) + 1;
    return true;
  } catch { return false; }
}

// ==================== Undo / Redo ====================
export function pushUndo() {
  if (state.undoStack.length >= state.UNDO_LIMIT) state.undoStack.shift();
  state.undoStack.push({
    layers: state.layers.map(l => {
      if (l.type === 'brush') return { ...l, data: l.data.slice() };
      if (l.type === 'mask' && l.maskData) return { ...l, maskData: { width: l.maskData.width, height: l.maskData.height, data: Array.from(l.maskData.data) }, rawMaskData: l.rawMaskData ? { width: l.rawMaskData.width, height: l.rawMaskData.height, data: Array.from(l.rawMaskData.data) } : null };
      return JSON.parse(JSON.stringify(l));
    }),
  });
  updateUndoButton();
}

function undo() {
  if (!state.undoStack.length) { toast('Nothing to undo'); return; }
  const prev = state.undoStack.pop();
  state.layers.length = 0;
  for (const l of prev.layers) {
    if (l.type === 'brush') {
      const newL = makeBrushLayer();
      newL.data.set(l.data);
      Object.assign(newL, { id: l.id, name: l.name, visible: l.visible });
      state.layers.push(newL);
    } else if (l.type === 'mask') {
      const md = l.maskData;
      const imgData = new ImageData(new Uint8ClampedArray(md.data), md.width, md.height);
      const rawMd = l.rawMaskData;
      const rawImgData = rawMd ? new ImageData(new Uint8ClampedArray(rawMd.data), rawMd.width, rawMd.height) : null;
      state.layers.push({ id: l.id, type: 'mask', name: l.name, visible: l.visible, maskData: imgData, rawMaskData: rawImgData, invert: l.invert, threshold: l.threshold });
    } else {
      state.layers.push(JSON.parse(JSON.stringify(l)));
    }
  }
  state.selectedLayerId = null;
  hideLayerProps();
  refreshLayerPanel();
  renderComposite();
  updateUndoButton();
}

function updateUndoButton() {
  document.getElementById('undoBtn').disabled = state.undoStack.length === 0;
}
updateUndoButton();
document.getElementById('undoBtn').addEventListener('click', undo);

// ==================== Resize ====================
function resizeCanvases(w, h) {
  setStageSize(w, h);
  state.layers.length = 0;
  state.layers.push(makeBrushLayer());
  state.undoStack.length = 0;
  state.selectedLayerId = null;
  hideLayerProps();
  refreshLayerPanel();
  renderComposite();
  updateUndoButton();
}

// ==================== Canvas Format ====================
const canvasFormatSelect = document.getElementById('canvasFormatSelect');
const canvasCustomDims = document.getElementById('canvasCustomDims');
const canvasWEl = document.getElementById('canvasW');
const canvasHEl = document.getElementById('canvasH');
const canvasWVal = document.getElementById('canvasWVal');
const canvasHVal = document.getElementById('canvasHVal');

canvasFormatSelect.addEventListener('change', () => {
  if (canvasFormatSelect.value === 'custom') {
    canvasCustomDims.style.display = '';
    return;
  }
  canvasCustomDims.style.display = 'none';
  const [w, h] = canvasFormatSelect.value.split('x').map(Number);
  if (w && h) resizeCanvases(w, h);
});

canvasWEl.addEventListener('input', () => canvasWVal.textContent = canvasWEl.value);
canvasHEl.addEventListener('input', () => canvasHVal.textContent = canvasHEl.value);
document.getElementById('applyCanvasSize').addEventListener('click', () => {
  resizeCanvases(parseInt(canvasWEl.value, 10), parseInt(canvasHEl.value, 10));
});

// ==================== Panel Resize ====================
const panelResize = document.getElementById('panelResize');
const rpanelEl = document.getElementById('rpanel');
let panelResizing = false;
panelResize.addEventListener('pointerdown', e => {
  e.preventDefault();
  panelResizing = true;
  panelResize.classList.add('active');
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
  document.addEventListener('pointermove', onPanelResize);
  document.addEventListener('pointerup', onPanelResizeEnd);
});
function onPanelResize(e) {
  if (!panelResizing) return;
  const r = rpanelEl.getBoundingClientRect();
  const newW = Math.max(180, Math.min(500, r.right - e.clientX));
  document.documentElement.style.setProperty('--rpanel-w', newW + 'px');
  setStageSize(state.CW, state.CH);
}
function onPanelResizeEnd() {
  panelResizing = false;
  panelResize.classList.remove('active');
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
  document.removeEventListener('pointermove', onPanelResize);
  document.removeEventListener('pointerup', onPanelResizeEnd);
  renderComposite();
}

// ==================== Image Loading ====================
const imgFileInput = document.getElementById('imgFileInput');
document.getElementById('imgFileBtn').addEventListener('click', () => imgFileInput.click());
imgFileInput.addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    const image = new Image();
    image.onload = () => {
      let w = image.naturalWidth, h = image.naturalHeight;
      const maxDim = 1400;
      if (Math.max(w, h) > maxDim) {
        const s = maxDim / Math.max(w, h);
        w = Math.round(w * s); h = Math.round(h * s);
      }
      if (w !== state.CW || h !== state.CH) {
        pushUndo();
        setStageSize(w, h);
      }
      imgCtx.clearRect(0, 0, w, h);
      imgCtx.drawImage(image, 0, 0, w, h);
      autoGenBtn.disabled = false;
      document.getElementById('waterOpts').style.display = '';
      opacity.value = 80;
      flowCanvas.style.opacity = 0.8;
      opacityVal.textContent = '80%';
      updateWaterPreview();
      renderComposite();
      toast('Image loaded');
    };
    image.src = ev.target.result;
  };
  reader.readAsDataURL(file);
});

// ==================== Auto-generate flow from image ====================
const autoGenBtn = document.getElementById('autoGenBtn');
const waterPreviewCanvas = document.getElementById('waterPreview');
const waterPreviewCtx = waterPreviewCanvas.getContext('2d');
const hueBarCanvas = document.getElementById('waterHueBar');
const hueBarCtx = hueBarCanvas.getContext('2d');

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
      // HSV to RGB with full saturation, decent value
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
  // draw range indicator lines
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

function updateWaterPreview() {
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
document.getElementById('waterHue').addEventListener('input', e => {
  document.getElementById('waterHueVal').textContent = e.target.value + '°';
  updateWaterPreview();
});
document.getElementById('waterRange').addEventListener('input', e => {
  document.getElementById('waterRangeVal').textContent = e.target.value + '°';
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

// ==================== Opacity Slider ====================
const opacity = document.getElementById('opacity');
const opacityVal = document.getElementById('opacityVal');
opacity.addEventListener('input', () => {
  const v = opacity.value / 100;
  flowCanvas.style.opacity = v;
  opacityVal.textContent = opacity.value + '%';
});
const v = opacity.value / 100;
flowCanvas.style.opacity = v;

// ==================== Tool State & Sliders ====================
const toolButtons = document.querySelectorAll('.tool-btn');
const brushOptsEl = document.getElementById('brushOpts');
const shapeOptsEl = document.getElementById('shapeOpts');
const selectOptsEl = document.getElementById('selectOpts');
const fillOptsEl = document.getElementById('fillOpts');
const rotationDirPanelEl = document.getElementById('rotationDirPanel');
const spiralPanelEl = document.getElementById('spiralPanel');

export function setTool(t) {
  if (state.currentTool === 'pen' && t !== 'pen' && state.penAnchors.length > 0) finishPenPath();
  state.currentTool = t;
  toolButtons.forEach(b => b.classList.toggle('active', b.dataset.tool === t));
  const isBrushLike = (t === 'brush' || t === 'eraser' || t === 'pen');
  brushOptsEl.style.display = isBrushLike ? '' : 'none';
  fillOptsEl.style.display = t === 'fill' ? '' : 'none';
  shapeOptsEl.style.display = (t === 'arrow' || t === 'circle' || t === 'swirl' || t === 'radial' || t === 'wave') ? '' : 'none';
  selectOptsEl.style.display = t === 'select' ? '' : 'none';
  document.getElementById('layerProps').style.display = 'none';
  rotationDirPanelEl.style.display = (t === 'circle' || t === 'swirl' || t === 'radial') ? '' : 'none';
  spiralPanelEl.style.display = t === 'swirl' ? '' : 'none';
  const isWave = t === 'wave';
  document.getElementById('wavePanel').style.display = isWave ? '' : 'none';
  document.getElementById('waveAmpPanel').style.display = isWave ? '' : 'none';
  document.getElementById('waveOffPanel').style.display = isWave ? '' : 'none';
  const isRadial = t === 'radial';
  cwBtn.textContent = isRadial ? 'Out' : '\u21BB CW';
  ccwBtn.textContent = isRadial ? 'In' : '\u21BA CCW';
  if (t !== 'select') {
    state.selectedLayerId = null;
    drawOverlay();
    refreshLayerPanel();
  }
  clearPreview();
}
toolButtons.forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));

document.getElementById('invertX').addEventListener('change', e => { state.invertX = e.target.checked; renderComposite(); });
document.getElementById('invertY').addEventListener('change', e => { state.invertY = e.target.checked; renderComposite(); });

function bindSlider(id, valId, setter, fmt, div) {
  const el = document.getElementById(id);
  const valEl = document.getElementById(valId);
  el.addEventListener('input', () => {
    const raw = parseFloat(el.value);
    const v = div ? raw / div : raw;
    setter(v);
    valEl.textContent = fmt(v);
  });
}
bindSlider('brushSize', 'brushSizeVal', v => state.brushSize = v, v => v + ' px');
bindSlider('brushStrength', 'brushStrengthVal', v => state.brushStrength = v, v => v.toFixed(2), 100);
bindSlider('brushFeather', 'brushFeatherVal', v => state.brushFeather = v, v => v.toFixed(2), 100);
bindSlider('arrowRadius', 'arrowRadiusVal', v => state.arrowRadius = v, v => v + ' px');
bindSlider('arrowStrength', 'arrowStrengthVal', v => state.arrowStrength = v, v => v.toFixed(2), 100);
bindSlider('arrowFeather', 'arrowFeatherVal', v => state.arrowFeather = v, v => v.toFixed(2), 100);
bindSlider('spiralFactor', 'spiralFactorVal', v => state.spiralFactor = v, v => (v >= 0 ? '+' : '') + v.toFixed(2), 100);
bindSlider('waveFrequency', 'waveFrequencyVal', v => state.waveFrequency = v, v => v.toFixed(2), 100);
bindSlider('waveAmplitude', 'waveAmplitudeVal', v => state.waveAmplitude = v, v => v + ' px', 1);
bindSlider('waveOffset', 'waveOffsetVal', v => state.waveOffset = v, v => v.toFixed(2), 100);
bindSlider('fillTolerance', 'fillToleranceVal', v => state.fillTolerance = v, v => v);


const cwBtn = document.getElementById('cwBtn'), ccwBtn = document.getElementById('ccwBtn');
cwBtn.addEventListener('click', () => { state.rotationDir = 1; cwBtn.classList.add('active'); ccwBtn.classList.remove('active'); });
ccwBtn.addEventListener('click', () => { state.rotationDir = -1; ccwBtn.classList.add('active'); cwBtn.classList.remove('active'); });

// ==================== Blur ====================
const blurAmount = document.getElementById('blurAmount');
const blurAmountVal = document.getElementById('blurAmountVal');
blurAmount.addEventListener('input', () => blurAmountVal.textContent = blurAmount.value);
document.getElementById('applyBlurBtn').addEventListener('click', () => {
  const passes = parseInt(blurAmount.value, 10);
  if (passes <= 0) { toast('Set blur passes > 0'); return; }
  pushUndo();
  for (let p = 0; p < passes; p++) blurOnce();
  renderComposite();
  toast('Blur applied (' + passes + ' passes)');
});

// ==================== Keyboard Shortcuts ====================
window.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
  if (e.key === 'Escape' && state.currentTool === 'pen' && state.penAnchors.length > 0) {
    finishPenPath();
  }
});

window.addEventListener('keydown', e => {
  if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
  const map = { 'v': 'select', 'b': 'brush', 'e': 'eraser', 'p': 'pen', 'f': 'fill', 'a': 'arrow', 'c': 'circle', 's': 'swirl', 'd': 'radial', 'w': 'wave' };
  if (map[e.key]) setTool(map[e.key]);
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (state.selectedLayerId != null) {
      pushUndo();
      const idx = state.layers.findIndex(l => l.id === state.selectedLayerId);
      if (idx >= 0) state.layers.splice(idx, 1);
      state.selectedLayerId = null;
      hideLayerProps();
      refreshLayerPanel();
      renderComposite();
    }
  }
});

// ==================== Reset / Export ====================
document.getElementById('resetBtn').addEventListener('click', () => {
  pushUndo();
  state.penAnchors = []; state.penClosed = false; state.penActiveLayerId = null;
  state.layers.length = 0;
  state.selectedLayerId = null;
  hideLayerProps();
  refreshLayerPanel();
  renderComposite();
  clearPreview();
  toast('Flow map reset');
});

document.getElementById('exportBtn').addEventListener('click', () => {
  const url = flowCanvas.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url; a.download = 'flow-map.png'; a.click();
  toast('Flow map exported');
});

document.getElementById('exportProjectBtn').addEventListener('click', () => {
  const blob = new Blob([serializeProject()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'flowmap-project.json'; a.click();
  URL.revokeObjectURL(a.href);
  toast('Project exported');
});

document.getElementById('importProjectBtn').addEventListener('click', () => {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.json';
  input.onchange = e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      if (loadProject(ev.target.result)) {
        refreshLayerPanel();
        renderComposite();
        toast('Project imported');
      } else {
        toast('Import failed');
      }
    };
    reader.readAsText(file);
  };
  input.click();
});

// ==================== New Brush Layer ====================
document.getElementById('newBrushLayerBtn').addEventListener('click', () => {
  const layer = makeBrushLayer();
  state.layers.push(layer);
  refreshLayerPanel();
  selectLayer(layer.id);
  renderComposite();
  toast('New brush layer');
});

document.getElementById('addMaskBtn').addEventListener('click', () => {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'image/*';
  input.onchange = e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const img = new Image();
      img.onload = () => {
        pushUndo();
        const c = document.createElement('canvas');
        c.width = state.CW; c.height = state.CH;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, state.CW, state.CH);
        const maskData = ctx.getImageData(0, 0, state.CW, state.CH);
        const layer = makeMaskLayer(maskData);
        state.layers.push(layer);
        refreshLayerPanel();
        selectLayer(layer.id);
        toast('Mask layer added');
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  };
  input.click();
});

// ==================== Example / Demo ====================
document.getElementById('exampleBtn').addEventListener('click', async () => {
  await launchDemo();
});

// ==================== Collapsible Sections ====================
document.querySelectorAll('.section .section-title').forEach(title => {
  title.addEventListener('click', () => title.parentElement.classList.toggle('collapsed'));
});
