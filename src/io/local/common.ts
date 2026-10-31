import type * as ToneNS from 'tone';

/** CC numbers the local instruments respond to; mirrored in their instrument definitions. */
export const LOCAL_CC = {
  volume: 7,
  cutoff: 74,
  resonance: 71,
  attack: 73,
  release: 72,
  decay: 75,
  envMod: 12,
  accent: 16,
  drive: 17,
  waveform: 70,
  reverb: 91,
  delay: 94,
  allSoundOff: 120,
  allNotesOff: 123,
} as const;

export interface Instrument {
  noteOn(note: number, velocity: number, time: number): void;
  noteOff(note: number, time: number): void;
  cc(cc: number, value: number): void;
  allOff(time: number): void;
}

export const norm = (v: number) => Math.max(0, Math.min(127, v)) / 127;
/** 0..127 → exponential range lo..hi. */
export const expRange = (v: number, lo: number, hi: number) => lo * Math.pow(hi / lo, norm(v));
export const midiHz = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

export interface Channel {
  out: ToneNS.Gain;
  rev: ToneNS.Gain;
  del: ToneNS.Gain;
}

/** CCs every instrument understands: level and effect sends. */
export function channelCc(ch: Channel, cc: number, value: number): boolean {
  if (cc === LOCAL_CC.volume) ch.out.gain.rampTo(norm(value) * norm(value), 0.02);
  else if (cc === LOCAL_CC.reverb) ch.rev.gain.rampTo(norm(value), 0.05);
  else if (cc === LOCAL_CC.delay) ch.del.gain.rampTo(norm(value) * 0.8, 0.05);
  else return false;
  return true;
}

