import type { AnswerTransform, PhraseRole } from '../core/engine/phrasing';
import { defaultConfig, type GeneratorConfig } from '../core/generators/registry';
import type { TrackType } from '../core/generators/types';
import type { Register } from '../core/pattern/pattern';
import type { ProgressionStep } from '../core/theory/harmony';
import { parsePitchClass } from '../core/theory/note';
import type { ModeName } from '../core/theory/scale';
import { newId, SCHEMA_VERSION, type CcModulation, type MidiTarget, type ProjectState, type TrackState } from './project';
import { roleForType, type DeviceRole } from './rack';

export const TRACK_COLORS = {
  lead: '#F5A524',
  bass: '#38BDF8',
  pad: '#A78BFA',
  drums: '#A3E635',
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
  mutationIntervalBars?: number;
  /** CC LFOs, e.g. a slow filter sweep. */
  modulations?: Omit<CcModulation, 'id'>[];
  /** Call-and-response role; `answerFrom` names another track in the template. */
  phrase?: { role: PhraseRole; bars: number; answerFrom?: string; transform?: AnswerTransform };
}

export function createTrack(spec: TrackSpec): TrackState {
  const base = defaultConfig(spec.type);
  const generator = { type: base.type, params: { ...base.params, ...spec.params } } as GeneratorConfig;
  return {
    id: newId(),
    name: spec.name,
    color: spec.color,
    generator,
    register: { ...REGISTERS[spec.type] },
    output: { ...spec.output },
    role: spec.role ?? roleForType(spec.type),
    muted: false,
    solo: false,
    frozen: false,
    mutationIntervalBars: spec.mutationIntervalBars ?? 4,
    seed: Math.floor(Math.random() * 2 ** 32),
    modulations: (spec.modulations ?? []).map((m) => ({ ...m, id: newId() })),
  };
}

export interface TemplateSpec {
  id: string;
  name: string;
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

export const TEMPLATES: TemplateSpec[] = [
  {
    id: 'techno',
    name: 'Techno',
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
      { name: 'Lead', color: TRACK_COLORS.lead, type: 'motif', output: LEAD, params: { density: 0.35, rangeDegrees: 5 } },
      { name: 'Bass', color: TRACK_COLORS.bass, type: 'bass', output: BASS, params: { density: 0.7, offbeat: false } },
      { name: 'Drone', color: TRACK_COLORS.pad, type: 'drone', output: PAD },
      { name: 'Drums', color: TRACK_COLORS.drums, type: 'drums', output: DRUMS },
    ],
  },
  {
    id: 'deep-house',
    name: 'Deep house',
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
      { name: 'Lead', color: TRACK_COLORS.lead, type: 'motif', output: LEAD, params: { density: 0.3, mutation: 0.12 } },
      { name: 'Bass', color: TRACK_COLORS.bass, type: 'bass', output: BASS, params: { offbeat: true, fifthChance: 0.3 } },
      { name: 'Pad', color: TRACK_COLORS.pad, type: 'chords', output: PAD, params: { style: 'pulse', pulses: 3, gate: 0.5 } },
      { name: 'Drums', color: TRACK_COLORS.drums, type: 'drums', output: DRUMS },
    ],
  },
  {
    id: 'acid',
    name: 'Acid',
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
      {
        name: '303',
        color: TRACK_COLORS.bass,
        type: 'acid',
        output: BASS,
        mutationIntervalBars: 4,
        modulations: [
          { enabled: true, cc: 74, label: 'Cutoff', shape: 'sine', periodBars: 8, min: 25, max: 105 },
          { enabled: true, cc: 12, label: 'Env mod', shape: 'triangle', periodBars: 16, min: 40, max: 120 },
        ],
      },
      { name: 'Drums', color: TRACK_COLORS.drums, type: 'drums', output: DRUMS, params: { ratchetChance: 0.15, conditionChance: 0.12 } },
      { name: 'Drone', color: TRACK_COLORS.pad, type: 'drone', output: PAD, params: { velocity: 55 } },
    ],
  },
  {
    id: 'conversation',
    name: 'Conversation',
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
      {
        name: 'Call',
        color: TRACK_COLORS.lead,
        type: 'motif',
        output: LEAD,
        params: { density: 0.5, rangeDegrees: 6, mutation: 0.15 },
        phrase: { role: 'call', bars: 1 },
      },
      {
        // Same synth and channel: the two phrases never overlap.
        name: 'Answer',
        color: '#F472B6',
        type: 'motif',
        output: LEAD,
        phrase: { role: 'response', bars: 1, answerFrom: 'Call', transform: 'upThird' },
      },
      { name: 'Bass', color: TRACK_COLORS.bass, type: 'bass', output: BASS, params: { offbeat: true } },
      { name: 'Drums', color: TRACK_COLORS.drums, type: 'drums', output: DRUMS, params: { ratchetChance: 0.12, conditionChance: 0.15 } },
    ],
  },
  {
    id: 'ambient',
    name: 'Ambient',
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
    tracks: [
      { name: 'Lead', color: TRACK_COLORS.lead, type: 'motif', output: LEAD, params: { density: 0.15, maxLeap: 2, lengthSteps: 64 }, mutationIntervalBars: 8 },
      { name: 'Arp', color: TRACK_COLORS.bass, type: 'arp', output: BASS, params: { rate: 2, restChance: 0.35, octaves: 3 } },
      { name: 'Pad', color: TRACK_COLORS.pad, type: 'chords', output: PAD, params: { gate: 1 } },
    ],
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
