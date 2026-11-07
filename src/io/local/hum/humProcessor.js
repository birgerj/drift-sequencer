/*
 * Drift Synth Hum: a sung / hummed voice in one AudioWorkletProcessor.
 *
 * Formant synthesis, written from scratch for Drift: per voice a band-limited
 * glottal source (PolyBLEP saw with a spectral tilt), breath noise, and four
 * parallel band-pass formant filters (TPT state-variable). Each note sings a
 * syllable: an onset consonant (glide, nasal, voiced or voiceless stop with
 * its burst and aspiration), a vowel that may glide into a second vowel
 * (diphthong), and an optional closing consonant on note off ("dum").
 * Vibrato with delay, a scoop into each note, slow pitch drift and per-note
 * variation make it sound sung rather than played. A stereo ensemble chorus
 * on the sum turns chords into a small choir.
 *
 * Plain JavaScript on purpose: the app loads this file as text (?raw) into a
 * Blob URL, so it also works in the single-file build. No allocations in
 * process(). Tests evaluate the same source (see tests/hum.test.ts).
 *
 * Messages (port): [0, note, velocity 0..1, time] note on,
 * [1, note, 0, time] note off, [2, name, value] parameter (real units, see
 * humParams.ts), [3, 0, 0, time] all notes off. Times are AudioContext
 * seconds; notes start on the exact frame.
 */

const VOICES = 8;
/** Formants, pitch and articulation are recomputed every CTRL samples. */
const CTRL = 16;
const QUEUE = 1024;
const MAX_BLOCK = 128;
const ENS_SIZE = 4096;
const OUT_GAIN = 0.55;
const NF = 4;

/**
 * Formant targets: [F1..F4 Hz, bandwidths Hz, levels dB]. An adult alto
 * voice; the Voice knob scales the frequencies.
 */
const SHAPES_DB = {
  a: [800, 1150, 2800, 3500, 80, 90, 120, 130, 0, -4, -20, -36],
  e: [550, 1800, 2550, 3500, 70, 90, 110, 130, 0, -10, -18, -30],
  i: [280, 2250, 2900, 3700, 50, 100, 120, 150, 0, -16, -18, -30],
  o: [450, 800, 2830, 3500, 70, 80, 100, 130, 0, -9, -16, -28],
  u: [325, 700, 2530, 3500, 50, 60, 170, 180, 0, -12, -30, -40],
  uh: [620, 1200, 2550, 3500, 80, 90, 110, 130, 0, -6, -22, -34],
  m: [250, 1100, 2350, 3300, 60, 150, 200, 250, 0, -28, -38, -46],
  n: [250, 1700, 2600, 3400, 60, 150, 200, 250, 0, -26, -34, -44],
  l: [360, 1300, 2700, 3400, 60, 100, 140, 160, -3, -14, -26, -34],
  j: [280, 2250, 3000, 3700, 50, 90, 120, 150, -2, -14, -18, -30],
  // Where the formants start after a lip or tongue-tip closure (loci).
  lab: [300, 900, 2300, 3300, 70, 90, 120, 140, -6, -12, -26, -36],
  alv: [300, 1700, 2600, 3500, 70, 90, 120, 140, -6, -12, -24, -34],
};
const SHAPE_NAMES = Object.keys(SHAPES_DB);
/**
 * How loud a shape sounds: each formant passes about level² · bandwidth
 * (the source is evened out per formant, see FLAT).
 */
function loudness(s) {
  let e = 0;
  for (let k = 0; k < 4; k++) e += Math.pow(10, s[8 + k] / 10) * s[4 + k];
  return e;
}
/**
 * The saw's harmonics fall 1/f; each formant's gain rises with its
 * frequency so the levels above are the levels you hear.
 */
const FLAT = 1 / 500;
const REF = loudness(SHAPES_DB.a);
/**
 * Same shapes with linear levels, as Float64Arrays indexed like SHAPE_NAMES.
 * Vowels are evened out so "ee" isn't louder than "aa"; nasals and loci keep
 * some of their natural drop.
 */
const SHAPES = SHAPE_NAMES.map((k) => {
  const s = SHAPES_DB[k];
  const vowel = k.length <= 2 && k !== 'm' && k !== 'n' && k !== 'l' && k !== 'j';
  const trim = Math.pow(REF / loudness(s), vowel ? 0.62 : 0.4);
  const out = new Float64Array(12);
  for (let i = 0; i < 8; i++) out[i] = s[i];
  for (let i = 8; i < 12; i++) out[i] = Math.pow(10, s[i] / 20) * trim;
  return out;
});
const S = (name) => SHAPE_NAMES.indexOf(name);
const J = S('j');

/** Onset kinds. */
const NONE = 0;
const GLIDE = 1;
const NASAL = 2;
const VOICED = 3;
const VOICELESS = 4;

/**
 * Syllables in switch order (HUM_SYLLABLES in humParams.ts):
 * [onset kind, onset shape, vowel, second vowel or -1, closing shape or -1, burst Hz].
 */
const SYLLABLES = [
  [GLIDE, S('l'), S('a'), -1, -1, 0], // Laa
  [VOICED, S('alv'), S('u'), -1, -1, 3800], // Doo
  [VOICED, S('alv'), S('a'), -1, -1, 3800], // Daa
  [VOICED, S('alv'), S('i'), -1, -1, 4200], // Dee
  [VOICELESS, S('lab'), S('a'), -1, -1, 1300], // Paa
  [VOICELESS, S('lab'), S('i'), -1, -1, 1500], // Pee
  [VOICED, S('lab'), S('a'), -1, -1, 1200], // Bah
  [GLIDE, S('j'), S('e'), S('i'), -1, 0], // Yay ("jee")
  [NASAL, S('m'), S('a'), -1, -1, 0], // Mah
  [NASAL, S('n'), S('a'), -1, -1, 0], // Nah
  [NONE, -1, S('m'), -1, -1, 0], // Mmm
  [NONE, -1, S('u'), -1, -1, 0], // Ooh
  [NONE, -1, S('a'), -1, -1, 0], // Aah
  [VOICED, S('alv'), S('uh'), -1, S('m'), 3800], // Dum
];
/** Pick-per-note modes after the syllables: Scat, Cycle, Random. */
const SCAT = [1, 2, 3, 6, 13, 4, 1, 2];
const CYCLE = [4, 1, 3, 5, 7]; // pa doo dee pee yay
const MODE_SCAT = SYLLABLES.length;
const MODE_CYCLE = MODE_SCAT + 1;
const MODE_RANDOM = MODE_SCAT + 2;

/** Who plays which note. Same assigner as the Juno; kept separate so it can be tested on its own. */
class VoiceAllocator {
  constructor(n) {
    this.n = n;
    this.note = new Int16Array(n).fill(-1);
    this.gate = new Uint8Array(n);
    /** Set by the engine: 1 while the voice makes sound (incl. release). */
    this.sounding = new Uint8Array(n);
    this.stamp = new Float64Array(n);
    this.clock = 0;
    this.next = 0;
  }

  noteOn(note) {
    const n = this.n;
    let pick = -1;
    for (let i = 0; i < n; i++) {
      if (this.note[i] === note && (this.gate[i] || this.sounding[i])) {
        pick = i;
        break;
      }
    }
    if (pick < 0) {
      for (let j = 0; j < n; j++) {
        const i = (this.next + j) % n;
        if (!this.gate[i] && !this.sounding[i]) {
          pick = i;
          break;
        }
      }
    }
    if (pick < 0) pick = this.oldest(0);
    if (pick < 0) pick = this.oldest(1);
    this.note[pick] = note;
    this.gate[pick] = 1;
    this.sounding[pick] = 1;
    this.stamp[pick] = ++this.clock;
    this.next = (pick + 1) % n;
    return pick;
  }

  noteOff(note) {
    for (let i = 0; i < this.n; i++) {
      if (this.gate[i] && this.note[i] === note) {
        this.gate[i] = 0;
        this.stamp[i] = ++this.clock;
        return i;
      }
    }
    return -1;
  }

  releaseAll() {
    for (let i = 0; i < this.n; i++) {
      if (this.gate[i]) this.stamp[i] = ++this.clock;
      this.gate[i] = 0;
    }
  }

  oldest(gate) {
    let pick = -1;
    let best = Infinity;
    for (let i = 0; i < this.n; i++) {
      if (this.gate[i] === gate && this.stamp[i] < best) {
        best = this.stamp[i];
        pick = i;
      }
    }
    return pick;
  }
}

/** PolyBLEP residual for a step at phase 0, t in [0,1), dt = phase increment. */
function blep(t, dt) {
  if (t < dt) {
    t /= dt;
    return t + t - t * t - 1;
  }
  if (t > 1 - dt) {
    t = (t - 1) / dt;
    return t * t + t + t + 1;
  }
  return 0;
}

/** 0..1 ease in and out. */
function smooth(x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return x * x * (3 - 2 * x);
}

class HumEngine {
  constructor(sr) {
    this.sr = sr;
    this.alloc = new VoiceAllocator(VOICES);
    const n = VOICES;
    this.syl = new Int8Array(n);
    this.vel = new Float64Array(n);
    this.env = new Float64Array(n);
    /** 0 idle, 1 attack, 2 hold, 3 release. */
    this.stage = new Uint8Array(n);
    this.t = new Float64Array(n); // s since note on
    this.rt = new Float64Array(n); // s since note off
    this.phase = new Float64Array(n);
    this.tilt = new Float64Array(n);
    this.vg = new Float64Array(n); // voicing, smoothed
    this.asp = new Float64Array(n); // aspiration, smoothed
    this.bst = new Float64Array(n); // burst, smoothed
    this.bs1 = new Float64Array(n);
    this.bs2 = new Float64Array(n);
    this.bG = new Float64Array(n);
    this.vibPhase = new Float64Array(n);
    this.vibRate = new Float64Array(n);
    this.scoopAmt = new Float64Array(n);
    this.drift = new Float64Array(n);
    this.fmtVar = new Float64Array(n);
    /** Per voice and formant: current frequency, bandwidth, level, and filter state. */
    this.cf = new Float64Array(n * NF);
    this.cb = new Float64Array(n * NF);
    this.ca = new Float64Array(n * NF);
    this.s1 = new Float64Array(n * NF);
    this.s2 = new Float64Array(n * NF);
    this.fresh = new Uint8Array(n);
    // Scratch for one control block.
    this.tf = new Float64Array(NF);
    this.tb = new Float64Array(NF);
    this.ta = new Float64Array(NF);
    this.ka = new Float64Array(NF);
    this.a1 = new Float64Array(NF);
    this.a2 = new Float64Array(NF);
    this.a3 = new Float64Array(NF);
    this.gate = new Float64Array(3);
    this.mix = new Float32Array(MAX_BLOCK);
    this.noise = new Float32Array(MAX_BLOCK);
    this.seed = 12345;
    this.rand = 98765;
    this.cycle = 0;
    this.ensBuf = new Float32Array(ENS_SIZE);
    this.ensPos = 0;
    this.ensPhase = 0;
    this.tiltCoef = 1 - Math.exp((-2 * Math.PI * 320) / sr);
    // Real-unit parameters; humSynth.ts sends its defaults on start.
    this.p = {
      syllable: 0,
      voice: 1,
      brightness: 0.55,
      focus: 1,
      breath: 0.1,
      articulation: 0.6,
      vibDepth: 0.15,
      vibRate: 5.2,
      vibDelay: 0.2,
      scoop: 0.25,
      humanize: 0.4,
      attack: 0.03,
      release: 0.3,
      ensemble: 0.3,
    };
    this.updateEnvelope();
  }

  /** Sets a parameter in real units; false if the name is unknown. */
  set(name, value) {
    if (!Object.prototype.hasOwnProperty.call(this.p, name) || typeof value !== 'number' || !isFinite(value)) return false;
    this.p[name] = value;
    if (name === 'attack' || name === 'release') this.updateEnvelope();
    return true;
  }

  updateEnvelope() {
    this.atkInc = 1 / Math.max(1, this.p.attack * this.sr);
    this.relCoef = Math.exp(-4.6 / Math.max(1, this.p.release * this.sr));
  }

  /** 0..1 from the engine's own random stream (not Math.random, so tests repeat). */
  random() {
    let r = this.rand;
    r ^= r << 13;
    r ^= r >>> 17;
    r ^= r << 5;
    this.rand = r;
    return (r >>> 0) / 4294967296;
  }

  /** The syllable index a new note sings, resolving Scat / Cycle / Random. */
  pickSyllable() {
    const s = Math.round(this.p.syllable);
    if (s === MODE_SCAT) return SCAT[Math.floor(this.random() * SCAT.length)];
    if (s === MODE_CYCLE) return CYCLE[this.cycle++ % CYCLE.length];
    if (s >= MODE_RANDOM) return Math.floor(this.random() * SYLLABLES.length);
    return s < 0 ? 0 : s;
  }

  noteOn(note, velocity) {
    const v = this.alloc.noteOn(note);
    const h = this.p.humanize;
    if (this.stage[v] === 0) {
      this.env[v] = 0;
      this.phase[v] = this.random();
      this.tilt[v] = 0;
      this.vg[v] = this.asp[v] = this.bst[v] = 0;
      this.bs1[v] = this.bs2[v] = 0;
      for (let k = 0; k < NF; k++) this.s1[v * NF + k] = this.s2[v * NF + k] = 0;
      this.fresh[v] = 1;
      this.drift[v] = 0;
    }
    const syl = this.pickSyllable();
    this.syl[v] = syl;
    this.vel[v] = 0.5 + 0.5 * Math.max(0, Math.min(1, velocity));
    this.stage[v] = 1;
    this.t[v] = 0;
    this.rt[v] = 0;
    this.vibPhase[v] = this.random();
    this.vibRate[v] = 1 + (this.random() - 0.5) * 0.16 * (0.3 + h);
    this.scoopAmt[v] = 0.55 + 0.45 * this.random();
    this.fmtVar[v] = 1 + (this.random() - 0.5) * 0.07 * h;
    const hz = SYLLABLES[syl][5] * this.p.voice;
    this.bG[v] = hz > 0 ? Math.tan((Math.PI * Math.min(hz, 0.45 * this.sr)) / this.sr) : 0;
    return v;
  }

  noteOff(note) {
    const v = this.alloc.noteOff(note);
    if (v >= 0) {
      this.stage[v] = 3;
      this.rt[v] = 0;
    }
  }

  allOff() {
    this.alloc.releaseAll();
    for (let v = 0; v < VOICES; v++) if (this.stage[v] !== 0) this.stage[v] = 3;
  }

  /** Blends shape `a` toward shape `b` by x into the target scratch (b < 0: keep a). */
  shapeInto(a, b, x) {
    const A = SHAPES[a];
    const tf = this.tf;
    const tb = this.tb;
    const ta = this.ta;
    if (b < 0 || x <= 0) {
      for (let k = 0; k < NF; k++) {
        tf[k] = A[k];
        tb[k] = A[4 + k];
        ta[k] = A[8 + k];
      }
      return;
    }
    const B = SHAPES[b];
    for (let k = 0; k < NF; k++) {
      tf[k] = A[k] + (B[k] - A[k]) * x;
      tb[k] = A[4 + k] + (B[4 + k] - A[4 + k]) * x;
      ta[k] = A[8 + k] + (B[8 + k] - A[8 + k]) * x;
    }
  }

  /** Blends the current target toward shape `b` by x (in place). */
  shapeToward(b, x) {
    if (x <= 0) return;
    const B = SHAPES[b];
    for (let k = 0; k < NF; k++) {
      this.tf[k] += (B[k] - this.tf[k]) * x;
      this.tb[k] += (B[4 + k] - this.tb[k]) * x;
      this.ta[k] += (B[8 + k] - this.ta[k]) * x;
    }
  }

  /**
   * Articulation of voice v at its time: sets the formant targets and
   * this.gate = [voicing, aspiration, burst] (0..1).
   */
  articulate(v) {
    const syl = SYLLABLES[this.syl[v]];
    const kind = syl[0];
    const art = this.p.articulation;
    const sc = 0.5 + art; // consonants get longer as articulation rises
    const t = this.t[v];
    let voicing = 1;
    let asp = 0;
    let burst = 0;

    // Vowel, gliding into its second vowel after the onset.
    let start = 0; // when the vowel's own glide may begin
    if (kind === GLIDE) start = (syl[1] === J ? 0.1 : 0.07) * sc;
    else if (kind === NASAL) start = 0.11 * sc;
    else if (kind === VOICED) start = 0.057 * sc;
    else if (kind === VOICELESS) start = 0.078 * sc;
    this.shapeInto(syl[2], syl[3], syl[3] >= 0 ? smooth((t - start - 0.05) / 0.22) : 0);

    if (kind === GLIDE) {
      const g = (syl[1] === J ? 0.1 : 0.07) * sc;
      const x = smooth(t / g);
      this.blendFrom(syl[1], x);
      voicing = 1 - 0.45 * art * (1 - x);
    } else if (kind === NASAL) {
      const m = 0.06 * sc;
      const x = smooth((t - m) / (0.05 * sc));
      this.blendFrom(syl[1], x);
      voicing = 0.7 + 0.3 * x;
    } else if (kind === VOICED) {
      const c = 0.012 * sc;
      if (t < c) voicing = 1 - 0.96 * art;
      else {
        voicing = 0.3 + 0.7 * smooth((t - c) / 0.008);
        if (t < c + 0.006) burst = 0.7 * art;
      }
      this.blendFrom(syl[1], smooth((t - c) / (0.045 * sc)));
    } else if (kind === VOICELESS) {
      const c = 0.018 * sc;
      const vot = 0.035 * sc * (0.3 + 0.7 * art);
      if (t < c) voicing = 1 - art;
      else if (t < c + vot) {
        voicing = 1 - art;
        asp = 0.9 * art;
        if (t < c + 0.008) burst = art;
      } else voicing = 0.3 + 0.7 * smooth((t - c - vot) / 0.01);
      this.blendFrom(syl[1], smooth((t - c) / (0.06 * sc)));
    }

    // Closing consonant on note off ("dum").
    if (syl[4] >= 0 && this.stage[v] === 3) this.shapeToward(syl[4], smooth(this.rt[v] / 0.07));
    const g = this.gate;
    g[0] = voicing < 0 ? 0 : voicing;
    g[1] = asp;
    g[2] = burst;
  }

  /** While an onset plays, the targets start at shape `from` and reach the vowel at x = 1. */
  blendFrom(from, x) {
    if (x >= 1) return;
    const A = SHAPES[from];
    const y = 1 - x;
    for (let k = 0; k < NF; k++) {
      this.tf[k] += (A[k] - this.tf[k]) * y;
      this.tb[k] += (A[4 + k] - this.tb[k]) * y;
      this.ta[k] += (A[8 + k] - this.ta[k]) * y;
    }
  }

  /** Renders frames [start, end) into outL/outR (outR may equal outL for mono). */
  render(outL, outR, start, end) {
    let pos = start;
    while (pos < end) {
      const n = Math.min(CTRL, end - pos);
      this.renderChunk(outL, outR, pos, n);
      pos += n;
    }
  }

  renderChunk(outL, outR, off, n) {
    const p = this.p;
    const sr = this.sr;
    const mix = this.mix;
    const noise = this.noise;
    const dt = n / sr;

    let seed = this.seed;
    for (let i = 0; i < n; i++) {
      mix[i] = 0;
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      noise[i] = (seed | 0) / 2147483648;
    }
    this.seed = seed;

    const alloc = this.alloc;
    const nyq = 0.45 * sr;
    const tf = this.tf;
    const tb = this.tb;
    const ta = this.ta;
    const ka = this.ka;
    const a1 = this.a1;
    const a2 = this.a2;
    const a3 = this.a3;
    const gate = this.gate;
    const atkInc = this.atkInc;
    const relCoef = this.relCoef;
    const tiltCoef = this.tiltCoef;
    const breath = p.breath;
    const scale = p.voice;

    for (let v = 0; v < VOICES; v++) {
      let stage = this.stage[v];
      if (stage === 0) continue;
      const t = this.t[v];

      // Pitch: scoop into the note, delayed vibrato, slow drift.
      let semis = alloc.note[v] - 69;
      semis -= p.scoop * this.scoopAmt[v] * Math.exp(-t / 0.07);
      let vp = this.vibPhase[v] + p.vibRate * this.vibRate[v] * dt;
      vp -= Math.floor(vp);
      this.vibPhase[v] = vp;
      const vibIn = p.vibDelay <= 0.001 ? 1 : smooth((t - p.vibDelay * 0.5) / (p.vibDelay + 0.15));
      semis += p.vibDepth * vibIn * Math.sin(2 * Math.PI * vp);
      let d = this.drift[v] * 0.995 + (this.random() - 0.5) * 0.02 * p.humanize;
      this.drift[v] = d;
      semis += d;
      const f0 = 440 * Math.pow(2, semis / 12);
      const inc = Math.min(0.45, f0 / sr);

      // Formant targets for this moment of the syllable.
      this.articulate(v);
      const fv = scale * this.fmtVar[v];
      const base = v * NF;
      const fresh = this.fresh[v] === 1;
      for (let k = 0; k < NF; k++) {
        let f = tf[k] * fv;
        const level = ta[k] * Math.min(f, nyq) * FLAT;
        // Singers open F1 up to the sung pitch on high notes (without getting louder).
        if (k === 0 && f < f0 * 1.05) f = f0 * 1.05;
        if (f > nyq) f = nyq;
        let bw = tb[k] * p.focus;
        if (bw < 0.3 * f0) bw = 0.3 * f0;
        const j = base + k;
        if (fresh) {
          this.cf[j] = f;
          this.cb[j] = bw;
          this.ca[j] = level;
        } else {
          this.cf[j] += (f - this.cf[j]) * 0.5;
          this.cb[j] += (bw - this.cb[j]) * 0.5;
          this.ca[j] += (level - this.ca[j]) * 0.5;
        }
        const fc = this.cf[j];
        const g = Math.tan((Math.PI * fc) / sr);
        const kk = this.cb[j] / fc;
        const A1 = 1 / (1 + g * (g + kk));
        a1[k] = A1;
        a2[k] = g * A1;
        a3[k] = g * g * A1;
        ka[k] = kk * this.ca[j];
      }
      this.fresh[v] = 0;

      const gVoice = gate[0];
      const gAsp = gate[1];
      const gBurst = gate[2];
      let vg = this.vg[v];
      let as = this.asp[v];
      let bs = this.bst[v];
      let env = this.env[v];
      let ph = this.phase[v];
      let lp = this.tilt[v];
      const vel = this.vel[v];
      const bright = Math.min(1, p.brightness * (0.75 + 0.35 * vel));
      const bG = this.bG[v];
      const bA1 = 1 / (1 + bG * (bG + 0.7));
      const bA2 = bG * bA1;
      const bA3 = bG * bA2;
      let b1 = this.bs1[v];
      let b2 = this.bs2[v];
      let f1a = this.s1[base];
      let f1b = this.s2[base];
      let f2a = this.s1[base + 1];
      let f2b = this.s2[base + 1];
      let f3a = this.s1[base + 2];
      let f3b = this.s2[base + 2];
      let f4a = this.s1[base + 3];
      let f4b = this.s2[base + 3];

      for (let i = 0; i < n; i++) {
        vg += (gVoice - vg) * 0.03;
        as += (gAsp - as) * 0.08;
        bs += (gBurst - bs) * 0.25;

        // Glottal source: band-limited saw, softened by the tilt.
        ph += inc;
        if (ph >= 1) ph -= 1;
        const saw = 2 * ph - 1 - blep(ph, inc);
        lp += tiltCoef * (saw - lp);
        const src = lp + bright * (saw - lp);
        const nz = noise[i];
        const puff = nz * (0.55 + (ph < 0.4 ? 0.45 : 0));
        const x = src * vg + puff * (breath * 0.4 * vg + as * 0.7);

        // Four formants in parallel (TPT state-variable band-passes).
        let v3 = x - f1b;
        let v1 = a1[0] * f1a + a2[0] * v3;
        let v2 = f1b + a2[0] * f1a + a3[0] * v3;
        f1a = 2 * v1 - f1a;
        f1b = 2 * v2 - f1b;
        let y = ka[0] * v1;
        v3 = x - f2b;
        v1 = a1[1] * f2a + a2[1] * v3;
        v2 = f2b + a2[1] * f2a + a3[1] * v3;
        f2a = 2 * v1 - f2a;
        f2b = 2 * v2 - f2b;
        y += ka[1] * v1;
        v3 = x - f3b;
        v1 = a1[2] * f3a + a2[2] * v3;
        v2 = f3b + a2[2] * f3a + a3[2] * v3;
        f3a = 2 * v1 - f3a;
        f3b = 2 * v2 - f3b;
        y += ka[2] * v1;
        v3 = x - f4b;
        v1 = a1[3] * f4a + a2[3] * v3;
        v2 = f4b + a2[3] * f4a + a3[3] * v3;
        f4a = 2 * v1 - f4a;
        f4b = 2 * v2 - f4b;
        y += ka[3] * v1;

        // Stop burst: a short noise click at the place of the closure.
        if (bG > 0) {
          const bx = nz * bs;
          const w3 = bx - b2;
          const w1 = bA1 * b1 + bA2 * w3;
          const w2 = b2 + bA2 * b1 + bA3 * w3;
          b1 = 2 * w1 - b1;
          b2 = 2 * w2 - b2;
          y += 0.7 * w1;
        }

        // Envelope.
        if (stage === 1) {
          env += atkInc;
          if (env >= 1) {
            env = 1;
            stage = 2;
          }
        } else if (stage === 3) {
          env *= relCoef;
          if (env < 0.0001) {
            stage = 0;
            env = 0;
            break;
          }
        }
        mix[i] += y * env * vel;
      }

      this.vg[v] = vg;
      this.asp[v] = as;
      this.bst[v] = bs;
      this.env[v] = env;
      this.phase[v] = ph;
      this.tilt[v] = lp;
      this.bs1[v] = b1;
      this.bs2[v] = b2;
      this.s1[base] = f1a;
      this.s2[base] = f1b;
      this.s1[base + 1] = f2a;
      this.s2[base + 1] = f2b;
      this.s1[base + 2] = f3a;
      this.s2[base + 2] = f3b;
      this.s1[base + 3] = f4a;
      this.s2[base + 3] = f4b;
      this.t[v] = t + dt;
      if (this.stage[v] === 3 || stage === 3) this.rt[v] += dt;
      this.stage[v] = stage;
      if (stage === 0) alloc.sounding[v] = 0;
    }

    // Ensemble: two slowly moving delay taps, one per side.
    const ens = p.ensemble;
    const buf = this.ensBuf;
    const mask = ENS_SIZE - 1;
    let w = this.ensPos;
    let eph = this.ensPhase;
    const einc = 0.37 / sr;
    const centre = 0.014 * sr;
    const depth = 0.004 * sr;
    const dry = 1 - 0.35 * ens;
    const stereo = outL !== outR;
    for (let i = 0; i < n; i++) {
      const x = mix[i] * OUT_GAIN;
      buf[w] = x;
      let l = x;
      let r = x;
      if (ens > 0.001) {
        eph += einc;
        if (eph >= 1) eph -= 1;
        const s = Math.sin(2 * Math.PI * eph);
        const c = Math.cos(2 * Math.PI * eph * 1.31);
        let rp = w - (centre + depth * s);
        if (rp < 0) rp += ENS_SIZE;
        let ri = rp | 0;
        let fr = rp - ri;
        const dl = buf[ri & mask] * (1 - fr) + buf[(ri + 1) & mask] * fr;
        rp = w - (centre * 0.8 + depth * c);
        if (rp < 0) rp += ENS_SIZE;
        ri = rp | 0;
        fr = rp - ri;
        const dr = buf[ri & mask] * (1 - fr) + buf[(ri + 1) & mask] * fr;
        l = dry * x + ens * 0.6 * dl;
        r = dry * x + ens * 0.6 * dr;
      }
      w = (w + 1) & mask;
      if (stereo) {
        outL[off + i] = l;
        outR[off + i] = r;
      } else outL[off + i] = 0.5 * (l + r);
    }
    this.ensPos = w;
    this.ensPhase = eph;
  }
}

const Base = typeof AudioWorkletProcessor === 'function' ? AudioWorkletProcessor : class {};

/** Timed events wait in fixed arrays (no allocation in process()) and apply on their frame. */
class HumProcessor extends Base {
  constructor() {
    super();
    this.engine = new HumEngine(sampleRate);
    this.qType = new Int8Array(QUEUE);
    this.qNote = new Int16Array(QUEUE);
    this.qVel = new Float32Array(QUEUE);
    this.qTime = new Float64Array(QUEUE);
    this.qCount = 0;
    if (this.port) this.port.onmessage = (e) => this.receive(e.data);
  }

  receive(m) {
    const type = m[0];
    if (type === 2) {
      this.engine.set(m[1], m[2]);
      return;
    }
    if (this.qCount >= QUEUE) return;
    const i = this.qCount++;
    this.qType[i] = type;
    this.qNote[i] = m[1] | 0;
    this.qVel[i] = +m[2] || 0;
    this.qTime[i] = +m[3] || 0;
  }

  /** Renders one block that starts at AudioContext time `now`. */
  run(outL, outR, frames, now) {
    const sr = this.engine.sr;
    const end = now + frames / sr;
    let pos = 0;
    for (;;) {
      let pick = -1;
      let best = end;
      for (let i = 0; i < this.qCount; i++) {
        if (this.qTime[i] < best) {
          best = this.qTime[i];
          pick = i;
        }
      }
      if (pick < 0) break;
      let frame = Math.round((best - now) * sr);
      if (frame < pos) frame = pos;
      if (frame > frames) frame = frames;
      if (frame > pos) this.engine.render(outL, outR, pos, frame);
      pos = frame;
      const type = this.qType[pick];
      if (type === 0) this.engine.noteOn(this.qNote[pick], this.qVel[pick]);
      else if (type === 1) this.engine.noteOff(this.qNote[pick]);
      else if (type === 3) this.engine.allOff();
      const last = --this.qCount;
      this.qType[pick] = this.qType[last];
      this.qNote[pick] = this.qNote[last];
      this.qVel[pick] = this.qVel[last];
      this.qTime[pick] = this.qTime[last];
    }
    if (pos < frames) this.engine.render(outL, outR, pos, frames);
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    if (!out || out.length === 0) return true;
    const outL = out[0];
    const outR = out.length > 1 ? out[1] : outL;
    this.run(outL, outR, outL.length, currentTime);
    return true;
  }
}

if (typeof registerProcessor === 'function') registerProcessor('drift-hum', HumProcessor);
