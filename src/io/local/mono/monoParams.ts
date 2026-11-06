import { expRange, LOCAL_CC, norm } from '../common';

/**
 * Drift Synth Mono: a monophonic bass/lead synth (Minimoog / SH-101 style)
 * as CCs. Shared knobs reuse the LOCAL_CC numbers (cutoff, resonance,
 * envelope, drive, accent, waveform); glide is CC 5 (portamento time).
 * Mirrored in `core/instruments/data/drift-synth-mono.json` (a test keeps
 * them in step). Volume, reverb and delay are handled by the shared channel.
 */
export const MONO_CC = {
  osc1Wave: LOCAL_CC.waveform,
  pw: 21,
  osc2Wave: 22,
  osc2Octave: 26,
  osc2Detune: 25,
  osc1Level: 20,
  osc2Level: 24,
  sub: 27,
  noise: 28,
  cutoff: LOCAL_CC.cutoff,
  resonance: LOCAL_CC.resonance,
  envMod: LOCAL_CC.envMod,
  drive: LOCAL_CC.drive,
  keyFollow: 29,
  velFilter: 30,
  accent: LOCAL_CC.accent,
  fAttack: 102,
  fDecay: LOCAL_CC.decay,
  fSustain: 103,
  attack: LOCAL_CC.attack,
  decay: 104,
  sustain: 105,
  release: LOCAL_CC.release,
  glide: 5,
  pitchEnv: 106,
  pitchDecay: 107,
  lfoRate: 76,
  lfoFilter: 31,
  lfoPitch: 77,
} as const;

export type MonoParam = keyof typeof MONO_CC;

/** Name of the AudioWorkletProcessor in monoProcessor.js. */
export const MONO_PROCESSOR = 'drift-mono';

const steps = (v: number, n: number) => Math.min(n - 1, Math.floor((Math.max(0, Math.min(127, v)) * n) / 128));
/** 0..127 with 64 as the centre → -1..1. */
const bipolar = (v: number) => Math.max(-1, Math.min(1, (Math.max(0, Math.min(127, v)) - 64) / 63));

/** CC value (0–127) → the engine's value in real units. */
const MAP: Record<MonoParam, (v: number) => number> = {
  osc1Wave: (v) => steps(v, 3), // 0 saw, 1 pulse, 2 triangle
  pw: (v) => 0.5 - norm(v) * 0.45, // pulse width: 0.5 square … 0.05 thin
  osc2Wave: (v) => steps(v, 3), // 0 saw, 1 pulse, 2 triangle
  osc2Octave: (v) => steps(v, 3) - 1, // octaves: -1 / 0 / +1
  osc2Detune: (v) => bipolar(v) * 0.5, // semitones, ±50 cents
  osc1Level: norm,
  osc2Level: norm,
  sub: norm, // sine one octave below
  noise: (v) => norm(v) * norm(v),
  cutoff: (v) => expRange(v, 30, 16000), // Hz
  resonance: (v) => norm(v) * 3.9, // ladder feedback; ~4 self-oscillates
  envMod: (v) => norm(v) * 6, // octaves
  drive: (v) => 1 + norm(v) * norm(v) * 7, // input gain into the filter
  keyFollow: norm,
  velFilter: (v) => norm(v) * 3, // octaves at full velocity
  accent: (v) => norm(v), // extra level and filter on notes with velocity ≥ 100
  fAttack: (v) => expRange(v, 0.001, 2), // s
  fDecay: (v) => expRange(v, 0.02, 4), // s
  fSustain: norm,
  attack: (v) => expRange(v, 0.001, 2), // s
  decay: (v) => expRange(v, 0.02, 4), // s
  sustain: norm,
  release: (v) => expRange(v, 0.005, 4), // s
  glide: (v) => (v < 2 ? 0 : expRange(v, 0.005, 1)), // s, 0 = off
  pitchEnv: (v) => norm(v) * norm(v) * 24, // semitones above the note at the start
  pitchDecay: (v) => expRange(v, 0.005, 0.5), // s
  lfoRate: (v) => expRange(v, 0.05, 20), // Hz
  lfoFilter: (v) => norm(v) * norm(v) * 3, // octaves
  lfoPitch: (v) => norm(v) * norm(v) * 1, // semitones
};

/** Default panel: a round two-oscillator Moog-style bass. */
export const MONO_DEFAULTS: Record<MonoParam, number> = {
  osc1Wave: 0,
  pw: 0,
  osc2Wave: 0,
  osc2Octave: 64,
  osc2Detune: 70,
  osc1Level: 110,
  osc2Level: 80,
  sub: 60,
  noise: 0,
  cutoff: 50,
  resonance: 25,
  envMod: 45,
  drive: 40,
  keyFollow: 64,
  velFilter: 30,
  accent: 60,
  fAttack: 0,
  fDecay: 55,
  fSustain: 20,
  attack: 0,
  decay: 80,
  sustain: 100,
  release: 30,
  glide: 0,
  pitchEnv: 0,
  pitchDecay: 40,
  lfoRate: 40,
  lfoFilter: 0,
  lfoPitch: 0,
};

const BY_CC = new Map<number, MonoParam>(Object.entries(MONO_CC).map(([k, cc]) => [cc, k as MonoParam]));

/** The engine parameter a CC sets, with its value in real units; undefined if the Mono ignores it. */
export function monoParam(cc: number, value: number): [MonoParam, number] | undefined {
  const key = BY_CC.get(cc);
  return key ? [key, MAP[key](value)] : undefined;
}

/** All parameters at their default, in engine units. */
export function monoDefaultValues(): [MonoParam, number][] {
  return (Object.keys(MONO_DEFAULTS) as MonoParam[]).map((k) => [k, MAP[k](MONO_DEFAULTS[k])]);
}
