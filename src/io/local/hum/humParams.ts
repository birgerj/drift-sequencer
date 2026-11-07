import { expRange, LOCAL_CC, norm } from '../common';

/**
 * Drift Synth Hum: a sung / hummed voice (formant synthesis) as CCs.
 * Brightness and focus reuse the cutoff and resonance CCs so filter LFOs
 * and the "filterCutoff" modulation target work on it too. Mirrored in
 * `core/instruments/data/drift-synth-hum.json` (a test keeps them in step).
 * Volume, reverb and delay are handled by the shared channel.
 */
export const HUM_CC = {
  syllable: 20,
  voice: 21,
  brightness: LOCAL_CC.cutoff,
  focus: LOCAL_CC.resonance,
  breath: 23,
  articulation: 24,
  vibDepth: 77,
  vibRate: 76,
  vibDelay: 78,
  scoop: 25,
  humanize: 26,
  attack: LOCAL_CC.attack,
  release: LOCAL_CC.release,
  ensemble: 93,
} as const;

export type HumParam = keyof typeof HUM_CC;

/** Name of the AudioWorkletProcessor in humProcessor.js. */
export const HUM_PROCESSOR = 'drift-hum';

/**
 * What each note sings, in switch order. The last three pick per note:
 * Scat from scat syllables, Cycle steps through "pa doo dee pee yay",
 * Random from all of them. Mirrored in humProcessor.js (SYLLABLES, MODES).
 */
export const HUM_SYLLABLES = [
  'Laa', 'Doo', 'Daa', 'Dee', 'Paa', 'Pee', 'Bah', 'Yay', 'Mah', 'Nah', 'Mmm', 'Ooh', 'Aah', 'Dum', 'Scat', 'Cycle', 'Random',
] as const;

const steps = (v: number, n: number) => Math.min(n - 1, Math.floor((Math.max(0, Math.min(127, v)) * n) / 128));

/** The highest CC value of each syllable's band (for the definition's `choices`). */
export function syllableBands(): { upTo: number; label: string }[] {
  const n = HUM_SYLLABLES.length;
  return HUM_SYLLABLES.map((label, i) => ({ upTo: Math.ceil(((i + 1) * 128) / n) - 1, label }));
}

/** CC value (0–127) → the engine's value in real units. */
const MAP: Record<HumParam, (v: number) => number> = {
  syllable: (v) => steps(v, HUM_SYLLABLES.length), // index into HUM_SYLLABLES
  voice: (v) => expRange(v, 0.78, 1.28), // formant scale: deep … child
  brightness: norm, // glottal source tilt
  focus: (v) => 2 * Math.pow(0.25, norm(v)), // formant bandwidth scale: 2 (wide) … 0.5 (sharp)
  breath: (v) => norm(v) * norm(v), // aspiration noise
  articulation: norm, // consonant strength and length
  vibDepth: (v) => norm(v) * norm(v) * 0.8, // semitones
  vibRate: (v) => expRange(v, 3, 8), // Hz
  vibDelay: (v) => norm(v) * norm(v) * 1.5, // s until vibrato is fully in
  scoop: (v) => norm(v) * norm(v) * 2, // semitones below the note at the start
  humanize: norm, // pitch drift and per-note variation
  attack: (v) => expRange(v, 0.005, 2), // s
  release: (v) => expRange(v, 0.03, 4), // s
  ensemble: norm, // stereo choir chorus
};

/** Default: a warm "laa" with gentle vibrato that sits well as a lead. */
export const HUM_DEFAULTS: Record<HumParam, number> = {
  syllable: 3,
  voice: 64,
  brightness: 70,
  focus: 64,
  breath: 40,
  articulation: 80,
  vibDepth: 55,
  vibRate: 60,
  vibDelay: 45,
  scoop: 45,
  humanize: 50,
  attack: 30,
  release: 55,
  ensemble: 35,
};

const BY_CC = new Map<number, HumParam>(Object.entries(HUM_CC).map(([k, cc]) => [cc, k as HumParam]));

/** The engine parameter a CC sets, with its value in real units; undefined if Hum ignores it. */
export function humParam(cc: number, value: number): [HumParam, number] | undefined {
  const key = BY_CC.get(cc);
  return key ? [key, MAP[key](value)] : undefined;
}

/** All parameters at their default, in engine units. */
export function humDefaultValues(): [HumParam, number][] {
  return (Object.keys(HUM_DEFAULTS) as HumParam[]).map((k) => [k, MAP[k](HUM_DEFAULTS[k])]);
}
