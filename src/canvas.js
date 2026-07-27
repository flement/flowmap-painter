import { state } from './state.js';

export const stage = document.getElementById('stage');
export const imgCanvas = document.getElementById('imgCanvas');
export const flowCanvas = document.getElementById('flowCanvas');
export const overlayCanvas = document.getElementById('overlayCanvas');
export const previewCanvas = document.getElementById('previewCanvas');
export const imgCtx = imgCanvas.getContext('2d');
export const flowCtx = flowCanvas.getContext('2d', { willReadFrequently: true });
export const ovCtx = overlayCanvas.getContext('2d');
export const pvCtx = previewCanvas.getContext('2d');

export const TAU = Math.PI * 2;
export const HANDLE_RADIUS = 6;

export function clamp8(v) { return v < 0 ? 0 : (v > 255 ? 255 : v); }

export function setStageSize(w, h) {
  state.CW = w; state.CH = h;
  const wrap = stage.parentElement;
  const maxW = wrap.clientWidth - 40;
  const maxH = wrap.clientHeight - 70;
  const scale = Math.min(maxW / w, maxH / h, 1.8);
  const dw = w * scale, dh = h * scale;
  stage.style.width = dw + 'px';
  stage.style.height = dh + 'px';
  [imgCanvas, flowCanvas, overlayCanvas, previewCanvas].forEach(c => {
    c.width = w; c.height = h;
    c.style.width = dw + 'px'; c.style.height = dh + 'px';
  });
}
