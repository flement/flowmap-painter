import './style.css';
import { state } from './state.js';
import { setStageSize } from './canvas.js';
import { renderComposite, saveToStorage } from './rendering.js';
import { makeBrushLayer, refreshLayerPanel } from './layers.js';
import { loadProject } from './ui.js';
import './interaction.js';

const STORAGE_KEY = 'flowmap-studio';

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

window.addEventListener('resize', () => { setStageSize(state.CW, state.CH); renderComposite(); });
window.addEventListener('beforeunload', saveToStorage);
