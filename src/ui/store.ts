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
import { WebMidiService } from '../io/midi/webMidiService';
import { MidiGuideClient } from '../io/midiGuideClient';
import { IndexedDbInstrumentStore, InstrumentLibrary, type InstalledInstrument } from '../state/instrumentLibrary';
import type { MidiTarget, ProjectState, TrackState } from '../state/project';
import {
  assignDevices,
  deviceForRole,
  effectiveInstrumentId,
  effectiveOutput,
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
  readonly midi = new WebMidiService();
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
    this.notify();
  }

  portAvailable(name: string): boolean {
    return this.ports.includes(name);
  }

  // ---------- transport ----------

  async togglePlay(): Promise<void> {
    if (this.sequencer.playing) {
      this.sequencer.stop();
    } else {
      if (!this.midi.connected) await this.connectMidi();
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
      }),
      ev.on('chord', ({ chord }) => this.pending.push({ at: this.lastStepAt, kind: 'chord', chord: chord.symbol() })),
      ev.on('note', ({ trackId, notes, timeMs, durationMs }) =>
        this.pending.push({ at: timeMs, kind: 'note', trackId, notes, until: timeMs + durationMs }),
      ),
      ev.on('mutation', ({ trackId, bar }) => {
        const t = this.project.tracks.find((x) => x.id === trackId);
        if (t) this.addLog(bar, `${t.name} · pattern mutated`, t.color);
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
