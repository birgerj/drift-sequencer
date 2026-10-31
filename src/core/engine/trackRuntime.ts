import { generatePattern, mutatePattern } from '../generators/registry';
import type { Pattern } from '../pattern/pattern';
import { resolvePitch, type ResolveState } from '../pattern/resolve';
import { Rng } from '../random/rng';
import type { Harmony } from '../theory/harmony';
import type { MidiNote } from '../theory/note';
import type { TrackState } from '../../state/project';

export interface ScheduledNote {
  trackId: string;
  notes: MidiNote[];
  velocity: number;
  /** Duration in steps. */
  length: number;
}

/**
 * Live state of one track: its current pattern, its random generator and
 * the resolver memory. Configuration lives in TrackState (the project).
 */
export class TrackRuntime {
  pattern: Pattern;
  private rng: Rng;
  private resolveState: ResolveState = {};
  /** Every pattern this track has played; lets the UI jump back. */
  readonly history: Pattern[] = [];

  constructor(
    public config: TrackState,
    private readonly stepsPerBar: number,
  ) {
    this.rng = new Rng(config.seed);
    this.pattern = config.userPattern ?? generatePattern(config.generator, this.ctx());
    this.history.push(this.pattern);
  }

  /** Replace the pattern with one the user edited. */
  setPattern(pattern: Pattern): void {
    this.pattern = pattern;
    this.history.push(pattern);
    if (this.history.length > 64) this.history.shift();
  }

  /** Throw away the pattern and generate a new one (new seed). */
  regenerate(seed: number = Math.floor(Math.random() * 2 ** 32)): void {
    this.config = { ...this.config, seed };
    this.rng = new Rng(seed);
    this.resolveState = {};
    this.pattern = generatePattern(this.config.generator, this.ctx());
    this.history.push(this.pattern);
  }

  /** Called at bar boundaries; returns true if the pattern changed. */
  maybeMutate(bar: number): boolean {
    if (this.config.frozen || bar === 0) return false;
    if (bar % Math.max(1, this.config.mutationIntervalBars) !== 0) return false;
    const next = mutatePattern(this.config.generator, this.pattern, this.ctx());
    if (next === this.pattern) return false;
    this.pattern = next;
    this.history.push(next);
    if (this.history.length > 64) this.history.shift();
    return true;
  }

  restore(index: number): void {
    const p = this.history[index];
    if (p) this.pattern = p;
  }

  /** Notes to play at a global step, resolved against the current harmony. */
  notesAt(globalStep: number, harmony: Harmony): ScheduledNote[] {
    const local = globalStep % this.pattern.lengthSteps;
    const bar = Math.floor(globalStep / this.stepsPerBar);
    const moment = harmony.at(bar);
    const out: ScheduledNote[] = [];
    for (const ev of this.pattern.events) {
      if (ev.step !== local) continue;
      if (ev.probability !== undefined && !this.rng.chance(ev.probability)) continue;
      out.push({
        trackId: this.config.id,
        notes: resolvePitch(ev.pitch, moment, this.config.register, this.resolveState),
        velocity: ev.velocity,
        length: ev.length,
      });
    }
    return out;
  }

  private ctx() {
    return { rng: this.rng, stepsPerBar: this.stepsPerBar };
  }
}
