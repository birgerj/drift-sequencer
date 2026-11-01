import type { DrumParams } from '../generators/drumGenerator';
import { Emitter } from '../events';
import type { GeneratorConfig } from '../generators/registry';
import { Harmony, type HarmonicMoment } from '../theory/harmony';
import { answerEvents, phraseActive } from './phrasing';
import { resizePattern } from '../pattern/edit';
import { Scale } from '../theory/scale';
import type { Chord } from '../theory/chord';
import type { MidiNote } from '../theory/note';
import { Midi } from '../../io/midi/messages';
import type { MidiPortResolver } from '../../io/midi/output';
import type { ProjectState, TrackState } from '../../state/project';
import { lfoValue } from './lfo';
import { browserTimerHost, LookaheadScheduler, type TimerHost } from './scheduler';
import { MidiGuard } from '../../io/midi/guard';
import { shiftRegister, TrackRuntime, type ScheduledNote } from './trackRuntime';
import { applyInterplay, interplayActive } from './interplay';
import { Rng } from '../random/rng';

/** Kick drums on the TR-8S / GM map. */
const KICK_NOTES = new Set([35, 36]);

export interface SequencerEvents extends Record<string, unknown> {
  step: { step: number; bar: number; timeMs: number };
  chord: { bar: number; chord: Chord };
  note: { trackId: string; notes: MidiNote[]; velocity: number; timeMs: number; durationMs: number };
  mutation: { trackId: string; bar: number; kind: 'mutation' | 'theme' | 'recall' | 'ensemble' };
  /** An LFO value as it is sent, for displays (0..127). */
  lfo: { trackId: string; index: number; cc: number; value: number; timeMs: number };
  transport: { playing: boolean };
  /**
   * The progression is about to start again. Emitted synchronously before
   * the bar is scheduled, so a listener can change the harmony in time.
   */
  loop: { loop: number; bar: number };
  /** The browser paused playback; missed steps were skipped, not replayed. */
  skipped: { steps: number; gapMs: number };
  /** Playback was stopped because far too many MIDI messages were being sent. */
  safetyStop: { perSecond: number };
}

/** MIDI clock is 24 pulses per quarter note. */
const PPQN = 24;

/**
 * Glues project state, harmony, tracks, scheduler and MIDI output together.
 * Knows nothing about the UI: the UI calls methods and listens to events.
 */
export class Sequencer {
  readonly events = new Emitter<SequencerEvents>();
  private project: ProjectState;
  private harmony: Harmony;
  private tracks = new Map<string, TrackRuntime>();
  private scheduler: LookaheadScheduler;
  private lastChordStep = -1;
  /** Bar at which the current progression started (see harmonyAt). */
  private harmonyStartBar = 0;
  private schedulingBar = 0;
  private inLoopEvent = false;
  private readonly ports: MidiGuard;
  /** Timing/velocity jitter for humanized tracks. */
  private readonly humanRng = new Rng(0x5eed);
  /** Dice for the interplay rules (separate, so they don't shift other randomness). */
  private readonly interplayRng = new Rng(0x1157e4);

  constructor(project: ProjectState, ports: MidiPortResolver, timer: TimerHost = browserTimerHost) {
    this.project = project;
    this.harmony = buildHarmony(project);
    this.scheduler = new LookaheadScheduler(
      { bpm: project.bpm, swing: project.swing, stepsPerBeat: project.stepsPerBar / 4 },
      timer,
    );
    this.scheduler.onSkip = (steps, gapMs) => this.events.emit('skipped', { steps, gapMs });
    this.ports = new MidiGuard(ports, {
      now: () => timer.now(),
      onTrip: (perSecond) => {
        // Defer: we're inside a send call in the middle of a step.
        queueMicrotask(() => {
          this.stop();
          this.events.emit('safetyStop', { perSecond });
        });
      },
    });
    for (const t of project.tracks) this.tracks.set(t.id, new TrackRuntime(t, project.stepsPerBar));
    this.linkEnsemble();
  }

  /** Tracks the ensemble model writes don't mutate on their own. */
  private linkEnsemble(): void {
    const e = this.project.ensemble;
    const linked = new Set(e?.z ? [e.melody, e.bass, e.drums].filter(Boolean) : []);
    for (const [id, rt] of this.tracks) rt.external = linked.has(id);
  }

  get playing(): boolean {
    return this.scheduler.running;
  }

  get state(): ProjectState {
    return this.project;
  }

  get currentHarmony(): Harmony {
    return this.harmony;
  }

  /**
   * The harmonic moment at an absolute bar. When the progression changes at
   * a loop point, the new one starts from its first chord at that bar.
   */
  harmonyAt(bar: number): HarmonicMoment {
    return this.harmony.at(Math.max(0, bar - this.harmonyStartBar));
  }

  track(id: string): TrackRuntime | undefined {
    return this.tracks.get(id);
  }

  /** Apply a new project state (from the UI or storage) without stopping playback. */
  update(next: ProjectState): void {
    const prev = this.project;
    this.project = next;
    if (prev.key !== next.key || prev.progression !== next.progression) {
      this.harmony = buildHarmony(next);
      // A progression swapped in at a loop point starts from its first chord.
      if (this.inLoopEvent && prev.progression !== next.progression) this.harmonyStartBar = this.schedulingBar;
    }
    this.scheduler.setBpm(next.bpm);
    this.scheduler.setSwing(next.swing);
    const ids = new Set(next.tracks.map((t) => t.id));
    for (const id of this.tracks.keys()) if (!ids.has(id)) this.tracks.delete(id);
    for (const t of next.tracks) {
      const rt = this.tracks.get(t.id);
      if (!rt) this.tracks.set(t.id, new TrackRuntime(t, next.stepsPerBar));
      else {
        const prev = rt.config;
        rt.config = t;
        if (t.userPattern && t.userPattern !== prev.userPattern) {
          // A pattern already queued for the next phrase isn't switched to early.
          if (rt.pending !== t.userPattern) rt.setPattern(t.userPattern);
        }
        else if (prev.generator !== t.generator && needsRegenerate(prev.generator, t.generator, !!t.userPattern)) rt.regenerate(t.seed);
        else if (
          !t.userPattern &&
          prev.generator.type === t.generator.type &&
          t.generator.params.lengthSteps !== rt.pattern.lengthSteps
        ) {
          // A new length keeps the music: the pattern is repeated or trimmed.
          rt.setPattern(resizePattern(rt.pattern, t.generator.params.lengthSteps));
        }
      }
    }
    this.linkEnsemble();
  }

  /** Call when the page is hidden/visible; hidden pages get a longer lookahead. */
  setBackground(hidden: boolean): void {
    this.scheduler.setLookahead(hidden ? 400 : 100);
  }

  start(): void {
    this.lastChordStep = -1;
    this.harmonyStartBar = 0;
    this.ports.reset();
    this.forEachClockPort((send) => send(Midi.start()));
    this.scheduler.start((step, time, dur) => this.onStep(step, time, dur));
    this.events.emit('transport', { playing: true });
  }

  stop(): void {
    this.scheduler.stop();
    this.forEachClockPort((send) => send(Midi.stop()));
    for (const t of this.project.tracks) {
      this.ports.byName(t.output.portName)?.send(Midi.allNotesOff(t.output.channel));
    }
    this.events.emit('transport', { playing: false });
  }

  private onStep(step: number, timeMs: number, stepMs: number): void {
    const { stepsPerBar } = this.project;
    const bar = Math.floor(step / stepsPerBar);
    this.schedulingBar = bar;
    this.events.emit('step', { step, bar, timeMs });

    if (step % stepsPerBar === 0) {
      const sinceStart = bar - this.harmonyStartBar;
      const loopBars = this.harmony.lengthBars;
      if (sinceStart > 0 && sinceStart % loopBars === 0) {
        this.inLoopEvent = true;
        try {
          this.events.emit('loop', { loop: sinceStart / loopBars, bar });
        } finally {
          this.inLoopEvent = false;
        }
      }
      for (const rt of this.tracks.values()) {
        if (rt.maybeMutate(bar)) this.events.emit('mutation', { trackId: rt.config.id, bar, kind: rt.lastChange });
      }
      const moment = this.harmonyAt(bar);
      if (moment.barInChord === 0 || this.lastChordStep < 0) {
        this.lastChordStep = step;
        this.events.emit('chord', { bar, chord: moment.chord });
      }
    }

    // MIDI clock: PPQN / stepsPerBeat pulses per step.
    const pulses = PPQN / (stepsPerBar / 4);
    this.forEachClockPort((send) => {
      for (let i = 0; i < pulses; i++) send(Midi.clock(), timeMs + (i * stepMs) / pulses);
    });

    const anySolo = this.project.tracks.some((t) => t.solo);
    const moment = this.harmonyAt(bar);
    const kickNow = this.kickAt(step, anySolo);
    // First every track decides what it would play, so tracks can listen to each other.
    const planned = new Map<string, ScheduledNote[]>();
    for (const rt of this.tracks.values()) {
      this.sendModulations(rt.config, step, timeMs);
      planned.set(rt.config.id, this.notesFor(rt, step, bar, moment));
    }
    const isAudible = (t: TrackState) => !t.muted && (!anySolo || t.solo);
    for (const rt of this.tracks.values()) {
      const t = rt.config;
      if (!isAudible(t)) continue;
      let scheduled = planned.get(t.id) ?? [];
      if (interplayActive(t.interplay)) {
        const heard = t.interplay.listenTo.flatMap((id) => {
          const other = this.tracks.get(id);
          return other && other !== rt && isAudible(other.config) ? (planned.get(id) ?? []) : [];
        });
        const register = shiftRegister(t.register, t.octave ?? 0);
        scheduled = applyInterplay(scheduled, heard, t.interplay, {
          strong: step % Math.max(1, stepsPerBar / 4) === 0,
          chord: moment.chord,
          rng: this.interplayRng,
          fixed: t.generator.type === 'drums',
          low: register.low,
          high: register.high,
        });
      }
      const kickMode = (t.generator.type === 'bass' || t.generator.type === 'acid') && t.kickMode ? t.kickMode : 'off';
      if (kickMode !== 'off' && kickNow) scheduled = this.makeRoomForKick(scheduled, kickMode, step, anySolo, rt);
      const human = t.humanize;
      const port = this.ports.byName(t.output.portName);
      for (const n of scheduled) {
        // Tracks faster than ×1 place some notes inside the step.
        let noteTime = timeMs + n.offset * stepMs;
        if (human) {
          // Never earlier than the step itself: that time is still ahead of the clock.
          noteTime = Math.max(timeMs, noteTime + human.layBack * 25 + (this.humanRng.next() * 2 - 1) * human.timing * 18);
          if (!n.accent) n.velocity = Math.max(1, Math.min(127, Math.round(n.velocity + (this.humanRng.next() * 2 - 1) * human.velocity * 30)));
        }
        // A note followed by a slide is held into the next note (overlap → glide).
        const durationMs = n.holdSteps ? n.holdSteps * stepMs + 15 : Math.max(5, n.length * stepMs - 2);
        if (n.accent) n.velocity = 127;
        if (t.slideCc !== undefined && n.ratchet <= 1) {
          port?.send(Midi.cc(t.output.channel, t.slideCc, n.slide ? 127 : 0), Math.max(0, noteTime - 1));
        }
        if (n.ratchet > 1) {
          // Ratchet: n quick repeats spread over one pattern step.
          const slot = (stepMs * n.stepScale) / n.ratchet;
          for (let r = 0; r < n.ratchet; r++) {
            const at = noteTime + r * slot;
            const vel = Math.max(1, n.velocity - r * 6);
            for (const note of n.notes) {
              port?.send(Midi.noteOn(t.output.channel, note, vel), at);
              port?.send(Midi.noteOff(t.output.channel, note), at + Math.max(5, slot * 0.7));
            }
          }
        } else {
          for (const note of n.notes) {
            port?.send(Midi.noteOn(t.output.channel, note, n.velocity), noteTime);
            port?.send(Midi.noteOff(t.output.channel, note), noteTime + durationMs);
          }
        }
        this.events.emit('note', { trackId: t.id, notes: n.notes, velocity: n.velocity, timeMs: noteTime, durationMs });
      }
    }
  }

  /** Does an audible drum track play a kick on this global step? (Pattern only; no dice rolls.) */
  private kickAt(step: number, anySolo: boolean): boolean {
    for (const rt of this.tracks.values()) {
      const t = rt.config;
      if (t.generator.type !== 'drums' || t.muted || (anySolo && !t.solo)) continue;
      const rate = t.rate ?? 1;
      if (rate < 1 && step % Math.round(1 / rate) !== 0) continue;
      const ps = rt.patternStepAt(step);
      const muted = new Set(t.generator.params.voices.filter((v) => v.muted).map((v) => v.note));
      if (rt.pattern.events.some((e) => e.step === ps && e.pitch.kind === 'fixed' && KICK_NOTES.has(e.pitch.note) && !muted.has(e.pitch.note))) {
        return true;
      }
    }
    return false;
  }

  /** Bass on a kick: duck it, or move it half a beat on if that spot is free. */
  private makeRoomForKick(
    notes: ScheduledNote[],
    mode: 'avoid' | 'duck',
    step: number,
    anySolo: boolean,
    rt: TrackRuntime,
  ): ScheduledNote[] {
    if (mode === 'duck') return notes.map((n) => (n.offset === 0 ? { ...n, velocity: Math.max(1, Math.round(n.velocity * 0.55)) } : n));
    const nextIsBusy = this.kickAt(step + 1, anySolo) || rt.eventsAt(step + 1).length > 0;
    return notes.flatMap((n) => {
      if (n.offset !== 0) return [n];
      if (nextIsBusy) return [];
      // Move to the next step, a little shorter so it ends where it would have.
      return [{ ...n, offset: n.offset + 1, length: Math.max(0.5, n.length - 1), holdSteps: n.holdSteps ? Math.max(1, n.holdSteps - 1) : n.holdSteps }];
    });
  }

  /** A track's notes for this step, honouring its call-and-response role. */
  private notesFor(rt: TrackRuntime, step: number, bar: number, moment: HarmonicMoment): ScheduledNote[] {
    const phrase = rt.config.phrase;
    if (!phrase) return rt.notesAt(step, moment);
    if (!phraseActive(phrase, bar)) return [];
    const source = phrase.role === 'response' && phrase.answer ? this.tracks.get(phrase.answer.from) : undefined;
    if (!source || source === rt) return rt.notesAt(step, moment);
    const events = answerEvents(source.pattern, phrase.answer!.transform, step, this.project.stepsPerBar, phrase.bars);
    return rt.resolveEvents(events, step, moment);
  }

  /** CCs a person is turning right now: LFOs and motions leave them alone until then. */
  private held = new Map<string, number>();

  holdCc(trackId: string, cc: number, untilMs: number): void {
    this.held.set(`${trackId}:${cc}`, untilMs);
  }

  private isHeld(trackId: string, cc: number, timeMs: number): boolean {
    const until = this.held.get(`${trackId}:${cc}`);
    return until !== undefined && timeMs < until;
  }

  private sendModulations(t: TrackState, step: number, timeMs: number): void {
    if (t.modulations.length === 0 && !t.motions?.length) return;
    const port = this.ports.byName(t.output.portName);
    const stepsPerBar = this.project.stepsPerBar;
    t.modulations.forEach((m, index) => {
      if (!m.enabled || this.isHeld(t.id, m.cc, timeMs)) return;
      const period = Math.max(1, m.periodBars * stepsPerBar);
      const phase = (step % period) / period;
      const cycle = Math.floor(step / period);
      const value = m.min + (m.max - m.min) * lfoValue(m.shape, phase, cycle);
      port?.send(Midi.cc(t.output.channel, m.cc, value), timeMs);
      this.events.emit('lfo', { trackId: t.id, index, cc: m.cc, value, timeMs });
    });
    for (const m of t.motions ?? []) {
      if (!m.enabled || m.values.length === 0 || this.isHeld(t.id, m.cc, timeMs)) continue;
      const value = m.values[step % m.values.length]!;
      const prev = m.values[(step - 1 + m.values.length) % m.values.length];
      // Only changes go out; a held value costs no MIDI traffic.
      if (value === prev && step % stepsPerBar !== 0) continue;
      port?.send(Midi.cc(t.output.channel, m.cc, value), timeMs);
      this.events.emit('lfo', { trackId: t.id, index: -1, cc: m.cc, value, timeMs });
    }
  }

  private forEachClockPort(fn: (send: (data: readonly number[], ts?: number) => void) => void): void {
    for (const name of this.project.clock.sendTo) {
      const port = this.ports.byName(name);
      if (port) fn((d, ts) => port.send(d, ts));
    }
  }
}

/**
 * Melodic generators (motif, bass) keep their pattern when knobs move — the
 * new settings shape the next mutations, so the music keeps evolving rather
 * than jumping. Structural changes regenerate right away.
 */
function needsRegenerate(prev: GeneratorConfig, next: GeneratorConfig, hasUserPattern: boolean): boolean {
  if (prev.type !== next.type) return true;
  // A drawn pattern is never thrown away by moving a knob.
  if (hasUserPattern) return false;
  // Muting a drum voice only silences it at play time.
  if (prev.type === 'drums' && next.type === 'drums' && sameIgnoringMutes(prev.params, next.params)) return false;
  return next.type !== 'motif' && next.type !== 'bass' && next.type !== 'acid';
}

export function buildHarmony(project: ProjectState): Harmony {
  return new Harmony(new Scale(project.key.root, project.key.mode), project.progression);
}

function sameIgnoringMutes(a: DrumParams, b: DrumParams): boolean {
  const strip = (p: DrumParams) => JSON.stringify({ ...p, voices: p.voices.map(({ muted: _m, ...v }) => v) });
  return strip(a) === strip(b);
}
