import { useEffect, useState } from 'preact/hooks';
import { NOTE_NAMES } from '../core/theory/note';
import { pwa } from './pwa';
import { Icon, Stepper } from './components/controls';
import { useLive, useStore } from './store';
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
  return (
    <>
      <Header />
      {v.name === 'performance' && <Performance />}
      {v.name === 'track' && <TrackEditor trackId={v.trackId} />}
      {v.name === 'templates' && <Library />}
      {v.name === 'instruments' && <Instruments />}
      {v.name === 'harmony' && <HarmonyEditor />}
      {v.name === 'setup' && <Setup />}
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
    </>
  );
}

function Header() {
  const s = useStore();
  const p = s.project;
  const playing = s.sequencer.playing;
  const position = useLive((l) => (playing && l.step >= 0 ? `${String(l.bar + 1).padStart(3, '0')}.${Math.floor((l.step % p.stepsPerBar) / 4) + 1}` : '001.1'));
  const chord = useLive((l) => (playing ? l.chord : ''));
  const clockTarget = p.clock.sendTo[0] ?? '';
  const pwaState = usePwa();

  return (
    <header class="topbar">
      <div class="brand">
        <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
          <path d="M2 17 C6 5, 10 5, 13 13 S20 21, 24 9" fill="none" stroke="#F5A524" stroke-width="2.5" stroke-linecap="round" />
        </svg>
        <button type="button" class="project-name" onClick={() => s.go({ name: 'templates' })} aria-label="Projects and templates">
          {p.name}
        </button>
      </div>

      <button type="button" class={`play ${playing ? 'on' : ''}`} aria-label={playing ? 'Stop' : 'Play'} onClick={() => void s.togglePlay()}>
        <Icon name={playing ? 'stop' : 'play'} size={22} />
      </button>

      <div class="readout">
        <span class="eyebrow">Tempo</span>
        <Stepper label="Tempo" value={p.bpm} min={20} max={300} onChange={(bpm) => s.change((x) => ({ ...x, bpm }))} />
      </div>
      <div class="readout">
        <span class="eyebrow">Position</span>
        <span class="mono big">{position}</span>
      </div>
      <button type="button" class="readout tappable" onClick={() => s.go({ name: 'harmony' })} aria-label="Edit key and progression">
        <span class="eyebrow">Key</span>
        <span class="big">
          {NOTE_NAMES[p.key.root]} <span class="muted">{p.key.mode}</span>
          {chord && <span class="chord-now"> · {chord}</span>}
        </span>
      </button>
      <div class="readout">
        <label class="eyebrow" for="clock-target">
          Clock out
        </label>
        {s.rack.devices.length > 0 ? (
          <select
            id="clock-target"
            value={s.rack.devices.find((d) => d.clock)?.id ?? ''}
            onChange={(e) => {
              const id = (e.target as HTMLSelectElement).value;
              s.setRack({ devices: s.rack.devices.map((d) => ({ ...d, clock: d.id === id })) });
            }}
          >
            <option value="">Off</option>
            {s.rack.devices.map((d) => (
              <option value={d.id}>{d.name}</option>
            ))}
          </select>
        ) : (
          <select
            id="clock-target"
            value={clockTarget}
            onChange={(e) => {
              const v = (e.target as HTMLSelectElement).value;
              s.change((x) => ({ ...x, clock: { sendTo: v ? [v] : [] } }));
            }}
          >
            <option value="">Off</option>
            {[...new Set([clockTarget, ...s.ports].filter(Boolean))].map((n) => (
              <option value={n}>{n}</option>
            ))}
          </select>
        )}
      </div>

      <div class="spacer" />

      {pwaState.canInstall && (
        <button type="button" onClick={() => void pwa.install()}>
          <Icon name="download" /> Install app
        </button>
      )}

      <div class="devices">
        {!s.midi.connected ? (
          <button type="button" onClick={() => void s.connectMidi()}>
            Connect MIDI
          </button>
        ) : s.rack.devices.length > 0 ? (
          s.rack.devices.slice(0, 5).map((d) => (
            <button type="button" class="device-chip" onClick={() => s.go({ name: 'instruments' })} title={`${d.portName} · ch ${d.channel}`}>
              <span class={`dot ${s.ports.includes(d.portName) ? 'ok' : ''}`} /> {d.name}
            </button>
          ))
        ) : s.ports.length === 0 ? (
          <span class="device-chip warn">No MIDI outputs</span>
        ) : (
          s.ports.slice(0, 4).map((n) => (
            <span class="device-chip">
              <span class="dot ok" /> {n}
            </span>
          ))
        )}
      </div>

      <nav class="nav" aria-label="Main">
        <button type="button" aria-current={s.view.name === 'performance'} onClick={() => s.go({ name: 'performance' })}>
          <Icon name="grid" /> <span>Perform</span>
        </button>
        <button type="button" aria-current={s.view.name === 'harmony'} onClick={() => s.go({ name: 'harmony' })}>
          <Icon name="music" /> <span>Harmony</span>
        </button>
        <button type="button" aria-current={s.view.name === 'templates'} onClick={() => s.go({ name: 'templates' })}>
          <Icon name="download" /> <span>Projects</span>
        </button>
        <button
          type="button"
          aria-current={s.view.name === 'instruments' || s.view.name === 'setup'}
          onClick={() => s.go({ name: 'instruments' })}
        >
          <Icon name="sliders" /> <span>Devices</span>
        </button>
      </nav>
    </header>
  );
}
