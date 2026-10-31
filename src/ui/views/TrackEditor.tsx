import type { DrumParams, DrumVoice } from '../../core/generators/drumGenerator';
import type { InstrumentDefinition } from '../../core/instruments/instrument';
import { noteName } from '../../core/theory/note';
import { ANSWER_TRANSFORMS, type PhraseRole, type PhraseSettings } from '../../core/engine/phrasing';
import { newId, type CcModulation, type LfoShape, type TrackState } from '../../state/project';
import { useEffect, useState } from 'preact/hooks';
import { Chord } from '../../core/theory/chord';
import { Card, Icon, Segmented, Select, Slider, Stepper, Toggle, TYPE_ICONS } from '../components/controls';
import { LfoPreview } from '../components/LfoPreview';
import { OctaveControl } from '../components/OctaveControl';
import { TrackTiming } from '../components/TrackTiming';
import { PatternEditor } from '../components/PatternEditor';
import { PatternView } from '../components/PatternView';
import { PARAM_SCHEMA, TRACK_TYPES, typeLabel, type Control } from '../paramSchema';
import { jumpToSection, lastJump, SECTIONS, type SectionId } from '../shortcuts';
import { useLive, useStore } from '../store';

export function TrackEditor({ trackId }: { trackId: string }) {
  const s = useStore();
  const track = s.project.tracks.find((t) => t.id === trackId);
  const active = useActiveSection();
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
        <div class="detail-chords" aria-label="Progression">
          {s.project.progression.map((step, i) => (
            <ChordChip key={i} index={i} label={Chord.fromDegree(harmony.scale, step.degree, step.size ?? 3).symbol()} />
          ))}
        </div>
      </div>

      <nav class="jump-bar" aria-label="Jump to section">
        {SECTIONS.map((x) => (
          <button type="button" class="jump" aria-current={active === x.id} onClick={() => jumpToSection(x.id)}>
            <Icon name={x.icon} size={16} />
            {x.label}
            <kbd>{x.key}</kbd>
          </button>
        ))}
        <div class="spacer" />
        <button type="button" class="jump" onClick={() => s.regenerate(track.id)} title="N">
          <Icon name="dice" size={16} /> New pattern
        </button>
        <button type="button" class="jump" aria-pressed={track.frozen} onClick={() => s.updateTrack(track.id, { frozen: !track.frozen })} title="F">
          <Icon name="snow" size={16} /> {track.frozen ? 'Frozen' : 'Freeze'}
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
      </nav>

      <div class="detail-body">
        <div id="sec-pattern" class="detail-section span-all">
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
            {editable ? (
              <PatternEditor track={track} />
            ) : (
              rt && <PatternView track={track} pattern={rt.pattern} harmony={harmony} height={180} showLabels />
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

        <div id="sec-generator" class="detail-section">
          <Card title="Generator">
            <div class="type-chips" role="radiogroup" aria-label="Track type">
              {TRACK_TYPES.map((t) => (
                <button
                  type="button"
                  role="radio"
                  class="type-chip"
                  aria-checked={track.generator.type === t.type}
                  title={t.description}
                  onClick={() => s.setTrackType(track.id, t.type)}
                >
                  <Icon name={TYPE_ICONS[t.type] ?? 'motif'} size={16} />
                  {t.label}
                </button>
              ))}
            </div>
            {PARAM_SCHEMA[track.generator.type].map((c) => (
              <ParamControl control={c} track={track} />
            ))}
            <Segmented
              label="Mutate every (bars)"
              value={track.mutationIntervalBars}
              options={[1, 2, 4, 8, 16].map((b) => ({ value: b, label: String(b) }))}
              onChange={(mutationIntervalBars) => s.updateTrack(track.id, { mutationIntervalBars })}
            />
          </Card>
          {track.generator.type === 'drums' && <DrumVoices track={track} instrument={instrument} />}
        </div>

        <div id="sec-modulation" class="detail-section">
          <Modulations track={track} instrument={instrument} />
          <CallResponse track={track} />
        </div>

        <div id="sec-output" class="detail-section">
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

/** The section nearest the top of the scroll area, for the jump bar highlight. */
function useActiveSection(): SectionId {
  const [active, setActive] = useState<SectionId>('pattern');
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      if (performance.now() - lastJump.at < 900) return;
      const bar = document.querySelector('.jump-bar')?.getBoundingClientRect().bottom ?? 0;
      // The lowest section top that has reached the bar; sections side by
      // side in one row tie, and then the first of them wins.
      let current: SectionId = 'pattern';
      let best = -Infinity;
      for (const x of SECTIONS) {
        const top = document.getElementById(`sec-${x.id}`)?.getBoundingClientRect().top;
        if (top !== undefined && top <= bar + 40 && top > best + 1) {
          best = top;
          current = x.id;
        }
      }
      setActive(current);
    };
    const onJump = (e: Event) => setActive((e as CustomEvent<SectionId>).detail);
    window.addEventListener('drift:section', onJump);
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    document.addEventListener('scroll', onScroll, true);
    update();
    return () => {
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('drift:section', onJump);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
  return active;
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
          onChange={(portName) => s.updateTrack(track.id, { output: { ...track.output, portName } })}
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
      <p class={`hint ${s.portAvailable(out.portName) ? '' : 'warn'}`}>
        {out.portName} · channel {out.channel}
        {instrument ? ` · ${instrument.manufacturer} ${instrument.device}` : ''}
        {s.portAvailable(out.portName) ? '' : ' · not connected'}
      </p>
      {!device && <p class="warn small">No device chosen — this track uses its own port setting.</p>}
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

function ParamControl({ control: c, track }: { control: Control; track: TrackState }) {
  const s = useStore();
  const params = track.generator.params as unknown as Record<string, unknown>;
  const value = params[c.key];
  switch (c.kind) {
    case 'range':
      return (
        <Slider
          label={c.label}
          value={Number(value ?? c.min)}
          min={c.min}
          max={c.max}
          step={c.step}
          format={c.format}
          color={track.color}
          onInput={(v) => s.setTrackParam(track.id, c.key, v)}
        />
      );
    case 'toggle':
      return <Toggle label={c.label} description={c.description} checked={Boolean(value)} onChange={(v) => s.setTrackParam(track.id, c.key, v)} />;
    case 'choice':
      return (
        <Segmented
          label={c.label}
          value={value as string | number}
          options={c.options}
          onChange={(v) => s.setTrackParam(track.id, c.key, v)}
        />
      );
  }
}

function DrumVoices({ track, instrument }: { track: TrackState; instrument: InstrumentDefinition | undefined }) {
  const s = useStore();
  const params = track.generator.params as DrumParams;
  const setVoices = (voices: DrumVoice[]) => s.setTrackParam(track.id, 'voices', voices);
  const update = (i: number, patch: Partial<DrumVoice>) => setVoices(params.voices.map((v, j) => (j === i ? { ...v, ...patch } : v)));
  const triggers = (instrument?.triggers ?? []).filter((t, i, all) => all.findIndex((x) => x.note === t.note) === i);
  const noteOptions = (current: number) => {
    const opts = triggers.map((t) => ({ value: t.note, label: `${t.name} (${t.note})` }));
    if (!opts.some((o) => o.value === current)) opts.unshift({ value: current, label: `${noteName(current)} (${current})` });
    return opts;
  };
  return (
    <Card
      title="Drum voices"
      actions={
        <button
          type="button"
          onClick={() => setVoices([...params.voices, { name: 'NEW', note: 37, pulses: 3, rotate: 0, probability: 0.7, velocity: 90 }])}
        >
          <Icon name="plus" /> Voice
        </button>
      }
    >
      <div class="voices">
        {params.voices.map((v, i) => (
          <div class="voice">
            <div class="row gap-s wrap">
              <input
                class="voice-name mono"
                aria-label="Voice name"
                value={v.name}
                maxLength={6}
                onChange={(e) => update(i, { name: (e.target as HTMLInputElement).value })}
              />
              <Select hideLabel label={`${v.name} note`} value={v.note} options={noteOptions(v.note)} onChange={(note) => update(i, { note })} />
              <div class="spacer" />
              <button type="button" class="square" aria-label={`Remove ${v.name}`} onClick={() => setVoices(params.voices.filter((_, j) => j !== i))}>
                <Icon name="trash" />
              </button>
            </div>
            <div class="voice-sliders">
              <Slider compact label="Hits per bar" value={v.pulses} min={0} max={16} step={1} color={track.color} onInput={(pulses) => update(i, { pulses })} />
              <Slider compact label="Rotate" value={v.rotate} min={0} max={15} step={1} color={track.color} onInput={(rotate) => update(i, { rotate })} />
              <Slider
                compact
                label="Chance"
                value={v.probability}
                min={0}
                max={1}
                step={0.01}
                format={(x) => `${Math.round(x * 100)}%`}
                color={track.color}
                onInput={(probability) => update(i, { probability })}
              />
              <Slider compact label="Velocity" value={v.velocity} min={1} max={127} step={1} color={track.color} onInput={(velocity) => update(i, { velocity })} />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
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
            options={[1, 2, 4, 8, 16].map((b) => ({ value: b, label: String(b) }))}
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
