import { Sequencer } from '../core/engine/sequencer';
import { NOTE_NAMES, noteName } from '../core/theory/note';
import { WebMidiService } from '../io/midi/webMidiService';
import type { ProjectState, TrackState } from '../state/project';
import { IndexedDbProjectRepository, loadSettings, saveSettings, serializeProject, deserializeProject } from '../state/storage';
import { createProject, TEMPLATES } from '../state/templates';

/** Escape text for HTML; project files can be imported from anywhere. */
function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/**
 * Minimal, framework-free shell to exercise the engine. It only talks to the
 * Sequencer API and its events; swapping in React/Svelte later touches only
 * this folder.
 */
export class App {
  private midi = new WebMidiService();
  private repo = new IndexedDbProjectRepository();
  private sequencer: Sequencer;
  private project: ProjectState;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly root: HTMLElement) {
    this.project = createProject('deep-house');
    this.sequencer = new Sequencer(this.project, this.midi);
    this.wireEvents();
  }

  async init(): Promise<void> {
    const { lastProjectId } = loadSettings();
    if (lastProjectId) {
      const stored = await this.repo.load(lastProjectId).catch(() => undefined);
      if (stored) this.load(stored);
    }
    this.midi.onChange(() => this.render());
    this.render();
  }

  private load(project: ProjectState): void {
    this.sequencer.stop();
    this.project = project;
    this.sequencer = new Sequencer(project, this.midi);
    this.wireEvents();
    saveSettings({ lastProjectId: project.id });
  }

  private wireEvents(): void {
    const ev = this.sequencer.events;
    ev.on('step', ({ step, bar }) => {
      this.text('#position', `${String(bar + 1).padStart(3, '0')}.${Math.floor((step % 16) / 4) + 1}`);
    });
    ev.on('chord', ({ chord }) => this.text('#chord', chord.symbol()));
    ev.on('note', ({ trackId, notes }) => this.text(`[data-now="${trackId}"]`, notes.map(noteName).join(' ')));
    ev.on('mutation', ({ trackId, bar }) => this.log(`Bar ${bar + 1}: ${this.trackName(trackId)} mutated`));
    ev.on('transport', ({ playing }) => this.text('#play', playing ? 'Stop' : 'Play'));
  }

  /** Every edit goes through here: update state, push to engine, autosave. */
  private change(mutator: (p: ProjectState) => ProjectState): void {
    this.project = mutator(this.project);
    this.sequencer.update(this.project);
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.repo.save(this.project), 500);
    saveSettings({ lastProjectId: this.project.id });
  }

  private updateTrack(id: string, patch: Partial<TrackState>): void {
    this.change((p) => ({ ...p, tracks: p.tracks.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
  }

  private render(): void {
    const p = this.project;
    const ports = this.midi.all().map((o) => o.name);
    this.root.innerHTML = `
      <header class="bar">
        <strong class="logo">Drift</strong>
        <button id="connect">${this.midi.connected ? 'MIDI connected' : 'Connect MIDI'}</button>
        <button id="play" class="primary">${this.sequencer.playing ? 'Stop' : 'Play'}</button>
        <label>Tempo <input id="bpm" type="number" min="20" max="300" value="${Number(p.bpm)}"></label>
        <span>Key <b>${NOTE_NAMES[p.key.root] ?? '?'} ${esc(p.key.mode)}</b></span>
        <span>Chord <b id="chord">–</b></span>
        <span>Position <b id="position">001.1</b></span>
        <label>Template
          <select id="template">${TEMPLATES.map((t) => `<option value="${t.id}">${t.name}</option>`).join('')}</select>
        </label>
        <button id="export">Export</button>
        <label class="file">Import <input id="import" type="file" accept="application/json"></label>
      </header>
      <main class="tracks">
        ${p.tracks.map((t) => this.trackRow(t, ports)).join('')}
      </main>
      <section class="log" id="log"></section>`;
    this.bind();
  }

  private trackRow(t: TrackState, ports: string[]): string {
    const options = [...new Set([t.output.portName, ...ports])]
      .map((n) => `<option value="${esc(n)}" ${n === t.output.portName ? 'selected' : ''}>${esc(n)}</option>`)
      .join('');
    const id = esc(t.id);
    const color = /^#[0-9a-f]{3,8}$/i.test(t.color) ? t.color : '#f5a524';
    return `
      <article class="track" style="--accent:${color}">
        <span class="dot"></span>
        <b>${esc(t.name)}</b>
        <span class="type">${esc(t.generator.type)}</span>
        <select data-port="${id}" aria-label="MIDI output">${options}</select>
        <input data-channel="${id}" type="number" min="1" max="16" value="${Number(t.output.channel)}" aria-label="MIDI channel">
        <button data-mute="${id}" aria-pressed="${t.muted}">M</button>
        <button data-freeze="${id}" aria-pressed="${t.frozen}">Freeze</button>
        <button data-new="${id}">New</button>
        <span class="now" data-now="${id}"></span>
      </article>`;
  }

  private bind(): void {
    const $ = <T extends HTMLElement>(sel: string) => this.root.querySelector<T>(sel);
    $('#connect')?.addEventListener('click', async () => {
      try {
        await this.midi.connect();
      } catch (e) {
        this.log(String(e));
      }
      this.render();
    });
    $('#play')?.addEventListener('click', () => (this.sequencer.playing ? this.sequencer.stop() : this.sequencer.start()));
    $<HTMLInputElement>('#bpm')?.addEventListener('change', (e) => {
      const bpm = Number((e.target as HTMLInputElement).value);
      this.change((p) => ({ ...p, bpm }));
    });
    $<HTMLSelectElement>('#template')?.addEventListener('change', (e) => {
      this.load(createProject((e.target as HTMLSelectElement).value));
      this.render();
    });
    $('#export')?.addEventListener('click', () => this.exportJson());
    $<HTMLInputElement>('#import')?.addEventListener('change', async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        this.load(deserializeProject(await file.text()));
        this.render();
      } catch (err) {
        this.log(String(err));
      }
    });
    this.root.querySelectorAll<HTMLSelectElement>('[data-port]').forEach((el) =>
      el.addEventListener('change', () => {
        const t = this.project.tracks.find((x) => x.id === el.dataset.port)!;
        this.updateTrack(t.id, { output: { ...t.output, portName: el.value } });
      }),
    );
    this.root.querySelectorAll<HTMLInputElement>('[data-channel]').forEach((el) =>
      el.addEventListener('change', () => {
        const t = this.project.tracks.find((x) => x.id === el.dataset.channel)!;
        this.updateTrack(t.id, { output: { ...t.output, channel: Math.max(1, Math.min(16, Number(el.value))) } });
      }),
    );
    this.root.querySelectorAll<HTMLButtonElement>('[data-mute]').forEach((el) =>
      el.addEventListener('click', () => {
        const t = this.project.tracks.find((x) => x.id === el.dataset.mute)!;
        this.updateTrack(t.id, { muted: !t.muted });
        el.setAttribute('aria-pressed', String(!t.muted));
      }),
    );
    this.root.querySelectorAll<HTMLButtonElement>('[data-freeze]').forEach((el) =>
      el.addEventListener('click', () => {
        const t = this.project.tracks.find((x) => x.id === el.dataset.freeze)!;
        this.updateTrack(t.id, { frozen: !t.frozen });
        el.setAttribute('aria-pressed', String(!t.frozen));
      }),
    );
    this.root.querySelectorAll<HTMLButtonElement>('[data-new]').forEach((el) =>
      el.addEventListener('click', () => this.sequencer.track(el.dataset.new!)?.regenerate()),
    );
  }

  private exportJson(): void {
    const blob = new Blob([serializeProject(this.project)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${this.project.name.replace(/\s+/g, '-').toLowerCase()}.drift.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  private trackName(id: string): string {
    return this.project.tracks.find((t) => t.id === id)?.name ?? id;
  }

  private text(selector: string, value: string): void {
    const el = this.root.querySelector(selector);
    if (el) el.textContent = value;
  }

  private log(message: string): void {
    // textContent below; no escaping needed.
    const el = this.root.querySelector('#log');
    if (!el) return;
    const line = document.createElement('div');
    line.textContent = message;
    el.prepend(line);
    while (el.childElementCount > 20) el.lastElementChild?.remove();
  }
}
