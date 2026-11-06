import type { Pattern, PatternEvent } from '../pattern/pattern';
import type { ProgressionStep } from '../theory/harmony';
import { Chord } from '../theory/chord';
import { mod, NOTE_NAMES } from '../theory/note';
import type { Scale } from '../theory/scale';
import { TR8S_NOTES } from '../generators/drumGenerator';

/**
 * A composition written by Claude for the AI ensemble: a few short sections
 * (lead, bass, pads, drums) and a form that orders them (A A' B A). Pure data
 * and pure functions: building the request, checking the answer and turning
 * a section into patterns. The API call itself lives in io/ensemble.
 */

export type Part = 'melody' | 'bass' | 'pads' | 'drums';
export type Density = 'sparse' | 'balanced' | 'busy';
export type ChordFit = 'off' | 'bar' | 'half' | 'beat';

/** A melodic note: `degree` counts scale steps from the key's tonic (0), 7 is the tonic an octave up in a 7-note scale. */
export interface ComposedNote {
  step: number;
  len: number;
  degree: number;
  vel: number;
}

/** One drum voice in a section: the steps it plays on, at one velocity. */
export interface ComposedDrums {
  voice: string;
  vel: number;
  steps: number[];
}

/** A pad or chord hit: the chord that plays at that moment, voice-led by Drift. */
export interface ComposedChordHit {
  step: number;
  len: number;
  vel: number;
}

export interface ComposedSection {
  name: string;
  melody: ComposedNote[];
  bass: ComposedNote[];
  pads: ComposedChordHit[];
  drums: ComposedDrums[];
}

export interface Composition {
  title: string;
  /** Section names in playing order; the form loops. */
  form: string[];
  /** Every section is this many bars long. */
  bars: number;
  stepsPerBar: number;
  sections: ComposedSection[];
}

export interface ComposeContext {
  scale: Scale;
  progression: readonly ProgressionStep[];
  stepsPerBar: number;
  bpm: number;
  /** Parts that have a track to play them. */
  parts: Record<Part, boolean>;
  /** Drum voice names the drum track has (e.g. BD, SD, CH). */
  drumVoices: string[];
  /** Free text from the user: genre, mood, instructions. */
  style?: string;
  melodyDensity?: Density;
  drumDensity?: Density;
  /** Continue from this composition instead of starting fresh. */
  previous?: Composition;
  /** Parts that must stay as they are in `previous` (they are copied over anyway). */
  keep?: Part[];
  /** Wanted section length in bars (rounded up to whole passes of the progression). */
  sectionLength?: number;
}

export const PARTS: Part[] = ['melody', 'bass', 'pads', 'drums'];

/**
 * Sections last whole passes of the chord progression (so a section always
 * meets the same chords): at least `wanted` bars, at most 16 unless the
 * progression itself is longer.
 */
export function sectionBars(progression: readonly ProgressionStep[], wanted = 4): number {
  const total = Math.max(1, progression.reduce((s, p) => s + p.bars, 0));
  if (total >= 16) return total > 32 ? 32 : total;
  let bars = total * Math.ceil(Math.max(1, wanted) / total);
  while (bars > 16) bars -= total;
  return Math.max(total, bars);
}

// ---------- request ----------

export const COMPOSE_TOOL_NAME = 'write_music';

/** JSON schema of the tool Claude must call; voices are limited to what the drum track has. */
export function composeTool(drumVoices: string[]) {
  const note = {
    type: 'object',
    properties: {
      step: { type: 'integer', description: 'Start step within the section, 0-based' },
      len: { type: 'number', description: 'Length in steps' },
      degree: { type: 'integer', description: 'Scale degree from the tonic (0); negative is below, scale size is an octave up' },
      vel: { type: 'integer', description: 'Velocity 1-127' },
    },
    required: ['step', 'len', 'degree', 'vel'],
  };
  const voice = drumVoices.length ? { type: 'string', enum: drumVoices } : { type: 'string' };
  const chordHit = {
    type: 'object',
    properties: {
      step: { type: 'integer', description: 'Start step within the section, 0-based' },
      len: { type: 'number', description: 'Length in steps' },
      vel: { type: 'integer', description: 'Velocity 1-127' },
    },
    required: ['step', 'len', 'vel'],
  };
  return {
    name: COMPOSE_TOOL_NAME,
    description: 'Hand the finished composition to the sequencer.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'A short name for the piece' },
        form: { type: 'array', items: { type: 'string' }, description: 'Section names in playing order, e.g. ["A","A2","B","A"]' },
        sections: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              melody: { type: 'array', items: note },
              bass: { type: 'array', items: note },
              pads: { type: 'array', items: chordHit, description: 'When the chord sounds; Drift plays the chord of that bar' },
              drums: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: { voice, vel: { type: 'integer' }, steps: { type: 'array', items: { type: 'integer' } } },
                  required: ['voice', 'vel', 'steps'],
                },
              },
            },
            required: ['name', 'melody', 'bass', 'pads', 'drums'],
          },
        },
      },
      required: ['title', 'form', 'sections'],
    },
  };
}

export const COMPOSE_SYSTEM = `You are the composer inside Drift, a generative MIDI sequencer that a musician plays along with on hardware synths, tweaking sounds by hand. You write the sections of a piece (lead melody, bass, pads and drums) and hand them over with the write_music tool.

Write music, not random notes:
- The lead carries the piece. Write it as a complete, singable melody that spans the whole section, not a short riff on repeat. Build it from one clear motif of 1-2 bars: state it, repeat it, vary it (transpose to fit the next chord, change the ending, invert a step, shift the rhythm), and develop it towards a high point before it comes home. The listener should be able to hum it.
- Phrase in 2- or 4-bar phrases of question and answer: questions end open (on a non-tonic chord tone or the 2nd/5th), answers resolve. The last phrase of a section leads into the next one; the last section of the form resolves to the tonic.
- Put chord tones on strong beats (step 0 of each bar and the middle of the bar); use passing and neighbour tones in between. End phrases on chord tones.
- Mostly stepwise motion with the occasional leap; after a leap, move back by step. Keep the melody within about an octave and a half.
- Leave space: rests are part of the melody. Lead and bass should not both be busy at the same moment.
- Bass: anchor each chord with its root on the bar's first step, then move with fifths, octaves and approach notes into the next chord. Lock the bass rhythm to the kick.
- Pads accompany: Drift voices the chord of the bar, you choose when it sounds and how loud. Long sustained chords under a busy lead, rhythmic stabs or swells where the lead rests. Change the pad rhythm between sections to give each its own colour.
- Drums: a solid groove that fits the style. Kick and snare define it; hats give the pulse. Vary small things between sections (a fill in the last bar, an extra kick), not the whole groove.
- Sections in the form must relate: A2 is a variation of A, B contrasts (other register, rhythm or density) but keeps the same character. Arrange: the accompaniment can thin out or build up between sections (fewer drum voices in an intro or breakdown, fuller in the main part).
- Use velocity for shape: accents on the beat, softer ghost notes.

Use only the scale degrees, steps and drum voices described in the request. Leave a part as an empty list when the request says it has no track.`;

/** The user message: key, chords per bar, grid, parts and the musician's wishes. */
export function composePrompt(ctx: ComposeContext): string {
  const { scale } = ctx;
  const bars = sectionBars(ctx.progression, ctx.sectionLength);
  const steps = bars * ctx.stepsPerBar;
  const lines: string[] = [];
  const keyName = `${NOTE_NAMES[scale.root]} ${scale.mode}`;
  lines.push(`Key: ${keyName}. Tempo: ${ctx.bpm} BPM.`);
  const degreeNames = Array.from({ length: scale.size }, (_, d) => `${d}=${NOTE_NAMES[scale.pitchClassOfDegree(d)]}`).join(', ');
  lines.push(
    `Scale degrees: ${degreeNames}. ${scale.size} is the tonic an octave up, -1 the degree below the tonic, and so on. Every note is in the scale.`,
  );
  lines.push(
    `Grid: ${ctx.stepsPerBar} steps per bar. Every section is ${bars} bars = ${steps} steps (step 0 to ${steps - 1}). Beats start at steps ${beatSteps(ctx.stepsPerBar).join(', ')} of each bar.`,
  );
  lines.push('', 'Chords (the same in every section):');
  for (let bar = 0; bar < bars; bar++) lines.push(`- bar ${bar + 1} (steps ${bar * ctx.stepsPerBar}-${(bar + 1) * ctx.stepsPerBar - 1}): ${chordAt(ctx, bar)}`);
  lines.push('');
  const want = PARTS.filter((p) => ctx.parts[p]);
  const skip = PARTS.filter((p) => !ctx.parts[p]);
  lines.push(`Write: ${want.join(', ') || 'nothing'}.${skip.length ? ` Leave empty: ${skip.join(', ')}.` : ''}`);
  if (ctx.parts.melody)
    lines.push(
      `Lead melody: one through-composed line of ${bars} bars per section, degrees roughly 0 to ${scale.size * 2} (it is played in the lead's own octave).${density('melody', ctx.melodyDensity, bars)}`,
    );
  if (ctx.parts.bass) lines.push(`Bass: degrees roughly -${scale.size} to ${scale.size} (it is played in the bass's own octave).`);
  if (ctx.parts.pads) lines.push('Pads: chord hits (step, length, velocity); the chord itself comes from the chords above.');
  if (ctx.parts.drums) lines.push(`Drum voices: ${ctx.drumVoices.join(', ')}.${density('drums', ctx.drumDensity, bars)}`);
  lines.push('Form: 2 to 4 different sections, played in a form of 4 to 8 slots, e.g. ["A","A2","B","A"].');
  if (ctx.style?.trim()) lines.push('', `The musician's wishes: ${ctx.style.trim()}`);
  if (ctx.previous) {
    lines.push(
      '',
      'This continues the piece that is playing now. Keep its character and develop its motifs so it is recognisably the same piece, but bring something new.',
    );
    if (ctx.keep?.length) lines.push(`Keep these parts exactly as they are: ${ctx.keep.join(', ')}.`);
    lines.push('Playing now:', JSON.stringify({ title: ctx.previous.title, form: ctx.previous.form, sections: ctx.previous.sections }));
  }
  return lines.join('\n');
}

function beatSteps(stepsPerBar: number): number[] {
  const beat = stepsPerBar % 4 === 0 ? stepsPerBar / 4 : stepsPerBar % 3 === 0 ? stepsPerBar / 3 : stepsPerBar;
  return Array.from({ length: Math.round(stepsPerBar / beat) }, (_, i) => i * beat);
}

/** "Am (degree 5, chord tones 5, 7, 9)" for one bar of the section. */
function chordAt(ctx: ComposeContext, bar: number): string {
  const total = ctx.progression.reduce((s, p) => s + p.bars, 0);
  let b = mod(bar, Math.max(1, total));
  let step = ctx.progression[0]!;
  for (const p of ctx.progression) {
    if (b < p.bars) {
      step = p;
      break;
    }
    b -= p.bars;
  }
  const size = step.size ?? 3;
  const chord = Chord.fromDegree(ctx.scale, step.degree, size);
  const tones = Array.from({ length: size }, (_, i) => mod(step.degree, ctx.scale.size) + i * 2);
  return `${chord.symbol()} (root degree ${mod(step.degree, ctx.scale.size)}, chord tones at degrees ${tones.join(', ')})`;
}

const MELODY_NOTES_PER_BAR: Record<Density, string> = { sparse: '2-4', balanced: '4-7', busy: '7-12' };
const DRUM_HITS_PER_BAR: Record<Density, string> = { sparse: '5-8', balanced: '9-14', busy: '15-20' };

function density(part: 'melody' | 'drums', d: Density | undefined, bars: number): string {
  if (!d) return '';
  const per = part === 'melody' ? MELODY_NOTES_PER_BAR[d] : DRUM_HITS_PER_BAR[d];
  return ` Keep it ${d}: about ${per} ${part === 'melody' ? 'notes' : 'hits'} per bar (${bars} bars per section).`;
}

// ---------- answer ----------

/**
 * Check and tidy what Claude sent: unknown voices and sections are dropped,
 * steps, lengths, degrees and velocities are clamped. Throws when nothing
 * playable is left.
 */
export function parseComposition(raw: unknown, ctx: ComposeContext): Composition {
  const bars = sectionBars(ctx.progression, ctx.sectionLength);
  const steps = bars * ctx.stepsPerBar;
  const input = isObject(raw) ? raw : {};
  const voices = new Set(ctx.drumVoices);
  const seen = new Set<string>();
  const sections: ComposedSection[] = [];
  for (const s of Array.isArray(input.sections) ? input.sections : []) {
    if (!isObject(s)) continue;
    const name = typeof s.name === 'string' && s.name.trim() ? s.name.trim().slice(0, 12) : `S${sections.length + 1}`;
    if (seen.has(name)) continue;
    seen.add(name);
    sections.push({
      name,
      melody: ctx.parts.melody ? notes(s.melody, steps, ctx.scale.size) : [],
      bass: ctx.parts.bass ? notes(s.bass, steps, ctx.scale.size) : [],
      pads: ctx.parts.pads ? chordHits(s.pads, steps) : [],
      drums: ctx.parts.drums ? drums(s.drums, steps, voices) : [],
    });
    if (sections.length >= 6) break;
  }
  const playable = sections.filter((s) => s.melody.length || s.bass.length || s.pads.length || s.drums.length);
  if (playable.length === 0) throw new Error('Claude sent no notes Drift can play');
  const names = new Set(playable.map((s) => s.name));
  let form = (Array.isArray(input.form) ? input.form : [])
    .map((f) => (typeof f === 'string' ? f.trim() : ''))
    .filter((f) => names.has(f))
    .slice(0, 16);
  if (form.length === 0) form = playable.map((s) => s.name);
  const title = typeof input.title === 'string' && input.title.trim() ? input.title.trim().slice(0, 40) : 'Untitled';
  const composition: Composition = { title, form, bars, stepsPerBar: ctx.stepsPerBar, sections: playable };
  return ctx.previous && ctx.keep?.length ? keepParts(composition, ctx.previous, ctx.keep) : composition;
}

function notes(raw: unknown, steps: number, scaleSize: number): ComposedNote[] {
  if (!Array.isArray(raw)) return [];
  const out: ComposedNote[] = [];
  const taken = new Set<number>();
  for (const n of raw) {
    if (!isObject(n) || !isNumber(n.step) || !isNumber(n.degree)) continue;
    const step = Math.round(n.step);
    if (step < 0 || step >= steps || taken.has(step)) continue;
    taken.add(step);
    const len = isNumber(n.len) ? Math.max(0.25, Math.min(steps - step, n.len)) : 1;
    const degree = Math.max(-scaleSize * 2, Math.min(scaleSize * 3, Math.round(n.degree)));
    out.push({ step, len, degree, vel: velocity(n.vel, 96) });
  }
  return out.sort((a, b) => a.step - b.step);
}

function chordHits(raw: unknown, steps: number): ComposedChordHit[] {
  if (!Array.isArray(raw)) return [];
  const out: ComposedChordHit[] = [];
  const taken = new Set<number>();
  for (const h of raw) {
    if (!isObject(h) || !isNumber(h.step)) continue;
    const step = Math.round(h.step);
    if (step < 0 || step >= steps || taken.has(step)) continue;
    taken.add(step);
    const len = isNumber(h.len) ? Math.max(0.25, Math.min(steps - step, h.len)) : 4;
    out.push({ step, len, vel: velocity(h.vel, 80) });
  }
  return out.sort((a, b) => a.step - b.step);
}

function drums(raw: unknown, steps: number, voices: Set<string>): ComposedDrums[] {
  if (!Array.isArray(raw)) return [];
  const out: ComposedDrums[] = [];
  for (const d of raw) {
    if (!isObject(d) || typeof d.voice !== 'string' || !voices.has(d.voice) || !Array.isArray(d.steps)) continue;
    const hits = [...new Set(d.steps.filter(isNumber).map((s) => Math.round(s)).filter((s) => s >= 0 && s < steps))].sort((a, b) => a - b);
    if (hits.length) out.push({ voice: d.voice, vel: velocity(d.vel, 100), steps: hits });
  }
  return out;
}

/** Copy the kept parts from the piece that played before, section by section. */
export function keepParts(next: Composition, previous: Composition, keep: readonly Part[]): Composition {
  if (previous.sections.length === 0 || previous.bars !== next.bars) return next;
  return {
    ...next,
    sections: next.sections.map((s, i) => {
      const old = previous.sections.find((p) => p.name === s.name) ?? previous.sections[i % previous.sections.length]!;
      const out = { ...s };
      for (const part of keep) (out as Record<Part, unknown>)[part] = old[part];
      return out;
    }),
  };
}

// ---------- patterns ----------

export interface SectionPatternOptions {
  /** Voice name → MIDI note of the drum track (falls back to the TR-8S map). */
  drumNotes?: Record<string, number>;
  /** Bend notes on strong steps onto the chord that is actually playing (useful when the chords change). */
  fit?: ChordFit;
}

export type SectionPatterns = Record<Part, Pattern>;

/** Turn one section into a pattern per part. Melody and bass stay key-relative, so they follow key changes. */
export function sectionPatterns(composition: Composition, sectionName: string, opts: SectionPatternOptions = {}): SectionPatterns {
  const section = composition.sections.find((s) => s.name === sectionName) ?? composition.sections[0]!;
  const lengthSteps = composition.bars * composition.stepsPerBar;
  const every = fitEvery(opts.fit ?? 'off', composition.stepsPerBar);
  const line = (ns: ComposedNote[], bass: boolean): Pattern => ({
    lengthSteps,
    events: ns.map((n): PatternEvent => {
      const strong = every > 0 && n.step % every === 0;
      const fit = !strong ? undefined : bass && n.step % composition.stepsPerBar === 0 ? 'root' : 'tone';
      return {
        step: n.step,
        length: n.len,
        velocity: n.vel,
        pitch: { kind: 'keyDegree', degree: n.degree, ...(fit ? { fit } : {}) },
      };
    }),
  });
  const drumEvents = section.drums.flatMap((d) => {
    const note = opts.drumNotes?.[d.voice] ?? TR8S_NOTES[d.voice as keyof typeof TR8S_NOTES];
    if (note === undefined) return [];
    return d.steps.map((step): PatternEvent => ({ step, length: 0.5, velocity: d.vel, pitch: { kind: 'fixed', note } }));
  });
  const seen = new Set<string>();
  const drumsDeduped = drumEvents
    .filter((e) => {
      const key = `${e.step}:${e.pitch.kind === 'fixed' ? e.pitch.note : ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.step - b.step);
  return {
    melody: line(section.melody, false),
    bass: line(section.bass, true),
    pads: {
      lengthSteps,
      events: (section.pads ?? []).map((h): PatternEvent => ({ step: h.step, length: h.len, velocity: h.vel, pitch: { kind: 'chord' } })),
    },
    drums: { lengthSteps, events: drumsDeduped },
  };
}

function fitEvery(fit: ChordFit, stepsPerBar: number): number {
  if (fit === 'bar') return stepsPerBar;
  if (fit === 'half') return stepsPerBar / 2;
  if (fit === 'beat') return stepsPerBar / 4;
  return 0;
}

// ---------- helpers ----------

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function velocity(v: unknown, fallback: number): number {
  return isNumber(v) ? Math.max(1, Math.min(127, Math.round(v))) : fallback;
}
