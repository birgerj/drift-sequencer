import { NOTE_NAMES, parsePitchClass } from '../../core/theory/note';
import { Chord } from '../../core/theory/chord';
import { Scale } from '../../core/theory/scale';
import { TEMPLATES } from '../../state/templates';
import { Card, Icon, Segmented } from '../components/controls';
import { useStore } from '../store';

export function Library() {
  const s = useStore();
  return (
    <div class="page">
      <div class="page-head">
        <button type="button" class="ghost" onClick={() => s.go({ name: 'performance' })}>
          <Icon name="back" /> Performance
        </button>
        <h1>Projects</h1>
        <div class="spacer" />
        <button type="button" onClick={() => s.exportProject()}>
          <Icon name="download" /> Export current
        </button>
        <label class="button">
          <Icon name="upload" /> Import .json
          <input
            type="file"
            accept="application/json,.json"
            class="sr-only"
            onChange={(e) => {
              const f = (e.target as HTMLInputElement).files?.[0];
              if (f) void s.importProject(f);
              (e.target as HTMLInputElement).value = '';
            }}
          />
        </label>
      </div>

      <h2 class="section-title">Start from a template</h2>
      <p class="hint">
        Each template starts from written parts — drums, bass, hooks, chords — that evolve while they play and keep coming back to
        their theme. Everything stays editable.
      </p>
      <Segmented
        label="Instruments"
        value={s.instrumentChoice}
        options={[
          { value: 'best', label: 'Best fit' },
          { value: 'role', label: 'By role' },
        ]}
        onChange={(v) => s.setInstrumentChoice(v)}
      />
      <p class="hint">
        {s.instrumentChoice === 'best'
          ? 'Each part gets the synth that suits it: your own devices first, one part per synth; built-in synths with a matching sound fill the gaps.'
          : 'Each part plays on the device you set up for its role under Devices.'}
      </p>
      <div class="template-grid">
        {TEMPLATES.map((t) => {
          const scale = new Scale(parsePitchClass(t.key), t.mode);
          const prog = t.progression.map((p) => Chord.fromDegree(scale, p.degree, p.size ?? 3).symbol()).join(' – ');
          return (
            <button type="button" class="template-card" onClick={() => s.newFromTemplate(t.id)}>
              <div class="row-between">
                <b>{t.name}</b>
                <span class="mono muted">{t.bpm} bpm</span>
              </div>
              <span class="muted small">{t.genre}</span>
              <span>
                {NOTE_NAMES[scale.root]} {t.mode}
              </span>
              <span class="small">{t.description}</span>
              <span class="mono muted small">{prog}</span>
              <span class="hint">{t.tracks.map((x) => x.name).join(' · ')}</span>
            </button>
          );
        })}
      </div>

      <Card title="Saved on this device">
        {s.projects.length === 0 && <p class="hint">Projects save automatically while you work.</p>}
        <ul class="project-list">
          {s.projects.map((p) => (
            <li>
              <button type="button" class="project-open" aria-current={p.id === s.project.id} onClick={() => void s.openSaved(p.id)}>
                <b>{p.name}</b>
                <span class="hint">{new Date(p.updatedAt).toLocaleString()}</span>
              </button>
              <button
                type="button"
                class="square"
                aria-label={`Delete ${p.name}`}
                disabled={p.id === s.project.id}
                onClick={() => {
                  if (confirm(`Delete “${p.name}”?`)) void s.deleteSaved(p.id);
                }}
              >
                <Icon name="trash" />
              </button>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
