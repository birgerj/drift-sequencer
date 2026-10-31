import { useEffect } from 'preact/hooks';
import { useStore } from '../store';
import { Card } from './controls';

/** Live list of incoming MIDI: shows whether knobs arrive, on which port and channel. */
export function MidiMonitor() {
  const s = useStore();
  useEffect(() => {
    s.setMonitorOpen(true);
    return () => s.setMonitorOpen(false);
  }, [s]);
  return (
    <Card title="MIDI in monitor">
      {!s.midi.connected ? (
        <button type="button" class="primary" onClick={() => void s.connectMidi()}>
          Connect MIDI
        </button>
      ) : (
        <p class="hint">
          Inputs: {s.inputs.length ? s.inputs.join(' · ') : 'none found'}. Turn a knob on a synth; every message shows here.
        </p>
      )}
      <ol class="monitor" aria-live="polite">
        {s.monitor.length === 0 && <li class="muted">Nothing received yet.</li>}
        {s.monitor.map((m) => (
          <li key={m.id}>
            <span class="mono muted">{m.port}</span>
            <span class="mono">ch {m.channel}</span>
            <b class="mono">{m.text}</b>
            <span class={m.tracks.length ? 'ok-text' : 'warn'}>{m.tracks.length ? `→ ${m.tracks.join(', ')}` : 'no track listens (input/channel)'}</span>
          </li>
        ))}
      </ol>
    </Card>
  );
}
