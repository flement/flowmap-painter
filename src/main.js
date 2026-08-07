import './style.css';
import { state } from './state.js';
import { setStageSize } from './canvas.js';
import { renderComposite } from './rendering.js';
import { makeBrushLayer, refreshLayerPanel } from './layers.js';
import { STORAGE_KEY, loadProject, saveToStorage } from './project.js';
import './preview.js';

const loaded = (() => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw && loadProject(raw);
  } catch { return false; }
})();
if (!loaded) {
  state.layers.push(makeBrushLayer());
}
renderComposite();
refreshLayerPanel();

let resizeRaf = null;
window.addEventListener('resize', () => {
  cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(() => { setStageSize(state.CW, state.CH); renderComposite(); });
});
window.addEventListener('beforeunload', saveToStorage);
window.addEventListener('pagehide', saveToStorage);
