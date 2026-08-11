import { state } from './state.js';
import { refreshLayerPanel, hideLayerProps, selectLayer } from './layers.js';
import { drawOverlay } from './overlay.js';
import { finishPenPath, clearPreview } from './preview.js';

const toolButtons = document.querySelectorAll('.tool-btn');
const brushOptsEl = document.getElementById('brushOpts');
const smoothPanelEl = document.getElementById('smoothPanel');
const shapeOptsEl = document.getElementById('shapeOpts');
const selectOptsEl = document.getElementById('selectOpts');
const fillOptsEl = document.getElementById('fillOpts');
const rotationDirPanelEl = document.getElementById('rotationDirPanel');
const spiralPanelEl = document.getElementById('spiralPanel');

export function updateSwirlOpts() {
  const showEye = state.currentTool === 'swirl' && state.cyclone;
  for (const id of ['cycloneEyePanel', 'cycloneSoftPanel', 'cycloneEyewallPanel', 'cycloneDecayPanel', 'cycloneBandsPanel', 'cycloneBandAmpPanel']) {
    document.getElementById(id).style.display = showEye ? '' : 'none';
  }
}

export function setTool(t) {
  if (state.currentTool === 'pen' && t !== 'pen' && state.penAnchors.length > 0) finishPenPath();
  state.currentTool = t;
  toolButtons.forEach(b => b.classList.toggle('active', b.dataset.tool === t));
  const isBrushLike = (t === 'brush' || t === 'eraser' || t === 'pen');
  brushOptsEl.style.display = isBrushLike ? '' : 'none';
  smoothPanelEl.style.display = t === 'brush' ? '' : 'none';
  document.getElementById('fixedDirPanel').style.display = t === 'brush' ? '' : 'none';
  document.getElementById('fixedDirSliders').style.display = (t === 'brush' && state.brushFixed) ? '' : 'none';
  fillOptsEl.style.display = t === 'fill' ? '' : 'none';
  shapeOptsEl.style.display = (t === 'arrow' || t === 'circle' || t === 'swirl' || t === 'radial' || t === 'wave') ? '' : 'none';
  selectOptsEl.style.display = t === 'select' ? '' : 'none';
  document.getElementById('layerProps').style.display = 'none';
  rotationDirPanelEl.style.display = (t === 'circle' || t === 'swirl' || t === 'radial') ? '' : 'none';
  spiralPanelEl.style.display = t === 'swirl' ? '' : 'none';
  document.getElementById('cyclonePanel').style.display = t === 'swirl' ? '' : 'none';
  updateSwirlOpts();
  const isWave = t === 'wave';
  document.getElementById('wavePanel').style.display = isWave ? '' : 'none';
  document.getElementById('waveAmpPanel').style.display = isWave ? '' : 'none';
  document.getElementById('waveOffPanel').style.display = isWave ? '' : 'none';
  const isRadial = t === 'radial';
  cwBtn.textContent = isRadial ? 'Out' : '\u21BB CW';
  ccwBtn.textContent = isRadial ? 'In' : '\u21BA CCW';
  if (t === 'brush' || t === 'eraser') {
    if (!state.layers.some(l => l.id === state.selectedLayerId && l.type === 'brush' && l.visible)) {
      for (let i = state.layers.length - 1; i >= 0; i--) {
        if (state.layers[i].type === 'brush' && state.layers[i].visible) {
          selectLayer(state.layers[i].id);
          break;
        }
      }
    }
  } else if (t !== 'select') {
    state.selectedLayerId = null;
    drawOverlay();
    refreshLayerPanel();
  }
  clearPreview();
}

toolButtons.forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));

const cwBtn = document.getElementById('cwBtn'), ccwBtn = document.getElementById('ccwBtn');
cwBtn.addEventListener('click', () => { state.rotationDir = 1; cwBtn.classList.add('active'); ccwBtn.classList.remove('active'); });
ccwBtn.addEventListener('click', () => { state.rotationDir = -1; ccwBtn.classList.add('active'); cwBtn.classList.remove('active'); });
