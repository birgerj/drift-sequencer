import './ui/styles.css';
import { VISUALS_HASH } from './visuals/protocol';

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
