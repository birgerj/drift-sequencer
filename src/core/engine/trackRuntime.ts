import { generatePattern, mutatePattern } from '../generators/registry';
import { conditionMet, type Pattern, type PatternEvent, type Register } from '../pattern/pattern';
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
  accent: boolean;
  /** This note is slid into from the previous one. */
  slide: boolean;
  /**
   * When the next note slides in, hold this one for this many steps so the
   * two overlap (a 303 slides when notes overlap).
   */
  holdSteps?: number;
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
    return this.resolveEvents(this.eventsAt(globalStep), globalStep, moment, this.pattern);
  }

  /**
   * Resolve events (this track's, or ones borrowed from another track for a
   * call-and-response answer) in this track's register, applying trig
   * conditions and probability.
   */
  resolveEvents(
    events: readonly PatternEvent[],
    globalStep: number,
    moment: HarmonicMoment,
    source?: Pattern,
  ): ScheduledNote[] {
    const pass = Math.floor(globalStep / this.pattern.lengthSteps);
    const register = shiftRegister(this.config.register, this.config.octave ?? 0);
    const out: ScheduledNote[] = [];
    for (const ev of events) {
      if (ev.condition && !conditionMet(ev.condition, pass)) continue;
      if (ev.probability !== undefined && !this.rng.chance(ev.probability)) continue;
      out.push({
        trackId: this.config.id,
        notes: resolvePitch(ev.pitch, moment, register, this.resolveState),
        velocity: ev.velocity,
        length: ev.length,
        ratchet: Math.max(1, Math.min(4, Math.round(ev.ratchet ?? 1))),
        accent: !!ev.accent,
        slide: !!ev.slide,
        holdSteps: source ? slideHold(source, ev) : undefined,
      });
    }
    return out;
  }

  private ctx() {
    return { rng: this.rng, stepsPerBar: this.stepsPerBar };
  }
}

/** Move a register up or down by whole octaves (drum notes are fixed and unaffected). */
export function shiftRegister(register: Register, octaves: number): Register {
  if (!octaves) return register;
  const d = Math.round(octaves) * 12;
  const low = Math.max(0, register.low + d);
  const high = Math.min(127, register.high + d);
  return { baseOctave: register.baseOctave + Math.round(octaves), low, high: Math.max(low + 11, high) };
}

/**
 * If the next note after `ev` slides in, the steps until it starts (so this
 * note can be held into it); otherwise undefined.
 */
export function slideHold(pattern: Pattern, ev: PatternEvent): number | undefined {
  if (ev.pitch.kind === 'fixed') return undefined;
  const len = pattern.lengthSteps;
  let next: PatternEvent | undefined;
  let best = Infinity;
  for (const e of pattern.events) {
    if (e === ev || e.pitch.kind === 'fixed') continue;
    const d = (((e.step - ev.step) % len) + len) % len || len;
    if (d < best) {
      best = d;
      next = e;
    }
  }
  return next?.slide ? best : undefined;
}
