import type { TrackState } from '../../state/project';
import { useStore } from '../store';
import { Icon } from './controls';

/** Octave shift for a whole track: −3…+3. Hidden for drum tracks (fixed notes). */
export function OctaveControl({ track, compact }: { track: TrackState; compact?: boolean }) {
  const s = useStore();
  if (track.generator.type === 'drums') return null;
  const octave = track.octave ?? 0;
  const set = (v: number) => s.updateTrack(track.id, { octave: Math.max(-3, Math.min(3, v)) });
  return (
    <div class={`octave-control ${compact ? 'compact' : ''}`} role="group" aria-label={`${track.name} octave`}>
      <button type="button" class="square" aria-label={`${track.name} octave down`} disabled={octave <= -3} onClick={() => set(octave - 1)}>
        <Icon name="minus" />
      </button>
      <button type="button" class="octave-value" aria-label={`${track.name} octave ${octave}, reset`} onClick={() => set(0)} title="Tap to reset">
        <span class="eyebrow">Oct</span>
        <span class="mono">{octave > 0 ? `+${octave}` : octave}</span>
      </button>
      <button type="button" class="square" aria-label={`${track.name} octave up`} disabled={octave >= 3} onClick={() => set(octave + 1)}>
        <Icon name="plus" />
      </button>
    </div>
  );
}
