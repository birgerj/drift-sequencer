import {
  COMPOSE_SYSTEM,
  composePrompt,
  composeTool,
  parseComposition,
  PARTS,
  sectionPatterns,
  type ComposeContext,
  type Composition,
  type Part,
} from '../core/ensemble/composition';
import type { Pattern } from '../core/pattern/pattern';
import { TR8S_NOTES } from '../core/generators/drumGenerator';
import { Scale } from '../core/theory/scale';
import { callTool, DEFAULT_CLAUDE_MODEL, loadApiKey, saveApiKey } from '../io/ensemble/claudeApi';
import type { EnsembleSettings, ProjectState, TrackState } from '../state/project';
import type { AppStore } from './store';

export type { Part } from '../core/ensemble/composition';

export const DEFAULT_ENSEMBLE: EnsembleSettings = { model: DEFAULT_CLAUDE_MODEL, style: '', evolve: true, everyLoops: 2 };

export const ENSEMBLE_PARTS: { part: Part; label: string }[] = [
  { part: 'melody', label: 'Melody' },
  { part: 'bass', label: 'Bass' },
  { part: 'pads', label: 'Pads' },
  { part: 'drums', label: 'Drums' },
];

/** A composition that played, so it can be brought back exactly. */
export interface CompositionMemory {
  id: number;
  bar: number;
  composition: Composition;
}

/**
 * Lead, bass, pads and drums composed together by Claude. Claude writes a few
 * sections and a form (A A2 B A); Drift plays the form section by section and,
 * while it plays, asks Claude for the next part of the piece. The tracks keep
 * their patterns and the composition stays in the project, so a reload plays
 * it without the API.
 */
export class EnsembleController {
  busy = false;
  /** A follow-up is being written in the background. */
  preparing = false;
  error = '';
  /** The last compositions that played (newest first); kept for this session only. */
  history: CompositionMemory[] = [];
  /** Slot of the form that plays now. */
  formIndex = 0;
  private apiKeyValue = loadApiKey();
  private nextMemory = 1;
  /** Written ahead while the current piece plays. */
  private next: Composition | undefined;
  /** Passes through the form since the composition started. */
  private loops = 0;
  /** The next section is already queued (a new piece or a jump): don't advance at the next boundary. */
  private queued = false;
  /** Bumped by every manual request, so an older background answer is thrown away. */
  private generation = 0;
  private abort: AbortController | undefined;

  constructor(private readonly store: AppStore) {}

  get settings(): EnsembleSettings {
    const p = this.store.project;
    return { ...this.defaults(p), ...p.ensemble };
  }

  get composition(): Composition | undefined {
    return this.settings.composition;
  }

  /** Why the ensemble can't be used in this project, if it can't. */
  get unavailable(): string | undefined {
    return undefined;
  }

  get apiKey(): string {
    return this.apiKeyValue;
  }

  /** The next part is written and waits for the form to come round. */
  get ready(): boolean {
    return !!this.next;
  }

  setApiKey(key: string): void {
    this.apiKeyValue = key.trim();
    saveApiKey(this.apiKeyValue);
    if (this.apiKeyValue) this.error = '';
    this.store.notify();
  }

  /** Linked track, if the part has one. */
  track(part: Part): TrackState | undefined {
    const id = this.settings[part];
    return id ? this.store.project.tracks.find((t) => t.id === id) : undefined;
  }

  update(patch: Partial<EnsembleSettings>): void {
    this.store.change((p) => ({ ...p, ensemble: { ...this.defaults(p), ...p.ensemble, ...patch } }));
  }

  /** Stop following the composition: the tracks keep their pattern and mutate on their own again. */
  unlink(): void {
    this.next = undefined;
    this.update({ linked: false });
  }

  /** A fresh piece. */
  async generate(): Promise<void> {
    await this.request(false);
  }

  /** The next part of the piece that plays now, right away. */
  async develop(): Promise<void> {
    await this.request(!!this.composition);
  }

  private async request(develop: boolean): Promise<void> {
    if (this.busy) return;
    if (!this.apiKey) {
      this.error = 'Add your Claude API key first.';
      this.store.showToast('AI ensemble: add your Claude API key on the AI page');
      this.store.notify();
      return;
    }
    const generation = ++this.generation;
    this.abort?.abort();
    this.preparing = false;
    this.busy = true;
    this.error = '';
    this.store.notify();
    try {
      const composition = await this.compose(develop ? this.composition : undefined, false);
      if (generation !== this.generation) return;
      this.start(composition, develop ? 'develops the piece' : 'new piece');
    } catch (e) {
      if (generation === this.generation) this.fail(e);
    } finally {
      if (generation === this.generation) this.busy = false;
      this.store.notify();
    }
  }

  /** Called by the store on every step: one bar before a section ends, queue the next slot of the form. */
  onStep(step: number, bar: number): void {
    const e = this.settings;
    const c = e.composition;
    if (!e.linked || !c || step % this.store.project.stepsPerBar !== 0) return;
    if ((bar + 1) % c.bars !== 0) return;
    if (this.queued) {
      this.queued = false;
      return;
    }
    let index = this.formIndex + 1;
    if (index >= c.form.length) {
      index = 0;
      this.loops++;
      if (e.evolve && this.next && this.loops >= e.everyLoops) {
        const next = this.next;
        this.next = undefined;
        this.start(next, 'next part', true);
        return;
      }
    }
    this.formIndex = index;
    this.applySection(c, c.form[index]!, 'queue');
    this.store.notify();
    // Write the next part during the last pass, so it is there when the form comes round.
    if (e.evolve && !this.next && !this.preparing && !this.busy && this.apiKey && this.loops >= e.everyLoops - 1) void this.prepare();
  }

  /** Jump to a slot of the form at the next section start. */
  jump(index: number): void {
    const c = this.composition;
    if (!c || !c.form[index]) return;
    this.formIndex = index;
    const playing = this.store.sequencer.playing;
    if (!this.settings.linked) this.update({ linked: true });
    this.applySection(c, c.form[index]!, playing ? 'queue' : 'now');
    if (playing) this.queued = true;
    this.store.notify();
  }

  /** Play an earlier composition again, exactly as it was. */
  recall(id: number): void {
    const m = this.history.find((x) => x.id === id);
    if (!m) return;
    this.start(m.composition, `back to “${m.composition.title}”`, false, false);
  }

  /** Re-apply the current section with new settings (e.g. chord fit), without asking Claude. */
  refit(): void {
    const c = this.composition;
    if (c && this.settings.linked) this.applySection(c, c.form[this.formIndex] ?? c.form[0]!, 'now');
  }

  /** Write the next part in the background. */
  private async prepare(): Promise<void> {
    const generation = this.generation;
    const current = this.composition;
    if (!current) return;
    this.preparing = true;
    this.store.notify();
    try {
      const next = await this.compose(current, true);
      if (generation === this.generation && this.composition === current) this.next = next;
    } catch (e) {
      if (generation === this.generation) this.fail(e);
    } finally {
      if (generation === this.generation) this.preparing = false;
      this.store.notify();
    }
  }

  private async compose(previous: Composition | undefined, evolving: boolean): Promise<Composition> {
    const ctx = this.context(previous, evolving);
    this.abort = new AbortController();
    const raw = await callTool({
      apiKey: this.apiKey,
      model: this.settings.model,
      system: COMPOSE_SYSTEM,
      user: composePrompt(ctx),
      tool: composeTool(ctx.drumVoices),
      signal: this.abort.signal,
    });
    return parseComposition(raw, ctx);
  }

  private context(previous: Composition | undefined, evolving: boolean): ComposeContext {
    const p = this.store.project;
    const e = this.settings;
    const parts = { melody: !!this.track('melody'), bass: !!this.track('bass'), pads: !!this.track('pads'), drums: !!this.track('drums') };
    const evolveParts = e.evolveParts ?? { melody: true, bass: true, drums: true };
    const keep = evolving && previous ? PARTS.filter((part) => parts[part] && evolveParts[part] === false) : undefined;
    return {
      scale: new Scale(p.key.root, p.key.mode),
      progression: p.progression,
      stepsPerBar: p.stepsPerBar,
      bpm: p.bpm,
      parts,
      drumVoices: Object.keys(this.drumNotes() ?? TR8S_NOTES),
      style: e.style,
      melodyDensity: e.melodyDensity,
      drumDensity: e.drumDensity,
      previous,
      keep,
      sectionLength: e.sectionLength ?? 8,
    };
  }

  /**
   * Make `composition` the one that plays and give the tracks its first
   * section: queued for the next section start while playing, right away
   * when stopped. `atBoundary`: called one bar before a section ends, so the
   * queued section lands on time and the next boundary advances as usual.
   */
  private start(composition: Composition, log: string, atBoundary = false, remember = true): void {
    this.next = undefined;
    this.loops = 0;
    this.formIndex = 0;
    const playing = this.store.sequencer.playing;
    this.queued = playing && !atBoundary;
    this.store.change((p) => ({ ...p, ensemble: { ...this.defaults(p), ...p.ensemble, composition, linked: true } }));
    this.applySection(composition, composition.form[0]!, playing ? 'queue' : 'now');
    const bar = Math.max(0, this.store.live.bar);
    if (remember) this.history = [{ id: this.nextMemory++, bar, composition }, ...this.history].slice(0, 12);
    this.store.addLog(bar, `Ensemble · ${log}: ${composition.title}`, this.track('melody')?.color ?? 'var(--accent)');
  }

  /** Hand each linked track its part of a section. */
  private applySection(composition: Composition, name: string, when: 'queue' | 'now'): void {
    const parts = sectionPatterns(composition, name, { drumNotes: this.drumNotes(), fit: this.settings.fit ?? 'off' });
    const updates = new Map<string, Pattern>();
    for (const { part } of ENSEMBLE_PARTS) {
      const t = this.track(part);
      if (!t || t.frozen || parts[part].events.length === 0) continue;
      updates.set(t.id, parts[part]);
      // Queue first: the sequencer then knows the new userPattern is pending and doesn't switch right away.
      if (when === 'queue') this.store.sequencer.track(t.id)?.queuePattern(parts[part]);
    }
    if (updates.size === 0) return;
    this.store.change((p) => ({
      ...p,
      tracks: p.tracks.map((t) => (updates.has(t.id) ? { ...t, userPattern: updates.get(t.id) } : t)),
    }));
  }

  private fail(e: unknown): void {
    if (e instanceof DOMException && e.name === 'AbortError') return;
    this.error = e instanceof Error ? e.message : String(e);
    this.store.showToast(`AI ensemble: ${this.error}`);
  }

  private drumNotes(): Record<string, number> | undefined {
    const t = this.track('drums');
    if (t?.generator.type !== 'drums') return undefined;
    return Object.fromEntries(t.generator.params.voices.map((v) => [v.name, v.note]));
  }

  /** First guess for which track plays which part, by type. */
  private defaults(p: ProjectState): EnsembleSettings {
    const find = (...types: string[]) => p.tracks.find((t) => types.includes(t.generator.type))?.id;
    return { ...DEFAULT_ENSEMBLE, melody: find('motif', 'arp'), bass: find('bass', 'acid'), pads: find('chords', 'drone'), drums: find('drums') };
  }
}
