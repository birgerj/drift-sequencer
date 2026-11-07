import type { ComponentChildren } from 'preact';
import type { DrumParams, DrumVoice } from '../../core/generators/drumGenerator';
import type { InstrumentDefinition } from '../../core/instruments/instrument';
import { DEFAULT_INTERPLAY, interplayActive, type InterplaySettings } from '../../core/engine/interplay';
import { noteName } from '../../core/theory/note';
import { tr8sKey, TR8S_GROUP_COLORS, TR8S_VOICE_ORDER } from '../../core/generators/drumPresets';
import type { TrackState } from '../../state/project';
import { slotComponent } from '../theme/slots';
import { Card, Icon, Segmented, Select, Toggle, TYPE_ICONS, drumIcon } from '../components/controls';
import { BarField, DegreeLadder, EuclidLane, EuclidRing, GateControl, GenKnob, PulseDots, StepButtons, VelocityBar } from '../components/GenControls';
import { PatternView } from '../components/PatternView';
import { controlGroup, controlWidget, PARAM_SCHEMA, TRACK_TYPES, type Control, type ControlGroup } from '../paramSchema';
import { useStore } from '../store';

const GROUPS: { id: ControlGroup; title: string; sub: string }[] = [
  { id: 'notes', title: 'Notes', sub: 'which pitches' },
  { id: 'rhythm', title: 'Rhythm', sub: 'when it plays' },
  { id: 'dynamics', title: 'Dynamics', sub: 'how hard' },
  { id: 'evolution', title: 'Evolution', sub: 'how it changes' },
];

/** Shown in a module that has nothing to set for this track type. */
const EMPTY: Partial<Record<string, Partial<Record<ControlGroup, string>>>> = {
  drone: {
    rhythm: 'One long note per chord — nothing to set. Use Speed on the Pattern tab for longer notes.',
    evolution: 'A drone doesn’t mutate. Shape it with an LFO on the Modulation tab instead.',
  },
};

/**
 * The Generator tab. Every track type uses the same layout — Notes, Rhythm,
 * Dynamics, Evolution, then Feel and Listens to — so a setting is always in
 * the same place; a module with nothing to set for a type stays as an empty
 * frame.
 */
export function GeneratorTab({ track, instrument }: { track: TrackState; instrument: InstrumentDefinition | undefined }) {
  const s = useStore();
  const type = track.generator.type;
  const drums = type === 'drums';
  const current = TRACK_TYPES.find((t) => t.type === type);
  return (
    <div class="detail-section span-all generator-tab">
      <div class="gen-type-row">
        <span class="eyebrow">Type</span>
        <div class="type-chips" role="radiogroup" aria-label="Track type">
          {TRACK_TYPES.map((t) => (
            <button
              type="button"
              role="radio"
              class="type-chip"
              aria-checked={type === t.type}
              title={t.description}
              onClick={() => s.setTrackType(track.id, t.type)}
            >
              <Icon name={TYPE_ICONS[t.type] ?? 'motif'} size={16} />
              {t.label}
            </button>
          ))}
        </div>
        <span class="hint gen-type-desc">{current?.description}</span>
      </div>

      {track.userPattern && (
        <div class="gen-written" role="status">
          <Icon name="snow" size={18} />
          <p>
            <b>This track plays a written pattern</b> — from the template or your own edits. Most settings here only shape
            generated patterns, so you won’t hear them until you switch.
          </p>
          <button type="button" onClick={() => s.regenerate(track.id)}>
            <Icon name="dice" /> Use generated pattern
          </button>
        </div>
      )}

      {drums ? <DrumVoices track={track} instrument={instrument} /> : <Preview track={track} />}

      <div class="gen-grid">
        {GROUPS.filter((g) => !drums || g.id === 'dynamics' || g.id === 'evolution').map((g) => (
          <GroupModule track={track} group={g} />
        ))}
        <FeelCard track={track} />
        <ListenCard track={track} />
      </div>
    </div>
  );
}

/** What the generator plays right now; redraws as soon as a setting changes it. */
function Preview({ track }: { track: TrackState }) {
  const s = useStore();
  const rt = s.sequencer.track(track.id);
  const ThemedPattern = slotComponent('patternDisplay');
  if (!rt) return null;
  return (
    <Card title="Preview" actions={<span class="hint">what it plays now</span>} class="gen-preview">
      {ThemedPattern ? (
        <ThemedPattern track={track} pattern={rt.pattern} />
      ) : (
        <PatternView track={track} pattern={rt.pattern} harmony={s.sequencer.currentHarmony} height={96} />
      )}
    </Card>
  );
}

function Module(props: { title: string; sub: string; empty?: boolean; children: ComponentChildren }) {
  return (
    <Card title={props.title} actions={<span class="hint">{props.sub}</span>} class={`gen-module ${props.empty ? 'gen-empty' : ''}`}>
      {props.children}
    </Card>
  );
}

function GroupModule({ track, group }: { track: TrackState; group: (typeof GROUPS)[number] }) {
  const s = useStore();
  const type = track.generator.type;
  const params = track.generator.params as unknown as Record<string, unknown>;
  const controls = PARAM_SCHEMA[type].filter((c) => controlGroup(c) === group.id && (!c.when || c.when(params)));
  const set = (key: string, v: unknown) => s.setTrackParam(track.id, key, v);

  // Velocity and its variation are drawn together as one bar.
  const velocity = controls.find((c) => c.key === 'velocity');
  const variation = controls.find((c) => c.key === 'velocityVariation');
  const rest = controls.filter((c) => c !== velocity && (c !== variation || !velocity));
  const fields = rest.filter((c) => !['knob', 'toggle'].includes(controlWidget(c)));
  const knobs = rest.filter((c) => controlWidget(c) === 'knob');
  const toggles = rest.filter((c) => controlWidget(c) === 'toggle');
  const mutates = group.id === 'evolution' && type !== 'drone';
  const empty = EMPTY[type]?.[group.id];

  if (!controls.length && !mutates && !(group.id === 'notes' && type === 'chords')) {
    return (
      <Module title={group.title} sub={group.sub} empty>
        <p class="hint">{empty ?? 'Nothing to set for this track type.'}</p>
      </Module>
    );
  }

  return (
    <Module title={group.title} sub={group.sub}>
      {group.id === 'notes' && type === 'chords' && (
        <p class="hint">
          Chords come from the progression and are voice-led automatically.{' '}
          <button type="button" class="link" onClick={() => s.go({ name: 'harmony' })}>
            Edit the progression
          </button>
        </p>
      )}
      {velocity && (
        <VelocityBar
          velocity={Number(params.velocity ?? 100)}
          variation={variation ? Number(params.velocityVariation ?? 0) : undefined}
          onVelocity={(v) => set('velocity', v)}
          onVariation={variation ? (v) => set('velocityVariation', v) : undefined}
        />
      )}
      {fields.map((c) => (
        <ParamControl control={c} track={track} />
      ))}
      {knobs.length > 0 && (
        <div class="gen-knobs">
          {knobs.map((c) => (
            <ParamControl control={c} track={track} />
          ))}
        </div>
      )}
      {mutates && (
        <Segmented
          label="Mutate every (bars)"
          value={track.mutationIntervalBars}
          options={[1, 2, 4, 8, 16].map((b) => ({ value: b, label: String(b) }))}
          onChange={(mutationIntervalBars) => s.updateTrack(track.id, { mutationIntervalBars })}
        />
      )}
      {toggles.map((c) => (
        <ParamControl control={c} track={track} />
      ))}
      {group.id === 'dynamics' && type === 'drums' && <p class="hint">Each voice has its own velocity, above.</p>}
    </Module>
  );
}

function ParamControl({ control: c, track }: { control: Control; track: TrackState }) {
  const s = useStore();
  const params = track.generator.params as unknown as Record<string, unknown>;
  const value = params[c.key];
  const set = (v: unknown) => s.setTrackParam(track.id, c.key, v);
  switch (c.kind) {
    case 'toggle':
      return <Toggle label={c.label} description={c.description} checked={Boolean(value)} onChange={set} />;
    case 'choice':
      return <Segmented label={c.label} value={value as string | number} options={c.options} onChange={set} />;
    case 'range': {
      const n = Number(value ?? c.min);
      switch (controlWidget(c)) {
        case 'steps':
          return <StepButtons label={c.label} value={n} min={c.min} max={c.max} format={c.format} onChange={set} />;
        case 'ladder':
          return <DegreeLadder label={c.label} value={n} min={c.min} max={c.max} onChange={set} />;
        case 'pulses':
          return <PulseDots label={c.label} value={n} min={c.min} max={c.max} onChange={set} />;
        case 'gate':
          return <GateControl label={c.label} value={n} min={c.min} max={c.max} step={c.step} onChange={set} />;
        default:
          return <GenKnob label={c.label} value={n} min={c.min} max={c.max} step={c.step} format={c.format} onChange={set} />;
      }
    }
  }
}

/** Humanize, kick awareness and melody memory. */
function FeelCard({ track }: { track: TrackState }) {
  const s = useStore();
  const h = track.humanize ?? { timing: 0, velocity: 0, layBack: 0 };
  const setH = (patch: Partial<typeof h>) => s.updateTrack(track.id, { humanize: { ...h, ...patch } });
  const memory = track.memory ?? { every: 0, mode: 'theme' as const };
  const bassLike = track.generator.type === 'bass' || track.generator.type === 'acid';
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  return (
    <Module title="Feel" sub="played, not programmed">
      <div class="gen-knobs">
        <GenKnob label="Timing drift" value={h.timing} min={0} max={1} step={0.01} format={(x) => `±${Math.round(x * 18)} ms`} onChange={(timing) => setH({ timing })} />
        <GenKnob label="Velocity drift" value={h.velocity} min={0} max={1} step={0.01} format={pct} onChange={(velocity) => setH({ velocity })} />
        <GenKnob label="Lay back" value={h.layBack} min={0} max={1} step={0.01} format={(x) => `${Math.round(x * 25)} ms`} onChange={(layBack) => setH({ layBack })} />
      </div>
      {bassLike && (
        <Segmented
          label="Kick drum"
          value={track.kickMode ?? 'off'}
          options={[
            { value: 'off', label: 'Ignore' },
            { value: 'avoid', label: 'Make room' },
            { value: 'duck', label: 'Duck' },
          ]}
          onChange={(kickMode) => s.updateTrack(track.id, { kickMode })}
        />
      )}
      <Segmented
        label="Melody memory · return after"
        value={memory.every}
        options={[0, 2, 3, 4, 6].map((n) => ({ value: n, label: n === 0 ? 'Never' : String(n) }))}
        onChange={(every) => s.updateTrack(track.id, { memory: { ...memory, every } })}
      />
      {memory.every > 0 && (
        <Segmented
          label="Return to"
          value={memory.mode}
          options={[
            { value: 'theme', label: 'The theme' },
            { value: 'recall', label: 'An earlier variation' },
          ]}
          onChange={(mode) => s.updateTrack(track.id, { memory: { ...memory, mode } })}
        />
      )}
      <p class="hint">
        {bassLike && track.kickMode === 'avoid' ? 'Bass notes that land on a kick move to the next step, if it is free. ' : ''}
        {bassLike && track.kickMode === 'duck' ? 'Bass notes on a kick play softer, like sidechain. ' : ''}
        {memory.every > 0
          ? `After ${memory.every} changes the track comes back to ${memory.mode === 'theme' ? 'its theme (the pattern it started with)' : 'one of its earlier variations'}, then evolves again.`
          : 'Timing and velocity drift make a track sound played rather than programmed.'}
      </p>
    </Module>
  );
}

/** Interplay: this track reacts to what other tracks play on the same step. */
function ListenCard({ track }: { track: TrackState }) {
  const s = useStore();
  const settings = track.interplay ?? DEFAULT_INTERPLAY;
  const set = (patch: Partial<InterplaySettings>) => s.updateTrack(track.id, { interplay: { ...settings, ...patch } });
  const others = s.project.tracks.filter((t) => t.id !== track.id);
  const drums = track.generator.type === 'drums';
  const names = settings.listenTo.map((id) => others.find((t) => t.id === id)?.name).filter(Boolean).join(' and ');
  const toggle = (id: string) =>
    set({ listenTo: settings.listenTo.includes(id) ? settings.listenTo.filter((x) => x !== id) : [...settings.listenTo, id] });
  const active = interplayActive(track.interplay);
  return (
    <Module title="Listens to" sub="reacts live">
      <div class="chips" role="group" aria-label="Tracks to listen to">
        {others.map((t) => (
          <button type="button" class="chip" style={{ '--accent': t.color }} aria-pressed={settings.listenTo.includes(t.id)} onClick={() => toggle(t.id)}>
            {t.name}
          </button>
        ))}
        {others.length === 0 && <span class="hint">Add another track first.</span>}
      </div>
      {settings.listenTo.length > 0 && (
        <>
          <Segmented
            label="Rhythm"
            value={settings.rhythm}
            options={[
              { value: 'free', label: 'Own rhythm' },
              { value: 'space', label: 'Make room' },
              { value: 'lock', label: 'Play along' },
            ]}
            onChange={(rhythm) => set({ rhythm })}
          />
          <div class="gen-knobs">
            <GenKnob label="Strength" value={settings.amount} min={0} max={1} step={0.05} format={(x) => `${Math.round(x * 100)}%`} onChange={(amount) => set({ amount })} />
          </div>
          {!drums && (
            <Toggle
              label="Different note"
              description="On the beat, pick a chord tone they aren’t playing"
              checked={settings.otherTone}
              onChange={(otherTone) => set({ otherTone })}
            />
          )}
        </>
      )}
      <p class="hint">
        {!active
          ? 'Pick tracks to listen to. This track then reacts to what they play, live — also after they change.'
          : [
              settings.rhythm === 'space' ? `Rests where ${names} play${settings.listenTo.length > 1 ? '' : 's'}.` : '',
              settings.rhythm === 'lock' ? `Plays together with ${names} and rests in between.` : '',
              settings.otherTone && !drums ? `On the beat it avoids the note ${names} ${settings.listenTo.length > 1 ? 'play' : 'plays'}.` : '',
            ]
              .filter(Boolean)
              .join(' ')}
      </p>
    </Module>
  );
}

/** Drum voices: one compact row each — ring, name and note, the bar it plays, and its settings. */
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
  const step = (label: string, value: number, min: number, max: number, onChange: (v: number) => void) => (
    <div class="voice-step" role="group" aria-label={label}>
      <button type="button" aria-label={`Decrease ${label}`} onClick={() => onChange(Math.max(min, value - 1))}>
        <Icon name="minus" size={16} />
      </button>
      <span class="mono">{value}</span>
      <button type="button" aria-label={`Increase ${label}`} onClick={() => onChange(Math.min(max, value + 1))}>
        <Icon name="plus" size={16} />
      </button>
    </div>
  );
  return (
    <Card
      title="Voices"
      class="drum-voices"
      actions={
        <>
          {params.voices.length < TR8S_VOICE_ORDER.length && (
            <button type="button" onClick={() => s.addAllTr8sVoices(track.id)}>
              <Icon name="plus" /> All TR-8S lanes
            </button>
          )}
          <button
            type="button"
            onClick={() => setVoices([...params.voices, { name: 'NEW', note: 37, pulses: 3, rotate: 0, probability: 0.7, velocity: 90 }])}
          >
            <Icon name="plus" /> Voice
          </button>
        </>
      }
    >
      <div class="dv-head" aria-hidden="true">
        <span />
        <span>Voice</span>
        <span>Bar · 16 steps</span>
        <span>Hits</span>
        <span>Rotate</span>
        <span>Chance</span>
        <span>Velocity</span>
        <span />
      </div>
      <div class="dv-rows">
        {params.voices.map((v, i) => (
          <div class={`dv-row ${v.muted ? 'muted' : ''}`}>
            <button
              type="button"
              class="dv-ring"
              aria-pressed={Boolean(v.muted)}
              aria-label={`Mute ${v.name}`}
              title={v.muted ? 'Muted — tap to unmute' : 'Tap to mute'}
              style={tr8sKey(v.note) ? { '--accent': TR8S_GROUP_COLORS[tr8sKey(v.note)!] } : undefined}
              onClick={() => s.toggleDrumVoiceMute(track.id, v.note)}
            >
              <EuclidRing pulses={v.pulses} rotate={v.rotate} />
              <span class="dv-icon">
                <Icon name={drumIcon(v.name, v.note)} size={14} />
              </span>
            </button>
            <div class="dv-name">
              <input
                class="voice-name mono"
                aria-label="Voice name"
                value={v.name}
                maxLength={6}
                onChange={(e) => update(i, { name: (e.target as HTMLInputElement).value })}
              />
              <Select hideLabel label={`${v.name} note`} value={v.note} options={noteOptions(v.note)} onChange={(note) => update(i, { note })} />
            </div>
            <EuclidLane pulses={v.pulses} rotate={v.rotate} probability={v.probability} muted={v.muted} />
            {step(`${v.name} hits`, v.pulses, 0, 16, (pulses) => update(i, { pulses }))}
            {step(`${v.name} rotate`, v.rotate, 0, 15, (rotate) => update(i, { rotate }))}
            <BarField
              label={`${v.name} chance`}
              value={v.probability}
              min={0}
              max={1}
              step={0.01}
              format={(x) => `${Math.round(x * 100)}%`}
              onChange={(probability) => update(i, { probability })}
            />
            <BarField label={`${v.name} velocity`} value={v.velocity} min={1} max={127} step={1} onChange={(velocity) => update(i, { velocity })} />
            <button type="button" class="square dv-remove" aria-label={`Remove ${v.name}`} onClick={() => setVoices(params.voices.filter((_, j) => j !== i))}>
              <Icon name="trash" />
            </button>
          </div>
        ))}
      </div>
      <p class="hint">The ring and the lane show each voice’s rhythm; dim steps play by chance. Tap the ring to mute a voice.</p>
    </Card>
  );
}
