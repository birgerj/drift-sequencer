import type * as ToneNS from 'tone';
import { channelCc, expRange, LOCAL_CC, midiHz, norm, type Channel, type Instrument } from './common';

/**
 * Analog-style drum synthesis on the GM drum notes (as used by the TR-8S).
 * Every hit builds its own short-lived Web Audio graph, scheduled to the
 * sample, so voices overlap naturally. Three kit characters: 808, 909, electro.
 */
export type KitName = '808' | '909' | 'electro';

/** Per-voice CCs; each voice has tune, decay and level. */
export const DRUM_CC = {
  kit: 14,
  busDrive: 17,
  busComp: 18,
  hatTone: 74,
  kick: { tune: 20, decay: 21, level: 22 },
  snare: { tune: 23, decay: 24, level: 25 },
  clap: { tune: 26, decay: 27, level: 28 },
  closedHat: { tune: 29, decay: 30, level: 31 },
  openHat: { tune: 32, decay: 33, level: 34 },
  toms: { level: 35 },
  cymbals: { level: 36 },
  percussion: { level: 37 },
} as const;

type Voice = 'kick' | 'snare' | 'clap' | 'closedHat' | 'openHat' | 'toms' | 'cymbals' | 'percussion';

interface KitSound {
  kick: { start: number; end: number; pitchDecay: number; decay: number; click: number; drive: number };
  snare: { tones: [number, number]; toneDecay: number; noiseDecay: number; noiseHz: number; tone: number };
  clap: { bursts: number; spacing: number; tail: number; hz: number };
  hat: { noise: number; closed: number; open: number; hz: number };
}

const KITS: Record<KitName, KitSound> = {
  '808': {
    kick: { start: 115, end: 47, pitchDecay: 0.07, decay: 0.75, click: 0.15, drive: 0.15 },
    snare: { tones: [180, 330], toneDecay: 0.13, noiseDecay: 0.17, noiseHz: 1800, tone: 0.55 },
    clap: { bursts: 3, spacing: 0.011, tail: 0.16, hz: 1100 },
    hat: { noise: 0.08, closed: 0.045, open: 0.38, hz: 10000 },
  },
  '909': {
    kick: { start: 240, end: 52, pitchDecay: 0.032, decay: 0.38, click: 0.7, drive: 0.35 },
    snare: { tones: [190, 280], toneDecay: 0.075, noiseDecay: 0.24, noiseHz: 2600, tone: 0.32 },
    clap: { bursts: 4, spacing: 0.009, tail: 0.2, hz: 1250 },
    hat: { noise: 0.45, closed: 0.06, open: 0.5, hz: 9000 },
  },
  electro: {
    kick: { start: 320, end: 44, pitchDecay: 0.022, decay: 0.5, click: 0.4, drive: 0.65 },
    snare: { tones: [210, 420], toneDecay: 0.05, noiseDecay: 0.11, noiseHz: 3400, tone: 0.3 },
    clap: { bursts: 3, spacing: 0.007, tail: 0.1, hz: 1600 },
    hat: { noise: 0.25, closed: 0.032, open: 0.26, hz: 11000 },
  },
};

/** The six detuned square oscillators of the TR-808 cymbal/hat circuit. */
const METAL_HZ = [205.3, 304.4, 369.6, 522.7, 540, 800];

interface VoiceParams {
  tune: number;
  decay: number;
  level: number;
}

export function kitFromCc(value: number): KitName {
  return value < 43 ? '808' : value < 86 ? '909' : 'electro';
}

export class DrumKit implements Instrument {
  private ctx: AudioContext;
  private input: GainNode;
  private shaper: WaveShaperNode;
  private comp: DynamicsCompressorNode;
  private clapRoom: GainNode;
  private noise: AudioBuffer;
  private kit: KitSound = KITS['808'];
  private hatTone = 1;
  private openHat: { gain: GainNode; start: number } | undefined;
  private voices: Record<Voice, VoiceParams> = {
    kick: { tune: 1, decay: 1, level: 1 },
    snare: { tune: 1, decay: 1, level: 1 },
    clap: { tune: 1, decay: 1, level: 1 },
    closedHat: { tune: 1, decay: 1, level: 1 },
    openHat: { tune: 1, decay: 1, level: 1 },
    toms: { tune: 1, decay: 1, level: 1 },
    cymbals: { tune: 1, decay: 1, level: 1 },
    percussion: { tune: 1, decay: 1, level: 1 },
  };

  constructor(
    T: typeof ToneNS,
    private ch: Channel,
  ) {
    const ctx = (this.ctx = T.getContext().rawContext as AudioContext);
    // Drum bus: saturation → glue compressor → make-up gain → channel.
    this.input = ctx.createGain();
    this.shaper = ctx.createWaveShaper();
    this.shaper.oversample = '2x';
    this.setDrive(0.25);
    this.comp = ctx.createDynamicsCompressor();
    this.comp.attack.value = 0.006;
    this.comp.release.value = 0.12;
    this.comp.knee.value = 6;
    this.setComp(0.4);
    const makeup = ctx.createGain();
    makeup.gain.value = 1.1;
    this.input.connect(this.shaper).connect(this.comp).connect(makeup);
    T.connect(makeup, ch.out);

    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    // Small room just for the clap.
    const room = ctx.createConvolver();
    room.buffer = this.roomImpulse(0.35);
    this.clapRoom = ctx.createGain();
    this.clapRoom.gain.value = 0.35;
    this.clapRoom.connect(room).connect(this.input);
  }

  noteOn(note: number, velocity: number, time: number) {
    const v = norm(velocity);
    switch (note) {
      case 35:
      case 36:
        return this.kick(time, v);
      case 37:
        return this.rim(time, v);
      case 38:
      case 40:
        return this.snare(time, v);
      case 39:
        return this.clap(time, v);
      case 42:
      case 44:
        return this.hat(time, v, false);
      case 46:
        return this.hat(time, v, true);
      case 49:
      case 52:
      case 55:
      case 57:
        return this.cymbal(time, v, false);
      case 51:
      case 53:
      case 59:
        return this.cymbal(time, v, true);
      case 56:
        return this.cowbell(time, v);
      default:
        return this.tom(note, time, v);
    }
  }

  noteOff() {
    /* one-shots */
  }

  allOff(time: number) {
    this.chokeOpenHat(time);
  }

  cc(cc: number, value: number) {
    if (channelCc(this.ch, cc, value)) return;
    if (cc === DRUM_CC.kit) this.kit = KITS[kitFromCc(value)];
    else if (cc === DRUM_CC.busDrive || cc === LOCAL_CC.drive) this.setDrive(norm(value));
    else if (cc === DRUM_CC.busComp) this.setComp(norm(value));
    else if (cc === DRUM_CC.hatTone) this.hatTone = expRange(value, 0.5, 1.6);
    else {
      for (const [voice, ccs] of Object.entries(DRUM_CC) as [Voice, Partial<Record<keyof VoiceParams, number>>][]) {
        if (typeof ccs !== 'object') continue;
        const p = this.voices[voice];
        if (ccs.tune === cc) p.tune = Math.pow(2, (value - 64) / 64); // ±1 octave
        else if (ccs.decay === cc) p.decay = expRange(value, 0.25, 3.5);
        else if (ccs.level === cc) p.level = Math.pow(value / 100, 2);
      }
    }
  }

  // ---------- voices ----------

  private kick(t: number, v: number) {
    const k = this.kit.kick;
    const p = this.voices.kick;
    const decay = k.decay * p.decay;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(k.start * p.tune * (0.9 + 0.2 * v), t);
    osc.frequency.exponentialRampToValueAtTime(k.end * p.tune, t + k.pitchDecay);
    const amp = this.env(t, 0.001, decay, (0.55 + 0.45 * v) * p.level * 0.75);
    // Per-voice saturation thickens the body.
    const sat = this.ctx.createWaveShaper();
    sat.curve = tanhCurve(1 + k.drive * 6);
    osc.connect(sat).connect(amp).connect(this.input);
    osc.start(t);
    osc.stop(t + decay + 0.05);
    // Click: a very short burst of filtered noise for the attack.
    if (k.click > 0) {
      const click = this.noiseSource(t, 0.02);
      const hp = this.filter('highpass', 1500);
      const g = this.env(t, 0.0005, 0.006, k.click * (0.5 + 0.7 * v) * p.level);
      click.connect(hp).connect(g).connect(this.input);
    }
  }

  private snare(t: number, v: number) {
    const s = this.kit.snare;
    const p = this.voices.snare;
    // Two tuned body tones…
    for (const [i, hz] of s.tones.entries()) {
      const osc = this.ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(hz * p.tune * 1.25, t);
      osc.frequency.exponentialRampToValueAtTime(hz * p.tune, t + 0.02);
      const g = this.env(t, 0.001, s.toneDecay * p.decay * (i ? 0.7 : 1), s.tone * (0.6 + 0.4 * v) * p.level * (i ? 0.6 : 1));
      osc.connect(g).connect(this.input);
      osc.start(t);
      osc.stop(t + s.toneDecay * p.decay + 0.05);
    }
    // …and the snares: noise, brighter when hit harder.
    const decay = s.noiseDecay * p.decay;
    const n = this.noiseSource(t, decay + 0.05);
    const hp = this.filter('highpass', s.noiseHz * p.tune * (0.85 + 0.3 * v));
    const peak = this.filter('peaking', 5000, 1, 4);
    const g = this.env(t, 0.001, decay, (0.45 + 0.55 * v) * p.level * 0.8);
    n.connect(hp).connect(peak).connect(g).connect(this.input);
  }

  private clap(t: number, v: number) {
    const c = this.kit.clap;
    const p = this.voices.clap;
    const bp = this.filter('bandpass', c.hz * p.tune, 1.4);
    const out = this.ctx.createGain();
    out.gain.value = (0.7 + 0.5 * v) * p.level * 1.6;
    bp.connect(out);
    out.connect(this.input);
    out.connect(this.clapRoom);
    const tail = c.tail * p.decay;
    const n = this.noiseSource(t, c.bursts * c.spacing + tail + 0.05);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    // A few quick slaps, then the tail.
    for (let i = 0; i < c.bursts; i++) {
      const at = t + i * c.spacing;
      g.gain.setValueAtTime(1, at);
      g.gain.exponentialRampToValueAtTime(0.15, at + c.spacing * 0.9);
    }
    const tailAt = t + c.bursts * c.spacing;
    g.gain.setValueAtTime(1, tailAt);
    g.gain.setTargetAtTime(0, tailAt, tail / 4);
    n.connect(g).connect(bp);
  }

  private hat(t: number, v: number, open: boolean) {
    const h = this.kit.hat;
    const p = open ? this.voices.openHat : this.voices.closedHat;
    // The closed hat (and a new open hat) chokes a ringing open hat.
    this.chokeOpenHat(t);
    const decay = (open ? h.open : h.closed) * p.decay;
    const bright = this.hatTone * (0.85 + 0.3 * v);
    const sum = this.metal(t, decay + 0.05, p.tune, 0.18 * (1 - h.noise));
    const n = this.noiseSource(t, decay + 0.05);
    const ng = this.ctx.createGain();
    ng.gain.value = h.noise;
    n.connect(ng).connect(sum);
    const bp = this.filter('bandpass', h.hz * bright, 0.9);
    const hp = this.filter('highpass', 7000 * bright);
    const g = this.env(t, 0.0005, decay, (0.35 + 0.65 * v) * p.level * (open ? 1.3 : 2));
    sum.connect(bp).connect(hp).connect(g).connect(this.input);
    if (open) this.openHat = { gain: g, start: t };
  }

  private cymbal(t: number, v: number, ride: boolean) {
    const p = this.voices.cymbals;
    const decay = (ride ? 0.9 : 1.6) * p.decay;
    const sum = this.metal(t, decay + 0.1, ride ? 0.85 : 1.1, 0.15);
    const n = this.noiseSource(t, decay + 0.1);
    const ng = this.ctx.createGain();
    ng.gain.value = ride ? 0.05 : 0.25;
    n.connect(ng).connect(sum);
    const bp = this.filter('bandpass', (ride ? 6500 : 8000) * this.hatTone, ride ? 1.5 : 0.6);
    const hp = this.filter('highpass', ride ? 3500 : 5000);
    const g = this.env(t, 0.001, decay, (0.3 + 0.5 * v) * p.level * 0.85);
    sum.connect(bp).connect(hp).connect(g).connect(this.input);
  }

  private tom(note: number, t: number, v: number) {
    const p = this.voices.toms;
    const hz = (note >= 41 && note <= 50 ? 75 * Math.pow(2, (note - 41) / 8) : midiHz(note)) * p.tune;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(hz * 1.6, t);
    osc.frequency.exponentialRampToValueAtTime(hz, t + 0.04);
    const decay = 0.35 * p.decay;
    const g = this.env(t, 0.001, decay, (0.5 + 0.5 * v) * p.level * 0.4);
    osc.connect(g).connect(this.input);
    osc.start(t);
    osc.stop(t + decay + 0.05);
    // Stick noise on the attack.
    const n = this.noiseSource(t, 0.04);
    const bp = this.filter('bandpass', hz * 6, 1);
    const ng = this.env(t, 0.0005, 0.015, 0.25 * v * p.level);
    n.connect(bp).connect(ng).connect(this.input);
  }

  private rim(t: number, v: number) {
    const p = this.voices.percussion;
    const hp = this.filter('highpass', 400);
    hp.connect(this.input);
    for (const hz of [1700, 480]) {
      const osc = this.ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = hz;
      const g = this.env(t, 0.0005, 0.022, (0.4 + 0.5 * v) * p.level * 0.7);
      osc.connect(g).connect(hp);
      osc.start(t);
      osc.stop(t + 0.06);
    }
  }

  private cowbell(t: number, v: number) {
    const p = this.voices.percussion;
    const bp = this.filter('bandpass', 800, 2.5);
    const g = this.env(t, 0.001, 0.28 * p.decay, (0.3 + 0.4 * v) * p.level * 0.4);
    bp.connect(g).connect(this.input);
    for (const hz of [540, 800]) {
      const osc = this.ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = hz;
      osc.connect(bp);
      osc.start(t);
      osc.stop(t + 0.4);
    }
  }

  // ---------- building blocks ----------

  /** Six square oscillators summed; the core of 808 hats and cymbals. */
  private metal(t: number, length: number, tune: number, level: number): GainNode {
    const sum = this.ctx.createGain();
    sum.gain.value = level;
    for (const hz of METAL_HZ) {
      const osc = this.ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = hz * tune;
      osc.connect(sum);
      osc.start(t);
      osc.stop(t + length);
    }
    return sum;
  }

  private chokeOpenHat(t: number) {
    const o = this.openHat;
    if (o && o.start < t) {
      o.gain.gain.cancelScheduledValues(t);
      o.gain.gain.setTargetAtTime(0, t, 0.006);
      this.openHat = undefined;
    }
  }

  /** Gain with a fast attack and an exponential-ish decay to silence. */
  private env(t: number, attack: number, decay: number, peak: number): GainNode {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.setTargetAtTime(0, t + attack, decay / 4);
    return g;
  }

  private noiseSource(t: number, length: number): AudioBufferSourceNode {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    // Start at a random point so repeated hits don't sound identical.
    const offset = Math.random() * (this.noise.duration - Math.min(length, 1.5) - 0.01);
    src.start(t, Math.max(0, offset));
    src.stop(t + length);
    return src;
  }

  private filter(type: BiquadFilterType, hz: number, q = 0.7, gain = 0): BiquadFilterNode {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = Math.min(hz, this.ctx.sampleRate / 2 - 100);
    f.Q.value = q;
    f.gain.value = gain;
    return f;
  }

  private setDrive(amount: number) {
    this.shaper.curve = tanhCurve(1 + amount * 4);
  }

  private setComp(amount: number) {
    this.comp.threshold.value = -6 - amount * 22;
    this.comp.ratio.value = 1.5 + amount * 5;
  }

  private roomImpulse(seconds: number): AudioBuffer {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(2, len, this.ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    return buf;
  }
}

/** Soft-clipping curve, normalised so full scale stays at full scale. */
const curves = new Map<number, Float32Array<ArrayBuffer>>();
function tanhCurve(drive: number): Float32Array<ArrayBuffer> {
  const key = Math.round(drive * 100);
  const cached = curves.get(key);
  if (cached) return cached;
  const n = 1024;
  const curve = new Float32Array(n);
  const norm = Math.tanh(drive);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * drive) / norm;
  }
  curves.set(key, curve);
  return curve;
}
