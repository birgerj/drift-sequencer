import { useMemo, useState } from 'preact/hooks';
import type { DrumParams } from '../../core/generators/drumGenerator';
import type { MotifParams } from '../../core/generators/motifGenerator';
import {
  clearPattern,
  cycleCondition,
  cycleDrumCell,
  cycleRatchet,
  drumAt,
  drumCell,
  noteStartAt,
  motifNoteAt,
  motifNoteCovering,
  resizePattern,
  toggleMotifNote,
} from '../../core/pattern/edit';
import { conditionLabel, type Pattern, type PatternEvent } from '../../core/pattern/pattern';
import { fold } from '../../core/pattern/resolve';
import { noteName } from '../../core/theory/note';
import type { TrackState } from '../../state/project';
import { useLive, useStore } from '../store';
import { Icon, Segmented } from './controls';

/** Tap-to-edit grid: drum steps for drum tracks, notes for motif tracks. */
export function PatternEditor({ track }: { track: TrackState }) {
  const s = useStore();
  const rt = s.sequencer.track(track.id);
  const playStep = useLive((l) => {
    const len = s.sequencer.track(track.id)?.pattern.lengthSteps ?? 16;
    return s.sequencer.playing && l.step >= 0 ? l.step % len : -1;
  });
  if (!rt) return null;
  const pattern = rt.pattern;
  const stepsPerBar = s.project.stepsPerBar;

  const [mode, setMode] = useState<EditMode>('notes');
  const setLength = (lengthSteps: number) => {
    s.editPattern(track.id, (p) => resizePattern(p, lengthSteps));
    s.setTrackParam(track.id, 'lengthSteps', lengthSteps);
  };

  return (
    <div class="pattern-editor" style={{ '--accent': track.color }}>
      <div class="row gap-s wrap">
        <Segmented
          label="Length"
          value={pattern.lengthSteps}
          options={[16, 32, 64].map((n) => ({ value: n, label: `${n / stepsPerBar} bar${n > stepsPerBar ? 's' : ''}` }))}
          onChange={setLength}
        />
        <div class="spacer" />
        <button type="button" onClick={() => s.editPattern(track.id, clearPattern)}>
          <Icon name="trash" /> Clear
        </button>
      </div>
      <Segmented
        label="Tap edits"
        value={mode}
        options={[
          { value: 'notes', label: track.generator.type === 'drums' ? 'Steps' : 'Notes' },
          { value: 'condition', label: 'Condition' },
          { value: 'ratchet', label: 'Ratchet' },
        ]}
        onChange={setMode}
      />
      {track.generator.type === 'drums' ? (
        <DrumGrid track={track} pattern={pattern} playStep={playStep} mode={mode} />
      ) : (
        <MotifGrid track={track} pattern={pattern} playStep={playStep} mode={mode} />
      )}
      <p class="hint">
        {mode === 'condition' &&
          'Tap a hit to cycle its condition: 1:2 plays on the 1st of every 2 passes, 3:4 on the 3rd of every 4, and so on.'}
        {mode === 'ratchet' && 'Tap a hit to repeat it 2, 3 or 4 times within its step.'}
      </p>
    </div>
  );
}

function StepHeader({ length, playStep }: { length: number; playStep: number }) {
  return (
    <>
      <span />
      {Array.from({ length }, (_, i) => (
        <span class={`step-num ${i % 4 === 0 ? 'beat' : ''} ${i === playStep ? 'now' : ''}`}>{i % 4 === 0 ? i / 4 + 1 : '·'}</span>
      ))}
    </>
  );
}

type EditMode = 'notes' | 'condition' | 'ratchet';

/**
 * The moving column highlight. Drawn as one overlay element so the grid of
 * buttons doesn't re-render on every step.
 */
function Playhead({ step, rows }: { step: number; rows: number }) {
  if (step < 0) return null;
  return <div class="grid-playhead" aria-hidden="true" style={{ gridColumn: String(step + 2), gridRow: `1 / span ${rows}` }} />;
}

/** Short text shown inside a cell for its condition / ratchet. */
function cellBadge(e: PatternEvent | undefined): string {
  if (!e) return '';
  const parts: string[] = [];
  if (e.condition) parts.push(conditionLabel(e.condition));
  if ((e.ratchet ?? 1) > 1) parts.push(`×${e.ratchet}`);
  return parts.join(' ');
}

function DrumGrid({ track, pattern, playStep, mode }: { track: TrackState; pattern: Pattern; playStep: number; mode: EditMode }) {
  const s = useStore();
  const params = track.generator.params as DrumParams;
  const len = pattern.lengthSteps;
  return (
    <>
      <div class="grid-scroll">
        <div class="step-grid" style={{ gridTemplateColumns: `64px repeat(${len}, minmax(38px, 1fr))` }}>
          <StepHeader length={len} playStep={playStep} />
          {useMemo(() => params.voices.map((v) => (
            <>
              <span class="row-label mono">{v.name}</span>
              {Array.from({ length: len }, (_, step) => {
                const state = drumCell(pattern, step, v.note);
                const ev = pattern.events.find(drumAt(step, v.note));
                const badge = cellBadge(ev);
                const onTap = () => {
                  if (mode === 'notes') s.editPattern(track.id, (p) => cycleDrumCell(p, step, v.note, v.velocity));
                  else if (state !== 'off')
                    s.editPattern(track.id, (p) => (mode === 'condition' ? cycleCondition : cycleRatchet)(p, drumAt(step, v.note)));
                };
                return (
                  <button
                    type="button"
                    class={`cell ${state} ${step % 4 === 0 ? 'beat' : ''}`}
                    aria-label={`${v.name} step ${step + 1}: ${state}${badge ? ' ' + badge : ''}`}
                    aria-pressed={state !== 'off'}
                    onClick={onTap}
                  >
                    {badge && <span class="cell-badge">{badge}</span>}
                  </button>
                );
              })}
            </>
          )), [pattern, params.voices, mode, len, track.id])}
          <Playhead step={playStep} rows={params.voices.length + 1} />
        </div>
      </div>
      {mode === 'notes' && <p class="hint">Tap a step: hit → 50% chance → off.</p>}
    </>
  );
}

function MotifGrid({ track, pattern, playStep, mode }: { track: TrackState; pattern: Pattern; playStep: number; mode: EditMode }) {
  const s = useStore();
  const params = track.generator.params as MotifParams;
  const [noteLength, setNoteLength] = useState(1);
  const len = pattern.lengthSteps;
  const bar = useLive((l) => (s.sequencer.playing ? l.bar : 0));
  const moment = s.sequencer.harmonyAt(bar);
  const range = Math.max(4, Math.min(14, params.rangeDegrees));
  const degrees = Array.from({ length: range * 2 + 1 }, (_, i) => range - i);
  const label = (d: number) =>
    noteName(fold(moment.scale.degreeToMidi(moment.chord.degree + d, track.register.baseOctave), track.register));

  const tap = (step: number, degree: number) => {
    const covering = motifNoteCovering(pattern, step);
    if (mode !== 'notes') {
      if (covering?.pitch.kind === 'degree' && covering.pitch.degree === degree) {
        const start = covering.step;
        s.editPattern(track.id, (p) => (mode === 'condition' ? cycleCondition : cycleRatchet)(p, noteStartAt(start)));
      }
      return;
    }
    // Tapping the tail of a held note shortens it to end here.
    if (covering && covering.step !== step && covering.pitch.kind === 'degree' && covering.pitch.degree === degree) {
      s.editPattern(track.id, (p) => ({
        ...p,
        events: p.events.map((e) => (e === covering ? { ...e, length: step - e.step } : e)),
      }));
      return;
    }
    s.editPattern(track.id, (p) => {
      const added = toggleMotifNote(p, step, degree, params.velocity);
      const note = motifNoteAt(added, step);
      if (!note || motifNoteAt(p, step)) return added;
      // New note: apply the chosen length (up to the next note).
      const next = added.events.find((e) => e.step > step && e.pitch.kind === 'degree');
      const max = (next?.step ?? len) - step;
      return { ...added, events: added.events.map((e) => (e === note ? { ...e, length: Math.min(noteLength, max) } : e)) };
    });
  };

  return (
    <>
      <Segmented
        label="New note length"
        value={noteLength}
        options={[
          { value: 1, label: '1/16' },
          { value: 2, label: '1/8' },
          { value: 4, label: '1/4' },
          { value: 8, label: '1/2' },
        ]}
        onChange={setNoteLength}
      />
      <div class="grid-scroll">
        <div class="step-grid motif" style={{ gridTemplateColumns: `52px repeat(${len}, minmax(34px, 1fr))` }}>
          <StepHeader length={len} playStep={playStep} />
          {useMemo(() => degrees.map((d) => {
            const chordTone = [0, 2, 4].includes(((d % 7) + 7) % 7);
            return (
              <>
                <span class={`row-label mono ${chordTone ? 'chord-tone' : ''}`}>{label(d)}</span>
                {Array.from({ length: len }, (_, step) => {
                  const cover = motifNoteCovering(pattern, step);
                  const on = cover?.pitch.kind === 'degree' && cover.pitch.degree === d;
                  const start = on && cover?.step === step;
                  const badge = start ? cellBadge(cover) : '';
                  return (
                    <button
                      type="button"
                      class={`cell ${start ? 'hit' : on ? 'held' : 'off'} ${chordTone ? 'tone-row' : ''} ${step % 4 === 0 ? 'beat' : ''}`}
                      aria-label={`${label(d)} step ${step + 1}${start ? ': note' : on ? ': held' : ''}${badge ? ' ' + badge : ''}`}
                      aria-pressed={on}
                      onClick={() => tap(step, d)}
                    >
                      {badge && <span class="cell-badge">{badge}</span>}
                    </button>
                  );
                })}
              </>
            );
          }), [pattern, mode, noteLength, len, range, moment.chord.degree, moment.scale, track.id])}
          <Playhead step={playStep} rows={degrees.length + 1} />
        </div>
      </div>
      <p class="hint">
        Rows are scale degrees from the current chord, so your melody follows the progression. Highlighted rows are chord
        tones. Tap to add or remove a note; tap the tail of a note to shorten it.
      </p>
    </>
  );
}
