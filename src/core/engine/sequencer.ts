import { Emitter } from '../events';
import type { GeneratorConfig } from '../generators/registry';
import { Harmony } from '../theory/harmony';
import { Scale } from '../theory/scale';
import type { Chord } from '../theory/chord';
import type { MidiNote } from '../theory/note';
import { Midi } from '../../io/midi/messages';
import type { MidiPortResolver } from '../../io/midi/output';
import type { ProjectState, TrackState } from '../../state/project';
import { lfoValue } from './lfo';
import { LookaheadScheduler, type TimerHost } from './scheduler';
import { TrackRuntime } from './trackRuntime';

export interface SequencerEvents extends Record<string, unknown> {
  step: { step: number; bar: number; timeMs: number };
  chord: { bar: number; chord: Chord };
  note: { trackId: string; notes: MidiNote[]; velocity: number; timeMs: number; durationMs: number };
  mutation: { trackId: string; bar: number };
  transport: { playing: boolean };
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

  constructor(
    project: ProjectState,
    private readonly ports: MidiPortResolver,
    timer?: TimerHost,
  ) {
    this.project = project;
    this.harmony = buildHarmony(project);
    this.scheduler = new LookaheadScheduler(
      { bpm: project.bpm, swing: project.swing, stepsPerBeat: project.stepsPerBar / 4 },
      timer,
    );
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

  track(id: string): TrackRuntime | undefined {
    return this.tracks.get(id);
  }

  /** Apply a new project state (from the UI or storage) without stopping playback. */
  update(next: ProjectState): void {
    const prev = this.project;
    this.project = next;
    if (prev.key !== next.key || prev.progression !== next.progression) this.harmony = buildHarmony(next);
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
    this.events.emit('step', { step, bar, timeMs });

    if (step % stepsPerBar === 0) {
      for (const rt of this.tracks.values()) {
        if (rt.maybeMutate(bar)) this.events.emit('mutation', { trackId: rt.config.id, bar });
      }
      const moment = this.harmony.at(bar);
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
    for (const rt of this.tracks.values()) {
      const t = rt.config;
      const audible = !t.muted && (!anySolo || t.solo);
      this.sendModulations(t, step, timeMs);
      const scheduled = rt.notesAt(step, this.harmony);
      if (!audible) continue;
      const port = this.ports.byName(t.output.portName);
      for (const n of scheduled) {
        const durationMs = Math.max(5, n.length * stepMs - 2);
        for (const note of n.notes) {
          port?.send(Midi.noteOn(t.output.channel, note, n.velocity), timeMs);
          port?.send(Midi.noteOff(t.output.channel, note), timeMs + durationMs);
        }
        this.events.emit('note', { trackId: t.id, notes: n.notes, velocity: n.velocity, timeMs, durationMs });
      }
    }
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
  return next.type !== 'motif' && next.type !== 'bass';
}

export function buildHarmony(project: ProjectState): Harmony {
  return new Harmony(new Scale(project.key.root, project.key.mode), project.progression);
}
