import { useEffect, useRef, useState } from 'preact/hooks';
import { Sequencer } from '../core/engine/sequencer';
import { createWorkerTimerHost } from '../core/engine/workerClock';
import { keepAwake } from './keepAwake';
import { Midi } from '../io/midi/messages';
import { defaultConfig, type GeneratorConfig } from '../core/generators/registry';
import type { TrackType } from '../core/generators/types';
import type { InstrumentDefinition } from '../core/instruments/instrument';
import type { MidiNote } from '../core/theory/note';
import type { Pattern } from '../core/pattern/pattern';
import { resizePattern } from '../core/pattern/edit';
import { Rng } from '../core/random/rng';
import { Chord } from '../core/theory/chord';
import { generateProgression, varyProgression, type ProgressionStyle } from '../core/theory/progressionGenerator';
import { Scale } from '../core/theory/scale';
import { isLocalPort } from '../io/local/localSynths';
import { MidiHub } from '../io/midi/midiHub';
import { MidiGuideClient } from '../io/midiGuideClient';
import { IndexedDbInstrumentStore, InstrumentLibrary, type InstalledInstrument } from '../state/instrumentLibrary';
import { newId, type CcMotion, type MidiTarget, type ProjectState, type TrackState } from '../state/project';
import {
  assignDevices,
  deviceForRole,
  effectiveInstrumentId,
  effectiveOutput,
  inputForDevice,
  loadRack,
  resolveProject,
  roleForType,
  roleOf,
  saveRack,
  type Rack,
  type RackDevice,
} from '../state/rack';
import {
  deserializeProject,
  IndexedDbProjectRepository,
  loadSettings,
  saveSettings,
  serializeProject,
  type ProjectSummary,
} from '../state/storage';
import { createProject, createTrack, TRACK_COLORS } from '../state/templates';

import type { SectionId } from './shortcuts';
import { toEpoch, VisualsLink } from '../visuals/link';
import type { DrumVoice } from '../core/generators/drumGenerator';
import { DRUM_PRESETS, orderDrumVoices, presetPattern, presetVoices, tr8sKey, tr8sVoices } from '../core/generators/drumPresets';

/** A TR-8S kit gets a lane for each of its 11 instruments, in panel order. */
function withAllTr8sLanes(voices: DrumVoice[]): DrumVoice[] {
  const isTr8s = voices.length > 0 && voices.every((v) => tr8sKey(v.note));
  const have = new Set(voices.map((v) => v.note));
  return orderDrumVoices(isTr8s ? [...voices, ...tr8sVoices().filter((v) => !have.has(v.note))] : voices);
}

/** Drum tracks: TR-8S panel order and names (older projects used "CP" and another order). */
function normalizeDrums(project: ProjectState): ProjectState {
  return {
    ...project,
    tracks: project.tracks.map((t) =>
      t.generator.type === 'drums'
        ? ({ ...t, generator: { ...t.generator, params: { ...t.generator.params, voices: withAllTr8sLanes(t.generator.params.voices) } } } as TrackState)
        : t,
    ),
  };
}

export interface MonitorEntry {
  id: number;
  port: string;
  channel: number;
  text: string;
  /** Tracks this message reaches (same input and channel). */
  tracks: string[];
}

export type View =
  | { name: 'performance' }
  | { name: 'track'; trackId: string }
  | { name: 'templates' }
  | { name: 'instruments' }
  | { name: 'setup' }
  | { name: 'harmony' };

export interface LogEntry {
  id: number;
  bar: number;
  text: string;
  color: string;
}

/** Fast-changing playback state, read by components in an animation frame. */
export interface LiveState {
  step: number;
  bar: number;
  chord: string;
  /** Last sounding notes per track, and when they stop. */
  now: Record<string, { notes: MidiNote[]; until: number }>;
}

type Pending =
  | { at: number; kind: 'step'; step: number; bar: number }
  | { at: number; kind: 'chord'; chord: string }
  | { at: number; kind: 'note'; trackId: string; notes: MidiNote[]; until: number };

/**
 * Application state + actions. The UI calls actions and re-renders on
 * change; it never touches the engine directly.
 */
export class AppStore {
  readonly midi = new MidiHub();
  readonly midiGuide = new MidiGuideClient();
  readonly library = new InstrumentLibrary(new IndexedDbInstrumentStore());
  private repo = new IndexedDbProjectRepository();
  /** Worker-driven timer: keeps the scheduler ticking in background tabs. */
  private readonly clock = createWorkerTimerHost();

  project: ProjectState;
  sequencer: Sequencer;
  /** The user's hardware setup, shared by all projects on this device. */
  rack: Rack = loadRack();
  view: View = { name: 'performance' };
  ports: string[] = [];
  /** Connected MIDI inputs. */
  inputs: string[] = [];
  /** Recording knob movements into a motion, if armed or running. */
  recording:
    | { trackId: string; bars: number; startStep?: number; values: Map<number, (number | undefined)[]>; current: Map<number, number> }
    | undefined;
  /** Last time each track received a knob from its synth (performance.now). */
  readonly lastInput = new Map<string, number>();
  private inQueue = new Map<string, { trackId: string; cc: number; value: number }>();
  private inFrame = 0;
  instruments: InstalledInstrument[] = [];
  projects: ProjectSummary[] = [];
  log: LogEntry[] = [];
  toast: string | undefined;
  /** Keyboard shortcut overlay. */
  shortcutsOpen = false;
  /** Open tab of the track detail pane; kept when switching tracks. */
  trackTab: SectionId = 'overview';
  readonly live: LiveState = { step: -1, bar: 0, chord: '', now: {} };

  private listeners = new Set<() => void>();
  private pending: Pending[] = [];
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private logId = 0;
  private lastStepAt = 0;
  private unsubscribers: (() => void)[] = [];
  /** Stream to the visuals window, if one is open. */
  readonly visuals = typeof window !== 'undefined' ? new VisualsLink() : undefined;
  private visualsTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    this.project = assignDevices(createProject('deep-house'), this.rack);
    this.sequencer = this.createSequencer(this.project);
  }

  /** The project with outputs, instruments and clock taken from the rack. */
  private engineView(project: ProjectState = this.project): ProjectState {
    const resolved = resolveProject(project, this.rack);
    // Per-instrument extras the engine needs, e.g. the TB-03's slide CC.
    const tracks = resolved.tracks.map((t) => {
      const slide = this.instrument(t.instrumentId)?.params.find((p) => /\bslide\b/i.test(p.name) && p.msg.type === 'cc');
      const slideCc = slide?.msg.type === 'cc' ? slide.msg.cc : undefined;
      return slideCc === t.slideCc ? t : { ...t, slideCc };
    });
    return { ...resolved, tracks };
  }

  async init(): Promise<void> {
    const { lastProjectId } = loadSettings();
    const stored = lastProjectId ? await this.repo.load(lastProjectId).catch(() => undefined) : undefined;
    if (stored) this.open(stored);
    else {
      // First run: remember the starter project so work survives a reload.
      saveSettings({ lastProjectId: this.project.id });
      await this.repo.save(this.project).catch(() => undefined);
    }
    this.midi.onChange(() => this.refreshPorts());
    this.midi.onMessage((port, data) => this.onMidiIn(port, data));
    this.refreshPorts();
    document.addEventListener('visibilitychange', () => {
      this.sequencer.setBackground(document.hidden);
      if (document.hidden && this.saveTimer) this.flushSave();
    });
    window.addEventListener('pagehide', () => {
      if (this.saveTimer) this.flushSave();
    });
    await Promise.all([this.refreshInstruments(), this.refreshProjects()]);
    // Reconnect silently if MIDI permission was granted before.
    try {
      const perm = await navigator.permissions?.query({ name: 'midi' as PermissionName });
      if (perm?.state === 'granted') await this.connectMidi();
    } catch {
      /* permissions API without 'midi' support */
    }
    this.startLiveLoop();
    this.notify();
  }

  // ---------- subscription ----------

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    this.listeners.forEach((l) => l());
    if (this.visuals?.active && !this.visualsTimer) {
      this.visualsTimer = setTimeout(() => {
        this.visualsTimer = undefined;
        this.sendVisualsState();
      }, 200);
    }
  }

  openVisuals(): void {
    if (!this.visuals) return;
    this.visuals.onHello = () => this.sendVisualsState();
    this.visuals.open();
  }

  private sendVisualsState(): void {
    if (!this.visuals?.active) return;
    const soloed = this.project.tracks.some((t) => t.solo);
    const chord = this.sequencer.harmonyAt(Math.max(0, this.live.bar)).chord;
    this.visuals.send({
      t: 'state',
      tracks: this.project.tracks.map((t) => ({
        id: t.id,
        name: t.name,
        color: t.color,
        type: t.generator.type,
        silent: t.muted || (soloed && !t.solo),
      })),
      bpm: this.project.bpm,
      playing: this.sequencer.playing,
      stepsPerBar: this.project.stepsPerBar,
      chord: chord.symbol(),
      chordPcs: [...chord.tones],
    });
  }

  // ---------- navigation & feedback ----------

  go(view: View): void {
    this.view = view;
    this.notify();
  }

  setTrackTab(tab: SectionId): void {
    this.trackTab = tab;
    this.notify();
  }

  setShortcutsOpen(open: boolean): void {
    this.shortcutsOpen = open;
    this.notify();
  }

  /** The track shown in the detail pane, if any. */
  get currentTrack(): TrackState | undefined {
    const v = this.view;
    return v.name === 'track' ? this.project.tracks.find((t) => t.id === v.trackId) : undefined;
  }

  showToast(text: string): void {
    this.toast = text;
    this.notify();
    setTimeout(() => {
      if (this.toast === text) {
        this.toast = undefined;
        this.notify();
      }
    }, 4000);
  }

  // ---------- MIDI ----------

  async connectMidi(): Promise<void> {
    try {
      await this.midi.connect();
      this.refreshPorts();
    } catch (e) {
      this.showToast(e instanceof Error ? e.message : String(e));
    }
  }

  private refreshPorts(): void {
    this.ports = this.midi.all().map((p) => p.name);
    this.inputs = this.midi.inputs();
    this.notify();
  }

  /** The MIDI input a track's synth sends its knobs on, if any. */
  trackInput(t: TrackState): string | undefined {
    const out = this.trackOutput(t);
    const d = this.device(t.deviceId);
    return inputForDevice(d ?? { id: '', name: '', portName: out.portName, channel: out.channel, roles: [], clock: false }, this.inputs);
  }

  /** Last incoming MIDI messages, newest first, for the monitor. */
  monitor: MonitorEntry[] = [];
  monitorOpen = false;
  private monitorFrame = 0;
  private nrpn = new Map<string, { msb?: number; lsb?: number }>();

  private logIncoming(port: string, data: Uint8Array): void {
    if (!this.monitorOpen) return;
    const status = data[0]!;
    const ch = (status & 0x0f) + 1;
    const type = status & 0xf0;
    let text: string;
    if (type === 0xb0) {
      const cc = data[1]!;
      const v = data[2]!;
      const key = `${port}:${ch}`;
      const n = this.nrpn.get(key) ?? {};
      if (cc === 99) n.msb = v;
      if (cc === 98) n.lsb = v;
      this.nrpn.set(key, n);
      text =
        cc === 6 && n.msb !== undefined && n.lsb !== undefined
          ? `NRPN ${n.msb}:${n.lsb} = ${v}`
          : cc === 99 || cc === 98 || cc === 38
            ? `NRPN part (CC ${cc} = ${v})`
            : `CC ${cc} = ${v}`;
    } else if (type === 0x90 && data[2]! > 0) text = `Note on ${data[1]} vel ${data[2]}`;
    else if (type === 0x80 || type === 0x90) text = `Note off ${data[1]}`;
    else if (type === 0xc0) text = `Program ${data[1]}`;
    else if (type === 0xe0) text = `Pitch bend ${(data[2]! << 7) | data[1]!}`;
    else if (type === 0xd0) text = `Aftertouch ${data[1]}`;
    else text = [...data].map((b) => b.toString(16).padStart(2, '0')).join(' ');
    const tracks = this.project.tracks
      .filter((t) => this.trackOutput(t).channel === ch && this.trackInput(t) === port)
      .map((t) => t.name);
    this.monitor = [{ id: ++this.logId, port, channel: ch, text, tracks }, ...this.monitor].slice(0, 40);
    if (!this.monitorFrame) {
      this.monitorFrame = requestAnimationFrame(() => {
        this.monitorFrame = 0;
        this.notify();
      });
    }
  }

  setMonitorOpen(open: boolean): void {
    this.monitorOpen = open;
    if (!open) this.monitor = [];
  }

  /** A knob turned on a synth: show it, pause automation on it, record it. */
  private onMidiIn(port: string, data: Uint8Array): void {
    this.logIncoming(port, data);
    const status = data[0]!;
    if ((status & 0xf0) !== 0xb0 || data.length < 3) return;
    const channel = (status & 0x0f) + 1;
    const cc = data[1]!;
    const value = data[2]!;
    const now = performance.now();
    for (const t of this.project.tracks) {
      if (this.trackOutput(t).channel !== channel || this.trackInput(t) !== port) continue;
      // Don't fight the hand: LFOs and motions on this CC wait until it rests.
      this.sequencer.holdCc(t.id, cc, now + 1500);
      this.lastInput.set(t.id, now);
      this.inQueue.set(`${t.id}:${cc}`, { trackId: t.id, cc, value });
      this.visuals?.send({ t: 'cc', track: t.id, cc, value });
      this.recordCc(t.id, cc, value);
    }
    if (this.inQueue.size && !this.inFrame) {
      this.inFrame = requestAnimationFrame(() => {
        this.inFrame = 0;
        const batch = [...this.inQueue.values()];
        this.inQueue.clear();
        this.change((p) => ({
          ...p,
          tracks: p.tracks.map((t) => {
            const mine = batch.filter((b) => b.trackId === t.id);
            if (!mine.length) return t;
            const values = { ...(t.panel?.values ?? {}) };
            for (const b of mine) values[b.cc] = b.value;
            return { ...t, panel: { ...(t.panel ?? {}), values } };
          }),
        }));
      });
    }
  }

  // ---------- motion recording ----------

  startMotionRecording(trackId: string, bars: number): void {
    if (!this.sequencer.playing) {
      this.showToast('Press Play first: recording starts on the next bar.');
      return;
    }
    this.recording = { trackId, bars, values: new Map(), current: new Map() };
    this.notify();
  }

  cancelMotionRecording(): void {
    this.recording = undefined;
    this.notify();
  }

  private recordCc(trackId: string, cc: number, value: number): void {
    const rec = this.recording;
    if (!rec || rec.trackId !== trackId) return;
    rec.current.set(cc, value);
    if (!rec.values.has(cc)) rec.values.set(cc, []);
  }

  /** Called as each step is heard: samples the knobs being recorded. */
  private onLiveStep(step: number): void {
    const rec = this.recording;
    if (!rec) return;
    const spb = this.project.stepsPerBar;
    if (rec.startStep === undefined) {
      if (step % spb !== 0) return;
      rec.startStep = step;
      this.notify();
    }
    const idx = step - rec.startStep;
    const total = rec.bars * spb;
    if (idx >= total || idx < 0) {
      this.commitMotion();
      return;
    }
    for (const [cc, arr] of rec.values) {
      const v = rec.current.get(cc);
      if (v !== undefined) arr[idx] = v;
    }
  }

  private commitMotion(): void {
    const rec = this.recording;
    this.recording = undefined;
    const t = rec && this.project.tracks.find((x) => x.id === rec.trackId);
    if (!rec || !t) return this.notify();
    const total = rec.bars * this.project.stepsPerBar;
    const params = this.trackInstrument(t)?.params ?? [];
    const made: CcMotion[] = [];
    for (const [cc, raw] of rec.values) {
      const values: number[] = [];
      let last = raw.find((v) => v !== undefined);
      if (last === undefined) continue;
      for (let i = 0; i < total; i++) {
        if (raw[i] !== undefined) last = raw[i]!;
        values.push(last);
      }
      if (values.every((v) => v === values[0])) continue;
      const name = params.find((p) => p.msg.type === 'cc' && p.msg.cc === cc)?.name ?? `CC ${cc}`;
      made.push({ id: newId(), cc, label: name, enabled: true, values });
    }
    if (!made.length) {
      this.showToast('Nothing recorded: no knob moved during the recording.');
      return this.notify();
    }
    const keep = (t.motions ?? []).filter((m) => !made.some((n) => n.cc === m.cc));
    this.updateTrack(t.id, { motions: [...keep, ...made] });
    this.showToast(`Recorded ${made.map((m) => m.label).join(', ')} · ${rec.bars} bar${rec.bars === 1 ? '' : 's'}, looping.`);
  }

  updateMotion(trackId: string, id: string, patch: Partial<CcMotion> | null): void {
    const t = this.project.tracks.find((x) => x.id === trackId);
    if (!t) return;
    const motions = (t.motions ?? []).flatMap((m) => (m.id !== id ? [m] : patch === null ? [] : [{ ...m, ...patch }]));
    this.updateTrack(trackId, { motions });
  }

  portAvailable(name: string): boolean {
    return this.ports.includes(name);
  }

  // ---------- transport ----------

  async togglePlay(): Promise<void> {
    if (this.sequencer.playing) {
      this.sequencer.stop();
    } else {
      const ports = this.engineView().tracks.map((t) => t.output.portName);
      // Only ask for MIDI access when a track actually plays hardware.
      if (!this.midi.connected && !ports.every(isLocalPort)) await this.connectMidi();
      await this.midi.wakeAudioFor(ports);
      this.sequencer.start();
    }
    this.notify();
  }

  // ---------- project ----------

  private createSequencer(project: ProjectState): Sequencer {
    this.unsubscribers.forEach((u) => u());
    const seq = new Sequencer(this.engineView(project), this.midi, this.clock);
    seq.setBackground(typeof document !== 'undefined' && document.hidden);
    const ev = seq.events;
    this.unsubscribers = [
      ev.on('step', ({ step, bar, timeMs }) => {
        this.lastStepAt = timeMs;
        // Animation frames pause in a hidden tab; don't let the display queue grow.
        if (this.pending.length > 2000) this.pending.splice(0, this.pending.length - 1000);
        this.pending.push({ at: timeMs, kind: 'step', step, bar });
        this.visuals?.send({ t: 'step', step, bar, at: toEpoch(timeMs) });
      }),
      ev.on('chord', ({ chord }) => {
        this.pending.push({ at: this.lastStepAt, kind: 'chord', chord: chord.symbol() });
        this.visuals?.send({ t: 'chord', name: chord.symbol(), pcs: [...chord.tones], at: toEpoch(this.lastStepAt) });
      }),
      ev.on('note', ({ trackId, notes, velocity, timeMs, durationMs }) => {
        this.pending.push({ at: timeMs, kind: 'note', trackId, notes, until: timeMs + durationMs });
        this.visuals?.send({ t: 'note', track: trackId, notes: [...notes], vel: velocity, at: toEpoch(timeMs), dur: durationMs });
      }),
      ev.on('lfo', ({ trackId, value, timeMs }) => this.visuals?.send({ t: 'lfo', track: trackId, value, at: toEpoch(timeMs) })),
      ev.on('mutation', ({ trackId, bar, kind }) => {
        const t = this.project.tracks.find((x) => x.id === trackId);
        const text = kind === 'theme' ? 'back to the theme' : kind === 'recall' ? 'recalls an earlier variation' : 'pattern mutated';
        if (t) this.addLog(bar, `${t.name} · ${text}`, t.color);
      }),
      ev.on('transport', ({ playing }) => {
        void keepAwake(playing);
        this.notify();
      }),
      ev.on('skipped', ({ gapMs }) => {
        if (gapMs > 1000) this.showToast(`The browser paused Drift for ${(gapMs / 1000).toFixed(1)} s; playback skipped ahead.`);
      }),
      ev.on('safetyStop', ({ perSecond }) =>
        this.showToast(`Stopped for safety: ${perSecond} MIDI messages per second is far more than normal.`),
      ),
      ev.on('loop', ({ loop, bar }) => this.onProgressionLoop(loop, bar)),
    ];
    return seq;
  }

  open(incoming: ProjectState): void {
    const wasPlaying = this.sequencer.playing;
    this.sequencer.stop();
    // Tracks pick up this device's synths by role (templates, imports, old projects).
    const project = assignDevices(normalizeDrums(incoming), this.rack);
    this.project = project;
    this.sequencer = this.createSequencer(project);
    this.live.step = -1;
    this.live.now = {};
    this.log = [];
    this.view = { name: 'performance' };
    saveSettings({ lastProjectId: project.id });
    void this.repo.save(project).then(() => this.refreshProjects());
    if (wasPlaying) this.sequencer.start();
    this.notify();
  }

  newFromTemplate(templateId: string): void {
    this.open(createProject(templateId));
  }

  async openSaved(id: string): Promise<void> {
    const p = await this.repo.load(id);
    if (p) this.open(p);
  }

  async deleteSaved(id: string): Promise<void> {
    await this.repo.remove(id);
    await this.refreshProjects();
  }

  private async refreshProjects(): Promise<void> {
    this.projects = await this.repo.list().catch(() => []);
    this.notify();
  }

  /** Every edit goes through here: new state → engine → autosave → render. */
  change(mutator: (p: ProjectState) => ProjectState): void {
    this.project = mutator(this.project);
    this.sequencer.update(this.engineView());
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flushSave(), 600);
    this.notify();
  }

  private flushSave(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    saveSettings({ lastProjectId: this.project.id });
    void this.repo.save(this.project).then(() => this.refreshProjects());
  }

  updateTrack(id: string, patch: Partial<TrackState>): void {
    this.change((p) => ({ ...p, tracks: p.tracks.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
  }

  setTrackParam(id: string, key: string, value: unknown): void {
    const t = this.project.tracks.find((x) => x.id === id);
    if (!t) return;
    const generator = { ...t.generator, params: { ...t.generator.params, [key]: value } } as GeneratorConfig;
    this.updateTrack(id, { generator });
  }

  /** Change a track's pattern length; the current pattern repeats or is trimmed. */
  setTrackLength(id: string, lengthSteps: number): void {
    const t = this.project.tracks.find((x) => x.id === id);
    if (!t) return;
    const generator = { ...t.generator, params: { ...t.generator.params, lengthSteps } } as GeneratorConfig;
    if (t.userPattern) this.updateTrack(id, { generator, userPattern: resizePattern(t.userPattern, lengthSteps) });
    else this.updateTrack(id, { generator });
  }

  setTrackType(id: string, type: TrackType): void {
    const t = this.project.tracks.find((x) => x.id === id);
    if (!t || t.generator.type === type) return;
    const generator = defaultConfig(type);
    const fresh = createTrack({ name: t.name, color: t.color, type, output: t.output });
    // Moving between e.g. melody and drums also moves to the matching device.
    const role = roleForType(type);
    const device = roleOf(t) !== role ? deviceForRole(this.rack, role) : undefined;
    this.updateTrack(id, {
      generator,
      register: fresh.register,
      userPattern: undefined,
      role,
      ...(device ? { deviceId: device.id } : {}),
    });
  }

  addTrack(): void {
    const colors = Object.values(TRACK_COLORS);
    const track = createTrack({
      name: `Track ${this.project.tracks.length + 1}`,
      color: colors[this.project.tracks.length % colors.length]!,
      type: 'motif',
      output: { portName: this.ports[0] ?? 'Lead synth', channel: Math.min(16, this.project.tracks.length + 1) },
    });
    const device = deviceForRole(this.rack, 'lead');
    if (device) track.deviceId = device.id;
    this.change((p) => ({ ...p, tracks: [...p.tracks, track] }));
    this.go({ name: 'track', trackId: track.id });
  }

  removeTrack(id: string): void {
    this.change((p) => ({ ...p, tracks: p.tracks.filter((t) => t.id !== id) }));
    this.go({ name: 'performance' });
  }

  /**
   * Apply a user edit to a track's current pattern. The result is saved in
   * the project; the track is frozen so the edit isn't mutated away.
   */
  editPattern(id: string, edit: (p: Pattern) => Pattern): void {
    const rt = this.sequencer.track(id);
    const t = this.project.tracks.find((x) => x.id === id);
    if (!rt || !t) return;
    const userPattern = edit(rt.pattern);
    if (!t.frozen) this.showToast(`${t.name} is frozen so your edit stays. Unfreeze it to let it evolve.`);
    this.updateTrack(id, { userPattern, frozen: true });
  }

  /** Load a ready-made groove into a drum track (keeps its length). */
  loadDrumPreset(id: string, presetId: string): void {
    const t = this.project.tracks.find((x) => x.id === id);
    const preset = DRUM_PRESETS.find((p) => p.id === presetId);
    if (!t || t.generator.type !== 'drums' || !preset) return;
    const lengthSteps = t.generator.params.lengthSteps;
    const generator = { ...t.generator, params: { ...t.generator.params, voices: presetVoices(preset) } };
    this.updateTrack(id, { generator, userPattern: presetPattern(preset, lengthSteps), frozen: true });
    this.addLog(Math.max(0, this.live.bar), `${t.name} · ${preset.name}`, t.color);
    this.showToast(`${preset.name} loaded (suggested ${preset.bpm} BPM). Frozen; unfreeze to let it evolve.`);
  }

  /** Turn a knob on the panel: remember the value and send it to the synth. */
  setPanelValue(id: string, cc: number, value: number): void {
    const t = this.project.tracks.find((x) => x.id === id);
    if (!t) return;
    const v = Math.max(0, Math.min(127, Math.round(value)));
    const panel = t.panel ?? { values: {} };
    if (panel.values[cc] === v) return;
    this.updateTrack(id, { panel: { ...panel, values: { ...panel.values, [cc]: v } } });
    this.queueCc(t, cc, v);
    this.sequencer.holdCc(id, cc, performance.now() + 1500);
    this.recordCc(id, cc, v);
    this.visuals?.send({ t: 'cc', track: id, cc, value: v });
  }

  /** Send every stored panel value, so the synth matches what Drift shows. */
  sendPanel(id: string, values?: Record<string, number>): void {
    const t = this.project.tracks.find((x) => x.id === id);
    if (!t) return;
    const all = values ?? t.panel?.values ?? {};
    for (const [cc, v] of Object.entries(all)) this.queueCc(t, Number(cc), v);
    if (!this.portForTrack(t)) this.showToast(`${t.name}: MIDI port not connected.`);
  }

  storePanelSnapshot(id: string, slot: string): void {
    const t = this.project.tracks.find((x) => x.id === id);
    if (!t) return;
    const panel = t.panel ?? { values: {} };
    this.updateTrack(id, { panel: { ...panel, snapshots: { ...panel.snapshots, [slot]: { ...panel.values } } } });
    this.showToast(`Snapshot ${slot} stored.`);
  }

  recallPanelSnapshot(id: string, slot: string): void {
    const t = this.project.tracks.find((x) => x.id === id);
    const snap = t?.panel?.snapshots?.[slot];
    if (!t || !snap) return;
    this.updateTrack(id, { panel: { ...t.panel!, values: { ...t.panel!.values, ...snap } } });
    this.sendPanel(id, snap);
  }

  private portForTrack(t: TrackState) {
    return this.midi.byName(this.trackOutput(t).portName);
  }

  /** Knob moves are coalesced per CC and sent once per animation frame. */
  private ccQueue = new Map<string, { trackId: string; cc: number; value: number }>();
  private ccFrame = 0;
  private queueCc(t: TrackState, cc: number, value: number): void {
    this.ccQueue.set(`${t.id}:${cc}`, { trackId: t.id, cc, value });
    if (this.ccFrame) return;
    this.ccFrame = requestAnimationFrame(() => {
      this.ccFrame = 0;
      const batch = [...this.ccQueue.values()];
      this.ccQueue.clear();
      for (const m of batch) {
        const track = this.project.tracks.find((x) => x.id === m.trackId);
        const port = track && this.portForTrack(track);
        if (!port || !track) continue;
        port.send(Midi.cc(this.trackOutput(track).channel, m.cc, m.value));
      }
    });
  }

  /** Mute or unmute one drum voice (by note); the pattern stays as it is. */
  toggleDrumVoiceMute(id: string, note: number): void {
    const t = this.project.tracks.find((x) => x.id === id);
    if (!t || t.generator.type !== 'drums') return;
    this.setTrackParam(id, 'voices', t.generator.params.voices.map((v) => (v.note === note ? { ...v, muted: !v.muted } : v)));
  }

  /** Give a drum track a lane for every TR-8S instrument it doesn't have yet. */
  addAllTr8sVoices(id: string): void {
    const t = this.project.tracks.find((x) => x.id === id);
    if (!t || t.generator.type !== 'drums') return;
    const have = new Set(t.generator.params.voices.map((v) => v.note));
    const voices = orderDrumVoices([...t.generator.params.voices, ...tr8sVoices().filter((v) => !have.has(v.note))]);
    this.setTrackParam(id, 'voices', voices);
  }

  regenerate(id: string): void {
    const t = this.project.tracks.find((x) => x.id === id);
    if (t?.userPattern) this.updateTrack(id, { userPattern: undefined });
    this.sequencer.track(id)?.regenerate();
    if (t) this.addLog(Math.max(0, this.live.bar), `${t.name} · new pattern`, t.color);
    this.notify();
  }

  restoreVariation(id: string, index: number): void {
    this.sequencer.track(id)?.restore(index);
    this.notify();
  }

  exportProject(): void {
    const blob = new Blob([serializeProject(this.project)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${this.project.name.replace(/\s+/g, '-').toLowerCase() || 'project'}.drift.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async importProject(file: File): Promise<void> {
    try {
      this.open(deserializeProject(await file.text()));
      this.showToast(`Imported “${this.project.name}”`);
    } catch (e) {
      this.showToast(e instanceof Error ? e.message : String(e));
    }
  }

  // ---------- harmony ----------

  private harmonyRng = new Rng();

  /** Write a new progression in the given style. */
  generateProgression(style: ProgressionStyle, length?: number): void {
    const scale = new Scale(this.project.key.root, this.project.key.mode);
    const progression = generateProgression(scale, style, this.harmonyRng, length);
    this.change((p) => ({ ...p, progression }));
  }

  /** Swap one chord for a functional substitute. */
  varyProgression(style: ProgressionStyle): void {
    const scale = new Scale(this.project.key.root, this.project.key.mode);
    const progression = varyProgression(this.project.progression, scale, style, this.harmonyRng);
    this.change((p) => ({ ...p, progression }));
  }

  progressionLabel(): string {
    const scale = new Scale(this.project.key.root, this.project.key.mode);
    return this.project.progression.map((s) => Chord.fromDegree(scale, s.degree, s.size ?? 3).symbol()).join(' – ');
  }

  /** Called by the engine right before the progression starts again. */
  private onProgressionLoop(loop: number, bar: number): void {
    const evolve = this.project.harmonyEvolve;
    if (!evolve?.enabled || loop % Math.max(1, evolve.everyLoops) !== 0) return;
    if (evolve.mode === 'new') this.generateProgression(evolve.style);
    else this.varyProgression(evolve.style);
    this.addLog(bar, `Progression · ${this.progressionLabel()}`, '#f2f4f7');
  }

  // ---------- instruments ----------

  async refreshInstruments(): Promise<void> {
    this.instruments = await this.library.list().catch(() => []);
    // Instrument extras (e.g. slide CC) feed the engine.
    this.sequencer.update(this.engineView());
    this.notify();
  }

  // ---------- rack ----------

  /** Replace the device setup; `reassign` re-picks every track's device by role. */
  setRack(rack: Rack, reassign = false): void {
    this.rack = rack;
    saveRack(rack);
    const assigned = assignDevices(this.project, rack, reassign);
    if (assigned !== this.project) this.change(() => assigned);
    else {
      this.sequencer.update(this.engineView());
      this.notify();
    }
  }

  updateDevice(id: string, patch: Partial<RackDevice>): void {
    this.setRack({ devices: this.rack.devices.map((d) => (d.id === id ? { ...d, ...patch } : d)) });
  }

  /** Play a short C-E-G figure on a device, to check that it receives. */
  async testDevice(id: string, channel?: number): Promise<boolean> {
    const d = this.device(id);
    if (!d) return false;
    if (!this.midi.connected) await this.connectMidi();
    await this.midi.wakeAudioFor([d.portName]);
    const port = this.midi.byName(d.portName);
    if (!port) {
      this.showToast(`${d.name}: port “${d.portName}” is not connected.`);
      return false;
    }
    const ch = channel ?? d.channel;
    const base = d.roles.includes('drums') ? 36 : d.roles.includes('bass') ? 36 : 60;
    const now = performance.now() + 20;
    const notes = d.roles.includes('drums') ? [36, 38, 42] : [base, base + 4, base + 7];
    notes.forEach((n, i) => {
      port.send(Midi.noteOn(ch, n, 100), now + i * 180);
      port.send(Midi.noteOff(ch, n), now + i * 180 + 150);
    });
    return true;
  }

  /**
   * Four notes to hear how a 303-style synth handles accent and slide:
   * plain → accent → slide up an octave → slide down with accent.
   */
  async acidTest(id: string): Promise<void> {
    const d = this.device(id);
    if (!d) return;
    if (!this.midi.connected) await this.connectMidi();
    await this.midi.wakeAudioFor([d.portName]);
    const port = this.midi.byName(d.portName);
    if (!port) return this.showToast(`${d.name}: port “${d.portName}” is not connected.`);
    const ch = d.channel;
    const slideCc = this.instrument(d.instrumentId)?.params.find((p) => /\bslide\b/i.test(p.name) && p.msg.type === 'cc');
    const cc = slideCc?.msg.type === 'cc' ? slideCc.msg.cc : undefined;
    const step = 260;
    const t0 = performance.now() + 30;
    const plan = [
      { note: 36, vel: 80, slide: false },
      { note: 36, vel: 127, slide: false },
      { note: 48, vel: 80, slide: true },
      { note: 43, vel: 127, slide: true },
    ];
    plan.forEach((p, i) => {
      const at = t0 + i * step;
      if (cc !== undefined) port.send(Midi.cc(ch, cc, p.slide ? 127 : 0), at - 1);
      port.send(Midi.noteOn(ch, p.note, p.vel), at);
      const nextSlides = plan[i + 1]?.slide;
      port.send(Midi.noteOff(ch, p.note), nextSlides ? at + step + 15 : at + step * 0.58);
    });
    if (cc !== undefined) port.send(Midi.cc(ch, cc, 0), t0 + plan.length * step);
  }

  removeDevice(id: string): void {
    this.setRack({ devices: this.rack.devices.filter((d) => d.id !== id) });
  }

  device(id: string | undefined): RackDevice | undefined {
    return id ? this.rack.devices.find((d) => d.id === id) : undefined;
  }

  trackOutput(track: TrackState): MidiTarget {
    return effectiveOutput(track, this.rack);
  }

  trackInstrument(track: TrackState): InstrumentDefinition | undefined {
    return this.instrument(effectiveInstrumentId(track, this.rack));
  }

  instrument(id: string | undefined): InstrumentDefinition | undefined {
    return id ? this.instruments.find((i) => i.definition.id === id)?.definition : undefined;
  }

  async importInstrument(def: InstrumentDefinition): Promise<void> {
    await this.library.import(def);
    await this.refreshInstruments();
    this.showToast(`Imported ${def.manufacturer} ${def.device} (${def.params.length} parameters)`);
  }

  async removeInstrument(id: string): Promise<void> {
    await this.library.remove(id);
    await this.refreshInstruments();
  }

  // ---------- live loop ----------

  private addLog(bar: number, text: string, color: string): void {
    this.log = [{ id: ++this.logId, bar, text, color }, ...this.log].slice(0, 30);
    this.notify();
  }

  /** Applies scheduled events when their audio time arrives. */
  private startLiveLoop(): void {
    const frame = () => {
      const now = performance.now();
      if (this.pending.length) {
        const due = this.pending.filter((p) => p.at <= now);
        if (due.length) {
          this.pending = this.pending.filter((p) => p.at > now);
          for (const p of due) {
            if (p.kind === 'step') {
              this.live.step = p.step;
              this.live.bar = p.bar;
              this.onLiveStep(p.step);
            } else if (p.kind === 'chord') this.live.chord = p.chord;
            else this.live.now[p.trackId] = { notes: p.notes, until: p.until };
          }
        }
      }
      if (!this.sequencer.playing && this.pending.length === 0) this.live.now = {};
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }
}

export const store = new AppStore();

/** Re-render on any store change. */
export function useStore(): AppStore {
  const [, setTick] = useState(0);
  useEffect(() => store.subscribe(() => setTick((t) => t + 1)), []);
  return store;
}

/**
 * All live-state readers share ONE animation-frame loop (not one each), and
 * compare values shallowly, so many widgets on screen stay cheap.
 */
const liveReaders = new Set<() => void>();
let liveRaf = 0;
function liveLoop() {
  liveReaders.forEach((r) => r());
  liveRaf = liveReaders.size ? requestAnimationFrame(liveLoop) : 0;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/** Read a value from live state each frame; re-render only when it changes. */
export function useLive<T>(select: (live: LiveState) => T): T {
  const [value, setValue] = useState(() => select(store.live));
  const ref = useRef(value);
  const selectRef = useRef(select);
  selectRef.current = select;
  useEffect(() => {
    const reader = () => {
      const next = selectRef.current(store.live);
      if (!sameValue(next, ref.current)) {
        ref.current = next;
        setValue(next);
      }
    };
    liveReaders.add(reader);
    if (!liveRaf) liveRaf = requestAnimationFrame(liveLoop);
    return () => {
      liveReaders.delete(reader);
    };
  }, []);
  return value;
}
