import { useEffect, useState } from 'preact/hooks';
import { pwa } from './pwa';
import { Icon } from './components/controls';
import { Rail } from './components/Rail';
import { SHORTCUT_HELP, useShortcuts } from './shortcuts';
import { useStore } from './store';
import { HarmonyEditor } from './views/HarmonyEditor';
import { Instruments } from './views/Instruments';
import { Library } from './views/Library';
import { Performance } from './views/Performance';
import { Setup } from './views/Setup';
import { TrackEditor } from './views/TrackEditor';

function usePwa() {
  const [, setTick] = useState(0);
  useEffect(() => pwa.subscribe(() => setTick((t) => t + 1)), []);
  return { canInstall: pwa.canInstall, updateReady: pwa.updateReady };
}

export function App() {
  const s = useStore();
  const v = s.view;
  const pwaState = usePwa();
  useShortcuts();
  return (
    <div class="shell">
      <Rail canInstall={pwaState.canInstall} />
      <main class="detail" key={v.name === 'track' ? v.trackId : v.name}>
        {v.name === 'performance' && <Performance />}
        {v.name === 'track' && <TrackEditor trackId={v.trackId} />}
        {v.name === 'templates' && <Library />}
        {v.name === 'instruments' && <Instruments />}
        {v.name === 'harmony' && <HarmonyEditor />}
        {v.name === 'setup' && <Setup />}
      </main>
      {s.shortcutsOpen && <ShortcutHelp />}
      {pwaState.updateReady && (
        <div class="toast update" role="status">
          A new version of Drift is ready.
          <button type="button" class="primary" onClick={() => pwa.applyUpdate()}>
            Reload
          </button>
        </div>
      )}
      {s.toast && (
        <div class="toast" role="status">
          {s.toast}
        </div>
      )}
    </div>
  );
}

function ShortcutHelp() {
  const s = useStore();
  return (
    <div class="overlay" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" onClick={() => s.setShortcutsOpen(false)}>
      <div class="card shortcut-card" onClick={(e) => e.stopPropagation()}>
        <div class="card-head">
          <h2 class="eyebrow">Keyboard shortcuts</h2>
          <button type="button" class="square" aria-label="Close" onClick={() => s.setShortcutsOpen(false)}>
            <Icon name="close" />
          </button>
        </div>
        <dl class="shortcut-list">
          {SHORTCUT_HELP.map((x) => (
            <>
              <dt>
                <kbd>{x.keys}</kbd>
              </dt>
              <dd>{x.action}</dd>
            </>
          ))}
        </dl>
      </div>
    </div>
  );
}
