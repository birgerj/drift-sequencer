import type { ChordSize } from '../../core/theory/chord';
import { Chord } from '../../core/theory/chord';
import type { ProgressionStep } from '../../core/theory/harmony';
import { NOTE_NAMES } from '../../core/theory/note';
import { MODES, Scale, type ModeName } from '../../core/theory/scale';
import { Card, Icon, Segmented, Select, Stepper } from '../components/controls';
import { useStore } from '../store';

const MODE_LABELS: Record<ModeName, string> = {
  ionian: 'Major (Ionian)',
  dorian: 'Dorian',
  phrygian: 'Phrygian',
  lydian: 'Lydian',
  mixolydian: 'Mixolydian',
  aeolian: 'Minor (Aeolian)',
  locrian: 'Locrian',
  harmonicMinor: 'Harmonic minor',
  melodicMinor: 'Melodic minor',
  majorPentatonic: 'Major pentatonic',
  minorPentatonic: 'Minor pentatonic',
};

/** Common progressions as 0-based degrees. */
const PRESETS: { name: string; degrees: number[] }[] = [
  { name: 'i – VI – III – VII', degrees: [0, 5, 2, 6] },
  { name: 'I – V – vi – IV', degrees: [0, 4, 5, 3] },
  { name: 'i – iv – v – i', degrees: [0, 3, 4, 0] },
  { name: 'ii – V – I', degrees: [1, 4, 0, 0] },
  { name: 'i – VII – VI – VII', degrees: [0, 6, 5, 6] },
  { name: 'I – IV', degrees: [0, 3] },
];

export function HarmonyEditor() {
  const s = useStore();
  const p = s.project;
  const scale = new Scale(p.key.root, p.key.mode);
  const pentatonic = scale.size < 7;
  const setProgression = (progression: ProgressionStep[]) => s.change((x) => ({ ...x, progression }));
  const update = (i: number, patch: Partial<ProgressionStep>) =>
    setProgression(p.progression.map((st, j) => (j === i ? { ...st, ...patch } : st)));

  return (
    <div class="page">
      <div class="page-head">
        <button type="button" class="ghost" onClick={() => s.go({ name: 'performance' })}>
          <Icon name="back" /> Performance
        </button>
        <h1>Harmony</h1>
      </div>
      <div class="editor-grid">
        <div class="col">
          <Card title="Key">
            <Select
              label="Root"
              value={p.key.root}
              options={NOTE_NAMES.map((n, i) => ({ value: i, label: n }))}
              onChange={(root) => s.change((x) => ({ ...x, key: { ...x.key, root } }))}
            />
            <Select
              label="Mode"
              value={p.key.mode}
              options={(Object.keys(MODES) as ModeName[]).map((m) => ({ value: m, label: MODE_LABELS[m] }))}
              onChange={(mode) => s.change((x) => ({ ...x, key: { ...x.key, mode } }))}
            />
            {pentatonic && <p class="hint">Pentatonic scales build chords from five notes, so some chords are unusual.</p>}
          </Card>
          <Card title="Presets">
            <div class="chips">
              {PRESETS.map((preset) => (
                <button
                  type="button"
                  class="chip"
                  onClick={() => setProgression(preset.degrees.map((degree) => ({ degree, bars: 2, size: 3 })))}
                >
                  {preset.name}
                </button>
              ))}
            </div>
          </Card>
        </div>
        <div class="col wide">
          <Card
            title="Progression"
            actions={
              <button type="button" onClick={() => setProgression([...p.progression, { degree: 0, bars: 2, size: 3 }])}>
                <Icon name="plus" /> Chord
              </button>
            }
          >
            <div class="progression">
              {p.progression.map((st, i) => {
                const chord = Chord.fromDegree(scale, st.degree, st.size ?? 3);
                return (
                  <div class="prog-step">
                    <div class="row-between">
                      <b class="chord-big">{chord.symbol()}</b>
                      <button
                        type="button"
                        class="square"
                        aria-label={`Remove ${chord.symbol()}`}
                        disabled={p.progression.length <= 1}
                        onClick={() => setProgression(p.progression.filter((_, j) => j !== i))}
                      >
                        <Icon name="trash" />
                      </button>
                    </div>
                    <Segmented
                      label="Degree"
                      value={st.degree}
                      options={Array.from({ length: scale.size }, (_, d) => ({
                        value: d,
                        label: Chord.fromDegree(scale, d, 3).roman(),
                      }))}
                      onChange={(degree) => update(i, { degree })}
                    />
                    <Segmented
                      label="Chord"
                      value={st.size ?? 3}
                      options={[
                        { value: 3 as ChordSize, label: 'Triad' },
                        { value: 4 as ChordSize, label: '7th' },
                        { value: 5 as ChordSize, label: '9th' },
                      ]}
                      onChange={(size) => update(i, { size })}
                    />
                    <div class="field">
                      <span class="field-label">Bars</span>
                      <Stepper label="Bars" value={st.bars} min={1} max={16} onChange={(bars) => update(i, { bars })} />
                    </div>
                  </div>
                );
              })}
            </div>
            <p class="hint">All tracks follow this progression; melodies keep their shape and move with the chords.</p>
          </Card>
        </div>
      </div>
    </div>
  );
}
