import { Emitter } from '../events';
import type { GeneratorConfig } from '../generators/registry';
import { Harmony, type HarmonicMoment } from '../theory/harmony';
import { answerEvents, phraseActive } from './phrasing';
import { Scale } from '../theory/scale';
import type { Chord } from '../theory/chord';
import type { MidiNote } from '../theory/note';
import { Midi } from '../../io/midi/messages';
import type { MidiPortResolver } from '../../io/midi/output';
import type { ProjectState, TrackState } from '../../state/project';
import { lfoValue } from './lfo';
import { browserTimerHost, LookaheadScheduler, type TimerHost } from './scheduler';
import { MidiGuard } from '../../io/midi/guard';
import { TrackRuntime, type ScheduledNote } from './trackRuntime';

export interface SequencerEvents extends Record<string, unknown> {
  step: { step: number; bar: number; timeMs: number };
  chord: { bar: number; chord: Chord };
  note: { trackId: string; notes: MidiNote[]; velocity: number; timeMs: number; durationMs: number };
  mutation: { trackId: string; bar: number };
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
        if (t.userPattern && t.userPattern !== prev.userPattern) rt.setPattern(t.userPattern);
        else if (prev.generator !== t.generator && needsRegenerate(prev.generator, t.generator, !!t.userPattern)) rt.regenerate(t.seed);
      }
    }
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
        if (rt.maybeMutate(bar)) this.events.emit('mutation', { trackId: rt.config.id, bar });
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
    for (const rt of this.tracks.values()) {
      const t = rt.config;
      const audible = !t.muted && (!anySolo || t.solo);
      this.sendModulations(t, step, timeMs);
      const scheduled = this.notesFor(rt, step, bar, moment);
      if (!audible) continue;
      const port = this.ports.byName(t.output.portName);
      for (const n of scheduled) {
        // A note followed by a slide is held into the next note (overlap → glide).
        const durationMs = n.holdSteps ? n.holdSteps * stepMs + 15 : Math.max(5, n.length * stepMs - 2);
        if (n.accent) n.velocity = 127;
        if (t.slideCc !== undefined && n.ratchet <= 1) {
          port?.send(Midi.cc(t.output.channel, t.slideCc, n.slide ? 127 : 0), Math.max(0, timeMs - 1));
        }
        if (n.ratchet > 1) {
          // Ratchet: n quick repeats spread over one step.
          const slot = stepMs / n.ratchet;
          for (let r = 0; r < n.ratchet; r++) {
            const at = timeMs + r * slot;
            const vel = Math.max(1, n.velocity - r * 6);
            for (const note of n.notes) {
              port?.send(Midi.noteOn(t.output.channel, note, vel), at);
              port?.send(Midi.noteOff(t.output.channel, note), at + Math.max(5, slot * 0.7));
            }
          }
        } else {
          for (const note of n.notes) {
            port?.send(Midi.noteOn(t.output.channel, note, n.velocity), timeMs);
            port?.send(Midi.noteOff(t.output.channel, note), timeMs + durationMs);
          }
        }
        this.events.emit('note', { trackId: t.id, notes: n.notes, velocity: n.velocity, timeMs, durationMs });
      }
    }
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

  private sendModulations(t: TrackState, step: number, timeMs: number): void {
    if (t.modulations.length === 0) return;
    const port = this.ports.byName(t.output.portName);
    if (!port) return;
    const stepsPerBar = this.project.stepsPerBar;
    for (const m of t.modulations) {
      if (!m.enabled) continue;
      const period = Math.max(1, m.periodBars * stepsPerBar);
      const phase = (step % period) / period;
      const cycle = Math.floor(step / period);
      const value = m.min + (m.max - m.min) * lfoValue(m.shape, phase, cycle);
      port.send(Midi.cc(t.output.channel, m.cc, value), timeMs);
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
  if (prev.params.lengthSteps !== next.params.lengthSteps) return true;
  return next.type !== 'motif' && next.type !== 'bass' && next.type !== 'acid';
}

export function buildHarmony(project: ProjectState): Harmony {
  return new Harmony(new Scale(project.key.root, project.key.mode), project.progression);
}
