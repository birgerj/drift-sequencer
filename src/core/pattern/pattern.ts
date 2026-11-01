import type { MidiNote } from '../theory/note';

/**
 * How an event's pitch is expressed. Patterns store pitch *relative to the
 * harmony* and are resolved to MIDI only at play time, so a motif keeps its
 * shape while following the chord progression and any key change.
 */
export type PitchSpec =
  /**
   * Scale degree offset from the current chord's root degree (+ optional
   * octave jump). With `nearest`, the octave closest to the previous note is
   * chosen, so a melody moves smoothly across chord changes.
   */
  | { kind: 'degree'; degree: number; octave?: number; nearest?: boolean }
  /**
   * Scale degree offset from the key's root: the line keeps its own shape
   * across chord changes. `fit` moves this note onto the current chord (any
   * chord tone, or the root); `nearest` works as for `degree`.
   */
  | { kind: 'keyDegree'; degree: number; nearest?: boolean; fit?: 'tone' | 'root' }
  /** A tone of the current chord: 0 = root, 1 = third, 2 = fifth, … */
  | { kind: 'chordTone'; index: number; octave: number }
  /** The whole current chord, voice-led from the previous voicing. */
  | { kind: 'chord' }
  /** A fixed MIDI note, e.g. a drum voice on the TR-8S. */
  | { kind: 'fixed'; note: MidiNote };

export interface PatternEvent {
  /** Start step within the pattern (0-based). */
  step: number;
  /** Duration in steps (may be fractional). */
  length: number;
  /** 1..127 */
  velocity: number;
  pitch: PitchSpec;
  /** Chance (0..1) the event actually plays each pass. Defaults to 1. */
  probability?: number;
  /** Elektron-style trig condition: play only on some passes of the pattern. */
  condition?: StepCondition;
  /** Repeat the note this many times within its step (2–4). */
  ratchet?: number;
  /** 303-style accent: played at full velocity. */
  accent?: boolean;
  /** 303-style slide into this note: the previous note is held until it starts. */
  slide?: boolean;
}

/**
 * Plays on pass `on` out of every `every` passes (1-based): 1:2 plays on the
 * 1st, 3rd, 5th… pass; 4:4 only on every 4th pass.
 */
export interface StepCondition {
  on: number;
  every: number;
}

export const STEP_CONDITIONS: StepCondition[] = [
  { on: 1, every: 2 },
  { on: 2, every: 2 },
  { on: 1, every: 4 },
  { on: 2, every: 4 },
  { on: 3, every: 4 },
  { on: 4, every: 4 },
];

export function conditionLabel(c: StepCondition): string {
  return `${c.on}:${c.every}`;
}

/** `pass` is 0-based (the first pass is 0). */
export function conditionMet(c: StepCondition, pass: number): boolean {
  return ((pass % c.every) + c.every) % c.every === c.on - 1;
}

export interface Pattern {
  lengthSteps: number;
  events: PatternEvent[];
}

/** Pitch range a track plays in. */
export interface Register {
  /** Octave in which degree 0 / chord tone 0 is placed. */
  baseOctave: number;
  low: MidiNote;
  high: MidiNote;
}

export function emptyPattern(lengthSteps: number): Pattern {
  return { lengthSteps, events: [] };
}

export function eventsAtStep(pattern: Pattern, step: number): PatternEvent[] {
  return pattern.events.filter((e) => e.step === step);
}
