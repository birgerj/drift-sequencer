import { render } from 'preact';
import { App } from './ui/App';
import { pwa } from './ui/pwa';
import { store } from './ui/store';
import './ui/styles.css';

const root = document.getElementById('app');
if (root) {
  pwa.init();
  render(<App />, root);
  void store.init();
}
