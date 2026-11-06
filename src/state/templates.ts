import type { AnswerTransform, PhraseRole } from '../core/engine/phrasing';
import type { DrumVoiceKey } from '../core/generators/drumPresets';
import { defaultConfig, type GeneratorConfig } from '../core/generators/registry';
import type { TrackType } from '../core/generators/types';
import type { Pattern, Register } from '../core/pattern/pattern';
import type { ProgressionStep } from '../core/theory/harmony';
import { parsePitchClass } from '../core/theory/note';
import type { ModeName } from '../core/theory/scale';
import { drumPattern, drumVoices, line, type DrumRows, type LineMode } from './notation';
import {
  newId,
  SCHEMA_VERSION,
  type CcModulation,
  type HumanizeSettings,
  type KickMode,
  type MemorySettings,
  type MidiTarget,
  type ProjectState,
  type TrackState,
} from './project';
import { roleForType, type DeviceRole } from './rack';

export const TRACK_COLORS = {
  lead: '#F5A524',
  bass: '#38BDF8',
  pad: '#A78BFA',
  drums: '#A3E635',
  arp: '#F472B6',
  stab: '#FB7185',
} as const;

const REGISTERS: Record<TrackType, Register> = {
  motif: { baseOctave: 4, low: 60, high: 84 },
  arp: { baseOctave: 4, low: 57, high: 88 },
  bass: { baseOctave: 1, low: 28, high: 52 },
  acid: { baseOctave: 1, low: 24, high: 60 },
  chords: { baseOctave: 3, low: 52, high: 76 },
  drone: { baseOctave: 2, low: 36, high: 60 },
  drums: { baseOctave: 0, low: 0, high: 127 },
};

export interface TrackSpec {
  name: string;
  color: string;
  type: TrackType;
  output: MidiTarget;
  /** Which rack device to use; defaults from the track type. */
  role?: DeviceRole;
  /** Shallow overrides for the generator's default params. */
  params?: Record<string, unknown>;
  /** A written starting pattern; the track evolves from it unless frozen. */
  pattern?: Pattern;
  frozen?: boolean;
  mutationIntervalBars?: number;
  /** Instruments that suit this part, best first (definition ids). */
  prefer?: string[];
  /** Sound (preset name) to load per instrument id, when "best fit" picks that instrument. */
  sounds?: Record<string, string>;
  memory?: MemorySettings;
  humanize?: HumanizeSettings;
  kickMode?: KickMode;
  register?: Partial<Register>;
  /** CC LFOs, e.g. a slow filter sweep. */
  modulations?: Omit<CcModulation, 'id'>[];
  /** Call-and-response role; `answerFrom` names another track in the template. */
  phrase?: { role: PhraseRole; bars: number; answerFrom?: string; transform?: AnswerTransform };
}

export function createTrack(spec: TrackSpec): TrackState {
  const base = defaultConfig(spec.type);
  const params = { ...base.params, ...spec.params } as Record<string, unknown>;
  if (spec.pattern) params.lengthSteps = spec.pattern.lengthSteps;
  const generator = { type: base.type, params } as unknown as GeneratorConfig;
  return {
    id: newId(),
    name: spec.name,
    color: spec.color,
    generator,
    register: { ...REGISTERS[spec.type], ...spec.register },
    output: { ...spec.output },
    role: spec.role ?? roleForType(spec.type),
    muted: false,
    solo: false,
    frozen: spec.frozen ?? false,
    mutationIntervalBars: spec.mutationIntervalBars ?? 4,
    seed: Math.floor(Math.random() * 2 ** 32),
    modulations: (spec.modulations ?? []).map((m) => ({ ...m, id: newId() })),
    ...(spec.pattern ? { userPattern: spec.pattern } : {}),
    ...(spec.prefer ? { prefer: [...spec.prefer] } : {}),
    ...(spec.memory ? { memory: { ...spec.memory } } : {}),
    ...(spec.humanize ? { humanize: { ...spec.humanize } } : {}),
    ...(spec.kickMode ? { kickMode: spec.kickMode } : {}),
  };
}

export interface TemplateSpec {
  id: string;
  name: string;
  genre: string;
  /** One line about the feel, shown on the card. */
  description: string;
  bpm: number;
  swing: number;
  key: string;
  mode: ModeName;
  progression: ProgressionStep[];
  harmonyEvolve?: ProjectState['harmonyEvolve'];
  tracks: TrackSpec[];
}

/** Port names are placeholders; the user maps them to real devices. */
const LEAD = { portName: 'Lead synth', channel: 1 };
const BASS = { portName: 'Bass synth', channel: 2 };
const PAD = { portName: 'Lead synth', channel: 3 };
const DRUMS = { portName: 'TR-8S', channel: 10 };

/** Instrument choices per part, best first: your hardware, then the built-in synths. */
const PREFER = {
  lead: ['asm-hydrasynth', 'drift-synth-mono', 'drift-synth-lead'],
  polyLead: ['asm-hydrasynth', 'korg-wavestate', 'drift-synth-lead', 'drift-synth-juno'],
  seq: ['korg-wavestate', 'asm-hydrasynth', 'drift-synth-juno', 'drift-synth-lead'],
  stab: ['korg-wavestate', 'drift-synth-juno', 'asm-hydrasynth', 'drift-synth-pad'],
  pad: ['korg-wavestate', 'drift-synth-pad', 'drift-synth-juno'],
  acid: ['roland-tb-03', 'drift-synth-mono', 'drift-synth-bass'],
  bass: ['roland-tb-03', 'drift-synth-mono', 'drift-synth-bass'],
  drums: ['roland-tr-8s', 'drift-synth-drums'],
};

/** Melodic parts return to their written theme every few changes. */
const THEME: MemorySettings = { every: 3, mode: 'theme' };

// ---------------------------------------------------------------- part builders

function drums(rows: DrumRows, lengthSteps: number, opts: { evolve?: DrumVoiceKey[]; humanize?: HumanizeSettings } = {}): TrackSpec {
  return {
    name: 'Drums',
    color: TRACK_COLORS.drums,
    type: 'drums',
    output: DRUMS,
    pattern: drumPattern(rows, lengthSteps),
    params: { voices: drumVoices(rows, opts.evolve ?? ['CH', 'RS']), mutation: 0.18, ratchetChance: 0.08, conditionChance: 0.12 },
    mutationIntervalBars: 8,
    memory: { every: 2, mode: 'theme' },
    prefer: PREFER.drums,
    ...(opts.humanize ? { humanize: opts.humanize } : {}),
  };
}

interface PartOptions extends Partial<TrackSpec> {
  velocity?: number;
  gate?: number;
}

function part(name: string, type: TrackType, mode: LineMode, notes: string, o: PartOptions): TrackSpec {
  const { velocity = 96, gate, params, ...rest } = o;
  const color = rest.color ?? (type === 'bass' || type === 'acid' ? TRACK_COLORS.bass : type === 'chords' ? TRACK_COLORS.pad : type === 'arp' ? TRACK_COLORS.arp : TRACK_COLORS.lead);
  const output = rest.output ?? (type === 'bass' || type === 'acid' ? BASS : type === 'chords' ? PAD : LEAD);
  return {
    name,
    type,
    color,
    output,
    pattern: line(notes, { mode, velocity, ...(gate !== undefined ? { gate } : {}) }),
    params: { velocity, ...params },
    mutationIntervalBars: 8,
    memory: THEME,
    ...rest,
  };
}

const lead = (name: string, notes: string, o: PartOptions = {}) =>
  part(name, 'motif', 'degree', notes, { prefer: PREFER.lead, sounds: { 'drift-synth-mono': 'Mono Lead', 'drift-synth-juno': 'Warm Lead' }, ...o, params: { mutation: 0.12, density: 0.4, rhythmLock: true, ...o.params } });

const bass = (notes: string, o: PartOptions = {}) =>
  part(o.name ?? 'Bass', 'bass', 'bass', notes, { prefer: PREFER.bass, sounds: { 'drift-synth-mono': 'Round Moog' }, kickMode: 'avoid', ...o, params: { mutation: 0.06, density: 0.6, ...o.params } });

const chords = (name: string, notes: string, o: PartOptions = {}) => {
  const hits = notes.split(/\s+/).filter((t) => /c$/.test(t)).length;
  return part(name, 'chords', 'chord', notes, {
    prefer: PREFER.stab,
    sounds: { 'drift-synth-juno': 'Hollow Chords' },
    memory: undefined,
    ...o,
    // Written stabs keep their rhythm: the chord generator would re-roll it.
    params: { style: 'pulse', pulses: Math.max(1, hits), mutation: 0, gate: 0.7, ...o.params },
  });
};

const pad = (name = 'Pad', o: PartOptions = {}) =>
  chords(name, 'c - - - - - - - - - - - - - - -', {
    prefer: PREFER.pad,
    sounds: { 'drift-synth-juno': 'Juno Strings' },
    velocity: 54,
    gate: 0.98,
    color: TRACK_COLORS.pad,
    ...o,
    params: { style: 'sustain', gate: 1, ...o.params },
  });

const arp = (name: string, notes: string, o: PartOptions = {}) =>
  part(name, 'arp', 'tone', notes, { prefer: PREFER.seq, sounds: { 'drift-synth-juno': 'Poly Pluck' }, output: { portName: 'Lead synth', channel: 4 }, ...o, params: { mutation: 0.1, ...o.params } });

const FILL_MT = '................ ............f.f.';
const FILL_LT = '................ .............f.f';
const CRASH = 'C............... ................';
const FOUR = 'X...X...X...X... X...X...X...X...';

// ---------------------------------------------------------------- templates

export const TEMPLATES: TemplateSpec[] = [
  {
    id: 'techno',
    name: 'Peak techno',
    genre: 'Techno',
    description: 'Rolling 16th bass, dotted phrygian hook, 3-against-4 sequence.',
    bpm: 130,
    swing: 0,
    key: 'A',
    mode: 'phrygian',
    progression: [
      { degree: 0, bars: 2 },
      { degree: 1, bars: 1 },
      { degree: 6, bars: 1 },
    ],
    tracks: [
      drums(
        {
          BD: FOUR,
          HC: '....x.......x... ....x.......x...',
          CH: 'og.gog.gog.gog.g og.gog.gog.go?.g',
          OH: '..x...x...x...x. ..x...x...x...x.',
          RS: '...o..o.....o..o ...o..o...o..x..',
          MT: FILL_MT,
          LT: FILL_LT,
          CC: CRASH,
        },
        32,
      ),
      bass('. _0 0 _0 . _0 0 _0 . _0 0 _0 . _0 0 _0 | . _0 0 _0 . _0 0 _0 . _0 4 _0 . 1 0 _0', {
        name: 'Rumble',
        velocity: 100,
        gate: 0.55,
        sounds: { 'drift-synth-mono': 'Rubber' },
      }),
      lead('Hook', '!4 . . 2 . . 4 . . 2 . . 1 . 0 . | !4 . . 2 . . 4 . . 5 . . 4 - - .', {
        velocity: 96,
        gate: 0.45,
        modulations: [{ enabled: true, cc: 74, label: 'Cutoff', shape: 'sine', periodBars: 16, min: 40, max: 100 }],
      }),
      arp('Sequence', "!0 _2 _1' !0 _2 _1' !0 _2 _1' !0 _2 _1' !0 _2 _1' 0", {
        velocity: 82,
        gate: 0.4,
        modulations: [{ enabled: true, cc: 74, label: 'Cutoff', shape: 'triangle', periodBars: 8, min: 30, max: 95 }],
      }),
      pad('Atmos', { velocity: 50 }),
    ],
  },
  {
    id: 'deep-house',
    name: 'Deep house',
    genre: 'House',
    description: 'Dorian 9th chords, syncopated stabs, warm walking bass, swung hats.',
    bpm: 122,
    swing: 0.12,
    key: 'D',
    mode: 'dorian',
    progression: [
      { degree: 0, bars: 2, size: 5 },
      { degree: 3, bars: 2, size: 4 },
      { degree: 4, bars: 2, size: 4 },
      { degree: 3, bars: 2, size: 4 },
    ],
    tracks: [
      drums(
        {
          BD: FOUR,
          HC: '....x.......x... ....x.......x..o',
          CH: 'og.gog.gog.gog.g og.gog.gog.gog.?',
          OH: '..x...x...x...x. ..x...x...x...x.',
          RS: '...o......o..o.. ......o..o....o.',
          LT: '.......o........ .......o.....o..',
          HT: '................ .o..........o...',
        },
        32,
        { evolve: ['CH', 'RS', 'LT', 'HT'], humanize: { timing: 0.15, velocity: 0.2, layBack: 0.1 } },
      ),
      bass("!0 - - . . . 0 . . . 0' - . 0 . 2 | !0 - - . . . 0 . . 4 - . 6 - 4 .", { velocity: 100, gate: 0.85, kickMode: 'off', sounds: { 'drift-synth-mono': 'Round Moog' } }),
      chords('Stabs', '. . c - . . . c . . c - . . c . | . . c - . . . c . . . . . . . .', {
        velocity: 86,
        modulations: [{ enabled: true, cc: 74, label: 'Cutoff', shape: 'sine', periodBars: 8, min: 35, max: 95 }],
      }),
      lead(
        'Keys',
        '. . . . . . 4 . 6 . 4 - 2 - - . | . . . . . . 4 . 6 . 7 - 6 - 4 . | . . . . . . 4 . 6 . 4 - 2 - - . | . . . . . . 2 . 3 . 4 - - - - .',
        { velocity: 88, gate: 0.8, prefer: PREFER.polyLead, sounds: { 'drift-synth-juno': 'Warm Lead', 'drift-synth-mono': 'Mono Lead' } },
      ),
      pad('Pad', { velocity: 48 }),
    ],
  },
  {
    id: 'acid',
    name: 'Acid',
    genre: 'Acid',
    description: 'A written 303 line with accents and slides, 909 groove, rave stab.',
    bpm: 128,
    swing: 0.06,
    key: 'A',
    mode: 'phrygian',
    progression: [
      { degree: 0, bars: 4 },
      { degree: 1, bars: 2 },
      { degree: 0, bars: 2 },
    ],
    tracks: [
      drums(
        {
          BD: FOUR,
          HC: '....x.......x... ....x.......x...',
          SD: '................ ...........f.fff',
          CH: 'xg.gxg.gxg.gxg.g xg.gxg.gxg.gxg.?',
          OH: '..x...x...x...x. ..x...x...x...x.',
          RS: '..............o. ......o.......o.',
          CC: CRASH,
        },
        32,
      ),
      part('303', 'acid', 'acid', "!0 0' ~0 . !0 ~1 0 6, !0' ~0' . 0 !2 ~1 0 0' | !0 0' . 0 !4 ~3 1 . !0 0 ~0' . !6 ~4 1 ~0", {
        velocity: 90,
        gate: 0.58,
        prefer: PREFER.acid,
        sounds: { 'drift-synth-mono': 'Rubber' },
        mutationIntervalBars: 4,
        params: { mutation: 0.1 },
        modulations: [
          { enabled: true, cc: 74, label: 'Cutoff', shape: 'sine', periodBars: 8, min: 25, max: 105 },
          { enabled: true, cc: 12, label: 'Env mod', shape: 'triangle', periodBars: 16, min: 40, max: 120 },
        ],
      }),
      chords('Stab', 'c - . . . . . . . . . . . . . . | . . . . . . . . . . c - . . c .', {
        velocity: 92,
        color: TRACK_COLORS.stab,
        sounds: { 'drift-synth-juno': 'Brass' },
      }),
      {
        name: 'Drone',
        color: TRACK_COLORS.pad,
        type: 'drone',
        output: PAD,
        params: { velocity: 50 },
        prefer: ['asm-hydrasynth', 'korg-wavestate', 'drift-synth-pad'],
        sounds: { 'drift-synth-juno': 'Glass Pad' },
      },
    ],
  },
  {
    id: 'melodic-techno',
    name: 'Melodic techno',
    genre: 'Techno',
    description: 'Emotive long-note hook over a sweeping arpeggio and rolling bass.',
    bpm: 124,
    swing: 0,
    key: 'F#',
    mode: 'aeolian',
    progression: [
      { degree: 0, bars: 2 },
      { degree: 5, bars: 2 },
      { degree: 2, bars: 2 },
      { degree: 6, bars: 2 },
    ],
    tracks: [
      drums(
        {
          BD: FOUR,
          HC: '....o.......o... ....o.......o...',
          CH: 'og.gog.gog.gog.g og.gog.gog.go?.g',
          OH: '..o...o...o...o. ..o...o...o...o.',
          RS: '..o..o..o..o..o. .o..o..o..o..o..',
          MT: FILL_MT,
          LT: FILL_LT,
          CC: CRASH,
        },
        32,
        { evolve: ['CH'] },
      ),
      bass('. _0 !0 _0 . _0 !0 _0 . _0 !0 _0 . _0 !0 _0', { name: 'Rolling bass', velocity: 98, gate: 0.5, sounds: { 'drift-synth-mono': 'Funk Moog' } }),
      lead(
        'Hook',
        '!4 - - - - - 2 - 3 - 4 - - - - . | !6 - - - - - 4 - 3 - 2 - - - - . | !4 - - - - - 2 - 3 - 4 - - - 7 - | !6 - - - - - 4 - - - 2 - - - - .',
        { velocity: 92, gate: 0.95, prefer: PREFER.polyLead },
      ),
      arp('Arp', "!0 1 2 0' 2 1 0' 2 !0 1 2 0' 1' 2 0' 1 | !0 1 2 0' 2 1 0' 2 !0 1 2 0' 1' 2' 1' 0'", {
        velocity: 80,
        gate: 0.45,
        modulations: [{ enabled: true, cc: 74, label: 'Cutoff', shape: 'sine', periodBars: 16, min: 30, max: 110 }],
      }),
      pad('Pad', { velocity: 50 }),
    ],
  },
  {
    id: 'trance',
    name: 'Trance',
    genre: 'Trance',
    description: 'Anthem lead, gated chords, offbeat bass and a pluck arp.',
    bpm: 138,
    swing: 0,
    key: 'B',
    mode: 'aeolian',
    progression: [
      { degree: 0, bars: 2 },
      { degree: 5, bars: 2 },
      { degree: 6, bars: 2 },
      { degree: 4, bars: 2 },
    ],
    tracks: [
      drums(
        {
          BD: FOUR,
          HC: '....x.......x... ....x.......x...',
          SD: '................ ........f.f.ffff',
          CH: 'oo.ooo.ooo.ooo.o oo.ooo.ooo.ooo.o',
          OH: '..X...X...X...X. ..X...X...X...X.',
          CC: CRASH,
        },
        32,
        { evolve: ['CH'] },
      ),
      bass('. . !0 _0 . . !0 _0 . . !0 _0 . . !0 _0', { velocity: 100, gate: 0.6, params: { offbeat: true }, sounds: { 'drift-synth-mono': 'Rubber' } }),
      lead(
        'Anthem',
        '!0 - . 0 . 0 2 - . 2 . 4 - - 2 - | !4 - . 4 . 4 5 - . 4 . 2 - - 1 - | !0 - . 0 . 0 2 - . 2 . 4 - - 2 - | !4 - . 4 . 4 6 - . 7 - - - - - .',
        { velocity: 100, gate: 0.9, prefer: PREFER.polyLead, sounds: { 'drift-synth-juno': 'Warm Lead', 'drift-synth-mono': 'Mono Lead' } },
      ),
      chords('Gated chords', '!c . c c . c . c !c . c c . c . c', { velocity: 74, gate: 0.6, params: { gate: 0.6 }, sounds: { 'drift-synth-juno': 'Brass' } }),
      arp('Pluck', "!0 2 1' 2 0' 2 1' 2 !0 2 1' 2 0' 2 1' 2", { velocity: 66, gate: 0.35 }),
    ],
  },
  {
    id: 'conversation',
    name: 'Conversation',
    genre: 'House',
    description: 'Two voices take turns: a call and an answer a third higher.',
    bpm: 118,
    swing: 0.08,
    key: 'E',
    mode: 'dorian',
    progression: [
      { degree: 0, bars: 2, size: 4 },
      { degree: 3, bars: 2, size: 4 },
      { degree: 6, bars: 2 },
      { degree: 4, bars: 2, size: 4 },
    ],
    harmonyEvolve: { enabled: true, style: 'house', everyLoops: 2, mode: 'vary' },
    tracks: [
      drums(
        {
          BD: FOUR,
          HC: '....x.......x... ....x.......x...',
          CH: 'og.gog.gog.gog.g og.gog.gog.gog.?',
          OH: '..x...x...x...x. ..x...x...x...x.',
          RS: '...o......o..... ......o..o......',
        },
        32,
        { humanize: { timing: 0.12, velocity: 0.2, layBack: 0.1 } },
      ),
      bass("0 - . 0 . . 0 - . . 0 . 4 . 2 . | 0 - . 0 . . 0 - . . 6, . 5, . 4, .", { velocity: 98, gate: 0.8, kickMode: 'duck' }),
      lead('Call', '!4 . 2 . 4 - 6 . 7 - . 6 4 - - .', {
        velocity: 94,
        gate: 0.8,
        phrase: { role: 'call', bars: 1 },
        params: { rhythmLock: false, mutation: 0.15 },
      }),
      {
        // Same synth and channel: the two phrases never overlap.
        name: 'Answer',
        color: TRACK_COLORS.arp,
        type: 'motif',
        output: LEAD,
        phrase: { role: 'response', bars: 1, answerFrom: 'Call', transform: 'upThird' },
      },
      pad('Pad', { velocity: 46 }),
    ],
  },
  {
    id: 'synthwave',
    name: 'Synthwave',
    genre: 'Synthwave',
    description: 'Octave bass, Juno strings, up-arp and a nostalgic lead; tom fills.',
    bpm: 104,
    swing: 0,
    key: 'F',
    mode: 'aeolian',
    progression: [
      { degree: 0, bars: 2 },
      { degree: 5, bars: 2 },
      { degree: 2, bars: 2 },
      { degree: 6, bars: 2 },
    ],
    tracks: [
      drums(
        {
          BD: FOUR,
          SD: '....X.......X... ....X.......X...',
          HC: '....o.......o... ....o.......o...',
          CH: 'o.o.o.o.o.o.o.o. o.o.o.o.o.o.o.o.',
          OH: '................ ..............x.',
          HT: '................ ............f...',
          MT: '................ .............f..',
          LT: '................ ..............ff',
          CC: CRASH,
        },
        32,
        { evolve: ['CH'] },
      ),
      bass("!0 . 0' . 0 . 0' . !0 . 0' . 0 . 0' .", { velocity: 96, gate: 0.7, kickMode: 'off', sounds: { 'drift-synth-mono': '101 Square' } }),
      lead(
        'Lead',
        '!4 - - - 2 - 4 - 6 - - - 4 - - - | 5 - - - 4 - 2 - 4 - - - - - . . | !4 - - - 2 - 4 - 6 - - - 7 - - - | 6 - - - 4 - 5 - 4 - - - - - . .',
        { velocity: 94, gate: 0.92 },
      ),
      pad('Strings', { velocity: 58, prefer: ['drift-synth-juno', 'korg-wavestate', 'drift-synth-pad'] }),
      arp('Arp', "!0 1 2 0' 2 1 0 1 !0 1 2 0' 2' 0' 2 1", { velocity: 72, gate: 0.5 }),
    ],
  },
  {
    id: 'lofi',
    name: 'Lo-fi',
    genre: 'Downtempo',
    description: 'Swung boom-bap, ii–V–I 9th chords, mellow bass, lazy melody.',
    bpm: 84,
    swing: 0.3,
    key: 'F',
    mode: 'ionian',
    progression: [
      { degree: 1, bars: 2, size: 5 },
      { degree: 4, bars: 2, size: 5 },
      { degree: 0, bars: 2, size: 5 },
      { degree: 5, bars: 2, size: 4 },
    ],
    tracks: [
      drums(
        {
          BD: 'X......x..x..... X.......x.x..x..',
          SD: '....X.......X... ....X.......X...',
          CH: 'x.xox.x.x.xox.x. x.xox.x.x.xox.xo',
          RS: '.......o......o. .......o........',
          OH: '................ ..............x.',
        },
        32,
        { humanize: { timing: 0.35, velocity: 0.3, layBack: 0.4 } },
      ),
      bass("!0 - - - . . . 0 . . 4 - . . 2 - | 0 - - - . . . 0 . . . . 6, - 5, -", {
        velocity: 90,
        gate: 0.9,
        kickMode: 'off',
        humanize: { timing: 0.25, velocity: 0.2, layBack: 0.4 },
        sounds: { 'drift-synth-mono': 'Round Moog' },
      }),
      chords('Keys', 'c - - - - - . . . . c - - . . . | c - - - - - . . . . . . c - - .', {
        velocity: 70,
        gate: 0.9,
        humanize: { timing: 0.3, velocity: 0.25, layBack: 0.5 },
      }),
      lead(
        'Melody',
        '. . . . 4 - 3 - 2 - - - . . . . | . . . . . . 4 - 6 - 4 - - - . . | . . . . 4 - 3 - 2 - - - 1 - 0 - | . . . . . . . . . . . . . . . .',
        { velocity: 78, gate: 0.85, humanize: { timing: 0.35, velocity: 0.25, layBack: 0.5 } },
      ),
    ],
  },
  {
    id: 'dub-techno',
    name: 'Dub techno',
    genre: 'Techno',
    description: 'Short minor-7th chord stabs drifting in space over a deep sub.',
    bpm: 118,
    swing: 0.04,
    key: 'G',
    mode: 'aeolian',
    progression: [
      { degree: 0, bars: 4, size: 4 },
      { degree: 3, bars: 4, size: 4 },
    ],
    tracks: [
      drums(
        {
          BD: FOUR,
          CH: 'og.gog.gog.gog.g og.gog.gog.gog.?',
          OH: '..o...o...o...o. ..o...o...o...o.',
          RC: 'g.g.g.g.g.g.g.g. g.g.g.g.g.g.g.g.',
          RS: '..........o..... ......o...o.....',
        },
        32,
        { evolve: ['CH', 'RS', 'RC'] },
      ),
      bass('. . 0 - . . 0 - . . 0 - . . 0 -', { name: 'Sub', velocity: 96, gate: 0.9, prefer: ['drift-synth-mono', 'roland-tb-03', 'drift-synth-bass'], sounds: { 'drift-synth-mono': 'Deep Sub' } }),
      chords('Chords', '. . . c . . . . . . c . . . . . | . . . c . . . . . . . . . c . .', {
        velocity: 82,
        gate: 0.35,
        params: { gate: 0.35 },
        modulations: [{ enabled: true, cc: 74, label: 'Cutoff', shape: 'sine', periodBars: 32, min: 20, max: 80 }],
      }),
      {
        name: 'Atmos',
        color: TRACK_COLORS.pad,
        type: 'drone',
        output: PAD,
        params: { velocity: 44 },
        prefer: PREFER.pad,
        sounds: { 'drift-synth-juno': 'Glass Pad' },
      },
    ],
  },
  {
    id: 'ambient',
    name: 'Ambient',
    genre: 'Ambient',
    description: 'Lydian pads, a slow glassy arpeggio, long melody notes, soft pulse.',
    bpm: 70,
    swing: 0,
    key: 'C',
    mode: 'lydian',
    progression: [
      { degree: 0, bars: 4, size: 4 },
      { degree: 1, bars: 4 },
      { degree: 2, bars: 4, size: 4 },
      { degree: 1, bars: 4 },
    ],
    tracks: ([
      pad('Pad', { velocity: 60, sounds: { 'drift-synth-juno': 'Glass Pad' } }),
      lead(
        'Melody',
        '4 - - - - - - - . . . . 6 - - - | 7 - - - - - - - - - - - . . . . | 6 - - - - - 4 - - - - - . . . . | 2 - - - - - - - - - - - - - . .',
        { velocity: 72, gate: 0.95, mutationIntervalBars: 16, prefer: PREFER.polyLead, sounds: { 'drift-synth-juno': 'Warm Lead', 'drift-synth-mono': 'Mono Lead' } },
      ),
      arp('Glass', "!0 . 2 . 1' . 2 . 0' . ?2 . 1' . ?2 . | !0 . 2 . 1' . 2 . 0' . 1' . 2' . . .", {
        velocity: 68,
        gate: 0.9,
        params: { rate: 2 },
        modulations: [{ enabled: true, cc: 74, label: 'Cutoff', shape: 'sine', periodBars: 16, min: 35, max: 90 }],
      }),
      {
        name: 'Sub',
        color: TRACK_COLORS.bass,
        type: 'drone',
        role: 'bass',
        output: BASS,
        params: { velocity: 58, follow: 'chord' },
        prefer: ['drift-synth-mono', 'roland-tb-03', 'drift-synth-bass'],
        sounds: { 'drift-synth-mono': 'Deep Sub' },
      },
      drums(
        {
          BD: 'o............... o.......o.......',
          RS: '......?......... ..........?.....',
          CH: '..g...g...g...g. ..g...g...g...?.',
          RC: 'g...g...g...g... g...g...g...g...',
        },
        32,
        { evolve: ['CH', 'RS'], humanize: { timing: 0.2, velocity: 0.3, layBack: 0.2 } },
      ),
    ] as TrackSpec[]).map((t) => (t.name === 'Drums' ? { ...t, name: 'Pulse' } : t)),
  },
];

export function createProject(templateId: string): ProjectState {
  const t = TEMPLATES.find((x) => x.id === templateId) ?? TEMPLATES[0]!;
  return {
    schemaVersion: SCHEMA_VERSION,
    id: newId(),
    name: t.name,
    bpm: t.bpm,
    swing: t.swing,
    stepsPerBar: 16,
    key: { root: parsePitchClass(t.key), mode: t.mode },
    progression: t.progression.map((p) => ({ ...p })),
    ...(t.harmonyEvolve ? { harmonyEvolve: { ...t.harmonyEvolve } } : {}),
    clock: { sendTo: [DRUMS.portName] },
    tracks: withPhrases(t.tracks),
    updatedAt: new Date().toISOString(),
  };
}

/** Sounds each template track asks for, by track name and instrument id (for best-fit assignment). */
export function templateSounds(templateId: string): Record<string, Record<string, string>> {
  const t = TEMPLATES.find((x) => x.id === templateId) ?? TEMPLATES[0]!;
  return Object.fromEntries(t.tracks.filter((s) => s.sounds).map((s) => [s.name, { ...s.sounds! }]));
}

/** Create tracks and resolve `answerFrom` track names to ids. */
function withPhrases(specs: TrackSpec[]): TrackState[] {
  const tracks = specs.map(createTrack);
  return tracks.map((track, i) => {
    const p = specs[i]!.phrase;
    if (!p) return track;
    const from = p.answerFrom ? tracks.find((t) => t.name === p.answerFrom)?.id : undefined;
    return {
      ...track,
      phrase: { role: p.role, bars: p.bars, ...(from ? { answer: { from, transform: p.transform ?? 'echo' } } : {}) },
    };
  });
}
