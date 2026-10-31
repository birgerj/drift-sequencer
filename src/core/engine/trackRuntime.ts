import { generatePattern, mutatePattern } from '../generators/registry';
import { conditionMet, type Pattern, type PatternEvent } from '../pattern/pattern';
import { resolvePitch, type ResolveState } from '../pattern/resolve';
import { Rng } from '../random/rng';
import type { HarmonicMoment } from '../theory/harmony';
import type { MidiNote } from '../theory/note';
import type { TrackState } from '../../state/project';

export interface ScheduledNote {
  trackId: string;
  notes: MidiNote[];
  velocity: number;
  /** Duration in steps. */
  length: number;
  /** Number of repeats within the step (1 = a single note). */
  ratchet: number;
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
    if (this.history.length > 64) this.history.shift();
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

  /** Events of this track's own pattern that start at a global step. */
  eventsAt(globalStep: number): PatternEvent[] {
    const local = globalStep % this.pattern.lengthSteps;
    return this.pattern.events.filter((e) => e.step === local);
  }

  /** Notes to play at a global step, resolved against the harmonic moment. */
  notesAt(globalStep: number, moment: HarmonicMoment): ScheduledNote[] {
    return this.resolveEvents(this.eventsAt(globalStep), globalStep, moment);
  }

  /**
   * Resolve events (this track's, or ones borrowed from another track for a
   * call-and-response answer) in this track's register, applying trig
   * conditions and probability.
   */
  resolveEvents(events: readonly PatternEvent[], globalStep: number, moment: HarmonicMoment): ScheduledNote[] {
    const pass = Math.floor(globalStep / this.pattern.lengthSteps);
    const out: ScheduledNote[] = [];
    for (const ev of events) {
      if (ev.condition && !conditionMet(ev.condition, pass)) continue;
      if (ev.probability !== undefined && !this.rng.chance(ev.probability)) continue;
      out.push({
        trackId: this.config.id,
        notes: resolvePitch(ev.pitch, moment, this.config.register, this.resolveState),
        velocity: ev.velocity,
        length: ev.length,
        ratchet: Math.max(1, Math.min(4, Math.round(ev.ratchet ?? 1))),
      });
    }
    return out;
  }

  private ctx() {
    return { rng: this.rng, stepsPerBar: this.stepsPerBar };
  }
}
