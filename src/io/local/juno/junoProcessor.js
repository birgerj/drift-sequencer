/*
 * Drift Synth Juno: a Juno-60-style polysynth in one AudioWorkletProcessor.
 *
 * Written from scratch for Drift from the published Juno-60 architecture
 * (no code taken from other emulations): per voice a PolyBLEP DCO (saw,
 * pulse with PWM, sub square one octave down, noise), a 4-pole
 * zero-delay-feedback ladder low-pass and an ADSR; then a high-pass and the
 * stereo chorus (I, II, I+II) on the sum. One triangle LFO with delay.
 *
 * Plain JavaScript on purpose: the app loads this file as text (?raw) into a
 * Blob URL, so it also works in the single-file build. No allocations in
 * process(). Tests evaluate the same source (see tests/juno.test.ts).
 *
 * Messages (port): [0, note, velocity 0..1, time] note on,
 * [1, note, 0, time] note off, [2, name, value] parameter (real units, see
 * junoParams.ts), [3, 0, 0, time] all notes off. Times are AudioContext
 * seconds; notes start on the exact frame.
 */

const VOICES = 6;
/** Filter, pitch and LFO are recomputed every CTRL samples. */
const CTRL = 16;
const QUEUE = 1024;
const CHORUS_SIZE = 4096;
const MAX_BLOCK = 128;
const OUT_GAIN = 0.3;

/** Who plays which note. Kept separate so it can be tested on its own. */
class VoiceAllocator {
  constructor(n) {
    this.n = n;
    this.note = new Int16Array(n).fill(-1);
    this.gate = new Uint8Array(n);
    /** Set by the engine: 1 while the voice makes sound (incl. release). */
    this.sounding = new Uint8Array(n);
    /** Event counter value at the last note on / note off. */
    this.stamp = new Float64Array(n);
    this.clock = 0;
    this.next = 0;
  }

  /** Voice index for a new note: same note, a free voice, the oldest release, or the oldest held note. */
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
      // Round-robin over free voices, like the Juno's assigner.
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

  /** Releases the voice holding this note; returns its index or -1. */
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

  anyGate() {
    for (let i = 0; i < this.n; i++) if (this.gate[i]) return true;
    return false;
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

/** Soft clip, tanh-like for |x| < 3. */
function sat(x) {
  if (x > 3) x = 3;
  else if (x < -3) x = -3;
  return (x * (27 + x * x)) / (27 + 9 * x * x);
}

/** Chorus settings per mode: [rate Hz, centre ms, depth ms]. Mode 0 is off. */
const CHORUS = [
  [0, 0, 0],
  [0.513, 3.5, 1.85],
  [0.863, 3.5, 1.85],
  [9.75, 3.3, 0.3],
];

class JunoEngine {
  constructor(sr) {
    this.sr = sr;
    this.alloc = new VoiceAllocator(VOICES);
    const n = VOICES;
    this.phase = new Float64Array(n);
    this.inc = new Float64Array(n);
    this.subSign = new Float64Array(n).fill(1);
    this.vel = new Float64Array(n);
    this.env = new Float64Array(n);
    /** 0 idle, 1 attack, 2 decay/sustain, 3 release. */
    this.stage = new Uint8Array(n);
    this.s1 = new Float64Array(n);
    this.s2 = new Float64Array(n);
    this.s3 = new Float64Array(n);
    this.s4 = new Float64Array(n);
    this.mix = new Float32Array(MAX_BLOCK);
    this.noise = new Float32Array(MAX_BLOCK);
    this.seed = 22222;
    this.lfoPhase = 0;
    this.lfoElapsed = 0;
    this.cutSmooth = Math.log2(1000);
    this.hpState = 0;
    this.chorusBuf = new Float32Array(CHORUS_SIZE);
    this.chorusPos = 0;
    this.chorusPhase = 0;
    this.wetL = 0;
    this.wetR = 0;
    this.wetCoef = 1 - Math.exp((-2 * Math.PI * 7000) / sr);
    // Real-unit parameters; junoSynth.ts sends its defaults on start.
    this.p = {
      lfoRate: 1,
      lfoDelay: 0.2,
      range: 0,
      dcoLfo: 0,
      pwm: 0.25,
      pwmSource: 0,
      pulse: 0.5,
      saw: 0.9,
      sub: 0.3,
      noise: 0,
      hpf: 0,
      cutoff: 1500,
      resonance: 0.6,
      envMod: 2,
      vcfLfo: 0,
      keyFollow: 0.5,
      attack: 0.01,
      decay: 1,
      sustain: 0.65,
      release: 0.7,
      chorus: 1,
    };
    this.updateEnvelope();
    this.updateHpf();
  }

  /** Sets a parameter in real units; false if the name is unknown. */
  set(name, value) {
    if (!Object.prototype.hasOwnProperty.call(this.p, name) || typeof value !== 'number' || !isFinite(value)) return false;
    this.p[name] = value;
    if (name === 'attack' || name === 'decay' || name === 'release') this.updateEnvelope();
    else if (name === 'hpf') this.updateHpf();
    return true;
  }

  updateEnvelope() {
    const sr = this.sr;
    this.atkInc = 1 / Math.max(1, this.p.attack * sr);
    // Exponential segments reach -40 dB after the set time.
    this.decCoef = Math.exp(-4.6 / Math.max(1, this.p.decay * sr));
    this.relCoef = Math.exp(-4.6 / Math.max(1, this.p.release * sr));
  }

  updateHpf() {
    this.hpCoef = this.p.hpf > 0 ? 1 - Math.exp((-2 * Math.PI * this.p.hpf) / this.sr) : 0;
  }

  noteOn(note, velocity) {
    if (!this.alloc.anyGate()) this.lfoElapsed = 0; // LFO delay restarts, as on the Juno
    const v = this.alloc.noteOn(note);
    if (this.stage[v] === 0) {
      // Fresh voice: start clean. A stolen or retriggered voice attacks from where it is.
      this.env[v] = 0;
      this.s1[v] = this.s2[v] = this.s3[v] = this.s4[v] = 0;
    }
    this.vel[v] = 0.55 + 0.45 * Math.max(0, Math.min(1, velocity));
    this.stage[v] = 1;
    return v;
  }

  noteOff(note) {
    const v = this.alloc.noteOff(note);
    if (v >= 0) this.stage[v] = 3;
  }

  allOff() {
    this.alloc.releaseAll();
    for (let v = 0; v < VOICES; v++) if (this.stage[v] !== 0) this.stage[v] = 3;
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

    // LFO (triangle) and its delayed amount.
    this.lfoPhase += (p.lfoRate * n) / sr;
    this.lfoPhase -= Math.floor(this.lfoPhase);
    const lfo = this.lfoPhase < 0.5 ? 4 * this.lfoPhase - 1 : 3 - 4 * this.lfoPhase;
    this.lfoElapsed += n / sr;
    const delayed = p.lfoDelay <= 0.001 ? 1 : Math.min(1, this.lfoElapsed / p.lfoDelay);
    const lfoAmt = lfo * delayed;

    // Cutoff glides in the log domain so knob moves don't zipper.
    this.cutSmooth += (Math.log2(Math.max(20, p.cutoff)) - this.cutSmooth) * 0.25;

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
    const k = p.resonance;
    const comp = 1 + 0.5 * k; // the ladder thins the bass as resonance rises
    const nyq = 0.45 * sr;
    const saw = p.saw;
    const pulse = p.pulse;
    const sub = p.sub;
    const nz = p.noise;
    const sus = p.sustain;
    const atkInc = this.atkInc;
    const decCoef = this.decCoef;
    const relCoef = this.relCoef;

    for (let v = 0; v < VOICES; v++) {
      let stage = this.stage[v];
      if (stage === 0) continue;
      let env = this.env[v];
      const note = alloc.note[v] + 12 * p.range;

      const semis = note - 69 + p.dcoLfo * lfoAmt;
      const inc = Math.min(0.45, (440 * Math.pow(2, semis / 12)) / sr);
      const mod = p.pwmSource === 0 ? 0.5 + 0.5 * lfo : p.pwmSource === 1 ? 1 : env;
      const pw = 0.5 - p.pwm * mod;

      const oct = p.envMod * env + p.vcfLfo * lfoAmt + p.keyFollow * ((note - 60) / 12);
      const fc = Math.min(nyq, Math.max(20, Math.pow(2, this.cutSmooth + oct)));
      const g = Math.tan((Math.PI * fc) / sr);
      const G = g / (1 + g);
      const G2 = G * G;
      const G3 = G2 * G;
      const G4 = G2 * G2;
      const b = 1 - G;
      const den = 1 / (1 + k * G4);

      let ph = this.phase[v];
      let subSign = this.subSign[v];
      let s1 = this.s1[v];
      let s2 = this.s2[v];
      let s3 = this.s3[v];
      let s4 = this.s4[v];
      const vel = this.vel[v];

      for (let i = 0; i < n; i++) {
        // DCO
        ph += inc;
        if (ph >= 1) {
          ph -= 1;
          subSign = -subSign;
        }
        const bl = blep(ph, inc);
        let pp = ph - pw;
        if (pp < 0) pp += 1;
        const oSaw = 2 * ph - 1 - bl;
        const oPulse = (ph < pw ? 1 : -1) + bl - blep(pp, inc);
        const oSub = subSign + (ph < inc ? subSign * bl : -subSign * bl);
        const x = saw * oSaw + pulse * oPulse + sub * oSub + nz * noise[i];

        // VCF: zero-delay-feedback 4-pole ladder, soft clip at the input.
        const S = b * (G3 * s1 + G2 * s2 + G * s3 + s4);
        const u0 = x * comp;
        const y4est = (G4 * u0 + S) * den;
        const u = sat(u0 - k * y4est);
        let t = (u - s1) * G;
        const y1 = t + s1;
        s1 = y1 + t;
        t = (y1 - s2) * G;
        const y2 = t + s2;
        s2 = y2 + t;
        t = (y2 - s3) * G;
        const y3 = t + s3;
        s3 = y3 + t;
        t = (y3 - s4) * G;
        const y4 = t + s4;
        s4 = y4 + t;

        // ENV + VCA
        if (stage === 1) {
          env += atkInc;
          if (env >= 1) {
            env = 1;
            stage = 2;
          }
        } else if (stage === 2) env = sus + (env - sus) * decCoef;
        else {
          env *= relCoef;
          if (env < 0.0001) {
            stage = 0;
            env = 0;
            break;
          }
        }
        mix[i] += y4 * env * vel;
      }

      this.phase[v] = ph;
      this.subSign[v] = subSign;
      this.env[v] = env;
      this.stage[v] = stage;
      if (stage === 0) {
        alloc.sounding[v] = 0;
        this.s1[v] = this.s2[v] = this.s3[v] = this.s4[v] = 0;
      } else {
        this.s1[v] = s1;
        this.s2[v] = s2;
        this.s3[v] = s3;
        this.s4[v] = s4;
      }
    }

    // HPF and chorus on the sum.
    const hpCoef = this.hpCoef;
    let hp = this.hpState;
    const mode = p.chorus | 0;
    const cset = CHORUS[mode < 0 ? 0 : mode > 3 ? 3 : mode];
    const buf = this.chorusBuf;
    const mask = CHORUS_SIZE - 1;
    let w = this.chorusPos;
    let cph = this.chorusPhase;
    const cinc = cset[0] / sr;
    const centre = (cset[1] * sr) / 1000;
    const depth = (cset[2] * sr) / 1000;
    const wc = this.wetCoef;
    let wl = this.wetL;
    let wr = this.wetR;
    const stereo = outL !== outR;

    for (let i = 0; i < n; i++) {
      let x = mix[i] * OUT_GAIN;
      if (hpCoef > 0) {
        hp += hpCoef * (x - hp);
        x -= hp;
      }
      buf[w] = x;
      let l = x;
      let r = x;
      if (mode > 0) {
        cph += cinc;
        if (cph >= 1) cph -= 1;
        const tri = cph < 0.5 ? 4 * cph - 1 : 3 - 4 * cph;
        let rp = w - (centre + depth * tri);
        if (rp < 0) rp += CHORUS_SIZE;
        let ri = rp | 0;
        let fr = rp - ri;
        const dl = buf[ri & mask] * (1 - fr) + buf[(ri + 1) & mask] * fr;
        rp = w - (centre - depth * tri);
        if (rp < 0) rp += CHORUS_SIZE;
        ri = rp | 0;
        fr = rp - ri;
        const dr = buf[ri & mask] * (1 - fr) + buf[(ri + 1) & mask] * fr;
        // The BBD is dark: a gentle low-pass on the wet signal.
        wl += wc * (dl - wl);
        wr += wc * (dr - wr);
        l = 0.62 * (x + wl);
        r = 0.62 * (x + wr);
      }
      w = (w + 1) & mask;
      if (stereo) {
        outL[off + i] = l;
        outR[off + i] = r;
      } else outL[off + i] = 0.5 * (l + r);
    }
    this.hpState = hp;
    this.chorusPos = w;
    this.chorusPhase = cph;
    this.wetL = wl;
    this.wetR = wr;
  }
}

const Base = typeof AudioWorkletProcessor === 'function' ? AudioWorkletProcessor : class {};

/** Timed events wait in fixed arrays (no allocation in process()) and apply on their frame. */
class JunoProcessor extends Base {
  constructor() {
    super();
    this.engine = new JunoEngine(sampleRate);
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
      // The earliest event due in this block.
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
      // Swap-remove keeps the queue packed.
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

if (typeof registerProcessor === 'function') registerProcessor('drift-juno', JunoProcessor);
