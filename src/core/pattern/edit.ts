import { STEP_CONDITIONS, type Pattern, type PatternEvent } from './pattern';

/** Drum cell states, cycled by tapping: off → hit → chance → off. */
export type DrumCell = 'off' | 'hit' | 'chance';

export const CHANCE_PROBABILITY = 0.5;

export function drumCell(pattern: Pattern, step: number, note: number): DrumCell {
  const e = pattern.events.find((x) => x.step === step && x.pitch.kind === 'fixed' && x.pitch.note === note);
  if (!e) return 'off';
  return (e.probability ?? 1) < 1 ? 'chance' : 'hit';
}

/** Cycle one drum cell to its next state. Returns a new pattern. */
export function cycleDrumCell(pattern: Pattern, step: number, note: number, velocity: number): Pattern {
  const state = drumCell(pattern, step, note);
  const existing = pattern.events.find((x) => x.step === step && x.pitch.kind === 'fixed' && x.pitch.note === note);
  const others = pattern.events.filter((x) => x !== existing);
  // Keep a hit's condition and ratchet when it becomes a chance hit.
  const base: PatternEvent = existing
    ? { ...existing, probability: undefined }
    : { step, length: 0.5, velocity, pitch: { kind: 'fixed', note } };
  delete base.probability;
  const next =
    state === 'off' ? [...others, base] : state === 'hit' ? [...others, { ...base, probability: CHANCE_PROBABILITY }] : others;
  return { ...pattern, events: sortByStep(next) };
}

/** Degree of the motif note starting at `step`, if any. */
export function motifNoteAt(pattern: Pattern, step: number): PatternEvent | undefined {
  return pattern.events.find((e) => e.step === step && e.pitch.kind === 'degree');
}

/** Index of the motif note sounding (started or held) at `step`, if any. */
export function motifNoteCovering(pattern: Pattern, step: number): PatternEvent | undefined {
  return pattern.events.find((e) => e.pitch.kind === 'degree' && step >= e.step && step < e.step + e.length);
}

/**
 * Tap a cell in the motif grid (monophonic):
 * - empty step → add a one-step note at that degree
 * - tap the start of a note with the same degree → remove it
 * - tap a different degree at a step → move that note to the new degree
 * Notes before this one are shortened so nothing overlaps.
 */
export function toggleMotifNote(pattern: Pattern, step: number, degree: number, velocity: number): Pattern {
  const existing = motifNoteAt(pattern, step);
  let events = pattern.events.filter((e) => e !== existing);
  if (!existing || existing.pitch.kind !== 'degree' || existing.pitch.degree !== degree) {
    events.push({
      step,
      length: existing?.length ?? 1,
      velocity: existing?.velocity ?? velocity,
      pitch: { kind: 'degree', degree },
    });
  }
  events = sortByStep(events);
  return { ...pattern, events: trimOverlaps(events, pattern.lengthSteps) };
}

/** Make the note starting at `step` longer or shorter by `delta` steps. */
export function resizeMotifNote(pattern: Pattern, step: number, delta: number): Pattern {
  const events = sortByStep(pattern.events);
  const i = events.findIndex((e) => e.step === step && e.pitch.kind === 'degree');
  if (i < 0) return pattern;
  const limit = (events[i + 1]?.step ?? pattern.lengthSteps) - step;
  const e = events[i]!;
  events[i] = { ...e, length: Math.max(1, Math.min(limit, Math.round(e.length) + delta)) };
  return { ...pattern, events };
}

/** Find the event a grid cell refers to: a drum hit, or a motif note start. */
export type EventMatcher = (e: PatternEvent) => boolean;

export const drumAt = (step: number, note: number): EventMatcher => (e) =>
  e.step === step && e.pitch.kind === 'fixed' && e.pitch.note === note;

export const noteStartAt = (step: number): EventMatcher => (e) => e.step === step && e.pitch.kind === 'degree';

/** Cycle the trig condition: always → 1:2 → 2:2 → 1:4 → 2:4 → 3:4 → 4:4 → always. */
export function cycleCondition(pattern: Pattern, match: EventMatcher): Pattern {
  return {
    ...pattern,
    events: pattern.events.map((e) => {
      if (!match(e)) return e;
      const i = e.condition ? STEP_CONDITIONS.findIndex((c) => c.on === e.condition!.on && c.every === e.condition!.every) : -1;
      const next = STEP_CONDITIONS[i + 1];
      const { condition: _old, ...rest } = e;
      return next ? { ...rest, condition: { ...next } } : rest;
    }),
  };
}

/** Cycle ratchets: 1 → 2 → 3 → 4 → 1. */
export function cycleRatchet(pattern: Pattern, match: EventMatcher): Pattern {
  return {
    ...pattern,
    events: pattern.events.map((e) => {
      if (!match(e)) return e;
      const next = ((e.ratchet ?? 1) % 4) + 1;
      const { ratchet: _old, ...rest } = e;
      return next > 1 ? { ...rest, ratchet: next } : rest;
    }),
  };
}

export function clearPattern(pattern: Pattern): Pattern {
  return { ...pattern, events: [] };
}

/** Change a pattern's length; longer patterns repeat the existing content. */
export function resizePattern(pattern: Pattern, lengthSteps: number): Pattern {
  if (lengthSteps === pattern.lengthSteps) return pattern;
  if (lengthSteps < pattern.lengthSteps) {
    return { lengthSteps, events: trimOverlaps(pattern.events.filter((e) => e.step < lengthSteps), lengthSteps) };
  }
  const events: PatternEvent[] = [];
  for (let offset = 0; offset < lengthSteps; offset += pattern.lengthSteps) {
    for (const e of pattern.events) if (e.step + offset < lengthSteps) events.push({ ...e, step: e.step + offset });
  }
  return { lengthSteps, events: sortByStep(events) };
}

function sortByStep(events: PatternEvent[]): PatternEvent[] {
  return [...events].sort((a, b) => a.step - b.step);
}

function trimOverlaps(events: PatternEvent[], lengthSteps: number): PatternEvent[] {
  return events.map((e, i) => {
    if (e.pitch.kind !== 'degree') return e;
    const next = events.slice(i + 1).find((x) => x.pitch.kind === 'degree');
    const end = next?.step ?? lengthSteps;
    return { ...e, length: Math.max(1, Math.min(e.length, end - e.step)) };
  });
}
