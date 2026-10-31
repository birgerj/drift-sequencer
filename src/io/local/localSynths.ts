import type * as ToneNS from 'tone';
import type { MidiOutputPort } from '../midi/output';

/**
 * Built-in Web Audio instruments (Tone.js), exposed as MIDI output ports so
 * the sequencer, knob panel and LFOs drive them exactly like hardware.
 * Pick one as a device's port in "My devices". Tone.js is loaded on first use.
 */
export type LocalKind = 'lead' | 'bass' | 'pad' | 'drums';

export const LOCAL_PORTS: Record<LocalKind, string> = {
  lead: 'Drift Synth Lead',
  bass: 'Drift Synth Bass',
  pad: 'Drift Synth Pad',
  drums: 'Drift Synth Drums',
};

export function isLocalPort(name: string): boolean {
  return Object.values(LOCAL_PORTS).includes(name);
}

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

interface Instrument {
  noteOn(note: number, velocity: number, time: number): void;
  noteOff(note: number, time: number): void;
  cc(cc: number, value: number): void;
  allOff(time: number): void;
}

const norm = (v: number) => Math.max(0, Math.min(127, v)) / 127;
/** 0..127 → exponential range lo..hi. */
const expRange = (v: number, lo: number, hi: number) => lo * Math.pow(hi / lo, norm(v));
const midiHz = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

/** Shared audio graph: master bus with reverb and delay sends. */
class LocalAudio {
  T: typeof ToneNS | undefined;
  private loading: Promise<void> | undefined;
  private instruments = new Map<LocalKind, Instrument>();
  private master!: ToneNS.ToneAudioNode;
  private reverb!: ToneNS.ToneAudioNode;
  private delay!: ToneNS.ToneAudioNode;

  get ready(): boolean {
    return this.instruments.size > 0;
  }

  /** Load Tone.js and resume audio. Call from a click so the browser allows sound. */
  wake(): Promise<void> {
    this.loading ??= import('tone').then((T) => {
      this.T = T;
      this.build(T);
    });
    return this.loading.then(() => this.T!.start()).catch(() => undefined);
  }

  instrument(kind: LocalKind): Instrument | undefined {
    return this.instruments.get(kind);
  }

  /** performance.now() timestamp → AudioContext time, so notes sound when the engine meant them to. */
  toAudioTime(timestamp: number | undefined): number {
    const ctx = this.T!.getContext().rawContext as AudioContext;
    const now = ctx.currentTime;
    if (timestamp === undefined) return now;
    let t: number;
    try {
      const out = ctx.getOutputTimestamp?.();
      t = out?.performanceTime ? out.contextTime! + (timestamp - out.performanceTime) / 1000 : now + (timestamp - performance.now()) / 1000;
    } catch {
      t = now + (timestamp - performance.now()) / 1000;
    }
    return Math.max(now, t);
  }

  private build(T: typeof ToneNS): void {
    const limiter = new T.Limiter(-1).toDestination();
    this.master = new T.Gain(0.8).connect(limiter);
    const reverb = new T.Reverb({ decay: 3.5, preDelay: 0.02, wet: 1 });
    reverb.connect(this.master);
    this.reverb = reverb;
    const delay = new T.FeedbackDelay({ delayTime: 0.375, feedback: 0.35, wet: 1 });
    delay.connect(this.master);
    this.delay = delay;
    this.instruments.set('lead', new LeadSynth(T, this.channel(T, 0.12, 0.15)));
    this.instruments.set('bass', new AcidBass(T, this.channel(T, 0, 0)));
    this.instruments.set('pad', new PadSynth(T, this.channel(T, 0.35, 0)));
    this.instruments.set('drums', new DrumKit(T, this.channel(T, 0.06, 0)));
  }

  private channel(T: typeof ToneNS, reverb: number, delay: number): Channel {
    const out = new T.Gain(0.8).connect(this.master);
    const rev = new T.Gain(reverb).connect(this.reverb);
    const del = new T.Gain(delay).connect(this.delay);
    out.connect(rev);
    out.connect(del);
    return { out, rev, del };
  }
}

interface Channel {
  out: ToneNS.Gain;
  rev: ToneNS.Gain;
  del: ToneNS.Gain;
}

/** CCs every instrument understands: level and effect sends. */
function channelCc(ch: Channel, cc: number, value: number): boolean {
  if (cc === LOCAL_CC.volume) ch.out.gain.rampTo(norm(value) * norm(value), 0.02);
  else if (cc === LOCAL_CC.reverb) ch.rev.gain.rampTo(norm(value), 0.05);
  else if (cc === LOCAL_CC.delay) ch.del.gain.rampTo(norm(value) * 0.8, 0.05);
  else return false;
  return true;
}

/** Polyphonic saw lead with a resonant filter envelope. */
class LeadSynth implements Instrument {
  private synth: ToneNS.PolySynth<ToneNS.MonoSynth>;

  constructor(
    T: typeof ToneNS,
    private ch: Channel,
  ) {
    this.synth = new T.PolySynth(T.MonoSynth, {
      oscillator: { type: 'sawtooth' },
      filter: { type: 'lowpass', rolloff: -24, Q: 3 },
      envelope: { attack: 0.004, decay: 0.25, sustain: 0.5, release: 0.25 },
      filterEnvelope: { attack: 0.004, decay: 0.3, sustain: 0.25, release: 0.3, baseFrequency: 350, octaves: 3.5 },
      volume: -7,
    });
    this.synth.maxPolyphony = 8;
    this.synth.connect(ch.out);
  }

  noteOn(note: number, velocity: number, time: number) {
    this.synth.triggerAttack(midiHz(note), time, norm(velocity));
  }
  noteOff(note: number, time: number) {
    this.synth.triggerRelease(midiHz(note), time);
  }
  allOff() {
    this.synth.releaseAll();
  }
  cc(cc: number, v: number) {
    if (channelCc(this.ch, cc, v)) return;
    const s = this.synth;
    if (cc === LOCAL_CC.cutoff) s.set({ filterEnvelope: { baseFrequency: expRange(v, 60, 6000) } });
    else if (cc === LOCAL_CC.resonance) s.set({ filter: { Q: 0.5 + norm(v) * 14 } });
    else if (cc === LOCAL_CC.envMod) s.set({ filterEnvelope: { octaves: norm(v) * 6 } });
    else if (cc === LOCAL_CC.attack) s.set({ envelope: { attack: expRange(v, 0.002, 2) }, filterEnvelope: { attack: expRange(v, 0.002, 2) } });
    else if (cc === LOCAL_CC.decay) s.set({ envelope: { decay: expRange(v, 0.03, 2) }, filterEnvelope: { decay: expRange(v, 0.03, 2) } });
    else if (cc === LOCAL_CC.release) s.set({ envelope: { release: expRange(v, 0.02, 4) } });
    else if (cc === LOCAL_CC.waveform) s.set({ oscillator: { type: v < 43 ? 'sawtooth' : v < 86 ? 'square' : 'triangle' } });
  }
}

/**
 * 303-style mono bass. Overlapping notes slide without retriggering;
 * velocity ≥ 100 is an accent (louder, brighter, snappier).
 */
class AcidBass implements Instrument {
  private osc: ToneNS.Oscillator;
  private filter: ToneNS.Filter;
  private vca: ToneNS.Gain;
  private drive: ToneNS.Distortion;
  /** Notes by their start/end time, to know whether a new note overlaps (slides). */
  private notes: { note: number; on: number; off?: number }[] = [];
  private cutoff = 380;
  private envMod = 3;
  private decay = 0.35;
  private accent = 0.7;
  private current = 36;

  constructor(
    T: typeof ToneNS,
    private ch: Channel,
  ) {
    this.osc = new T.Oscillator({ type: 'sawtooth', frequency: midiHz(36) }).start();
    this.filter = new T.Filter({ type: 'lowpass', rolloff: -24, Q: 8, frequency: this.cutoff });
    this.vca = new T.Gain(0);
    this.drive = new T.Distortion({ distortion: 0.3, wet: 0.25 });
    const level = new T.Gain(0.22);
    this.osc.chain(this.filter, this.vca, this.drive, level, ch.out);
  }

  noteOn(note: number, velocity: number, time: number) {
    const sliding = this.notes.some((n) => n.on < time - 0.001 && (n.off === undefined || n.off > time + 0.001));
    this.notes = this.notes.filter((n) => n.off === undefined || n.off > time - 2);
    this.notes.push({ note, on: time });
    const accented = velocity >= 100;
    const freq = this.osc.frequency;
    const gain = this.vca.gain;
    const level = accented ? 1 : 0.62;
    // Drop any release already planned for the previous note.
    gain.cancelScheduledValues(time);
    if (sliding) {
      freq.cancelScheduledValues(time);
      freq.setTargetAtTime(midiHz(note), time, 0.022);
      gain.setTargetAtTime(level, time, 0.01);
    } else {
      freq.cancelScheduledValues(time);
      freq.setValueAtTime(midiHz(note), time);
      gain.setTargetAtTime(level, time, 0.002);
      const f = this.filter.frequency;
      const amount = this.envMod * (accented ? 1 + this.accent : 1);
      const peak = Math.min(16000, this.cutoff * Math.pow(2, amount));
      f.cancelScheduledValues(time);
      f.setValueAtTime(peak, time);
      f.setTargetAtTime(this.cutoff, time + 0.002, (accented ? this.decay * 0.5 : this.decay) / 3);
    }
    this.current = note;
  }

  noteOff(note: number, time: number) {
    const open = this.notes.find((n) => n.note === note && n.off === undefined);
    if (open) open.off = time;
    const stillHeld = this.notes.filter((n) => n !== open && n.on <= time && (n.off === undefined || n.off > time));
    if (stillHeld.length === 0) this.vca.gain.setTargetAtTime(0, time, 0.008);
    else if (note === this.current) {
      const back = stillHeld[stillHeld.length - 1]!.note;
      this.osc.frequency.setTargetAtTime(midiHz(back), time, 0.022);
      this.current = back;
    }
  }

  allOff(time: number) {
    this.notes = [];
    this.vca.gain.cancelScheduledValues(time);
    this.vca.gain.setTargetAtTime(0, time, 0.01);
  }

  cc(cc: number, v: number) {
    if (channelCc(this.ch, cc, v)) return;
    if (cc === LOCAL_CC.cutoff) {
      this.cutoff = expRange(v, 60, 3000);
      this.filter.frequency.setTargetAtTime(this.cutoff, this.filter.context.currentTime, 0.02);
    } else if (cc === LOCAL_CC.resonance) this.filter.Q.rampTo(0.7 + norm(v) * 24, 0.02);
    else if (cc === LOCAL_CC.envMod) this.envMod = norm(v) * 5;
    else if (cc === LOCAL_CC.decay) this.decay = expRange(v, 0.06, 2);
    else if (cc === LOCAL_CC.accent) this.accent = norm(v) * 1.2;
    else if (cc === LOCAL_CC.drive) {
      this.drive.distortion = 0.1 + norm(v) * 0.8;
      this.drive.wet.rampTo(norm(v), 0.02);
    } else if (cc === LOCAL_CC.waveform) this.osc.type = v < 64 ? 'sawtooth' : 'square';
  }
}

/** Wide detuned-saw pad with chorus. */
class PadSynth implements Instrument {
  private synth: ToneNS.PolySynth<ToneNS.Synth>;
  private filter: ToneNS.Filter;

  constructor(
    T: typeof ToneNS,
    private ch: Channel,
  ) {
    this.filter = new T.Filter({ type: 'lowpass', frequency: 1800, Q: 1, rolloff: -12 });
    const chorus = new T.Chorus({ frequency: 0.6, delayTime: 4, depth: 0.6, wet: 0.5 }).start();
    this.synth = new T.PolySynth(T.Synth, {
      oscillator: { type: 'fatsawtooth', count: 3, spread: 28 },
      envelope: { attack: 0.7, decay: 0.5, sustain: 0.8, release: 1.8 },
      volume: -12,
    });
    this.synth.maxPolyphony = 12;
    this.synth.chain(this.filter, chorus, ch.out);
  }

  noteOn(note: number, velocity: number, time: number) {
    this.synth.triggerAttack(midiHz(note), time, 0.4 + norm(velocity) * 0.6);
  }
  noteOff(note: number, time: number) {
    this.synth.triggerRelease(midiHz(note), time);
  }
  allOff() {
    this.synth.releaseAll();
  }
  cc(cc: number, v: number) {
    if (channelCc(this.ch, cc, v)) return;
    if (cc === LOCAL_CC.cutoff) this.filter.frequency.rampTo(expRange(v, 150, 12000), 0.03);
    else if (cc === LOCAL_CC.resonance) this.filter.Q.rampTo(0.5 + norm(v) * 10, 0.03);
    else if (cc === LOCAL_CC.attack) this.synth.set({ envelope: { attack: expRange(v, 0.005, 5) } });
    else if (cc === LOCAL_CC.release) this.synth.set({ envelope: { release: expRange(v, 0.05, 8) } });
  }
}

/** 808/909-flavoured kit on the GM drum notes (as used by the TR-8S). */
class DrumKit implements Instrument {
  private kick: ToneNS.MembraneSynth;
  private toms: ToneNS.MembraneSynth;
  private snareBody: ToneNS.MembraneSynth;
  private snare: ToneNS.NoiseSynth;
  private clap: ToneNS.NoiseSynth;
  private rim: ToneNS.Synth;
  private closedHat: ToneNS.MetalSynth;
  private openHat: ToneNS.MetalSynth;
  private cymbal: ToneNS.MetalSynth;
  private hatFilter: ToneNS.Filter;
  private kickDecay = 0.45;

  constructor(
    T: typeof ToneNS,
    private ch: Channel,
  ) {
    const out = ch.out;
    this.kick = new T.MembraneSynth({
      pitchDecay: 0.045,
      octaves: 6,
      envelope: { attack: 0.001, decay: this.kickDecay, sustain: 0, release: 0.05 },
      volume: -2,
    }).connect(out);
    this.toms = new T.MembraneSynth({
      pitchDecay: 0.03,
      octaves: 2.2,
      envelope: { attack: 0.001, decay: 0.32, sustain: 0, release: 0.05 },
      volume: -8,
    }).connect(out);
    this.snareBody = new T.MembraneSynth({
      pitchDecay: 0.02,
      octaves: 1.5,
      envelope: { attack: 0.001, decay: 0.09, sustain: 0, release: 0.02 },
      volume: -12,
    }).connect(out);
    const snareHp = new T.Filter({ type: 'highpass', frequency: 1400 }).connect(out);
    this.snare = new T.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.17, sustain: 0 }, volume: -10 }).connect(snareHp);
    const clapBp = new T.Filter({ type: 'bandpass', frequency: 1150, Q: 1.2 }).connect(out);
    this.clap = new T.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.12, sustain: 0 }, volume: -4 }).connect(clapBp);
    this.rim = new T.Synth({ oscillator: { type: 'triangle' }, envelope: { attack: 0.001, decay: 0.035, sustain: 0, release: 0.01 }, volume: -10 }).connect(out);
    this.hatFilter = new T.Filter({ type: 'highpass', frequency: 7000 }).connect(out);
    const metal = (decay: number, volume: number) =>
      new T.MetalSynth({
        envelope: { attack: 0.001, decay, sustain: 0, release: 0.04 },
        harmonicity: 5.1,
        modulationIndex: 32,
        resonance: 5000,
        octaves: 1.5,
        volume,
      }).connect(this.hatFilter);
    this.closedHat = metal(0.05, -20);
    this.openHat = metal(0.45, -22);
    this.cymbal = metal(1.4, -26);
  }

  noteOn(note: number, velocity: number, time: number) {
    const v = norm(velocity);
    switch (note) {
      case 35:
      case 36:
        this.kick.triggerAttackRelease(46, this.kickDecay, time, v);
        break;
      case 37:
        this.rim.triggerAttackRelease(1700, 0.03, time, v);
        break;
      case 38:
      case 40:
        this.snare.triggerAttackRelease(0.17, time, v);
        this.snareBody.triggerAttackRelease(185, 0.09, time, v);
        break;
      case 39:
        // A clap is a few quick bursts and a tail.
        [0, 0.011, 0.023].forEach((d) => this.clap.triggerAttackRelease(0.008, time + d, v * 0.8));
        this.clap.triggerAttackRelease(0.12, time + 0.034, v);
        break;
      case 42:
      case 44:
        this.openHat.triggerRelease(time); // closed hat chokes the open one
        this.closedHat.triggerAttackRelease(250, 0.05, time, v);
        break;
      case 46:
        this.openHat.triggerAttackRelease(250, 0.45, time, v);
        break;
      case 49:
      case 57:
      case 52:
      case 55:
        this.cymbal.triggerAttackRelease(300, 1.4, time, v);
        break;
      case 51:
      case 59:
      case 53:
        this.cymbal.triggerAttackRelease(180, 0.8, time, v * 0.7);
        break;
      default: {
        // Toms (41..50) and anything else: a pitched tom.
        const pitch = note >= 41 && note <= 50 ? 70 * Math.pow(2, (note - 41) / 9) : midiHz(note);
        this.toms.triggerAttackRelease(pitch, 0.3, time, v);
      }
    }
  }
  noteOff() {
    /* one-shots */
  }
  allOff() {
    /* one-shots ring out */
  }
  cc(cc: number, v: number) {
    if (channelCc(this.ch, cc, v)) return;
    if (cc === LOCAL_CC.cutoff) this.hatFilter.frequency.rampTo(expRange(v, 2500, 12000), 0.03);
    else if (cc === LOCAL_CC.decay) {
      this.kickDecay = expRange(v, 0.12, 1.4);
      this.kick.envelope.decay = this.kickDecay;
    }
  }
}

const audio = new LocalAudio();

/** A local instrument as a MIDI output port; MIDI channel is ignored. */
class LocalSynthPort implements MidiOutputPort {
  readonly id: string;

  constructor(
    readonly name: string,
    private readonly kind: LocalKind,
  ) {
    this.id = `local:${kind}`;
  }

  send(data: readonly number[], timestamp?: number): void {
    const instrument = audio.instrument(this.kind);
    if (!instrument) {
      // Not loaded yet (no click so far); load now, these notes are skipped.
      void audio.wake();
      return;
    }
    const status = data[0]!;
    if (status >= 0xf0) return; // clock, start/stop
    const type = status & 0xf0;
    const time = audio.toAudioTime(timestamp);
    if (type === 0x90 && data[2]! > 0) instrument.noteOn(data[1]!, data[2]!, time);
    else if (type === 0x80 || type === 0x90) instrument.noteOff(data[1]!, time);
    else if (type === 0xb0) {
      const [cc, value] = [data[1]!, data[2]!];
      if (cc === LOCAL_CC.allNotesOff || cc === LOCAL_CC.allSoundOff) return instrument.allOff(time);
      // Knob values apply when the engine meant them to, not when they were queued.
      const wait = timestamp === undefined ? 0 : timestamp - performance.now();
      if (wait > 4) setTimeout(() => instrument.cc(cc, value), wait);
      else instrument.cc(cc, value);
    }
  }
}

export const LOCAL_SYNTH_PORTS: MidiOutputPort[] = (Object.keys(LOCAL_PORTS) as LocalKind[]).map(
  (k) => new LocalSynthPort(LOCAL_PORTS[k], k),
);

/** Load Tone.js and resume audio; call from a user click (play, test). */
export function wakeLocalAudio(): Promise<void> {
  return audio.wake();
}
