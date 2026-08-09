import { state } from './state.js';
import { flowCanvas, imgCtx, setStageSize, TAU } from './canvas.js';
import { renderComposite } from './rendering.js';
import { makeBrushLayer, makeMaskLayer, makeBlurLayer, refreshLayerPanel, hideLayerProps, selectLayer } from './layers.js';
import { setTool, updateSwirlOpts } from './tools.js';
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
      if (l.type === 'mask' && l.maskData) return { ...l, maskData: { width: l.maskData.width, height: l.maskData.height, data: l.maskData.data.slice() }, rawMaskData: l.rawMaskData ? { width: l.rawMaskData.width, height: l.rawMaskData.height, data: l.rawMaskData.data.slice() } : null };
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

canvasFormatSelect.addEventListener('change', () => {
  if (canvasFormatSelect.value === 'custom') {
    canvasCustomDims.style.display = '';
    return;
  }
  canvasCustomDims.style.display = 'none';
  const [w, h] = canvasFormatSelect.value.split('x').map(Number);
  if (w && h) resizeCanvases(w, h);
});

document.getElementById('applyCanvasSize').addEventListener('click', () => {
  resizeCanvases(parseInt(canvasWEl.value, 10), parseInt(canvasHEl.value, 10));
});
bindSlider('canvasW', 'canvasWVal', () => {});
bindSlider('canvasH', 'canvasHVal', () => {});

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
      opacityVal.value = 80;
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
const applyOpacity = () => {
  const v = opacity.value / 100;
  flowCanvas.style.opacity = v;
  opacityVal.value = opacity.value;
};
opacityVal.min = 0;
opacityVal.max = 100;
opacityVal.step = 1;
opacityVal.inputMode = 'numeric';
opacity.addEventListener('input', applyOpacity);
opacityVal.addEventListener('change', () => {
  let v = parseFloat(opacityVal.value);
  if (isNaN(v)) { opacityVal.value = opacity.value; return; }
  v = Math.min(100, Math.max(0, v));
  opacity.value = v;
  applyOpacity();
});
applyOpacity();

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
  const tx = cx + ux * len * (W / 2 - 4), ty = cy + uy * len * (H / 2 - 4);
  const ang = Math.atan2(uy, ux);
  ctx.strokeStyle = ink; ctx.lineWidth = 3; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(tx, ty); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(tx + 9 * Math.cos(ang + 2.5), ty + 9 * Math.sin(ang + 2.5));
  ctx.lineTo(tx, ty);
  ctx.lineTo(tx + 9 * Math.cos(ang - 2.5), ty + 9 * Math.sin(ang - 2.5));
  ctx.stroke();
}

const fixedDirPreviewEl = document.getElementById('fixedDirPreview');
function aimFixedDir(e) {
  const rect = fixedDirPreviewEl.getBoundingClientRect();
  const nx = Math.max(-1, Math.min(1, (e.clientX - rect.left) / rect.width * 2 - 1));
  const ny = Math.max(-1, Math.min(1, (e.clientY - rect.top) / rect.height * 2 - 1));
  const sx = state.invertX ? -1 : 1, sy = state.invertY ? -1 : 1;
  state.brushFixedR = Math.max(1, Math.min(255, Math.round(128 + nx * 127 * sx)));
  state.brushFixedG = Math.max(1, Math.min(255, Math.round(128 - ny * 127 * sy)));
  document.getElementById('brushFixedR').value = state.brushFixedR;
  document.getElementById('brushFixedG').value = state.brushFixedG;
  document.getElementById('brushFixedRVal').value = state.brushFixedR;
  document.getElementById('brushFixedGVal').value = state.brushFixedG;
  drawFixedDirPreview();
}
fixedDirPreviewEl.addEventListener('pointerdown', e => {
  e.preventDefault();
  aimFixedDir(e);
  const move = ev => aimFixedDir(ev);
  const up = () => {
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', up);
  };
  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', up);
});
function bindSlider(id, valId, setter, div) {
  const el = document.getElementById(id);
  const valEl = document.getElementById(valId);
  const scale = div || 1;
  valEl.min = parseFloat(el.min) / scale;
  valEl.max = parseFloat(el.max) / scale;
  valEl.step = parseFloat(el.step || '1') / scale;
  valEl.inputMode = 'decimal';
  const setVal = () => { valEl.value = +(parseFloat(el.value) / scale).toFixed(2); };
  el.addEventListener('input', () => {
    const v = parseFloat(el.value) / scale;
    setter(v);
    setVal();
  });
  valEl.addEventListener('change', () => {
    let v = parseFloat(valEl.value);
    if (isNaN(v)) { setVal(); return; }
    const step = parseFloat(valEl.step) || 1;
    v = Math.min(valEl.max, Math.max(valEl.min, Math.round(v / step) * step));
    v = +v.toFixed(2);
    el.value = +(v * scale).toFixed(2);
    valEl.value = v;
    setter(v);
  });
  setVal();
}
bindSlider('brushSize', 'brushSizeVal', v => state.brushSize = v);
bindSlider('brushStrength', 'brushStrengthVal', v => state.brushStrength = v, 100);
bindSlider('brushFeather', 'brushFeatherVal', v => state.brushFeather = v, 100);
bindSlider('brushSmooth', 'brushSmoothVal', v => state.brushSmooth = v, 100);
bindSlider('brushFixedR', 'brushFixedRVal', v => { state.brushFixedR = v; drawFixedDirPreview(); });
bindSlider('brushFixedG', 'brushFixedGVal', v => { state.brushFixedG = v; drawFixedDirPreview(); });
bindSlider('constraintRadius', 'constraintRadiusVal', v => state.constraintRadius = v);
bindSlider('constraintStrength', 'constraintStrengthVal', v => state.constraintStrength = v, 100);
bindSlider('constraintFeather', 'constraintFeatherVal', v => state.constraintFeather = v, 100);
bindSlider('spiralFactor', 'spiralFactorVal', v => state.spiralFactor = v, 100);
bindSlider('cycloneEye', 'cycloneEyeVal', v => state.cycloneEye = v, 100);
bindSlider('cycloneEyeSoft', 'cycloneEyeSoftVal', v => state.cycloneEyeSoft = v, 100);
bindSlider('cycloneEyewall', 'cycloneEyewallVal', v => state.cycloneEyewall = v, 100);
bindSlider('cycloneDecay', 'cycloneDecayVal', v => state.cycloneDecay = v, 100);
bindSlider('cycloneBands', 'cycloneBandsVal', v => state.cycloneBands = v, 1);
bindSlider('cycloneBandAmp', 'cycloneBandAmpVal', v => state.cycloneBandAmp = v, 100);
bindSlider('waveFrequency', 'waveFrequencyVal', v => state.waveFrequency = v, 100);
bindSlider('waveAmplitude', 'waveAmplitudeVal', v => state.waveAmplitude = v, 1);
bindSlider('waveOffset', 'waveOffsetVal', v => state.waveOffset = v, 100);
bindSlider('fillStrength', 'fillStrengthVal', v => state.fillStrength = v, 100);
bindSlider('fillTolerance', 'fillToleranceVal', v => state.fillTolerance = v);

document.getElementById('cycloneToggle').addEventListener('change', e => {
  state.cyclone = e.target.checked;
  updateSwirlOpts();
});

document.getElementById('brushFixed').addEventListener('change', e => {
  state.brushFixed = e.target.checked;
  document.getElementById('fixedDirSliders').style.display = e.target.checked ? '' : 'none';
  drawFixedDirPreview();
});

// ==================== Keyboard Shortcuts ====================
window.addEventListener('keydown', e => {
  if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
  if (e.key === 'Escape' && state.currentTool === 'pen' && state.penAnchors.length > 0) {
    finishPenPath();
  }
});

window.addEventListener('keydown', e => {
  if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
  const map = { 'v': 'select', 'b': 'brush', 'e': 'eraser', 'p': 'pen', 'f': 'fill', 'a': 'arrow', 'c': 'circle', 's': 'swirl', 'd': 'radial', 'w': 'wave', 'i': 'pipette' };
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
  state.layers.push(makeBrushLayer());
  state.selectedLayerId = null;
  hideLayerProps();
  refreshLayerPanel();
  renderComposite();
  clearPreview();
  toast('Flow map reset');
});

// ==================== Export ====================
let lastExport = { w: state.CW, h: state.CH, format: 'png', quality: 90, invertX: false, invertY: false };
const exportModal = document.getElementById('exportModal');
const exportW = document.getElementById('exportW');
const exportH = document.getElementById('exportH');
const exportFormat = document.getElementById('exportFormat');
const exportQualityEl = document.getElementById('exportQuality');
const exportPreview = document.getElementById('exportPreview');
const exportInvertX = document.getElementById('exportInvertX');
const exportInvertY = document.getElementById('exportInvertY');

const clampDim = v => Math.max(1, Math.min(8192, v));
const dim = el => clampDim(parseInt(el.value, 10) || state.CW);
const outCanvas = (w, h, invX, invY) => {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(flowCanvas, 0, 0, w, h);
  if (invX || invY) {
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      if (invX) { d[i] = 256 - d[i]; if (d[i] === 256) d[i] = 255; }
      if (invY) { d[i + 1] = 256 - d[i + 1]; if (d[i + 1] === 256) d[i + 1] = 255; }
    }
    ctx.putImageData(img, 0, 0);
  }
  return c;
};
function renderExportPreview() {
  const w = dim(exportW), h = dim(exportH);
  const c = outCanvas(w, h, exportInvertX.checked, exportInvertY.checked);
  const pctx = exportPreview.getContext('2d');
  pctx.clearRect(0, 0, exportPreview.width, exportPreview.height);
  const s = Math.min(exportPreview.width / w, exportPreview.height / h);
  const dw = Math.floor(w * s), dh = Math.floor(h * s);
  pctx.drawImage(c, 0, 0, w, h, Math.floor((exportPreview.width - dw) / 2), Math.floor((exportPreview.height - dh) / 2), dw, dh);
}
function runExport() {
  const w = dim(exportW), h = dim(exportH);
  const cfg = {
    w, h, format: exportFormat.value, quality: +exportQualityEl.value,
    invertX: exportInvertX.checked, invertY: exportInvertY.checked,
  };
  const ext = cfg.format === 'jpeg' ? 'jpg' : cfg.format;
  const url = outCanvas(w, h, cfg.invertX, cfg.invertY).toDataURL('image/' + cfg.format, cfg.format === 'png' ? undefined : cfg.quality / 100);
  const a = document.createElement('a');
  a.href = url; a.download = 'flow-map.' + ext; a.click();
  lastExport = cfg;
  toast('Flow map exported');
}
function applyLastExport() {
  exportW.value = lastExport.w; exportH.value = lastExport.h;
  exportFormat.value = lastExport.format;
  exportQualityEl.value = lastExport.quality;
  document.getElementById('exportQualityVal').value = lastExport.quality;
  exportInvertX.checked = lastExport.invertX;
  exportInvertY.checked = lastExport.invertY;
}
function openExport() {
  applyLastExport();
  renderExportPreview();
  exportModal.style.display = 'flex';
}
document.getElementById('exportBtn').addEventListener('click', openExport);
document.getElementById('quickExportBtn').addEventListener('click', () => {
  applyLastExport();
  runExport();
});
document.getElementById('exportClose').addEventListener('click', () => exportModal.style.display = 'none');
document.getElementById('exportCancel').addEventListener('click', () => exportModal.style.display = 'none');
document.getElementById('exportDo').addEventListener('click', () => {
  runExport();
  exportModal.style.display = 'none';
});
exportModal.addEventListener('click', e => { if (e.target === exportModal) exportModal.style.display = 'none'; });
exportW.addEventListener('input', renderExportPreview);
exportH.addEventListener('input', renderExportPreview);
exportInvertX.addEventListener('change', renderExportPreview);
exportInvertY.addEventListener('change', renderExportPreview);
bindSlider('exportQuality', 'exportQualityVal', () => renderExportPreview());

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

document.getElementById('addBlurBtn').addEventListener('click', () => {
  pushUndo();
  const layer = makeBlurLayer();
  state.layers.push(layer);
  refreshLayerPanel();
  selectLayer(layer.id);
  renderComposite();
  toast('Blur layer added');
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
