import { normalizeRate, shiftRegister } from '../../core/engine/trackRuntime';
import type { Pattern } from '../../core/pattern/pattern';
import { resolvePitch } from '../../core/pattern/resolve';
import type { TrackState } from '../../state/project';
import { store, useLive } from '../store';

export interface StepShape {
  /** 0 = rest, else 0..1 pitch height within the pattern's range. */
  level: number;
  /** A held note continuing from an earlier step. */
  held: boolean;
  /** A note starts on this step. */
  onset: boolean;
}

/** Per-step pitch height of a melodic pattern, for themed pattern displays. */
export function patternShape(track: TrackState, pattern: Pattern): StepShape[] {
  const len = pattern.lengthSteps;
  const reg = shiftRegister(track.register, track.octave ?? 0);
  const state = {};
  const rate = normalizeRate(track.rate);
  const spb = store.project.stepsPerBar;
  const notes = pattern.events.map((e) => ({
    e,
    n: Math.max(...resolvePitch(e.pitch, store.sequencer.harmonyAt(Math.floor(e.step / rate / spb)), reg, state)),
  }));
  const all = notes.map((x) => x.n).filter(Number.isFinite);
  const lo = Math.min(...all, 127);
  const hi = Math.max(...all, 0);
  const out: StepShape[] = Array.from({ length: len }, () => ({ level: 0, held: false, onset: false }));
  for (const { e, n } of notes) {
    if (!Number.isFinite(n)) continue;
    const h = hi > lo ? 0.15 + ((n - lo) / (hi - lo)) * 0.8 : 0.55;
    const s0 = out[e.step]!;
    s0.level = Math.max(s0.level, h);
    s0.onset = true;
    s0.held = false;
    for (let k = 1; k < Math.min(len, Math.round(e.length)); k++) {
      const s = out[(e.step + k) % len]!;
      if (!s.level) {
        s.level = h;
        s.held = true;
      }
    }
  }
  return out;
}

/** Pattern step under the playhead, or -1 when stopped. */
export function usePlayStep(trackId: string): number {
  return useLive((l) => {
    const rt = store.sequencer.track(trackId);
    return store.sequencer.playing && l.step >= 0 && rt ? rt.patternStepAt(l.step) : -1;
  });
}
