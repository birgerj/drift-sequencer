/*
 * Drift Synth Mono: a monophonic bass/lead synth in one AudioWorkletProcessor.
 *
 * Written for Drift in the spirit of a Minimoog / SH-101: two PolyBLEP
 * oscillators (saw, pulse, triangle; the second detuned and with its own
 * octave), a sine sub one octave down, noise, a driven 4-pole
 * zero-delay-feedback ladder low-pass, a filter ADSR and an amp ADSR, glide
 * on overlapping (legato) notes, a pitch envelope for punchy sub basses,
 * accent, and one triangle LFO to filter and pitch.
 *
 * Plain JavaScript on purpose: the app loads this file as text (?raw) into a
 * Blob URL, so it also works in the single-file build. No allocations in
 * process(). Tests evaluate the same source (see tests/mono.test.ts).
 *
 * Messages (port): [0, note, velocity 0..1, time] note on,
 * [1, note, 0, time] note off, [2, name, value] parameter (real units, see
 * monoParams.ts), [3, 0, 0, time] all notes off. Times are AudioContext
 * seconds; notes start on the exact frame.
 */

/** Filter, pitch and LFO are recomputed every CTRL samples. */
const CTRL = 16;
const QUEUE = 1024;
const STACK = 16;
const OUT_GAIN = 0.32;
/** Velocity (0..1) from which a note is accented, like velocity 100 of 127. */
const ACCENT_FROM = 100 / 127;

/** Held notes, last one on top: the newest note plays, a released one hands back to the one below. */
class NoteStack {
  constructor() {
    this.notes = new Int16Array(STACK);
    this.count = 0;
  }

  push(note) {
    this.remove(note);
    if (this.count >= STACK) {
      this.notes.copyWithin(0, 1, STACK);
      this.count = STACK - 1;
    }
    this.notes[this.count++] = note;
  }

  /** Removes a note; true if it was held. */
  remove(note) {
    for (let i = 0; i < this.count; i++) {
      if (this.notes[i] === note) {
        this.notes.copyWithin(i, i + 1, this.count);
        this.count--;
        return true;
      }
    }
    return false;
  }

  top() {
    return this.count > 0 ? this.notes[this.count - 1] : -1;
  }

  clear() {
    this.count = 0;
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

/** One band-limited oscillator sample: 0 saw, 1 pulse (DC removed), 2 triangle. */
function osc(wave, ph, inc, pw) {
  if (wave === 0) return 2 * ph - 1 - blep(ph, inc);
  if (wave === 1) {
    let pp = ph - pw;
    if (pp < 0) pp += 1;
    return (ph < pw ? 1 : -1) + blep(ph, inc) - blep(pp, inc) - (2 * pw - 1);
  }
  return ph < 0.5 ? 4 * ph - 1 : 3 - 4 * ph;
}

class MonoEngine {
  constructor(sr) {
    this.sr = sr;
    this.stack = new NoteStack();
    this.ph1 = 0;
    this.ph2 = 0.37;
    this.phSub = 0;
    this.seed = 12345;
    /** Pitch in MIDI notes (fractional while gliding) and where it glides to. */
    this.pitch = 36;
    this.target = 36;
    this.gate = false;
    this.vel = 0.8;
    this.accented = false;
    this.ampEnv = 0;
    /** 0 idle, 1 attack, 2 decay/sustain, 3 release. */
    this.ampStage = 0;
    this.fEnv = 0;
    this.fStage = 0;
    this.pEnv = 0;
    this.lfoPhase = 0;
    this.cutSmooth = Math.log2(500);
    this.s1 = this.s2 = this.s3 = this.s4 = 0;
    this.dc = 0;
    this.dcOut = 0;
    // Real-unit parameters; monoSynth sends its defaults on start.
    this.p = {
      osc1Wave: 0,
      pw: 0.5,
      osc2Wave: 0,
      osc2Octave: 0,
      osc2Detune: 0.05,
      osc1Level: 0.9,
      osc2Level: 0.6,
      sub: 0.4,
      noise: 0,
      cutoff: 400,
      resonance: 0.8,
      envMod: 2,
      drive: 1.5,
      keyFollow: 0.5,
      velFilter: 0.7,
      accent: 0.5,
      fAttack: 0.001,
      fDecay: 0.3,
      fSustain: 0.15,
      attack: 0.001,
      decay: 1,
      sustain: 0.8,
      release: 0.05,
      glide: 0,
      pitchEnv: 0,
      pitchDecay: 0.04,
      lfoRate: 1,
      lfoFilter: 0,
      lfoPitch: 0,
    };
    this.updateCoefs();
  }

  /** Sets a parameter in real units; false if the name is unknown. */
  set(name, value) {
    if (!Object.prototype.hasOwnProperty.call(this.p, name) || typeof value !== 'number' || !isFinite(value)) return false;
    this.p[name] = value;
    this.updateCoefs();
    return true;
  }

  updateCoefs() {
    const sr = this.sr;
    const p = this.p;
    // Exponential segments reach -40 dB after the set time.
    const coef = (s) => Math.exp(-4.6 / Math.max(1, s * sr));
    this.ampAtk = 1 / Math.max(1, p.attack * sr);
    this.ampDec = coef(p.decay);
    this.ampRel = coef(p.release);
    this.fAtk = 1 / Math.max(1, p.fAttack * sr);
    this.fDec = coef(p.fDecay);
    this.pDec = coef(p.pitchDecay);
    // Glide: a one-pole slew in the pitch domain, ~done after the set time.
    this.glideCoef = p.glide > 0 ? 1 - Math.exp(-4.6 / Math.max(1, (p.glide * sr) / CTRL)) : 1;
  }

  noteOn(note, velocity) {
    const legato = this.gate && this.stack.count > 0;
    this.stack.push(note);
    this.target = note;
    this.vel = Math.max(0, Math.min(1, velocity));
    if (legato) {
      // Overlapping notes slide (when glide is set) and don't retrigger, like a Minimoog.
      if (this.p.glide <= 0) this.pitch = note;
      return;
    }
    this.pitch = note;
    this.gate = true;
    this.accented = this.vel >= ACCENT_FROM;
    // Envelopes restart from where they are, so a quick retrigger doesn't click.
    this.ampStage = 1;
    this.fStage = 1;
    this.pEnv = 1;
    if (this.ampEnv < 0.0001) this.s1 = this.s2 = this.s3 = this.s4 = 0;
  }

  noteOff(note) {
    const wasTop = this.stack.top() === note;
    if (!this.stack.remove(note)) return;
    if (this.stack.count === 0) {
      this.gate = false;
      if (this.ampStage !== 0) this.ampStage = 3;
      if (this.fStage !== 0) this.fStage = 3;
    } else if (wasTop) {
      // Back to the note still held, legato.
      this.target = this.stack.top();
      if (this.p.glide <= 0) this.pitch = this.target;
    }
  }

  allOff() {
    this.stack.clear();
    this.gate = false;
    if (this.ampStage !== 0) this.ampStage = 3;
    if (this.fStage !== 0) this.fStage = 3;
  }

  get sounding() {
    return this.ampStage !== 0;
  }

  /** Renders frames [start, end) into outL/outR (outR may equal outL). */
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
    const stereo = outL !== outR;

    this.lfoPhase += (p.lfoRate * n) / sr;
    this.lfoPhase -= Math.floor(this.lfoPhase);
    const lfo = this.lfoPhase < 0.5 ? 4 * this.lfoPhase - 1 : 3 - 4 * this.lfoPhase;

    if (this.ampStage === 0) {
      for (let i = 0; i < n; i++) {
        outL[off + i] = 0;
        if (stereo) outR[off + i] = 0;
      }
      return;
    }

    this.pitch += (this.target - this.pitch) * this.glideCoef;
    this.cutSmooth += (Math.log2(Math.max(20, p.cutoff)) - this.cutSmooth) * 0.25;

    const pe = this.pEnv;
    this.pEnv *= Math.pow(this.pDec, n);
    const note = this.pitch + p.pitchEnv * pe + p.lfoPitch * lfo;
    const hz = 440 * Math.pow(2, (note - 69) / 12);
    const inc1 = Math.min(0.45, hz / sr);
    const inc2 = Math.min(0.45, (hz * Math.pow(2, p.osc2Octave + p.osc2Detune / 12)) / sr);
    const incSub = inc1 * 0.5;

    const acc = this.accented ? p.accent : 0;
    const fEnvNow = this.fEnv;
    const oct =
      (p.envMod + 1.5 * acc) * fEnvNow +
      p.velFilter * (this.vel - 0.5) +
      p.lfoFilter * lfo +
      p.keyFollow * ((this.pitch - 48) / 12);
    const fc = Math.min(0.45 * sr, Math.max(20, Math.pow(2, this.cutSmooth + oct)));
    const g = Math.tan((Math.PI * fc) / sr);
    const G = g / (1 + g);
    const G2 = G * G;
    const G3 = G2 * G;
    const G4 = G2 * G2;
    const b = 1 - G;
    const k = p.resonance;
    const den = 1 / (1 + k * G4);
    // The ladder thins the bass as resonance rises; drive pushes it into saturation.
    const inGain = (1 + 0.5 * k) * p.drive;
    const makeup = 1 / Math.sqrt(p.drive);

    const w1 = p.osc1Wave | 0;
    const w2 = p.osc2Wave | 0;
    const pw = p.pw;
    const l1 = p.osc1Level;
    const l2 = p.osc2Level;
    const lSub = p.sub;
    const lNoise = p.noise;
    const level = (0.6 + 0.4 * this.vel) * (1 + 0.5 * acc) * makeup;

    let ph1 = this.ph1;
    let ph2 = this.ph2;
    let phSub = this.phSub;
    let seed = this.seed;
    let s1 = this.s1;
    let s2 = this.s2;
    let s3 = this.s3;
    let s4 = this.s4;
    let ampEnv = this.ampEnv;
    let ampStage = this.ampStage;
    let fEnv = this.fEnv;
    let fStage = this.fStage;
    let dc = this.dc;
    const ampAtk = this.ampAtk;
    const ampDec = this.ampDec;
    const ampRel = this.ampRel;
    const sus = p.sustain;
    const fAtk = this.fAtk;
    const fDec = this.fDec;
    const fSus = p.fSustain;

    for (let i = 0; i < n; i++) {
      ph1 += inc1;
      if (ph1 >= 1) ph1 -= 1;
      ph2 += inc2;
      if (ph2 >= 1) ph2 -= 1;
      phSub += incSub;
      if (phSub >= 1) phSub -= 1;
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      const nz = (seed | 0) / 2147483648;

      const x =
        l1 * osc(w1, ph1, inc1, pw) +
        l2 * osc(w2, ph2, inc2, pw) +
        lSub * Math.sin(2 * Math.PI * phSub) +
        lNoise * nz;

      // Ladder: zero-delay feedback, saturating input.
      const S = b * (G3 * s1 + G2 * s2 + G * s3 + s4);
      const u0 = x * inGain;
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

      // Filter envelope (its release follows the amp release).
      if (fStage === 1) {
        fEnv += fAtk;
        if (fEnv >= 1) {
          fEnv = 1;
          fStage = 2;
        }
      } else if (fStage === 2) fEnv = fSus + (fEnv - fSus) * fDec;
      else if (fStage === 3) fEnv *= ampRel;

      // Amp envelope.
      if (ampStage === 1) {
        ampEnv += ampAtk;
        if (ampEnv >= 1) {
          ampEnv = 1;
          ampStage = 2;
        }
      } else if (ampStage === 2) ampEnv = sus + (ampEnv - sus) * ampDec;
      else if (ampStage === 3) {
        ampEnv *= ampRel;
        if (ampEnv < 0.0001) {
          ampEnv = 0;
          ampStage = 0;
          fStage = 0;
          fEnv = 0;
        }
      }

      let y = y4 * ampEnv * level * OUT_GAIN;
      // DC blocker (~10 Hz) keeps the low end clean after heavy drive.
      dc += 0.0013 * (y - dc);
      y = sat(y - dc);
      outL[off + i] = y;
      if (stereo) outR[off + i] = y;
    }

    this.ph1 = ph1;
    this.ph2 = ph2;
    this.phSub = phSub;
    this.seed = seed;
    this.ampEnv = ampEnv;
    this.ampStage = ampStage;
    this.fEnv = fEnv;
    this.fStage = fStage;
    this.dc = dc;
    if (ampStage === 0) this.s1 = this.s2 = this.s3 = this.s4 = 0;
    else {
      this.s1 = s1;
      this.s2 = s2;
      this.s3 = s3;
      this.s4 = s4;
    }
  }
}

const Base = typeof AudioWorkletProcessor === 'function' ? AudioWorkletProcessor : class {};

/** Timed events wait in fixed arrays (no allocation in process()) and apply on their frame. */
class MonoProcessor extends Base {
  constructor() {
    super();
    this.engine = new MonoEngine(sampleRate);
    this.qType = new Int8Array(QUEUE);
    this.qNote = new Int16Array(QUEUE);
    this.qVel = new Float32Array(QUEUE);
    this.qTime = new Float64Array(QUEUE);
    this.qSeq = new Float64Array(QUEUE);
    this.seq = 0;
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
    this.qSeq[i] = ++this.seq;
  }

  /** Renders one block that starts at AudioContext time `now`. */
  run(outL, outR, frames, now) {
    const sr = this.engine.sr;
    const end = now + frames / sr;
    let pos = 0;
    for (;;) {
      // The earliest event due in this block. At the same time a note off goes
      // before a note on, so back-to-back notes retrigger and only truly
      // overlapping notes slide; otherwise arrival order.
      let pick = -1;
      let best = end;
      let bestRank = 0;
      for (let i = 0; i < this.qCount; i++) {
        const t = this.qTime[i];
        const rank = (this.qType[i] === 0 ? 1e12 : 0) + this.qSeq[i];
        if (t < best || (t === best && pick >= 0 && rank < bestRank)) {
          best = t;
          bestRank = rank;
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
      this.qSeq[pick] = this.qSeq[last];
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

if (typeof registerProcessor === 'function') registerProcessor('drift-mono', MonoProcessor);
