import { instrumentForLocalPort, isLocalPort, LOCAL_PORTS } from '../../io/local/ports';
import { slotComponent } from '../theme/slots';
import type { InstrumentDefinition } from '../../core/instruments/instrument';
import { ANSWER_TRANSFORMS, type PhraseRole, type PhraseSettings } from '../../core/engine/phrasing';
import { newId, type CcModulation, type LfoShape, type TrackState } from '../../state/project';
import { useState } from 'preact/hooks';
import { useNarrow } from '../useNarrow';
import { Chord } from '../../core/theory/chord';
import { DRUM_PRESETS, PRESET_GENRES } from '../../core/generators/drumPresets';
import { Card, Icon, Segmented, Select, Slider, Stepper, Toggle, TYPE_ICONS } from '../components/controls';
import { KnobPanel } from '../components/KnobPanel';
import { LfoPreview } from '../components/LfoPreview';
import { OctaveControl } from '../components/OctaveControl';
import { TrackTiming } from '../components/TrackTiming';
import { PatternEditor } from '../components/PatternEditor';
import { PatternView } from '../components/PatternView';
import { typeLabel } from '../paramSchema';
import { GeneratorTab } from './GeneratorTab';
import { SECTIONS, type SectionId } from '../shortcuts';
import { useLive, useStore } from '../store';

export function TrackEditor({ trackId }: { trackId: string }) {
  const s = useStore();
  const track = s.project.tracks.find((t) => t.id === trackId);
  if (!track) {
    return (
      <div class="page">
        <p>Track not found.</p>
        <button type="button" onClick={() => s.go({ name: 'performance' })}>Back</button>
      </div>
    );
  }
  const rt = s.sequencer.track(track.id);
  const instrument = s.trackInstrument(track);
  const out = s.trackOutput(track);
  const device = s.device(track.deviceId);
  const editable = track.generator.type === 'drums' || track.generator.type === 'motif' || track.generator.type === 'acid';
  const harmony = s.sequencer.currentHarmony;
  const tab = s.trackTab;
  const ThemedPattern = slotComponent('patternDisplay');

  return (
    <div class="track-detail" style={{ '--accent': track.color }}>
      <div class="detail-head">
        <span class="detail-icon">
          <Icon name={TYPE_ICONS[track.generator.type] ?? 'motif'} size={20} />
        </span>
        <input
          class="title-input"
          aria-label="Track name"
          value={track.name}
          onChange={(e) => s.updateTrack(track.id, { name: (e.target as HTMLInputElement).value || track.name })}
        />
        <span class="muted small detail-meta">
          {typeLabel(track.generator.type)} · {device?.name ?? out.portName} · ch {out.channel}
        </span>
        <div class="spacer" />
        <TrackActions track={track} />
        <div class="detail-chords" aria-label="Progression">
          {s.project.progression.map((step, i) => (
            <ChordChip key={i} index={i} label={Chord.fromDegree(harmony.scale, step.degree, step.size ?? 3).symbol()} />
          ))}
        </div>
      </div>

      <nav class="jump-bar" role="tablist" aria-label="Track sections">
        {SECTIONS.map((x) => (
          <button type="button" role="tab" class="jump" aria-selected={tab === x.id} aria-current={tab === x.id} onClick={() => s.setTrackTab(x.id)}>
            <Icon name={x.icon} size={16} />
            <span class="jump-label">{x.label}</span>
            <span class="jump-short" aria-hidden="true">{x.short}</span>
            <kbd>{x.key}</kbd>
          </button>
        ))}
        <div class="spacer" />
        <TrackActions track={track} />
      </nav>

      <div class="detail-body">
        {tab === 'pattern' && (
        <div class="detail-section span-all">
          <Card
            title={`Pattern · ${rt ? rt.pattern.lengthSteps / s.project.stepsPerBar : 0} bar(s)`}
            actions={
              track.userPattern ? (
                <button type="button" onClick={() => s.regenerate(track.id)}>
                  <Icon name="dice" /> Back to generated
                </button>
              ) : undefined
            }
          >
            <div class="timing-row">
              <TrackTiming track={track} />
              {track.generator.type !== 'drums' && (
                <div class="field">
                  <span class="field-label">Octave</span>
                  <OctaveControl track={track} compact />
                </div>
              )}
            </div>
            {track.generator.type === 'drums' && <DrumPresets track={track} />}
            {editable ? (
              <PatternEditor track={track} />
            ) : (
              rt &&
              (ThemedPattern ? (
                <ThemedPattern track={track} pattern={rt.pattern} />
              ) : (
                <PatternView track={track} pattern={rt.pattern} harmony={harmony} height={180} showLabels />
              ))
            )}
            <div class="variations">
              <span class="eyebrow">Variations</span>
              <div class="chips">
                {(rt?.history ?? []).slice(-10).map((pattern, i, list) => {
                  const index = (rt?.history.length ?? 0) - list.length + i;
                  const current = rt?.pattern === pattern;
                  return (
                    <button type="button" class="chip" aria-pressed={current} onClick={() => s.restoreVariation(track.id, index)}>
                      {variationName(index)}
                    </button>
                  );
                })}
              </div>
            </div>
          </Card>
        </div>

)}

        {tab === 'generator' && <GeneratorTab track={track} instrument={instrument} />}

        {tab === 'panel' && (
          <div class="detail-section span-all">
            <KnobPanel track={track} instrument={instrument} />
          </div>
        )}

        {tab === 'modulation' && (
        <div class="detail-section span-all tab-columns">
          <Modulations track={track} instrument={instrument} />
          <Motions track={track} />
          <CallResponse track={track} />
        </div>

)}

        {tab === 'output' && (
        <div class="detail-section span-all tab-columns">
          <OutputCard track={track} />
          <Card title="Track">
            <button
              type="button"
              class="danger"
              onClick={() => {
                if (confirm(`Delete track “${track.name}”?`)) s.removeTrack(track.id);
              }}
            >
              <Icon name="trash" /> Delete track
            </button>
          </Card>
        </div>
        )}
      </div>
    </div>
  );
}

/** New pattern, freeze, mute and solo. Shown in the tab bar on wide screens, next to the title on phones. */
function TrackActions({ track }: { track: TrackState }) {
  const s = useStore();
  return (
    <div class="detail-actions">
      <button type="button" class="jump square-jump" onClick={() => s.regenerate(track.id)} title="New pattern (N)" aria-label="New pattern (N)">
        <Icon name="dice" size={16} />
      </button>
      <button
        type="button"
        class="jump square-jump"
        aria-pressed={track.frozen}
        onClick={() => s.updateTrack(track.id, { frozen: !track.frozen })}
        title={track.frozen ? 'Frozen — unfreeze (F)' : 'Freeze (F)'}
        aria-label={track.frozen ? 'Unfreeze (F)' : 'Freeze (F)'}
      >
        <Icon name="snow" size={16} />
      </button>
      <button
        type="button"
        class="jump square-jump"
        aria-pressed={track.muted}
        aria-label={`Mute ${track.name} (M)`}
        onClick={() => s.updateTrack(track.id, { muted: !track.muted })}
      >
        <Icon name={track.muted ? 'mute' : 'speaker'} size={16} />
      </button>
      <button
        type="button"
        class="jump square-jump"
        aria-pressed={track.solo}
        aria-label={`Solo ${track.name} (S)`}
        onClick={() => s.updateTrack(track.id, { solo: !track.solo })}
      >
        S
      </button>
    </div>
  );
}

/** Knob movements recorded on the Panel tab or from the synth. */
function Motions({ track }: { track: TrackState }) {
  const s = useStore();
  const motions = track.motions ?? [];
  return (
    <Card title="Recorded motions">
      {motions.length === 0 && (
        <p class="hint">Turn knobs on the synth or the Panel tab while “Record motion” runs; the movement loops here like an LFO.</p>
      )}
      {motions.map((m) => (
        <div class="modulation" key={m.id}>
          <div class="row gap-s wrap">
            <b class="mod-title">{m.label}</b>
            <span class="muted small">
              CC {m.cc} · {m.values.length / s.project.stepsPerBar} bar{m.values.length === s.project.stepsPerBar ? '' : 's'}
            </span>
            <div class="spacer" />
            <Toggle label="On" checked={m.enabled} onChange={(enabled) => s.updateMotion(track.id, m.id, { enabled })} />
            <button type="button" class="danger" aria-label={`Remove motion ${m.label}`} onClick={() => s.updateMotion(track.id, m.id, null)}>
              <Icon name="trash" /> Remove
            </button>
          </div>
          <MotionPreview values={m.values} color={track.color} />
        </div>
      ))}
    </Card>
  );
}

function MotionPreview({ values, color }: { values: number[]; color: string }) {
  const w = 300;
  const h = 48;
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${((i / Math.max(1, values.length - 1)) * w).toFixed(1)} ${(h - (v / 127) * h).toFixed(1)}`).join(' ');
  return (
    <svg class="motion-preview" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <path d={d} fill="none" stroke={color} stroke-width="2" vector-effect="non-scaling-stroke" />
    </svg>
  );
}

/** One-tap grooves for the TR-8S, grouped by genre. */
function DrumPresets({ track }: { track: TrackState }) {
  const s = useStore();
  const [genre, setGenre] = useState(PRESET_GENRES[0]!);
  return (
    <div class="presets">
      <div class="presets-head">
        <span class="eyebrow">Presets</span>
        <div class="segmented" role="radiogroup" aria-label="Preset genre">
          {PRESET_GENRES.map((g) => (
            <button type="button" role="radio" aria-checked={g === genre} onClick={() => setGenre(g)}>
              {g}
            </button>
          ))}
        </div>
      </div>
      <div class="chips">
        {DRUM_PRESETS.filter((p) => p.genre === genre).map((p) => (
          <button type="button" class="preset-chip" onClick={() => s.loadDrumPreset(track.id, p.id)}>
            <b>{p.name}</b>
            <span class="mono">{p.bpm}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ChordChip({ index, label }: { index: number; label: string }) {
  const s = useStore();
  const current = useLive((l) => (s.sequencer.playing ? s.sequencer.harmonyAt(l.bar).stepIndex : -1));
  return (
    <button type="button" class="detail-chord" aria-current={current === index} onClick={() => s.go({ name: 'harmony' })}>
      {label}
    </button>
  );
}

/** Pick a device from "My devices"; without devices, set a port directly. */
function OutputCard({ track }: { track: TrackState }) {
  const s = useStore();
  const device = s.device(track.deviceId);
  const out = s.trackOutput(track);
  const instrument = s.trackInstrument(track);

  if (s.rack.devices.length === 0) {
    return (
      <Card title="Output">
        <div class="empty">
          <p>Set up your synths once under Devices; then every track just picks one, in every project.</p>
          <button type="button" class="primary" onClick={() => s.go({ name: 'setup' })}>
            Set up your gear
          </button>
        </div>
        <Select
          label="MIDI port"
          value={track.output.portName}
          options={[...new Set([track.output.portName, ...s.ports])].map((n) => ({
            value: n,
            label: s.portAvailable(n) ? n : `${n} (not connected)`,
          }))}
          onChange={(portName) => s.updateTrack(track.id, { output: { ...track.output, portName }, instrumentId: instrumentForLocalPort(portName) })}
        />
        <div class="field">
          <span class="field-label">Channel</span>
          <Stepper
            label="MIDI channel"
            value={track.output.channel}
            min={1}
            max={16}
            onChange={(channel) => s.updateTrack(track.id, { output: { ...track.output, channel } })}
          />
        </div>
      </Card>
    );
  }

  return (
    <Card title="Device">
      <div class="chips device-pick" role="radiogroup" aria-label="Device">
        {s.rack.devices.map((d) => (
          <button
            type="button"
            role="radio"
            class="chip device-option"
            aria-checked={d.id === track.deviceId}
            aria-pressed={d.id === track.deviceId}
            onClick={() => s.updateTrack(track.id, { deviceId: d.id })}
          >
            <span class={`dot ${s.ports.includes(d.portName) ? 'ok' : ''}`} />
            {d.name}
          </button>
        ))}
      </div>
      <span class="field-label">Built-in synths</span>
      <div class="chips device-pick" role="radiogroup" aria-label="Built-in synth">
        {Object.values(LOCAL_PORTS)
          .filter((port) => !s.rack.devices.some((d) => d.portName === port))
          .map((port) => {
            const on = !device && track.output.portName === port;
            return (
              <button
                type="button"
                role="radio"
                class="chip device-option"
                aria-checked={on}
                aria-pressed={on}
                onClick={() =>
                  s.updateTrack(track.id, {
                    deviceId: undefined,
                    output: { portName: port, channel: track.output.channel },
                    instrumentId: instrumentForLocalPort(port),
                  })
                }
              >
                {port.replace(/^Drift Synth /, '')}
              </button>
            );
          })}
      </div>
      <p class={`hint ${s.portAvailable(out.portName) ? '' : 'warn'}`}>
        {out.portName} · channel {out.channel}
        {instrument ? ` · ${instrument.manufacturer} ${instrument.device}` : ''}
        {s.portAvailable(out.portName) ? '' : ' · not connected'}
      </p>
      {!device && !isLocalPort(track.output.portName) && <p class="warn small">No device chosen — this track uses its own port setting.</p>}
      <button type="button" class="link" onClick={() => s.go({ name: 'instruments' })}>
        Edit my devices…
      </button>
    </Card>
  );
}

function variationName(i: number): string {
  if (i === 0) return 'A';
  return `A${i}`;
}

function CallResponse({ track }: { track: TrackState }) {
  const s = useStore();
  const phrase = track.phrase;
  const role = phrase?.role ?? 'off';
  const partners = s.project.tracks.filter((t) => t.id !== track.id && t.generator.type !== 'drums');
  const set = (next: PhraseSettings | undefined) => s.updateTrack(track.id, { phrase: next });
  const base: PhraseSettings = phrase ?? { role: 'call', bars: 1 };
  const caller = phrase?.answer ? s.project.tracks.find((t) => t.id === phrase.answer!.from) : undefined;

  return (
    <Card title="Call and response">
      <p class="hint">
        Two tracks take turns: the call plays a phrase, the response answers in the gap after it. Give the other track the
        opposite role{track.generator.type !== 'drums' ? ', or let this one answer with a transformed copy of the call' : ''}.
      </p>
      <Segmented
        label="Role"
        value={role}
        options={[
          { value: 'off', label: 'Always plays' },
          { value: 'call', label: 'Call' },
          { value: 'response', label: 'Response' },
        ]}
        onChange={(r) => (r === 'off' ? set(undefined) : set({ ...base, role: r as PhraseRole, answer: r === 'call' ? undefined : base.answer }))}
      />
      {phrase && (
        <Segmented
          label="Phrase length (bars)"
          value={phrase.bars}
          options={[1, 2, 4].map((b) => ({ value: b, label: String(b) }))}
          onChange={(bars) => set({ ...phrase, bars })}
        />
      )}
      {phrase?.role === 'response' && track.generator.type !== 'drums' && (
        <>
          <Select
            label="Answer with"
            value={phrase.answer?.from ?? ''}
            options={[
              { value: '', label: 'This track’s own pattern' },
              ...partners.map((t) => ({ value: t.id, label: `${t.name}’s phrase` })),
            ]}
            onChange={(from) =>
              set({ ...phrase, answer: from ? { from, transform: phrase.answer?.transform ?? 'upThird' } : undefined })
            }
          />
          {phrase.answer && (
            <Segmented
              label="Transform"
              value={phrase.answer.transform}
              options={ANSWER_TRANSFORMS.map((x) => ({ value: x.id, label: x.label }))}
              onChange={(transform) => set({ ...phrase, answer: { ...phrase.answer!, transform } })}
            />
          )}
          {caller && !caller.phrase && (
            <div class="row gap-s wrap">
              <span class="hint">{caller.name} still plays all the time.</span>
              <button type="button" onClick={() => s.updateTrack(caller.id, { phrase: { role: 'call', bars: phrase.bars } })}>
                Make {caller.name} the call
              </button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

const SHAPES: { value: LfoShape; label: string }[] = [
  { value: 'sine', label: 'Sine' },
  { value: 'triangle', label: 'Tri' },
  { value: 'saw', label: 'Saw' },
  { value: 'square', label: 'Square' },
  { value: 'random', label: 'S&H' },
];

function Modulations({ track, instrument }: { track: TrackState; instrument: InstrumentDefinition | undefined }) {
  const s = useStore();
  const ccParams = (instrument?.params ?? []).filter((p) => p.msg.type === 'cc' && p.msg.lsb === undefined);
  // Always read the latest track state, so quick successive edits never work
  // from a stale copy.
  const current = () => s.project.tracks.find((t) => t.id === track.id)?.modulations ?? [];
  const set = (modulations: CcModulation[]) => s.updateTrack(track.id, { modulations });
  const update = (id: string, patch: Partial<CcModulation>) => set(current().map((m) => (m.id === id ? { ...m, ...patch } : m)));
  const removeModulation = (id: string) => set(current().filter((m) => m.id !== id));
  const add = () => {
    const cutoff = ccParams.find((p) => /cutoff|filter/i.test(p.name)) ?? ccParams[0];
    const cc = cutoff?.msg.type === 'cc' ? cutoff.msg.cc : 74;
    set([
      ...current(),
      { id: newId(), enabled: true, cc, label: cutoff?.name ?? 'CC 74', shape: 'sine', periodBars: 4, min: 20, max: 110 },
    ]);
  };
  return (
    <Card
      title="Modulation (MIDI CC)"
      actions={
        <button type="button" onClick={add}>
          <Icon name="plus" /> LFO
        </button>
      }
    >
      {track.modulations.length === 0 && (
        <p class="hint">
          Add an LFO to sweep a synth parameter such as filter cutoff.
          {!instrument && ' Pick an instrument above to choose parameters by name.'}
        </p>
      )}
      {track.modulations.map((m, index) => (
        <div class="modulation" key={m.id}>
          <div class="row gap-s wrap">
            <b class="mod-title">LFO {index + 1}</b>
            <span class="muted small mod-target">{m.label}</span>
            <div class="spacer" />
            <Toggle label="On" checked={m.enabled} onChange={(enabled) => update(m.id, { enabled })} />
            <button
              type="button"
              class="danger"
              aria-label={`Remove LFO ${index + 1}`}
              onClick={() => removeModulation(m.id)}
            >
              <Icon name="trash" /> Remove
            </button>
          </div>
          <LfoPreview mod={m} color={track.color} />
          <div class="row gap-s wrap">
            {ccParams.length > 0 ? (
              <Select
                label="Parameter"
                value={m.cc}
                options={[
                  ...(ccParams.some((p) => p.msg.type === 'cc' && p.msg.cc === m.cc) ? [] : [{ value: m.cc, label: `CC ${m.cc}` }]),
                  ...ccParams.map((p) => ({
                    value: p.msg.type === 'cc' ? p.msg.cc : 0,
                    label: `${p.section ? p.section + ' · ' : ''}${p.name} (CC ${p.msg.type === 'cc' ? p.msg.cc : ''})`,
                  })),
                ]}
                onChange={(cc) => update(m.id, { cc, label: ccParams.find((p) => p.msg.type === 'cc' && p.msg.cc === cc)?.name ?? `CC ${cc}` })}
              />
            ) : (
              <div class="field">
                <span class="field-label">CC number</span>
                <Stepper label="CC number" value={m.cc} min={0} max={127} onChange={(cc) => update(m.id, { cc, label: `CC ${cc}` })} />
              </div>
            )}
          </div>
          <Segmented label="Shape" value={m.shape} options={SHAPES} onChange={(shape) => update(m.id, { shape })} />
          <Segmented
            label="Cycle (bars)"
            value={m.periodBars}
            options={[1, 2, 4, 8, 16, 32, 64].map((b) => ({ value: b, label: String(b) }))}
            onChange={(periodBars) => update(m.id, { periodBars })}
          />
          <div class="voice-sliders">
            <Slider compact label="Min" value={m.min} min={0} max={127} step={1} color={track.color} onInput={(min) => update(m.id, { min })} />
            <Slider compact label="Max" value={m.max} min={0} max={127} step={1} color={track.color} onInput={(max) => update(m.id, { max })} />
          </div>
        </div>
      ))}
    </Card>
  );
}
