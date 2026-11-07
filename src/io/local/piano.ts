import type * as ToneNS from 'tone';
import { channelCc, expRange, LOCAL_CC, midiHz, norm, type Channel, type Instrument } from './common';
import { loadPianoPack, pianoLayerFor, pianoPackFromCc, pianoRate, pianoZoneFor, type LoadedPiano, type PianoPackId } from './samplePianos';

/**
 * Drift Synth Piano: sampled piano packs (see samplePianos.ts), played with
 * plain AudioBufferSourceNodes, so it costs next to no CPU, also on phones.
 * The first pack downloads on first use; until it is ready a soft synth
 * tone plays instead.
 */
export const PIANO_CC = {
  pack: 15,
  tone: LOCAL_CC.cutoff,
  dynamics: 30,
  decay: LOCAL_CC.decay,
  release: LOCAL_CC.release,
} as const;

/** Defaults, mirrored in drift-synth-piano.json (a test keeps them in step). */
export const PIANO_DEFAULTS: Record<keyof typeof PIANO_CC, number> = {
  pack: 0,
  tone: 110,
  dynamics: 90,
  decay: 127,
  release: 45,
};

const MAX_VOICES = 32;

interface Voice {
  note: number;
  src: AudioScheduledSourceNode;
  /** Release stage; the sample's own envelope sits before it. */
  rel: GainNode;
}

export class PianoSynth implements Instrument {
  private readonly ctx: AudioContext;
  private readonly filter: BiquadFilterNode;
  private packId: PianoPackId = pianoPackFromCc(PIANO_DEFAULTS.pack);
  private piano: LoadedPiano | undefined;
  private voices: Voice[] = [];
  private dynamics = norm(PIANO_DEFAULTS.dynamics);
  private decay = norm(PIANO_DEFAULTS.decay);
  private release = releaseSeconds(PIANO_DEFAULTS.release);
  private loading: Promise<void> | undefined;

  constructor(
    T: typeof ToneNS,
    private readonly ch: Channel,
  ) {
    const ctx = (this.ctx = T.getContext().rawContext as AudioContext);
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.Q.value = 0.5;
    this.filter.frequency.value = toneHz(PIANO_DEFAULTS.tone);
    T.connect(this.filter, ch.out);
  }

  /** Start downloading the current pack (once per pack). */
  load(): Promise<void> {
    this.loading ??= this.select(this.packId, true);
    return this.loading;
  }

  private select(id: PianoPackId, force = false): Promise<void> {
    if (id === this.packId && !force) return Promise.resolve();
    this.packId = id;
    // Keep playing the current pack until the new one is ready.
    return loadPianoPack(this.ctx, id).then(
      (p) => {
        if (this.packId === id) this.piano = p;
      },
      () => undefined, // reported through onPianoStatus
    );
  }

  noteOn(note: number, velocity: number, time: number) {
    void this.load();
    const v = norm(velocity);
    // Same key struck again: the old note dampens, as on a piano.
    for (const voice of this.voices) if (voice.note === note) this.stop(voice, time, 0.03);
    if (this.voices.length >= MAX_VOICES) this.stop(this.voices[0]!, time, 0.02);
    const voice = this.piano ? this.sampleVoice(this.piano, note, v, time) : this.fallbackVoice(note, v, time);
    this.voices.push(voice);
    voice.src.onended = () => {
      this.voices = this.voices.filter((x) => x !== voice);
      voice.rel.disconnect();
    };
  }

  noteOff(note: number, time: number) {
    for (const voice of this.voices) if (voice.note === note) this.stop(voice, time, this.release / 5);
  }

  allOff(time: number) {
    for (const voice of this.voices) this.stop(voice, time, 0.03);
  }

  cc(cc: number, value: number) {
    if (channelCc(this.ch, cc, value)) return;
    if (cc === PIANO_CC.pack) {
      const id = pianoPackFromCc(value);
      this.loading = this.select(id);
    } else if (cc === PIANO_CC.tone) this.filter.frequency.setTargetAtTime(toneHz(value), this.ctx.currentTime, 0.03);
    else if (cc === PIANO_CC.dynamics) this.dynamics = norm(value);
    else if (cc === PIANO_CC.decay) this.decay = norm(value);
    else if (cc === PIANO_CC.release) this.release = releaseSeconds(value);
  }

  /** Level for a velocity: the layers already change the tone; Dynamics sets how much louder hard notes are. */
  private level(v: number): number {
    return 1 - this.dynamics + this.dynamics * Math.pow(v, 1.6);
  }

  private sampleVoice(piano: LoadedPiano, note: number, v: number, t: number): Voice {
    const zone = pianoZoneFor(pianoLayerFor(piano.layers, v), note);
    const rate = pianoRate(zone, note);
    const src = this.ctx.createBufferSource();
    src.buffer = zone.file;
    src.playbackRate.value = rate;
    const env = this.ctx.createGain();
    // Samples peak near full scale; chords of five or six notes must stay under the limiter.
    env.gain.setValueAtTime(piano.gain * this.level(v) * 0.4, t);
    // Decay below full shortens the ring even while the key is held.
    const length = zone.file.duration / rate;
    if (this.decay < 0.98) {
      const keep = 0.04 + length * this.decay * this.decay;
      env.gain.setTargetAtTime(0, t + keep * 0.6, Math.max(0.01, keep * 0.2));
    }
    const rel = this.ctx.createGain();
    src.connect(env).connect(rel).connect(this.filter);
    src.start(t);
    src.stop(t + length + 0.05);
    return { note, src, rel };
  }

  /** Until a pack is loaded: a soft, quickly decaying tone so the track isn't silent. */
  private fallbackVoice(note: number, v: number, t: number): Voice {
    const src = this.ctx.createOscillator();
    src.type = 'triangle';
    src.frequency.value = midiHz(note);
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.18 * this.level(v), t + 0.004);
    env.gain.setTargetAtTime(0, t + 0.004, 0.5);
    const rel = this.ctx.createGain();
    src.connect(env).connect(rel).connect(this.filter);
    src.start(t);
    src.stop(t + 3);
    return { note, src, rel };
  }

  private stop(voice: Voice, t: number, tau: number) {
    const at = Math.max(t, this.ctx.currentTime);
    voice.rel.gain.cancelScheduledValues(at);
    voice.rel.gain.setTargetAtTime(0, at, Math.max(0.005, tau));
    try {
      voice.src.stop(at + tau * 6 + 0.02);
    } catch {
      /* already stopped */
    }
  }
}

/** Tone knob → low-pass cutoff; fully open at the top. */
export function toneHz(value: number): number {
  return value >= 126 ? 20000 : expRange(value, 300, 20000);
}

/** Release knob → seconds the note takes to die after the key is let go. */
export function releaseSeconds(value: number): number {
  return expRange(value, 0.05, 4);
}
