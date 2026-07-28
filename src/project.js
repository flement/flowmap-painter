import { state } from './state.js';
import { setStageSize } from './canvas.js';
import { makeBrushLayer } from './layers.js';

export const STORAGE_KEY = 'flowmap-studio';

function uint8ToBase64(arr) {
  let bin = '';
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin);
}

function base64ToUint8(str) {
  const bin = atob(str);
  const arr = new Uint8ClampedArray(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

function isAllNeutral(data) {
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] !== 128 || data[i + 1] !== 128) return false;
  }
  return true;
}

export function serializeProject() {
  return JSON.stringify({
    CW: state.CW, CH: state.CH, invertX: state.invertX, invertY: state.invertY,
    layers: state.layers.map(l => {
      if (l.type === 'brush') {
        if (isAllNeutral(l.data)) return { id: l.id, type: l.type, name: l.name, visible: l.visible, data: null };
        return { ...l, data: uint8ToBase64(l.data) };
      }
      if (l.type === 'mask' && l.maskData) {
        return { ...l,
          maskData: { w: l.maskData.width, h: l.maskData.height, d: uint8ToBase64(l.maskData.data) },
          rawMaskData: l.rawMaskData ? { w: l.rawMaskData.width, h: l.rawMaskData.height, d: uint8ToBase64(l.rawMaskData.data) } : null,
        };
      }
      return JSON.parse(JSON.stringify(l));
    }),
  });
}

let saveTimer = null;
export function saveToStorage() {
  try { localStorage.setItem(STORAGE_KEY, serializeProject()); } catch (e) { console.warn('Save failed:', e); }
}

export function debouncedSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveToStorage, 300);
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
        if (l.data) layer.data.set(base64ToUint8(l.data));
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
