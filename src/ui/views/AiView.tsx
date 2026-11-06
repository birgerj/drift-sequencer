import { useState } from 'preact/hooks';
import type { EnsembleSettings } from '../../state/project';
import { CLAUDE_MODELS } from '../../io/ensemble/claudeApi';
import { sectionBars } from '../../core/ensemble/composition';
import { Card, Icon, Segmented, Select, Toggle } from '../components/controls';
import { ENSEMBLE_PARTS } from '../ensemble';
import { useStore } from '../store';

type Density = NonNullable<EnsembleSettings['melodyDensity']>;
const DENSITY: { value: Density | ''; label: string }[] = [
  { value: '', label: 'Any' },
  { value: 'sparse', label: 'Sparse' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'busy', label: 'Busy' },
];

/** The AI page: Claude composes lead, bass, pads and drums together. */
export function AiView() {
  const s = useStore();
  const e = s.ensemble;
  return (
    <div class="page ai-page">
      <div class="page-head">
        <button type="button" class="ghost" onClick={() => s.go({ name: 'performance' })}>
          <Icon name="back" /> Performance
        </button>
        <h1>AI ensemble</h1>
      </div>
      <p class="hint ai-intro">
        Claude composes a lead melody with bass, pads and drums on your key and chords: a few sections built from one motif, played
        in a form like A A2 B A. While it plays, Claude writes the next part of the piece.
      </p>
      <div class="editor-grid">
        <div class="col">
          <ClaudeCard />
          <PartsCard />
          <ComposeCard />
        </div>
        <div class="col">
          <FormCard />
          <EvolveCard />
          <FitCard />
          <HistoryCard />
        </div>
      </div>
      {e.settings.linked && (
        <p class="hint">Linked tracks don’t mutate on their own; they follow the composition. Freeze a track to keep its part.</p>
      )}
    </div>
  );
}

function ClaudeCard() {
  const s = useStore();
  const e = s.ensemble;
  const [draft, setDraft] = useState('');
  const has = !!e.apiKey;
  const status = e.busy ? 'Composing…' : e.preparing ? 'Writing the next part…' : has ? 'Key set' : 'No key';
  return (
    <Card title="Claude" actions={<span class={`small ${e.error ? 'warn' : 'muted'}`}>{status}</span>}>
      {has ? (
        <div class="row gap-s wrap">
          <span class="mono small muted">{`${e.apiKey.slice(0, 10)}…${e.apiKey.slice(-4)}`}</span>
          <button type="button" class="small" onClick={() => e.setApiKey('')}>
            Remove key
          </button>
        </div>
      ) : (
        <form
          class="ensemble-key"
          onSubmit={(ev) => {
            ev.preventDefault();
            e.setApiKey(draft);
            setDraft('');
          }}
        >
          <label class="field-label" for="claude-key">
            API key
          </label>
          <div class="row gap-s">
            <input
              id="claude-key"
              type="password"
              autoComplete="off"
              spellcheck={false}
              placeholder="sk-ant-…"
              value={draft}
              onInput={(ev) => setDraft((ev.target as HTMLInputElement).value)}
            />
            <button type="submit" disabled={!draft.trim()}>
              Save
            </button>
          </div>
        </form>
      )}
      <Select label="Model" value={e.settings.model} options={CLAUDE_MODELS.map((m) => ({ value: m.id, label: m.label }))} onChange={(model) => e.update({ model })} />
      {e.error && <p class="hint warn">{e.error}</p>}
      <p class="hint">
        The key stays in this browser and goes only to Anthropic’s API; it is never saved in the project. Get one at
        console.anthropic.com and set a spend limit there. Each new part is one request.
      </p>
    </Card>
  );
}

function PartsCard() {
  const s = useStore();
  const e = s.ensemble;
  const settings = e.settings;
  const tracks = s.project.tracks;
  return (
    <Card title="Parts">
      <div class="ensemble-parts">
        {ENSEMBLE_PARTS.map(({ part, label }) => (
          <Select
            label={label}
            value={settings[part] ?? ''}
            options={[{ value: '', label: 'None' }, ...tracks.map((t) => ({ value: t.id, label: t.name }))]}
            onChange={(id) => e.update({ [part]: id || undefined })}
          />
        ))}
      </div>
      <p class="hint">Set a part to None to keep that track your own, e.g. Drums: None keeps your euclidean drums.</p>
    </Card>
  );
}

function ComposeCard() {
  const s = useStore();
  const e = s.ensemble;
  const settings = e.settings;
  const disabled = e.busy || !e.apiKey;
  const wanted = settings.sectionLength ?? 8;
  const bars = sectionBars(s.project.progression, wanted);
  return (
    <Card title="Compose">
      <div class="field">
        <label class="field-label" for="ensemble-style">
          Style and wishes
        </label>
        <textarea
          id="ensemble-style"
          rows={3}
          placeholder="e.g. dark melodic techno, a lead that sings, bass on the offbeat"
          value={settings.style}
          onChange={(ev) => e.update({ style: (ev.target as HTMLTextAreaElement).value })}
        />
      </div>
      <Segmented
        label="Section length (bars)"
        value={wanted}
        options={[4, 8, 16].map((n) => ({ value: n, label: String(n) }))}
        onChange={(sectionLength) => e.update({ sectionLength })}
      />
      <Segmented label="Lead" value={settings.melodyDensity ?? ''} options={DENSITY} onChange={(v) => e.update({ melodyDensity: v || undefined })} />
      <Segmented label="Drums" value={settings.drumDensity ?? ''} options={DENSITY} onChange={(v) => e.update({ drumDensity: v || undefined })} />
      <div class="row gap-s wrap">
        <button type="button" class="primary" title="New piece (G)" disabled={disabled} onClick={() => void e.generate()}>
          <Icon name="dice" /> {e.busy ? 'Composing…' : 'New piece'}
        </button>
        <button type="button" disabled={disabled || !e.composition} onClick={() => void e.develop()} title="Write the next part of this piece now">
          Develop
        </button>
      </div>
      <p class="hint">
        {bars !== wanted ? `Sections follow your chord progression: ${bars} bars each. ` : ''}
        Longer sections give the lead room for a whole melody, but take longer to write (up to a minute with Sonnet or Opus). While
        playing, a new piece starts at the next section; the music keeps going while Claude writes.
      </p>
    </Card>
  );
}

function FormCard() {
  const s = useStore();
  const e = s.ensemble;
  const c = e.composition;
  return (
    <Card title={c ? c.title : 'Form'} actions={c && <span class="small muted">{`${c.bars} bars per section`}</span>}>
      {c ? (
        <>
          <div class="chips" role="group" aria-label="Form">
            {c.form.map((name, i) => (
              <button type="button" class="chip" aria-pressed={!!e.settings.linked && i === e.formIndex} onClick={() => e.jump(i)} title="Play this slot next">
                {name}
              </button>
            ))}
          </div>
          {e.settings.linked ? (
            <div class="row gap-s wrap">
              <button type="button" onClick={() => e.unlink()} title="The tracks keep their pattern and evolve on their own again">
                Unlink tracks
              </button>
            </div>
          ) : (
            <p class="hint">Not linked: tap a section to follow the piece again.</p>
          )}
          <p class="hint">Tap a section to play it next.</p>
        </>
      ) : (
        <p class="hint">The form of the piece appears here once Claude has written one.</p>
      )}
    </Card>
  );
}

function EvolveCard() {
  const s = useStore();
  const e = s.ensemble;
  const settings = e.settings;
  const parts = settings.evolveParts ?? { melody: true, bass: true, drums: true };
  return (
    <Card title="Evolve" actions={settings.evolve && e.ready ? <span class="small muted">Next part ready</span> : undefined}>
      <Toggle
        label="Keep composing while playing"
        description="Claude writes the next part of the piece, which follows on from this one"
        checked={settings.evolve}
        onChange={(evolve) => e.update({ evolve })}
      />
      {settings.evolve && (
        <>
          <Segmented
            label="Move on after (passes of the form)"
            value={settings.everyLoops}
            options={[1, 2, 4, 8].map((n) => ({ value: n, label: String(n) }))}
            onChange={(everyLoops) => e.update({ everyLoops })}
          />
          <div class="field">
            <span class="field-label">Parts that change</span>
            <div class="chips" role="group" aria-label="Parts that change">
              {ENSEMBLE_PARTS.map(({ part, label }) => {
                const on = parts[part] ?? true;
                return (
                  <button type="button" class="chip" aria-pressed={on} onClick={() => e.update({ evolveParts: { ...parts, [part]: !on } })}>
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
          <p class="hint">More passes give the listener time to learn the piece. Parts that don’t change keep playing what they play now.</p>
        </>
      )}
    </Card>
  );
}

function FitCard() {
  const s = useStore();
  const e = s.ensemble;
  const fit = e.settings.fit ?? 'off';
  return (
    <Card title="Fit to the chords">
      <Segmented
        label="Bend onto the chord"
        value={fit}
        options={[
          { value: 'off', label: 'Off' },
          { value: 'bar', label: 'Bar' },
          { value: 'half', label: 'Half bar' },
          { value: 'beat', label: 'Every beat' },
        ]}
        onChange={(next) => {
          e.update({ fit: next });
          e.refit();
        }}
      />
      <p class="hint">
        {fit === 'off'
          ? 'Claude writes for your chords, so this can stay off. Turn it on when the chords change while a piece plays.'
          : `Lead and bass notes on ${fit === 'bar' ? 'the start of each bar' : fit === 'half' ? 'the start and middle of each bar' : 'every beat'} move to a tone of the chord that plays; the bass plays the root on the one. Pads always follow the chords.`}
      </p>
    </Card>
  );
}

function HistoryCard() {
  const s = useStore();
  const e = s.ensemble;
  const current = e.composition;
  return (
    <Card title="Recent pieces">
      {e.history.length === 0 ? (
        <p class="hint">The pieces that play appear here, so you can go back to one you liked. They are kept until you reload.</p>
      ) : (
        <div class="chips">
          {e.history.map((m) => (
            <button type="button" class="chip" aria-pressed={m.composition === current} title={`From bar ${m.bar + 1}`} onClick={() => e.recall(m.id)}>
              {m.composition.title}
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}
