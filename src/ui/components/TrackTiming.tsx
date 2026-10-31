import { TRACK_RATES } from '../../core/engine/trackRuntime';
import type { TrackState } from '../../state/project';
import { useStore } from '../store';
import { Segmented } from './controls';

export const LENGTH_OPTIONS = [8, 16, 32, 64].map((n) => ({ value: n, label: String(n) }));

export const RATE_LABELS: Record<number, string> = { 2: '×2', 1: '×1', 0.5: '½', 0.25: '¼' };

/** Pattern length in steps and playback speed for one track. */
export function TrackTiming({ track }: { track: TrackState }) {
  const s = useStore();
  const length = s.sequencer.track(track.id)?.pattern.lengthSteps ?? track.generator.params.lengthSteps;
  const rate = track.rate ?? 1;
  const bars = (length / s.project.stepsPerBar) / rate;
  return (
    <>
      <Segmented label="Length (steps)" value={length} options={LENGTH_OPTIONS} onChange={(n) => s.setTrackLength(track.id, n)} />
      <Segmented
        label="Speed"
        value={rate}
        options={TRACK_RATES.map((r) => ({ value: r, label: RATE_LABELS[r]! }))}
        onChange={(r) => s.updateTrack(track.id, { rate: r })}
      />
      <p class="hint">
        One pass takes {bars >= 1 ? `${bars} bar${bars === 1 ? '' : 's'}` : `${bars * 4} beat${bars * 4 === 1 ? '' : 's'}`}.
        {rate < 1 ? ' Each step lasts longer: slow chords and drones.' : rate > 1 ? ' Double-time: fast runs and arps.' : ''}
      </p>
    </>
  );
}
