import type { EnsembleSettings } from '../../state/project';
import { Card, Icon, Segmented, Select, Slider, Toggle } from '../components/controls';
import { ENSEMBLE_PARTS } from '../ensemble';
import { useStore } from '../store';

type Density = NonNullable<EnsembleSettings['melodyDensity']>;
const DENSITY: { value: Density | ''; label: string }[] = [
  { value: '', label: 'Any' },
  { value: 'sparse', label: 'Sparse' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'busy', label: 'Busy' },
];

/** The AI page: Magenta's MusicVAE trio writes melody, bass and drums together. */
export function AiView() {
  const s = useStore();
  const e = s.ensemble;
  const settings = e.settings;
  const blocked = e.unavailable;
  return (
    <div class="page ai-page">
      <div class="page-head">
        <button type="button" class="ghost" onClick={() => s.go({ name: 'performance' })}>
          <Icon name="back" /> Performance
        </button>
        <h1>AI ensemble</h1>
      </div>
      <p class="hint ai-intro">
        Magenta’s MusicVAE trio model writes 4 bars of melody, bass and drums that belong together. Drift moves them into your
        key and onto your chords, and can let them drift through variations while you play.
      </p>
      {blocked ? (
        <Card title="Not available">
          <p class="hint">{blocked}</p>
        </Card>
      ) : (
        <div class="editor-grid">
          <div class="col">
            <ModelCard />
            <PartsCard />
            <GenerateCard />
          </div>
          <div class="col">
            <FitCard />
            <EvolveCard />
            <MorphCard />
            <HistoryCard />
          </div>
        </div>
      )}
      {settings.z && !blocked && (
        <p class="hint">Linked tracks don’t mutate on their own; they follow the model. Freeze a track to keep its part.</p>
      )}
    </div>
  );
}

function ModelCard() {
  const s = useStore();
  const e = s.ensemble;
  const linked = !!e.settings.z;
  const status =
    e.status === 'loading' ? 'Loading…' : e.status === 'ready' ? `Ready · ${e.backend === 'webgl' ? 'GPU' : 'CPU'}` : e.status === 'error' ? 'Couldn’t load' : 'Not loaded';
  return (
    <Card title="Model" actions={<span class={`small ${e.status === 'error' ? 'warn' : 'muted'}`}>{status}</span>}>
      <p class="hint">
        MusicVAE <span class="mono">trio_4bar</span>. It downloads once when you first use it (tens of MB) and needs an internet
        connection for that.
      </p>
      {e.status === 'error' && <p class="hint warn">{e.error}</p>}
      {e.status === 'ready' && e.backend !== 'webgl' && (
        <p class="hint">Running on the CPU: writing a trio takes a few seconds. Fewer candidates make it quicker.</p>
      )}
      <div class="row gap-s wrap">
        {e.status !== 'ready' && (
          <button type="button" disabled={e.status === 'loading'} onClick={() => void e.load()}>
            <Icon name="download" /> Load model
          </button>
        )}
        {linked && (
          <button type="button" onClick={() => e.unlink()} title="The tracks keep their pattern and evolve on their own again">
            Unlink tracks
          </button>
        )}
      </div>
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

function GenerateCard() {
  const s = useStore();
  const e = s.ensemble;
  const settings = e.settings;
  const n = settings.candidates ?? 8;
  return (
    <Card title="Generate">
      <button type="button" class="primary" title="Generate together (G)" disabled={e.status === 'loading' || e.busy} onClick={() => void e.generate()}>
        <Icon name="dice" /> {e.busy ? 'Writing…' : e.status === 'ready' ? 'Generate together' : 'Load model and generate'}
      </button>
      <Slider
        label="Variation"
        value={settings.temperature}
        min={0.1}
        max={1.5}
        step={0.05}
        format={(x) => x.toFixed(2)}
        onInput={(temperature) => e.update({ temperature })}
      />
      <Segmented
        label="Candidates"
        value={n}
        options={[1, 4, 8, 16].map((x) => ({ value: x, label: String(x) }))}
        onChange={(candidates) => e.update({ candidates })}
      />
      <Segmented
        label="Melody"
        value={settings.melodyDensity ?? ''}
        options={DENSITY}
        onChange={(v) => e.update({ melodyDensity: v || undefined })}
      />
      <Segmented
        label="Drums"
        value={settings.drumDensity ?? ''}
        options={DENSITY}
        onChange={(v) => e.update({ drumDensity: v || undefined })}
      />
      <p class="hint">
        Drift writes {n === 1 ? 'one trio' : `${n} trios`} and plays the one that scores best on groove, a moving melody and a bass
        with some variety{settings.melodyDensity || settings.drumDensity ? ', closest to the busyness you picked' : ''}. Low
        variation is safe and repetitive, high variation surprising.
      </p>
    </Card>
  );
}

function FitCard() {
  const s = useStore();
  const e = s.ensemble;
  const fit = e.settings.fit ?? 'half';
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
          ? 'The model’s lines play as written, only moved into your key. They may clash with your chords.'
          : `Melody and bass keep the model’s line; notes on ${fit === 'bar' ? 'the start of each bar' : fit === 'half' ? 'the start and middle of each bar' : 'every beat'} move to a chord tone, and the bass plays the root on the one.`}
      </p>
    </Card>
  );
}

function EvolveCard() {
  const s = useStore();
  const e = s.ensemble;
  const settings = e.settings;
  const parts = settings.evolveParts ?? { melody: true, bass: true, drums: true };
  return (
    <Card title="Evolve">
      <Toggle label="Evolve while playing" description="Drift to a nearby variation every few bars" checked={settings.evolve} onChange={(evolve) => e.update({ evolve })} />
      {settings.evolve && (
        <>
          <Segmented
            label="Every (bars)"
            value={settings.everyBars}
            options={[4, 8, 16, 32].map((b) => ({ value: b, label: String(b) }))}
            onChange={(everyBars) => e.update({ everyBars })}
          />
          <Slider
            label="Step size"
            value={settings.amount}
            min={0.05}
            max={1}
            step={0.05}
            format={(x) => `${Math.round(x * 100)}%`}
            onInput={(amount) => e.update({ amount })}
          />
          <div class="field">
            <span class="field-label">Parts that evolve</span>
            <div class="chips" role="group" aria-label="Parts that evolve">
              {ENSEMBLE_PARTS.map(({ part, label }) => (
                <button type="button" class="chip" aria-pressed={parts[part]} onClick={() => e.update({ evolveParts: { ...parts, [part]: !parts[part] } })}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <p class="hint">
            Small steps keep it recognisable. Parts that don’t evolve keep the part of the trio they have now
            {e.status !== 'ready' ? '. Evolving starts once the model is loaded.' : '.'}
          </p>
        </>
      )}
    </Card>
  );
}

function MorphCard() {
  const s = useStore();
  const e = s.ensemble;
  const settings = e.settings;
  const linked = !!settings.z;
  return (
    <Card title="Morph">
      <div class="row gap-s">
        <button type="button" disabled={!linked} aria-pressed={!!settings.a} onClick={() => e.storeSlot('a')} title="Remember this trio as A">
          Set A
        </button>
        <button type="button" disabled={!linked} aria-pressed={!!settings.b} onClick={() => e.storeSlot('b')} title="Remember this trio as B">
          Set B
        </button>
      </div>
      {settings.a && settings.b ? (
        <Slider label="Morph A → B" value={settings.morph ?? 0.5} min={0} max={1} step={0.05} format={(x) => `${Math.round(x * 100)}%`} onInput={(t) => e.morph(t)} />
      ) : (
        <p class="hint">Store two trios as A and B, then slide between them. The points in between are new trios with something of both.</p>
      )}
    </Card>
  );
}

function HistoryCard() {
  const s = useStore();
  const e = s.ensemble;
  const current = e.settings.z;
  return (
    <Card title="Recent trios">
      {e.history.length === 0 ? (
        <p class="hint">The trios that play appear here, so you can go back to one you liked. They are kept until you reload.</p>
      ) : (
        <div class="chips">
          {e.history.map((m) => (
            <button
              type="button"
              class="chip"
              aria-pressed={m.z === current}
              title={`Bar ${m.bar + 1} · score ${Math.round(m.score * 100)}`}
              onClick={() => e.recall(m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}
