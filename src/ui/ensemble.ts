import { evolveLatent, randomLatent, slerp, trioToPatterns, TRIO_BARS, TRIO_STEPS_PER_BAR, type TrioPatterns } from '../core/ensemble/trio';
import type { Pattern } from '../core/pattern/pattern';
import { Scale } from '../core/theory/scale';
import { TrioModel } from '../io/ensemble/trioModel';
import type { EnsembleSettings, ProjectState, TrackState } from '../state/project';
import type { AppStore } from './store';

export const DEFAULT_ENSEMBLE: EnsembleSettings = { temperature: 0.5, evolve: true, everyBars: 8, amount: 0.35, morph: 0.5 };

export type EnsembleStatus = 'idle' | 'loading' | 'ready' | 'error';
type Part = 'melody' | 'bass' | 'drums';
export const ENSEMBLE_PARTS: { part: Part; label: string }[] = [
  { part: 'melody', label: 'Melody' },
  { part: 'bass', label: 'Bass' },
  { part: 'drums', label: 'Drums' },
];

/**
 * Melody, bass and drums written together by MusicVAE's trio model. The
 * model only runs on request; the tracks it writes keep their patterns in
 * the project, so a reload plays them without the model.
 */
export class EnsembleController {
  status: EnsembleStatus = 'idle';
  error = '';
  busy = false;
  private model: TrioModel | undefined;
  private morphTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly store: AppStore) {}

  get settings(): EnsembleSettings {
    return this.store.project.ensemble ?? this.defaults(this.store.project);
  }

  /** Why the ensemble can't be used in this project, if it can't. */
  get unavailable(): string | undefined {
    if (this.store.project.stepsPerBar !== TRIO_STEPS_PER_BAR) return 'The trio model writes 16th notes in 4/4; this project uses another grid.';
    return undefined;
  }

  /** Linked track ids, missing or not. */
  track(part: Part): TrackState | undefined {
    const id = this.settings[part];
    return id ? this.store.project.tracks.find((t) => t.id === id) : undefined;
  }

  update(patch: Partial<EnsembleSettings>): void {
    this.store.change((p) => ({ ...p, ensemble: { ...(p.ensemble ?? this.defaults(p)), ...patch } }));
  }

  /** Stop following the model: the tracks keep their pattern and mutate on their own again. */
  unlink(): void {
    this.update({ z: undefined });
  }

  async load(): Promise<boolean> {
    if (this.model?.ready) return true;
    if (this.status === 'loading') return false;
    this.status = 'loading';
    this.error = '';
    this.store.notify();
    try {
      this.model ??= new TrioModel();
      await this.model.load();
      this.status = 'ready';
      return true;
    } catch (e) {
      this.model?.dispose();
      this.model = undefined;
      this.status = 'error';
      this.error = e instanceof Error ? e.message : String(e);
      return false;
    } finally {
      this.store.notify();
    }
  }

  /** A fresh trio from a random point in the latent space. */
  async generate(): Promise<void> {
    if (!(await this.load()) || !this.model) return;
    await this.write(randomLatent(this.model.zDims), 'new trio');
  }

  storeSlot(slot: 'a' | 'b'): void {
    const z = this.settings.z;
    if (z) this.update({ [slot]: [...z] });
  }

  /** Move between the stored points A and B (debounced while the slider moves). */
  morph(t: number): void {
    this.update({ morph: t });
    clearTimeout(this.morphTimer);
    this.morphTimer = setTimeout(() => void this.morphNow(t), 180);
  }

  private async morphNow(t: number): Promise<void> {
    const { a, b } = this.settings;
    if (!a || !b || !(await this.load())) return;
    await this.write(slerp(a, b, t), `morph ${Math.round(t * 100)}% A→B`);
  }

  /** Called by the store on every step: one bar before a phrase change, prepare the next step. */
  onStep(step: number, bar: number): void {
    const e = this.store.project.ensemble;
    if (!e?.evolve || !e.z || this.busy || !this.model?.ready) return;
    const spb = this.store.project.stepsPerBar;
    if (step % spb !== 0) return;
    const every = Math.max(TRIO_BARS, Math.round(e.everyBars / TRIO_BARS) * TRIO_BARS);
    // Decode during the last bar, so the result is there when the phrase starts again.
    if ((bar + 1) % every !== 0) return;
    void this.write(evolveLatent(e.z, e.amount), undefined);
  }

  private async write(z: number[], log: string | undefined): Promise<void> {
    if (!this.model) return;
    this.busy = true;
    this.store.notify();
    try {
      const notes = await this.model.decode(z, this.settings.temperature);
      const project = this.store.project;
      const patterns = trioToPatterns(notes, {
        scale: new Scale(project.key.root, project.key.mode),
        drumNotes: this.drumNotes(),
      });
      this.apply(z, patterns);
      if (log) this.store.addLog(Math.max(0, this.store.live.bar), `Ensemble · ${log}`, this.track('melody')?.color ?? 'var(--accent)');
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
      this.store.showToast(`Ensemble: ${this.error}`);
    } finally {
      this.busy = false;
      this.store.notify();
    }
  }

  /** Give each linked track its part: queued for the next 4-bar phrase while playing, right away when stopped. */
  private apply(z: number[], parts: TrioPatterns): void {
    const playing = this.store.sequencer.playing;
    const updates = new Map<string, Pattern>();
    for (const { part } of ENSEMBLE_PARTS) {
      const t = this.track(part);
      if (!t || t.frozen) continue;
      updates.set(t.id, parts[part]);
      if (playing) this.store.sequencer.track(t.id)?.queuePattern(parts[part]);
    }
    this.store.change((p) => ({
      ...p,
      ensemble: { ...(p.ensemble ?? this.defaults(p)), z },
      tracks: p.tracks.map((t) => (updates.has(t.id) ? { ...t, userPattern: updates.get(t.id) } : t)),
    }));
  }

  private drumNotes(): Record<string, number> | undefined {
    const t = this.track('drums');
    if (t?.generator.type !== 'drums') return undefined;
    return Object.fromEntries(t.generator.params.voices.map((v) => [v.name, v.note]));
  }

  /** First guess for which track plays which part, by type. */
  private defaults(p: ProjectState): EnsembleSettings {
    const find = (...types: string[]) => p.tracks.find((t) => types.includes(t.generator.type))?.id;
    return { ...DEFAULT_ENSEMBLE, melody: find('motif', 'arp'), bass: find('bass', 'acid'), drums: find('drums') };
  }
}
