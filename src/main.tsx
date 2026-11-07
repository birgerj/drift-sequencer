import './ui/styles.css';
import './ui/theme/hifi.css';
import './ui/theme/modular.css';
import './ui/theme/tide.css';
import './ui/theme/phosphor.css';
import { VISUALS_HASH } from './visuals/protocol';
import { initTheme } from './ui/theme/theme';

initTheme();

// The AI ensemble was removed; don't leave its Claude API key behind in this browser.
try {
  localStorage.removeItem('drift.claudeApiKey');
} catch {
  /* storage blocked */
}

const root = document.getElementById('app');
if (root && location.hash === VISUALS_HASH) {
  // The visuals window: no MIDI, no store, just drawing.
  void import('./visuals/VisualsApp').then(({ startVisuals }) => startVisuals(root));
} else if (root) {
  void Promise.all([import('preact'), import('./ui/App'), import('./ui/pwa'), import('./ui/store')]).then(
    ([{ render }, { App }, { pwa }, { store }]) => {
      pwa.init();
      render(<App />, root);
      void store.init();
    },
  );
}
