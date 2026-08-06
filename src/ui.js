import { state } from './state.js';
import { flowCanvas, imgCtx, setStageSize, TAU } from './canvas.js';
import { renderComposite, blurOnce } from './rendering.js';
import { makeBrushLayer, makeMaskLayer, refreshLayerPanel, hideLayerProps, selectLayer } from './layers.js';
import { setTool } from './tools.js';
import { serializeProject, loadProject } from './project.js';
// import { initAutoflow, updateWaterPreview } from './autoflow.js'; // disabled
import { finishPenPath, clearPreview, fixedBrushDir } from './preview.js';
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
      state.layers.push({ ...l, maskData: imgData, rawMaskData: rawImgData });
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
      // document.getElementById('autoGenBtn').disabled = false; // disabled
      // document.getElementById('waterOpts').style.display = ''; // disabled
      opacity.value = 80;
      flowCanvas.style.opacity = 0.8;
      opacityVal.textContent = '80%';
      // updateWaterPreview(); // disabled
      renderComposite();
      toast('Image loaded');
    };
    image.src = ev.target.result;
  };
  reader.readAsDataURL(file);
});

// ==================== Auto-flow (disabled) ====================
// initAutoflow();

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

// ==================== Sliders ====================
function drawFixedDirPreview() {
  const c = document.getElementById('fixedDirPreview');
  if (!c) return;
  const ctx = c.getContext('2d');
  const W = c.width, H = c.height, cx = W / 2, cy = H / 2;
  const lum = 0.299 * state.brushFixedR + 0.587 * state.brushFixedG + 0.114 * 128;
  const ink = lum > 140 ? '#111' : '#fff';
  ctx.fillStyle = 'rgb(' + state.brushFixedR + ',' + state.brushFixedG + ',128)';
  ctx.fillRect(0, 0, W, H);
  const [dx, dy] = fixedBrushDir();
  const len = Math.hypot(dx, dy);
  if (len < 0.05) {
    ctx.fillStyle = ink;
    ctx.beginPath(); ctx.arc(cx, cy, 3, 0, TAU); ctx.fill();
    return;
  }
  const ux = dx / len, uy = dy / len;
  const L = Math.min(1, Math.max(len, 0.1)) * (H / 2 - 10);
  const tx = cx + ux * L, ty = cy + uy * L;
  const ang = Math.atan2(uy, ux);
  ctx.strokeStyle = ink; ctx.lineWidth = 3; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(tx, ty); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(tx + 9 * Math.cos(ang + 2.5), ty + 9 * Math.sin(ang + 2.5));
  ctx.lineTo(tx, ty);
  ctx.lineTo(tx + 9 * Math.cos(ang - 2.5), ty + 9 * Math.sin(ang - 2.5));
  ctx.stroke();
}
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
bindSlider('brushSmooth', 'brushSmoothVal', v => state.brushSmooth = v, v => Math.round(v * 100) + '%', 100);
bindSlider('brushFixedR', 'brushFixedRVal', v => { state.brushFixedR = v; drawFixedDirPreview(); }, v => '' + v);
bindSlider('brushFixedG', 'brushFixedGVal', v => { state.brushFixedG = v; drawFixedDirPreview(); }, v => '' + v);
bindSlider('constraintRadius', 'constraintRadiusVal', v => state.constraintRadius = v, v => v + ' px');
bindSlider('constraintStrength', 'constraintStrengthVal', v => state.constraintStrength = v, v => v.toFixed(2), 100);
bindSlider('constraintFeather', 'constraintFeatherVal', v => state.constraintFeather = v, v => v.toFixed(2), 100);
bindSlider('spiralFactor', 'spiralFactorVal', v => state.spiralFactor = v, v => (v >= 0 ? '+' : '') + v.toFixed(2), 100);
bindSlider('waveFrequency', 'waveFrequencyVal', v => state.waveFrequency = v, v => v.toFixed(2), 100);
bindSlider('waveAmplitude', 'waveAmplitudeVal', v => state.waveAmplitude = v, v => v + ' px', 1);
bindSlider('waveOffset', 'waveOffsetVal', v => state.waveOffset = v, v => v.toFixed(2), 100);
bindSlider('fillStrength', 'fillStrengthVal', v => state.fillStrength = v, v => v.toFixed(2), 100);
bindSlider('fillTolerance', 'fillToleranceVal', v => state.fillTolerance = v, v => v);

document.getElementById('invertX').addEventListener('change', e => { state.invertX = e.target.checked; renderComposite(); drawFixedDirPreview(); });
document.getElementById('invertY').addEventListener('change', e => { state.invertY = e.target.checked; renderComposite(); drawFixedDirPreview(); });

document.getElementById('brushFixed').addEventListener('change', e => {
  state.brushFixed = e.target.checked;
  document.getElementById('fixedDirSliders').style.display = e.target.checked ? '' : 'none';
  drawFixedDirPreview();
});

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
        layer.rawMaskData = maskData;
        state.layers.push(layer);
        refreshLayerPanel();
        selectLayer(layer.id);
        renderComposite();
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
