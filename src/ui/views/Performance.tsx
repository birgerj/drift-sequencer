import { phraseActive } from '../../core/engine/phrasing';
import { Chord } from '../../core/theory/chord';
import { NOTE_NAMES, noteName, pitchClassOf } from '../../core/theory/note';
import type { TrackState } from '../../state/project';
import { Icon, Slider } from '../components/controls';
import { PatternView } from '../components/PatternView';
import { PARAM_SCHEMA, typeLabel } from '../paramSchema';
import { useLive, useStore, store } from '../store';

export function Performance() {
  const s = useStore();
  const p = s.project;
  return (
    <div class="performance">
      <HarmonyStrip />
      <div class="perf-body">
        <main class="lanes">
          {p.tracks.map((t) => (
            <Lane key={t.id} track={t} />
          ))}
          <button type="button" class="add-track" onClick={() => s.addTrack()}>
            <Icon name="plus" /> Add track
          </button>
        </main>
        <aside class="side">
          <NowPlaying />
          <ScaleStrip />
          <Evolution />
        </aside>
      </div>
    </div>
  );
}

function HarmonyStrip() {
  const s = useStore();
  const p = s.project;
  const harmony = s.sequencer.currentHarmony;
  const bar = useLive((l) => (s.sequencer.playing ? l.bar : -1));
  const currentIndex = bar >= 0 ? s.sequencer.harmonyAt(bar).stepIndex : -1;
  const nextMutation = (() => {
    if (bar < 0) return undefined;
    const intervals = p.tracks.filter((t) => !t.frozen).map((t) => t.mutationIntervalBars);
    if (!intervals.length) return undefined;
    const until = Math.min(...intervals.map((i) => i - (bar % i)));
    const interval = Math.min(...intervals);
    return { until, progress: 1 - until / interval };
  })();
  return (
    <section class="card harmony-strip" aria-label="Harmony">
      <span class="eyebrow">Progression</span>
      <div class="chords">
        {p.progression.map((step, i) => {
          const chord = Chord.fromDegree(harmony.scale, step.degree, step.size ?? 3);
          return (
            <button
              type="button"
              class={`chord-chip ${i === currentIndex ? 'active' : ''}`}
              onClick={() => s.go({ name: 'harmony' })}
              aria-label={`${chord.symbol()}, ${step.bars} bars. Edit progression`}
            >
              <b>{chord.symbol()}</b>
              <span class="mono muted">
                {chord.roman()} · {step.bars}
              </span>
            </button>
          );
        })}
      </div>
      <div class="mutation-meter">
        <div class="row-between small">
          <span class="muted">Next mutation</span>
          <span class="mono">{nextMutation ? `in ${nextMutation.until} bar${nextMutation.until === 1 ? '' : 's'}` : '—'}</span>
        </div>
        <div class="meter">
          <div style={{ width: `${(nextMutation?.progress ?? 0) * 100}%` }} />
        </div>
      </div>
    </section>
  );
}

function Lane({ track }: { track: TrackState }) {
  const s = useStore();
  const rt = s.sequencer.track(track.id);
  const quick = PARAM_SCHEMA[track.generator.type].filter((c) => c.kind === 'range').slice(0, 3);
  const params = track.generator.params as unknown as Record<string, number>;
  const portOk = s.portAvailable(track.output.portName);
  const resting = useLive((l) => !!track.phrase && s.sequencer.playing && l.step >= 0 && !phraseActive(track.phrase, l.bar));
  const answering = track.phrase?.answer ? s.project.tracks.find((t) => t.id === track.phrase!.answer!.from) : undefined;
  return (
    <article class={`lane ${resting ? 'resting' : ''}`} style={{ '--accent': track.color }}>
      <div class="lane-head">
        <div class="row gap-s">
          <span class="swatch" />
          <button type="button" class="lane-name" onClick={() => s.go({ name: 'track', trackId: track.id })}>
            {track.name}
          </button>
          <span class="type-pill">{typeLabel(track.generator.type)}</span>
        </div>
        <span class={`small ${portOk ? 'muted' : 'warn'}`} title={portOk ? '' : 'Port not connected'}>
          {track.output.portName} · ch {track.output.channel}
        </span>
        {track.phrase && (
          <span class="phrase-badge small">
            {track.phrase.role === 'call' ? 'Call' : answering ? `Answers ${answering.name}` : 'Response'} · {track.phrase.bars} bar
            {track.phrase.bars > 1 ? 's' : ''}
          </span>
        )}
        <div class="row gap-s lane-buttons">
          <button type="button" class="square" aria-pressed={track.muted} aria-label={`Mute ${track.name}`} onClick={() => s.updateTrack(track.id, { muted: !track.muted })}>
            M
          </button>
          <button type="button" class="square" aria-pressed={track.solo} aria-label={`Solo ${track.name}`} onClick={() => s.updateTrack(track.id, { solo: !track.solo })}>
            S
          </button>
          <button type="button" class="square" aria-label={`New pattern for ${track.name}`} onClick={() => s.regenerate(track.id)}>
            <Icon name="dice" />
          </button>
          <button type="button" class="square" aria-label={`Edit ${track.name}`} onClick={() => s.go({ name: 'track', trackId: track.id })}>
            <Icon name="sliders" />
          </button>
        </div>
      </div>
      <div class="lane-pattern">
        {rt && <PatternView track={track} pattern={rt.pattern} harmony={s.sequencer.currentHarmony} height={track.generator.type === 'drums' ? 132 : 112} showLabels={track.generator.type === 'drums'} />}
      </div>
      <div class="lane-params">
        {quick.map((c) =>
          c.kind === 'range' ? (
            <Slider
              compact
              label={c.label}
              value={params[c.key] ?? c.min}
              min={c.min}
              max={c.max}
              step={c.step}
              format={c.format}
              color={track.color}
              onInput={(v) => s.setTrackParam(track.id, c.key, v)}
            />
          ) : null,
        )}
        {quick.length === 0 && <span class="hint">Open the track to edit its voices.</span>}
      </div>
    </article>
  );
}

function NowPlaying() {
  const s = useStore();
  const now = useLive((l) => {
    const t = performance.now();
    const out: Record<string, string> = {};
    for (const [id, n] of Object.entries(l.now)) {
      if (n.until + 150 <= t) continue;
      const track = store.project.tracks.find((x) => x.id === id);
      out[id] = n.notes.map((note) => (track ? drumName(track, note) : undefined) ?? noteName(note)).join(' ');
    }
    return out;
  });
  return (
    <section class="card">
      <h2 class="eyebrow">Now playing</h2>
      <div class="now-list">
        {s.project.tracks.map((t) => (
          <div class="row-between">
            <span>{t.name}</span>
            <span class="mono now-note" style={{ color: t.color }}>
              {now[t.id] ?? '·'}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function ScaleStrip() {
  const s = useStore();
  const scale = s.sequencer.currentHarmony.scale;
  const pcs = scale.pitchClasses();
  const sounding = useLive((l) => {
    const t = performance.now();
    const map: Record<number, string> = {};
    for (const [id, n] of Object.entries(l.now)) {
      if (n.until + 150 < t) continue;
      const track = store.project.tracks.find((x) => x.id === id);
      if (!track || track.generator.type === 'drums') continue; // drum notes aren't pitches
      const color = track.color;
      for (const note of n.notes) map[pitchClassOf(note)] = color;
    }
    return map;
  });
  return (
    <section class="card">
      <h2 class="eyebrow">
        Scale · {NOTE_NAMES[scale.root]} {scale.mode}
      </h2>
      <div class="scale-strip">
        {NOTE_NAMES.map((name, pc) => {
          const inScale = pcs.includes(pc);
          const color = sounding[pc];
          return (
            <div
              class={`key ${inScale ? 'in' : ''} ${pc === scale.root ? 'root' : ''}`}
              style={color ? { background: color, color: '#0b0c0f' } : undefined}
            >
              {name}
            </div>
          );
        })}
      </div>
      <p class="hint">Light cells are in the scale; coloured cells are sounding now.</p>
    </section>
  );
}

function drumName(track: TrackState, note: number): string | undefined {
  if (track.generator.type !== 'drums') return undefined;
  return track.generator.params.voices.find((v) => v.note === note)?.name;
}

function Evolution() {
  const s = useStore();
  return (
    <section class="card">
      <h2 class="eyebrow">Evolution</h2>
      {s.log.length === 0 && <p class="hint">Mutations appear here while playing.</p>}
      <ol class="log">
        {s.log.slice(0, 8).map((e) => (
          <li key={e.id}>
            <span class="mono muted">{String(e.bar + 1).padStart(3, '0')}</span>
            <span class="swatch small" style={{ background: e.color }} />
            <span>{e.text}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
