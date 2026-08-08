import { state } from './state.js';
import { TAU } from './canvas.js';
import { samplePenPath } from './bezier.js';
import { renderComposite } from './rendering.js';
import { drawOverlay } from './overlay.js';
import { pushUndo, toast } from './ui.js';
import { setTool } from './tools.js';

const layerListEl = document.getElementById('layerList');
const layerPropsEl = document.getElementById('layerProps');

export function makeBrushLayer() {
  const data = new Uint8ClampedArray(state.CW * state.CH * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 128; data[i + 1] = 128; data[i + 2] = 128; data[i + 3] = 0;
  }
  return { id: state.nextId++, type: 'brush', name: 'Brush', visible: true, data };
}

export function makeMaskLayer(maskImageData) {
  return { id: state.nextId++, type: 'mask', name: 'Mask', visible: true, maskData: maskImageData, rawMaskData: null, invert: false, threshold: 0, coastEnabled: false, coastWidth: 20, coastStrength: 1 };
}

export function makeBlurLayer() {
  return { id: state.nextId++, type: 'blur', name: 'Blur', visible: true, passes: 4 };
}

function reprocessMask(layer) {
  if (!layer.rawMaskData) return;
  const raw = layer.rawMaskData;
  const processed = new ImageData(state.CW, state.CH);
  const thresh = layer.threshold || 0;
  const inv = layer.invert;
  for (let i = 0; i < raw.data.length; i += 4) {
    let lum = (raw.data[i] + raw.data[i + 1] + raw.data[i + 2]) / 3;
    if (inv) lum = 255 - lum;
    const v = lum <= thresh ? 0 : Math.round((lum - thresh) / (255 - thresh) * 255);
    processed.data[i] = v; processed.data[i + 1] = v;
    processed.data[i + 2] = v; processed.data[i + 3] = 255;
  }
  layer.maskData = processed;
}

function generateLayerThumb(layer, w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, w, h);
  const sx = w / state.CW, sy = h / state.CH;

  if (layer.type === 'brush') {
    const imgData = ctx.createImageData(w, h);
    const d = imgData.data;
    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const srcX = Math.floor(px / sx), srcY = Math.floor(py / sy);
        const si = (srcY * state.CW + srcX) * 4;
        const di = (py * w + px) * 4;
        d[di] = layer.data[si]; d[di + 1] = layer.data[si + 1];
        d[di + 2] = 128; d[di + 3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0);
  } else if (layer.type === 'constraint') {
    const s = layer.shape;
    ctx.save(); ctx.scale(sx, sy);
    if (s.type === 'arrow' || s.type === 'wave') {
      ctx.strokeStyle = '#f2b84b'; ctx.lineWidth = 2 / sx;
      ctx.beginPath(); ctx.moveTo(s.x1, s.y1); ctx.lineTo(s.x2, s.y2); ctx.stroke();
    } else if (s.type === 'circle' || s.type === 'swirl' || s.type === 'radial') {
      ctx.strokeStyle = '#f2b84b'; ctx.lineWidth = 2 / sx;
      ctx.setLineDash([4 / sx, 3 / sx]);
      ctx.beginPath(); ctx.arc(s.cx, s.cy, s.radius, 0, TAU); ctx.stroke();
    }
    ctx.restore();
  } else if (layer.type === 'pen' && layer.anchors && layer.anchors.length >= 2) {
    ctx.save(); ctx.scale(sx, sy);
    ctx.strokeStyle = '#f2b84b'; ctx.lineWidth = 2 / sx;
    ctx.beginPath(); ctx.moveTo(layer.anchors[0].x, layer.anchors[0].y);
    for (let i = 1; i < layer.anchors.length; i++) {
      const a = layer.anchors[i - 1], b = layer.anchors[i];
      ctx.bezierCurveTo(a.h2x, a.h2y, b.h1x, b.h1y, b.x, b.y);
    }
    if (layer.closed && layer.anchors.length > 2) {
      const a = layer.anchors[layer.anchors.length - 1], b = layer.anchors[0];
      ctx.bezierCurveTo(a.h2x, a.h2y, b.h1x, b.h1y, b.x, b.y);
    }
    ctx.stroke(); ctx.restore();
  } else if (layer.type === 'mask' && layer.maskData) {
    const tmpC = document.createElement('canvas');
    tmpC.width = layer.maskData.width; tmpC.height = layer.maskData.height;
    tmpC.getContext('2d').putImageData(layer.maskData, 0, 0);
    ctx.drawImage(tmpC, 0, 0, w, h);
  } else if (layer.type === 'blur') {
    const g = ctx.createRadialGradient(w / 2, h / 2, 1, w / 2, h / 2, w / 2);
    g.addColorStop(0, '#a8a8a8');
    g.addColorStop(1, '#808080');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
  return c;
}

export function refreshLayerPanel() {
  layerListEl.innerHTML = '';
  for (let i = state.layers.length - 1; i >= 0; i--) {
    const layer = state.layers[i];
    const item = document.createElement('div');
    item.className = 'layer-item' + (layer.id === state.selectedLayerId ? ' selected' : '');
    item.dataset.id = layer.id;
    item.draggable = true;

    const thumb = document.createElement('div');
    thumb.className = 'layer-thumb';
    thumb.appendChild(generateLayerThumb(layer, 40, 28));

    const vis = document.createElement('span');
    vis.className = 'layer-vis';
    vis.textContent = layer.visible ? '\uD83D\uDC41' : '\u2014';
    vis.addEventListener('click', e => {
      e.stopPropagation();
      layer.visible = !layer.visible;
      refreshLayerPanel();
      renderComposite();
    });

    const name = document.createElement('span');
    name.className = 'layer-name';
    name.textContent = layer.name;

    const del = document.createElement('button');
    del.className = 'layer-del';
    del.textContent = '\u2715';
    del.addEventListener('click', e => {
      e.stopPropagation();
      pushUndo();
      const idx = state.layers.findIndex(l => l.id === layer.id);
      if (idx >= 0) state.layers.splice(idx, 1);
      if (state.selectedLayerId === layer.id) { state.selectedLayerId = null; hideLayerProps(); }
      refreshLayerPanel();
      renderComposite();
    });

    item.appendChild(thumb);
    item.appendChild(vis);
    item.appendChild(name);
    item.appendChild(del);

    item.addEventListener('click', () => selectLayer(layer.id));

    item.addEventListener('dragstart', e => {
      state.dragLayerId = layer.id;
      item.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    item.addEventListener('dragend', () => {
      state.dragLayerId = null;
      layerListEl.querySelectorAll('.drag-over-top, .drag-over-bottom').forEach(el => {
        el.classList.remove('drag-over-top', 'drag-over-bottom');
      });
      layerListEl.querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging'));
    });
    item.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (state.dragLayerId === layer.id) return;
      const rect = item.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      item.classList.toggle('drag-over-top', e.clientY < mid);
      item.classList.toggle('drag-over-bottom', e.clientY >= mid);
    });
    item.addEventListener('dragleave', () => {
      item.classList.remove('drag-over-top', 'drag-over-bottom');
    });
    item.addEventListener('drop', e => {
      e.preventDefault();
      item.classList.remove('drag-over-top', 'drag-over-bottom');
      if (state.dragLayerId == null || state.dragLayerId === layer.id) return;
      const fromIdx = state.layers.findIndex(l => l.id === state.dragLayerId);
      const toIdx = state.layers.findIndex(l => l.id === layer.id);
      if (fromIdx < 0 || toIdx < 0) return;
      const rect = item.getBoundingClientRect();
      const above = e.clientY < rect.top + rect.height / 2;
      const [moved] = state.layers.splice(fromIdx, 1);
      let newIdx = state.layers.findIndex(l => l.id === layer.id);
      if (above) newIdx++;
      state.layers.splice(newIdx, 0, moved);
      refreshLayerPanel();
      renderComposite();
    });

    layerListEl.appendChild(item);
  }
}

export function hideLayerProps() {
  layerPropsEl.style.display = 'none';
  layerPropsEl.innerHTML = '';
  setTool(state.currentTool);
}

export function updateLayerProps(layer) {
  layerPropsEl.innerHTML = '';
  layerPropsEl.style.display = '';

  const title = document.createElement('div');
  title.className = 'section-title';
  title.innerHTML = '<span class="st-chevron">▸</span><span class="st-label">' + layer.name + ' Properties</span>';
  title.addEventListener('click', () => layerPropsEl.classList.toggle('collapsed'));
  layerPropsEl.appendChild(title);

  function addSlider(label, value, min, max, step, onChange) {
    const field = document.createElement('div');
    field.className = 'field';
    const row = document.createElement('div');
    row.className = 'field-row';
    const lbl = document.createElement('span');
    lbl.className = 'field-label';
    lbl.textContent = label;
    const val = document.createElement('input');
    val.type = 'number';
    val.className = 'field-value';
    val.min = min;
    val.max = max;
    val.step = step || 1;
    val.inputMode = 'decimal';
    val.value = +value.toFixed(2);
    row.appendChild(lbl);
    row.appendChild(val);
    const input = document.createElement('input');
    input.type = 'range';
    input.min = min;
    input.max = max;
    input.value = value;
    if (step) input.step = step;
    const apply = v => { onChange(v); renderComposite(); refreshLayerPanel(); };
    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      val.value = +(v.toFixed(2));
      apply(v);
    });
    val.addEventListener('change', () => {
      let v = parseFloat(val.value);
      if (isNaN(v)) { val.value = input.value; return; }
      const st = parseFloat(val.step) || 1;
      v = Math.min(max, Math.max(min, Math.round(v / st) * st));
      v = +v.toFixed(2);
      input.value = v;
      val.value = v;
      apply(v);
    });
    field.appendChild(row);
    field.appendChild(input);
    layerPropsEl.appendChild(field);
  }

  if (layer.type === 'constraint') {
    const s = layer.shape;
    addSlider('Radius', s.radius, 10, 400, 1, v => { s.radius = v; });
    addSlider('Strength', s.strength, 0.05, 1, 0.01, v => { s.strength = v; });
    addSlider('Feather', s.feather, 0, 1, 0.01, v => { s.feather = v; });
    if (s.type === 'circle' || s.type === 'swirl' || s.type === 'radial') {
      const dirField = document.createElement('div');
      dirField.className = 'field';
      const dirRow = document.createElement('div');
      dirRow.className = 'field-row';
      const dirLabel = document.createElement('span');
      dirLabel.className = 'field-label';
      dirLabel.textContent = 'Direction';
      dirRow.appendChild(dirLabel);
      dirField.appendChild(dirRow);
      const seg = document.createElement('div');
      seg.className = 'seg';
      const isRadial = s.type === 'radial';
      const cwBtn = document.createElement('button');
      cwBtn.textContent = isRadial ? 'Out' : '\u21BB CW';
      cwBtn.className = s.rotationDir === 1 ? 'active' : '';
      cwBtn.addEventListener('click', () => {
        s.rotationDir = 1;
        cwBtn.classList.add('active');
        ccwBtn.classList.remove('active');
        renderComposite();
      });
      const ccwBtn = document.createElement('button');
      ccwBtn.textContent = isRadial ? 'In' : '\u21BA CCW';
      ccwBtn.className = s.rotationDir === -1 ? 'active' : '';
      ccwBtn.addEventListener('click', () => {
        s.rotationDir = -1;
        ccwBtn.classList.add('active');
        cwBtn.classList.remove('active');
        renderComposite();
      });
      seg.appendChild(cwBtn);
      seg.appendChild(ccwBtn);
      dirField.appendChild(seg);
      layerPropsEl.appendChild(dirField);
    }
    if (s.type === 'swirl') {
      addSlider('Spiral', s.spiralFactor, -1, 1, 0.01, v => { s.spiralFactor = v; });
      const cycRow = document.createElement('label');
      cycRow.className = 'checkbox-row';
      const cycCb = document.createElement('input');
      cycCb.type = 'checkbox';
      cycCb.checked = s.cyclone !== false;
      cycCb.addEventListener('change', () => { s.cyclone = cycCb.checked; renderComposite(); });
      cycRow.appendChild(cycCb);
      cycRow.appendChild(document.createTextNode(' Cyclone profile'));
      layerPropsEl.appendChild(cycRow);
      addSlider('Eye size', s.cycloneEye ?? 0.12, 0, 0.5, 0.01, v => { s.cycloneEye = v; });
      addSlider('Eye softness', s.cycloneEyeSoft ?? 0.5, 0, 1, 0.01, v => { s.cycloneEyeSoft = v; });
      addSlider('Eyewall', s.cycloneEyewall ?? 0.25, 0.12, 0.5, 0.01, v => { s.cycloneEyewall = v; });
      addSlider('Decay', s.cycloneDecay ?? 0.6, 0.3, 1.5, 0.05, v => { s.cycloneDecay = v; });
      addSlider('Rainbands', s.cycloneBands ?? 0, 0, 8, 1, v => { s.cycloneBands = v; });
      addSlider('Band strength', s.cycloneBandAmp ?? 0.3, 0, 0.8, 0.01, v => { s.cycloneBandAmp = v; });
    }
    if (s.type === 'wave') {
      addSlider('Frequency', s.frequency, 0.25, 8, 0.25, v => { s.frequency = v; });
      addSlider('Amplitude', s.amplitude, 0, 200, 1, v => { s.amplitude = v; });
      addSlider('Offset', s.offset, -3.14, 3.14, 0.05, v => { s.offset = v; });
    }
  } else if (layer.type === 'pen') {
    addSlider('Radius', layer.radius, 4, 150, 1, v => { layer.radius = v; });
    addSlider('Strength', layer.strength, 0.05, 1, 0.01, v => { layer.strength = v; });
    addSlider('Feather', layer.feather, 0, 1, 0.01, v => { layer.feather = v; });
  } else if (layer.type === 'brush') {
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = 'Brush layers store pixel data. Use the brush tool to modify.';
    layerPropsEl.appendChild(hint);
  } else if (layer.type === 'blur') {
    addSlider('Passes', layer.passes, 1, 20, 1, v => { layer.passes = v; });
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = 'Blur smoothes the whole flow map. Toggle visibility to compare.';
    layerPropsEl.appendChild(hint);
  } else if (layer.type === 'mask') {
    if (layer.maskData) {
      const preview = document.createElement('canvas');
      preview.width = 80; preview.height = 56;
      preview.style.cssText = 'width:100%;border-radius:4px;margin:4px 0;';
      const pctx = preview.getContext('2d');
      const tmpC = document.createElement('canvas');
      tmpC.width = layer.maskData.width; tmpC.height = layer.maskData.height;
      tmpC.getContext('2d').putImageData(layer.maskData, 0, 0);
      pctx.drawImage(tmpC, 0, 0, 80, 56);
      layerPropsEl.appendChild(preview);

      addSlider('Threshold', layer.threshold, 0, 255, 1, v => { layer.threshold = v; reprocessMask(layer); });

      const invertRow = document.createElement('label');
      invertRow.className = 'checkbox-row';
      const invertCb = document.createElement('input');
      invertCb.type = 'checkbox';
      invertCb.checked = !!layer.invert;
      invertCb.addEventListener('change', () => { layer.invert = invertCb.checked; reprocessMask(layer); renderComposite(); });
      invertRow.appendChild(invertCb);
      invertRow.appendChild(document.createTextNode(' Invert mask'));
      layerPropsEl.appendChild(invertRow);

      const replaceBtn = document.createElement('button');
      replaceBtn.className = 'full';
      replaceBtn.textContent = 'Replace Mask…';
      replaceBtn.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file'; input.accept = 'image/*';
        input.onchange = e => { if (e.target.files[0]) loadMaskOnto(layer, e.target.files[0]); };
        input.click();
      });
      layerPropsEl.appendChild(replaceBtn);

      const coastRow = document.createElement('label');
      coastRow.className = 'checkbox-row';
      const coastCb = document.createElement('input');
      coastCb.type = 'checkbox';
      coastCb.checked = !!layer.coastEnabled;
      coastCb.addEventListener('change', () => { layer.coastEnabled = coastCb.checked; renderComposite(); });
      coastRow.appendChild(coastCb);
      coastRow.appendChild(document.createTextNode(' Coastal foam'));
      layerPropsEl.appendChild(coastRow);

      addSlider('Width', layer.coastWidth, 1, 100, 1, v => { layer.coastWidth = v; });
      addSlider('Strength', layer.coastStrength, 0, 1, 0.01, v => { layer.coastStrength = v; });
    }
  }
}

export function loadMaskOnto(layer, file) {
  pushUndo();
  const reader = new FileReader();
  reader.onload = ev => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = state.CW; c.height = state.CH;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, state.CW, state.CH);
      layer.rawMaskData = ctx.getImageData(0, 0, state.CW, state.CH);
      reprocessMask(layer);
      refreshLayerPanel();
      if (state.selectedLayerId === layer.id) updateLayerProps(layer);
      renderComposite();
      toast('Mask loaded');
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

export function selectLayer(id) {
  state.selectedLayerId = id;
  const layer = state.layers.find(l => l.id === id);
  const tool = layer && layer.type === 'brush' ? 'brush' : 'select';
  if (state.currentTool !== tool) setTool(tool);
  state.selectedLayerId = id;
  document.getElementById('brushOpts').style.display = 'none';
  document.getElementById('shapeOpts').style.display = 'none';
  document.getElementById('selectOpts').style.display = 'none';
  refreshLayerPanel();
  drawOverlay();
  if (layer) updateLayerProps(layer);
  else hideLayerProps();
}
