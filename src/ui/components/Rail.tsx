import { hasSlot } from '../theme/theme';
import { VuMeters } from '../theme/hifi/HifiParts';
import { NOTE_NAMES, noteName } from '../../core/theory/note';
import type { TrackState } from '../../state/project';
import { pwa } from '../pwa';
import { applyTheme, useTheme } from '../theme/theme';
import { THEMES } from '../theme/themes';
import { typeLabel } from '../paramSchema';
import { store, useLive, useStore, type View } from '../store';
import { Icon, TYPE_ICONS } from './controls';

/** Left column: transport, the track list and the main views. Always visible. */
export function Rail({ canInstall }: { canInstall: boolean }) {
  const s = useStore();
  const p = s.project;
  const playing = s.sequencer.playing;
  const position = useLive((l) =>
    playing && l.step >= 0 ? `${String(l.bar + 1).padStart(3, '0')}.${Math.floor((l.step % p.stepsPerBar) / 4) + 1}` : '001.1',
  );
  const chord = useLive((l) => (playing ? l.chord : ''));
  const bpm = (delta: number) => s.change((x) => ({ ...x, bpm: Math.max(20, Math.min(300, x.bpm + delta)) }));

  return (
    <aside class="rail" aria-label="Transport and tracks">
      <div class="rail-top">
        <button type="button" class="rail-project" onClick={() => s.go({ name: 'templates' })} aria-label="Projects and templates">
          <svg width="20" height="20" viewBox="0 0 26 26" aria-hidden="true">
            <path d="M2 17 C6 5, 10 5, 13 13 S20 21, 24 9" fill="none" stroke="var(--accent)" stroke-width="2.8" stroke-linecap="round" />
          </svg>
          <span>{p.name}</span>
        </button>
        <span class="mono rail-pos">{position}</span>
      </div>

      <button type="button" class={`rail-play ${playing ? 'on' : ''}`} onClick={() => void s.togglePlay()} aria-label={playing ? 'Stop (Space)' : 'Play (Space)'}>
        <Icon name={playing ? 'stop' : 'play'} size={18} />
        {playing ? 'Stop' : 'Play'}
        <kbd>Space</kbd>
      </button>

      <div class="rail-readouts">
        <div class="rail-readout bpm" role="group" aria-label="Tempo">
          <button type="button" aria-label="Tempo down" onClick={() => bpm(-1)}>
            <Icon name="minus" size={14} />
          </button>
          <span>
            <small>BPM</small>
            <b class="mono">{p.bpm}</b>
          </span>
          <button type="button" aria-label="Tempo up" onClick={() => bpm(1)}>
            <Icon name="plus" size={14} />
          </button>
        </div>
        <button type="button" class="rail-readout" onClick={() => s.go({ name: 'harmony' })} aria-label="Edit key and progression">
          <small>Key</small>
          <b>
            {NOTE_NAMES[p.key.root]} <span class="muted">{p.key.mode}</span>
          </b>
          {chord && <span class="rail-chord">{chord}</span>}
        </button>
      </div>

      {hasSlot('railMeters') && <VuMeters />}

      {!s.midi.connected && (
        <button type="button" class="primary rail-connect" onClick={() => void s.connectMidi()}>
          Connect MIDI
        </button>
      )}

      <div class="rail-tracks">
        {p.tracks.map((t, i) => (
          <RailTrack key={t.id} track={t} index={i} />
        ))}
        <button type="button" class="rail-add" onClick={() => s.addTrack()}>
          <Icon name="plus" size={16} /> Add track
        </button>
      </div>

      <div class="rail-bottom">
        <ClockSelect />
        {canInstall && (
          <button type="button" class="rail-install" onClick={() => void pwa.install()}>
            <Icon name="download" size={16} /> Install app
          </button>
        )}
        <nav class="rail-nav" aria-label="Main">
          <NavButton view={{ name: 'performance' }} icon="list" label="Overview" />
          <NavButton view={{ name: 'harmony' }} icon="music" label="Harmony" />
          <NavButton view={{ name: 'templates' }} icon="folder" label="Projects" />
          <NavButton view={{ name: 'instruments' }} icon="devices" label="Devices" also={['setup']} />
        </nav>
        <ThemePicker />
        <button type="button" class="rail-help" onClick={() => s.openVisuals()}>
          <Icon name="eye" size={16} /> Visuals
        </button>
        <button type="button" class="rail-help" onClick={() => s.setShortcutsOpen(true)}>
          <Icon name="keyboard" size={16} /> Shortcuts <kbd>?</kbd>
        </button>
      </div>
    </aside>
  );
}

function NavButton({ view, icon, label, also = [] }: { view: View; icon: string; label: string; also?: string[] }) {
  const s = useStore();
  const current = s.view.name === view.name || also.includes(s.view.name);
  return (
    <button type="button" aria-current={current} onClick={() => s.go(view)}>
      <Icon name={icon} size={18} />
      <span>{label}</span>
    </button>
  );
}

function RailTrack({ track, index }: { track: TrackState; index: number }) {
  const s = useStore();
  const selected = s.view.name === 'track' && s.view.trackId === track.id;
  const device = s.device(track.deviceId);
  const out = s.trackOutput(track);
  const now = useLive((l) => {
    const n = l.now[track.id];
    if (!n || n.until + 150 <= performance.now()) return '';
    const t = store.project.tracks.find((x) => x.id === track.id);
    if (t?.generator.type === 'drums') {
      return n.notes.map((note) => t.generator.type === 'drums' ? (t.generator.params.voices.find((v) => v.note === note)?.name ?? noteName(note)) : '').join(' ');
    }
    return n.notes.length > 2 ? noteName(n.notes[0]!) + '…' : n.notes.map(noteName).join(' ');
  });
  const silent = track.muted || (s.project.tracks.some((t) => t.solo) && !track.solo);
  return (
    <button
      type="button"
      class={`rail-track ${selected ? 'selected' : ''} ${silent ? 'silent' : ''}`}
      style={{ '--accent': track.color }}
      aria-current={selected}
      onClick={() => s.go({ name: 'track', trackId: track.id })}
    >
      <span class="rail-icon">
        <Icon name={TYPE_ICONS[track.generator.type] ?? 'motif'} size={18} />
      </span>
      <span class="rail-name">
        <b>{track.name}</b>
        <span>
          {typeLabel(track.generator.type)} · {device?.name ?? out.portName}
        </span>
      </span>
      <span class="rail-state">
        {track.muted ? (
          <span class="rail-flag">M</span>
        ) : track.solo ? (
          <span class="rail-flag solo">S</span>
        ) : (
          <span class="mono rail-now">{now || (index < 9 ? String(index + 1) : '')}</span>
        )}
      </span>
    </button>
  );
}

function ClockSelect() {
  const s = useStore();
  const p = s.project;
  if (s.rack.devices.length > 0) {
    return (
      <label class="rail-clock">
        <span>Clock out</span>
        <select
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
      </label>
    );
  }
  const target = p.clock.sendTo[0] ?? '';
  return (
    <label class="rail-clock">
      <span>Clock out</span>
      <select
        value={target}
        onChange={(e) => {
          const v = (e.target as HTMLSelectElement).value;
          s.change((x) => ({ ...x, clock: { sendTo: v ? [v] : [] } }));
        }}
      >
        <option value="">Off</option>
        {[...new Set([target, ...s.ports].filter(Boolean))].map((n) => (
          <option value={n}>{n}</option>
        ))}
      </select>
    </label>
  );
}

/** Theme switcher: one chip per theme, with a colour preview. */
function ThemePicker() {
  const theme = useTheme();
  return (
    <div class="theme-picker" role="radiogroup" aria-label="Theme">
      <span>Theme</span>
      {THEMES.map((t) => (
        <button
          type="button"
          role="radio"
          aria-checked={t.id === theme.id}
          title={`${t.name}: ${t.description} (Shift+T)`}
          onClick={() => applyTheme(t.id)}
        >
          <span class="theme-swatch" aria-hidden="true">
            {t.swatch.map((c) => (
              <i style={{ background: c }} />
            ))}
          </span>
          {t.name}
        </button>
      ))}
    </div>
  );
}
