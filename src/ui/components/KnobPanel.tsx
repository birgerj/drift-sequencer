import { useMemo, useState } from 'preact/hooks';
import { withAutoPanel } from '../../core/instruments/autoPanel';
import type { InstrumentDefinition } from '../../core/instruments/instrument';
import type { TrackState } from '../../state/project';
import { store, useLive, useStore } from '../store';
import { Card } from './controls';
import { PanelModules } from './PanelModules';

/**
 * The synth's panel. Built-in synths have a hand-made layout; any other
 * definition gets one built from its CC list (see autoPanel).
 */
export function KnobPanel({ track, instrument }: { track: TrackState; instrument: InstrumentDefinition | undefined }) {
  const s = useStore();
  const def = useMemo(() => (instrument ? withAutoPanel(instrument) : undefined), [instrument]);

  if (!def || !def.panel?.length) {
    return (
      <Card title="Panel">
        <div class="empty">
          <p>
            {instrument
              ? `${instrument.device} has no CC parameters to show.`
              : 'Choose which synth this device is (Devices → instrument) to get its knobs here.'}
          </p>
          <button type="button" class="primary" onClick={() => s.go({ name: 'instruments' })}>
            Open devices
          </button>
        </div>
      </Card>
    );
  }

  return (
    <div class="knob-panel with-modules" style={{ '--accent': track.color }}>
      <PanelModules track={track} instrument={def} />
      <MotionRecorder track={track} />
      <PanelBar track={track} instrument={def} />
    </div>
  );
}

/** Presets, snapshots and sending every value. */
function PanelBar({ track, instrument }: { track: TrackState; instrument: InstrumentDefinition }) {
  const s = useStore();
  const snapshots = track.panel?.snapshots ?? {};
  return (
    <div class="panel-bar">
      {instrument.presets?.length ? <PresetPicker track={track} instrument={instrument} /> : null}
      <span class="eyebrow">Snapshots</span>
      {['A', 'B', 'C', 'D'].map((slot) => (
        <button
          type="button"
          class={`snap ${snapshots[slot] ? 'filled' : ''}`}
          title={snapshots[slot] ? 'Tap to recall · Shift+tap to overwrite' : 'Tap to store the current knobs'}
          onClick={(e) =>
            snapshots[slot] && !e.shiftKey ? s.recallPanelSnapshot(track.id, slot) : s.storePanelSnapshot(track.id, slot)
          }
        >
          {slot}
        </button>
      ))}
      <div class="spacer" />
      <span class="hint">Drag · Shift for fine · double-tap resets</span>
      <button type="button" onClick={() => s.sendPanel(track.id)}>
        Send all values
      </button>
    </div>
  );
}

/** The instrument's ready-made sounds; "edited" once a knob moved away from the loaded preset. */
function PresetPicker({ track, instrument }: { track: TrackState; instrument: InstrumentDefinition }) {
  const s = useStore();
  const loaded = track.panel?.preset;
  const values = track.panel?.values ?? {};
  const edited = loaded ? Object.entries(loaded.values).some(([cc, v]) => values[cc] !== v) : false;
  return (
    <label class="preset-picker">
      <span class="eyebrow">Preset</span>
      <select
        value={loaded?.name ?? ''}
        aria-label="Preset"
        onChange={(e) => {
          const name = (e.currentTarget as HTMLSelectElement).value;
          if (name) s.loadPanelPreset(track.id, name);
        }}
      >
        {!loaded && <option value="">Choose…</option>}
        {instrument.presets!.map((p) => (
          <option value={p.name}>{p.name === loaded?.name && edited ? `${p.name} (edited)` : p.name}</option>
        ))}
      </select>
      {loaded && edited && (
        <button type="button" title={`Load ${loaded.name} again`} onClick={() => s.loadPanelPreset(track.id, loaded.name)}>
          Revert
        </button>
      )}
    </label>
  );
}

const REC_BARS = [1, 2, 4, 8];

/** Input status and recording knob movements into a looping motion. */
function MotionRecorder({ track }: { track: TrackState }) {
  const s = useStore();
  const [bars, setBars] = useState(4);
  const input = s.trackInput(track);
  const rec = s.recording?.trackId === track.id ? s.recording : undefined;
  const progress = useLive((l) => {
    const r = store.recording;
    if (!r || r.trackId !== track.id || r.startStep === undefined) return -1;
    return Math.min(1, (l.step - r.startStep + 1) / (r.bars * store.project.stepsPerBar));
  });
  const receiving = useLive(() => performance.now() - (store.lastInput.get(track.id) ?? -1e9) < 600);
  return (
    <div class="panel-bar recorder">
      <span class={`in-dot ${receiving ? 'on' : ''}`} aria-hidden="true" />
      <span class="small">
        {input ? (
          <>
            From synth: <b>{input}</b>
          </>
        ) : (
          <span class="muted">Not receiving knobs: pick this synth’s MIDI input under Devices</span>
        )}
      </span>
      <div class="spacer" />
      {rec ? (
        <>
          <span class="rec-state">
            <span class="rec-dot" />
            {rec.startStep === undefined ? 'Armed · starts on the next bar' : `Recording · ${Math.round(Math.max(0, progress) * 100)}%`}
          </span>
          <button type="button" onClick={() => s.cancelMotionRecording()}>
            Cancel
          </button>
        </>
      ) : (
        <>
          <div class="segmented" role="radiogroup" aria-label="Motion length in bars">
            {REC_BARS.map((b) => (
              <button type="button" role="radio" aria-checked={b === bars} onClick={() => setBars(b)}>
                {b} bar{b === 1 ? '' : 's'}
              </button>
            ))}
          </div>
          <button type="button" class="rec-button" onClick={() => s.startMotionRecording(track.id, bars)}>
            <span class="rec-dot" /> Record motion
          </button>
        </>
      )}
    </div>
  );
}
