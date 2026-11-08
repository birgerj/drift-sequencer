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
        <button type="button" class="primary" onClick={() => void s.shareProject()} title="A link with this song and its visual">
          <Icon name="share" /> Share link
        </button>
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
        {TEMPLATES.map((t) => (
          <button type="button" class="template-card" onClick={() => s.newFromTemplate(t.id)}>
            <span class="template-head">
              <b>{t.name}</b>
              <span class="mono muted small">{t.bpm} bpm</span>
            </span>
            <span class="muted small">{t.description}</span>
          </button>
        ))}
        <button type="button" class="template-card" onClick={() => s.newEmpty()}>
          <span class="template-head">
            <b>Empty</b>
          </span>
          <span class="muted small">No tracks; build it up yourself.</span>
        </button>
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

      <Card title="Reset">
        <p class="hint">Deletes everything Drift keeps on this device — projects, devices, imported instruments and settings — and starts empty.</p>
        <button
          type="button"
          class="danger"
          onClick={() => {
            if (confirm('Delete all projects, devices, instruments and settings on this device and start empty? This cannot be undone.'))
              void s.resetEverything();
          }}
        >
          <Icon name="trash" /> Reset everything
        </button>
      </Card>
    </div>
  );
}
