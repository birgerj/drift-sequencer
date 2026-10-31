import { useEffect, useRef, useState } from 'preact/hooks';
import { Sequencer } from '../core/engine/sequencer';
import { defaultConfig, type GeneratorConfig } from '../core/generators/registry';
import type { TrackType } from '../core/generators/types';
import type { InstrumentDefinition } from '../core/instruments/instrument';
import type { MidiNote } from '../core/theory/note';
import { WebMidiService } from '../io/midi/webMidiService';
import { MidiGuideClient } from '../io/midiGuideClient';
import { IndexedDbInstrumentStore, InstrumentLibrary, type InstalledInstrument } from '../state/instrumentLibrary';
import type { ProjectState, TrackState } from '../state/project';
import {
  deserializeProject,
  IndexedDbProjectRepository,
  loadSettings,
  saveSettings,
  serializeProject,
  type ProjectSummary,
} from '../state/storage';
import { createProject, createTrack, TRACK_COLORS } from '../state/templates';

export type View =
  | { name: 'performance' }
  | { name: 'track'; trackId: string }
  | { name: 'templates' }
  | { name: 'instruments' }
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

  project: ProjectState;
  sequencer: Sequencer;
  view: View = { name: 'performance' };
  ports: string[] = [];
  instruments: InstalledInstrument[] = [];
  projects: ProjectSummary[] = [];
  log: LogEntry[] = [];
  toast: string | undefined;
  readonly live: LiveState = { step: -1, bar: 0, chord: '', now: {} };

  private listeners = new Set<() => void>();
  private pending: Pending[] = [];
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private logId = 0;
  private lastStepAt = 0;
  private unsubscribers: (() => void)[] = [];

  constructor() {
    this.project = createProject('deep-house');
    this.sequencer = this.createSequencer(this.project);
  }

  async init(): Promise<void> {
    const { lastProjectId } = loadSettings();
    if (lastProjectId) {
      const stored = await this.repo.load(lastProjectId).catch(() => undefined);
      if (stored) this.open(stored);
    }
    this.midi.onChange(() => this.refreshPorts());
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
    const seq = new Sequencer(project, this.midi);
    const ev = seq.events;
    this.unsubscribers = [
      ev.on('step', ({ step, bar, timeMs }) => {
        this.lastStepAt = timeMs;
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
      ev.on('transport', () => this.notify()),
    ];
    return seq;
  }

  open(project: ProjectState): void {
    const wasPlaying = this.sequencer.playing;
    this.sequencer.stop();
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
    this.sequencer.update(this.project);
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.repo.save(this.project).then(() => this.refreshProjects()), 600);
    this.notify();
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

  setTrackType(id: string, type: TrackType): void {
    const t = this.project.tracks.find((x) => x.id === id);
    if (!t || t.generator.type === type) return;
    const generator = defaultConfig(type);
    const fresh = createTrack({ name: t.name, color: t.color, type, output: t.output });
    this.updateTrack(id, { generator, register: fresh.register });
  }

  addTrack(): void {
    const colors = Object.values(TRACK_COLORS);
    const track = createTrack({
      name: `Track ${this.project.tracks.length + 1}`,
      color: colors[this.project.tracks.length % colors.length]!,
      type: 'motif',
      output: { portName: this.ports[0] ?? 'Lead synth', channel: Math.min(16, this.project.tracks.length + 1) },
    });
    this.change((p) => ({ ...p, tracks: [...p.tracks, track] }));
    this.go({ name: 'track', trackId: track.id });
  }

  removeTrack(id: string): void {
    this.change((p) => ({ ...p, tracks: p.tracks.filter((t) => t.id !== id) }));
    this.go({ name: 'performance' });
  }

  regenerate(id: string): void {
    this.sequencer.track(id)?.regenerate();
    const t = this.project.tracks.find((x) => x.id === id);
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

  // ---------- instruments ----------

  async refreshInstruments(): Promise<void> {
    this.instruments = await this.library.list().catch(() => []);
    this.notify();
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

/** Read a value from live state every animation frame; re-render only when it changes. */
export function useLive<T>(select: (live: LiveState) => T): T {
  const [value, setValue] = useState(() => select(store.live));
  const ref = useRef(value);
  const selectRef = useRef(select);
  selectRef.current = select;
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const next = selectRef.current(store.live);
      if (!Object.is(next, ref.current) && JSON.stringify(next) !== JSON.stringify(ref.current)) {
        ref.current = next;
        setValue(next);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return value;
}
