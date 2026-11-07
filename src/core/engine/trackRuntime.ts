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
  /** Start offset within the global step (0..1), for tracks faster than ×1. */
  offset: number;
  /** Global steps per pattern step (ratchets spread over this). */
  stepScale: number;
}

export const TRACK_RATES = [2, 1, 0.5, 0.25] as const;

export function normalizeRate(rate: number | undefined): number {
  return TRACK_RATES.includes(rate as (typeof TRACK_RATES)[number]) ? (rate as number) : 1;
}

function scaleHold(hold: number | undefined, scale: number): number | undefined {
  return hold === undefined ? undefined : hold * scale;
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
  /** The pattern a melody keeps coming back to (see TrackState.memory). */
  theme: Pattern;
  private mutations = 0;
  /** What the last change at a bar boundary was. */
  lastChange: 'mutation' | 'theme' | 'recall' = 'mutation';

  constructor(
    public config: TrackState,
    private readonly stepsPerBar: number,
  ) {
    this.rng = new Rng(config.seed);
    this.pattern = config.userPattern ?? generatePattern(config.generator, this.ctx());
    this.theme = this.pattern;
    this.history.push(this.pattern);
  }

  /** Replace the pattern with one the user edited. */
  setPattern(pattern: Pattern): void {
    this.pattern = pattern;
    this.theme = pattern;
    this.mutations = 0;
    this.history.push(pattern);
    if (this.history.length > 64) this.history.shift();
  }

  /** Throw away the pattern and generate a new one (new seed). */
  regenerate(seed: number = Math.floor(Math.random() * 2 ** 32)): void {
    this.config = { ...this.config, seed };
    this.rng = new Rng(seed);
    this.resolveState = {};
    this.pattern = generatePattern(this.config.generator, this.ctx());
    this.theme = this.pattern;
    this.mutations = 0;
    this.history.push(this.pattern);
    if (this.history.length > 64) this.history.shift();
  }

  /** Called at bar boundaries; returns true if the pattern changed. */
  maybeMutate(bar: number): boolean {
    if (this.config.frozen || bar === 0) return false;
    if (bar % Math.max(1, this.config.mutationIntervalBars) !== 0) return false;
    this.mutations++;
    const memory = this.config.memory;
    if (memory && memory.every > 0 && this.mutations % (memory.every + 1) === 0) {
      // Melody memory: come back to something the listener has heard before.
      const earlier = this.history.slice(-16).filter((p) => p !== this.pattern && p.lengthSteps === this.pattern.lengthSteps);
      const back = memory.mode === 'recall' && earlier.length ? earlier[this.rng.int(0, earlier.length - 1)]! : this.theme;
      if (back.lengthSteps !== this.pattern.lengthSteps || back === this.pattern) return false;
      this.lastChange = memory.mode === 'recall' ? 'recall' : 'theme';
      this.pattern = back;
      this.history.push(back);
      if (this.history.length > 64) this.history.shift();
      return true;
    }
    this.lastChange = 'mutation';
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

  /**
   * Notes to play during one global step (a 16th of the song), resolved
   * against the harmonic moment. With a track speed other than 1, a global
   * step can hold several pattern steps (×2) or none (½, ¼).
   */
  notesAt(globalStep: number, moment: HarmonicMoment): ScheduledNote[] {
    const rate = normalizeRate(this.config.rate);
    if (rate === 1) return this.resolveEvents(this.eventsAt(globalStep), globalStep, moment, this.pattern);
    const out: ScheduledNote[] = [];
    if (rate > 1) {
      for (let k = 0; k < rate; k++) {
        const ps = globalStep * rate + k;
        out.push(...this.resolveEvents(this.eventsAt(ps), ps, moment, this.pattern, 1 / rate, k / rate));
      }
    } else {
      const div = Math.round(1 / rate);
      if (globalStep % div !== 0) return out;
      const ps = globalStep / div;
      out.push(...this.resolveEvents(this.eventsAt(ps), ps, moment, this.pattern, div, 0));
    }
    return out;
  }

  /** Notes of muted drum voices, or undefined when none are muted. */
  private mutedNotes(): Set<number> | undefined {
    const g = this.config.generator;
    if (g.type !== 'drums') return undefined;
    const muted = g.params.voices.filter((v) => v.muted);
    return muted.length ? new Set(muted.map((v) => v.note)) : undefined;
  }

  /** The pattern step playing at a global step (for playheads). */
  patternStepAt(globalStep: number): number {
    return Math.floor(globalStep * normalizeRate(this.config.rate)) % this.pattern.lengthSteps;
  }

  /**
   * Resolve events (this track's, or ones borrowed from another track for a
   * call-and-response answer) in this track's register, applying trig
   * conditions and probability.
   */
  resolveEvents(
    events: readonly PatternEvent[],
    patternStep: number,
    moment: HarmonicMoment,
    source?: Pattern,
    /** Global steps per pattern step (2 at half speed). */
    scale = 1,
    /** Start offset within the global step, as a fraction of it. */
    offset = 0,
  ): ScheduledNote[] {
    const pass = Math.floor(patternStep / this.pattern.lengthSteps);
    const register = shiftRegister(this.config.register, this.config.octave ?? 0);
    const muted = this.mutedNotes();
    const out: ScheduledNote[] = [];
    for (const ev of events) {
      if (muted && ev.pitch.kind === 'fixed' && muted.has(ev.pitch.note)) continue;
      if (ev.condition && !conditionMet(ev.condition, pass)) continue;
      if (ev.probability !== undefined && !this.rng.chance(ev.probability)) continue;
      out.push({
        trackId: this.config.id,
        notes: resolvePitch(ev.pitch, moment, register, this.resolveState),
        velocity: ev.velocity,
        length: ev.length * scale,
        ratchet: Math.max(1, Math.min(4, Math.round(ev.ratchet ?? 1))),
        accent: !!ev.accent,
        slide: !!ev.slide,
        holdSteps: source ? scaleHold(slideHold(source, ev), scale) : undefined,
        offset,
        stepScale: scale,
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
