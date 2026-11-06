import type { DrumVoice } from '../core/generators/drumGenerator';
import { TR8S_NOTES } from '../core/generators/drumGenerator';
import { tr8sVoices, TR8S_VOICE_ORDER, type DrumVoiceKey } from '../core/generators/drumPresets';
import type { Pattern, PatternEvent, StepCondition } from '../core/pattern/pattern';

/**
 * A compact way to write patterns by hand, used by the project templates.
 * Bar lines (`|`) and spaces are only for reading.
 */

const VALID_LENGTHS = [8, 16, 32, 64];

// ---------------------------------------------------------------- drums

interface DrumHit {
  velocity: number;
  probability?: number;
  ratchet?: number;
  condition?: StepCondition;
  /** Fills and crashes are extras: they don't count as the lane's basic rhythm. */
  extra?: boolean;
}

/**
 * One character per 16th:
 *   X accent · x hit · o soft · g ghost · ? 50 % chance
 *   2 / 3 ratchet · a / b every other pass (1st / 2nd)
 *   C only on the 1st of 4 passes (a crash at the top of a phrase)
 *   F / f only on the 4th of 4 passes (a fill before the phrase repeats)
 *   . rest
 */
const DRUM_HITS: Record<string, DrumHit> = {
  X: { velocity: 120 },
  x: { velocity: 98 },
  o: { velocity: 68 },
  g: { velocity: 46 },
  '?': { velocity: 78, probability: 0.5 },
  '2': { velocity: 92, ratchet: 2 },
  '3': { velocity: 88, ratchet: 3 },
  a: { velocity: 92, condition: { on: 1, every: 2 } },
  b: { velocity: 92, condition: { on: 2, every: 2 } },
  C: { velocity: 118, condition: { on: 1, every: 4 }, extra: true },
  F: { velocity: 118, condition: { on: 4, every: 4 }, extra: true },
  f: { velocity: 90, condition: { on: 4, every: 4 }, extra: true },
};

export type DrumRows = Partial<Record<DrumVoiceKey, string>>;

function clean(row: string): string {
  return row.replace(/[\s|]/g, '');
}

function checkLength(lengthSteps: number, what: string): void {
  if (!VALID_LENGTHS.includes(lengthSteps)) throw new Error(`${what}: length ${lengthSteps} must be 8, 16, 32 or 64 steps`);
}

/** Drum rows as a pattern; a row shorter than the pattern repeats. */
export function drumPattern(rows: DrumRows, lengthSteps: number): Pattern {
  checkLength(lengthSteps, 'drums');
  const events: PatternEvent[] = [];
  for (const key of TR8S_VOICE_ORDER) {
    const raw = rows[key];
    if (!raw) continue;
    const row = clean(raw);
    if (lengthSteps % row.length !== 0) throw new Error(`drums ${key}: row of ${row.length} doesn't fit ${lengthSteps} steps`);
    for (let step = 0; step < lengthSteps; step++) {
      const c = row[step % row.length]!;
      if (c === '.') continue;
      const hit = DRUM_HITS[c];
      if (!hit) throw new Error(`drums ${key}: unknown character “${c}”`);
      const ev: PatternEvent = { step, length: 0.5, velocity: hit.velocity, pitch: { kind: 'fixed', note: TR8S_NOTES[key] } };
      if (hit.probability !== undefined) ev.probability = hit.probability;
      if (hit.ratchet) ev.ratchet = hit.ratchet;
      if (hit.condition) ev.condition = { ...hit.condition };
      events.push(ev);
    }
  }
  events.sort((a, b) => a.step - b.step);
  return { lengthSteps, events };
}

/**
 * Generator lanes that follow the rows (hits per bar, first hit), so
 * mutations stay in style. Lanes not in `evolve` are locked: they keep
 * exactly what was written.
 */
export function drumVoices(rows: DrumRows, evolve: DrumVoiceKey[] = []): DrumVoice[] {
  const pulses: Partial<Record<DrumVoiceKey, [number, number]>> = {};
  for (const key of TR8S_VOICE_ORDER) {
    const row = rows[key] ? clean(rows[key]!).slice(0, 16) : '';
    const basic = [...row].map((c) => c !== '.' && !DRUM_HITS[c]?.extra);
    const hits = basic.filter(Boolean).length;
    if (hits) pulses[key] = [hits, Math.max(0, basic.indexOf(true))];
  }
  return tr8sVoices(pulses).map((v) => ({ ...v, locked: !evolve.includes(v.name as DrumVoiceKey) }));
}

// ---------------------------------------------------------------- melodic lines

/**
 * How note numbers are read:
 *   degree — scale steps from the current chord's root (0 root, 2 third, 4 fifth),
 *            smoothed to the nearest octave across chord changes (leads)
 *   bass   — scale steps from the chord root, octave as written (bass lines)
 *   acid   — like bass, and ! / ~ are real 303 accent and slide
 *   tone   — chord tones: 0 root, 1 third, 2 fifth, 3 seventh (arpeggios)
 *   chord  — `c` plays the whole chord (stabs, pads)
 */
export type LineMode = 'degree' | 'bass' | 'acid' | 'tone' | 'chord';

export interface LineOptions {
  mode: LineMode;
  velocity?: number;
  /** Part of a single step a short note sounds (0..1). */
  gate?: number;
}

/**
 * One token per 16th, separated by spaces:
 *   .  rest     -  hold the previous note one more step
 *   4  a note   c  the whole chord
 * Before a note: ! accent · _ soft · ~ slide into it · ? 50 % chance.
 * After a note: ' an octave up, , an octave down (repeatable).
 */
export function line(text: string, opts: LineOptions): Pattern {
  const tokens = text.split(/\s+/).filter((t) => t && t !== '|');
  checkLength(tokens.length, `line “${text.slice(0, 24)}…”`);
  const base = opts.velocity ?? 96;
  const gate = opts.gate ?? 0.9;
  const events: PatternEvent[] = [];
  tokens.forEach((tok, step) => {
    if (tok === '.' || tok === '-') return;
    const m = /^([!_~?]*)(c|-?\d+)([',]*)$/.exec(tok);
    if (!m) throw new Error(`line: can't read “${tok}”`);
    const [, flags = '', body = '', marks = ''] = m;
    let ties = 0;
    while (tokens[step + 1 + ties] === '-') ties++;
    const steps = ties + 1;
    const accent = flags.includes('!');
    const soft = flags.includes('_');
    const octave = [...marks].filter((c) => c === "'").length - [...marks].filter((c) => c === ',').length;
    const velocity = Math.max(1, Math.min(127, base + (accent ? 20 : 0) - (soft ? 24 : 0)));
    const n = body === 'c' ? 0 : Number(body);
    let pitch: PatternEvent['pitch'];
    if (body === 'c' || opts.mode === 'chord') pitch = { kind: 'chord' };
    else if (opts.mode === 'tone') pitch = { kind: 'chordTone', index: n, octave };
    else if (opts.mode === 'degree') pitch = { kind: 'degree', degree: n, nearest: true, ...(octave ? { octave } : {}) };
    else pitch = { kind: 'degree', degree: n, octave };
    const ev: PatternEvent = {
      step,
      length: steps === 1 ? gate : Math.max(gate, steps - (1 - gate) * 0.5),
      velocity,
      pitch,
    };
    if (flags.includes('?')) ev.probability = 0.5;
    if (flags.includes('~')) ev.slide = true;
    if (accent && opts.mode === 'acid') ev.accent = true;
    events.push(ev);
  });
  return { lengthSteps: tokens.length, events };
}
