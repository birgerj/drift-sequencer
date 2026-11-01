import { useMemo } from 'preact/hooks';
import type { Pattern } from '../../../core/pattern/pattern';
import type { TrackState } from '../../../state/project';
import { patternShape, usePlayStep } from '../patternShape';

interface Props {
  track: TrackState;
  pattern: Pattern;
}

/** Modular: one fader per step, like an analogue step sequencer. */
export function SliderSequencer({ track, pattern }: Props) {
  const steps = useMemo(() => patternShape(track, pattern), [pattern, track.register, track.octave, track.rate]);
  const now = usePlayStep(track.id);
  return (
    <div class="slider-seq" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }} role="img" aria-label={`${track.name} pattern`}>
      {steps.map((s, i) => (
        <div class={`seq-step ${i === now ? 'now' : ''} ${s.onset ? 'on' : s.held ? 'held' : ''}`}>
          <div class="seq-slot">
            <span class="seq-cap" style={{ bottom: `${Math.round((s.level || 0) * 100)}%` }} />
          </div>
          <span class="seq-led" />
        </div>
      ))}
    </div>
  );
}

/** Tide: the melody as a soft wave with glowing note bubbles. */
export function TideWave({ track, pattern }: Props) {
  const steps = useMemo(() => patternShape(track, pattern), [pattern, track.register, track.octave, track.rate]);
  const now = usePlayStep(track.id);
  const W = 1000;
  const H = 200;
  const pts = steps.map((s, i) => [((i + 0.5) / steps.length) * W, H - 20 - (s.level || 0) * (H - 50)] as const).filter((_, i) => steps[i]!.level);
  let d = '';
  pts.forEach(([x, y], i) => {
    if (i === 0) d = `M${x.toFixed(1)} ${y.toFixed(1)}`;
    else {
      const [px, py] = pts[i - 1]!;
      const mx = (px + x) / 2;
      d += ` C ${mx.toFixed(1)} ${py.toFixed(1)}, ${mx.toFixed(1)} ${y.toFixed(1)}, ${x.toFixed(1)} ${y.toFixed(1)}`;
    }
  });
  const area = pts.length ? `${d} L ${pts[pts.length - 1]![0].toFixed(1)} ${H} L ${pts[0]![0].toFixed(1)} ${H} Z` : '';
  const nowX = now >= 0 ? ((now + 0.5) / steps.length) * W : -1;
  return (
    <svg class="tide-wave" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`${track.name} pattern`}>
      <defs>
        <linearGradient id="tide-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.45" />
          <stop offset="100%" stop-color="var(--accent)" stop-opacity="0" />
        </linearGradient>
      </defs>
      {area && <path d={area} fill="url(#tide-fill)" />}
      {d && <path d={d} fill="none" stroke="var(--accent)" stroke-width="3" stroke-linecap="round" vector-effect="non-scaling-stroke" />}
      {steps.map((s, i) =>
        s.onset ? (
          <ellipse
            cx={((i + 0.5) / steps.length) * W}
            cy={H - 20 - s.level * (H - 50)}
            rx={i === now ? 9 : 6}
            ry={i === now ? 9 * 2.2 : 6 * 2.2}
            fill={i === now ? '#fff' : 'var(--accent)'}
            class="tide-dot"
          />
        ) : null,
      )}
      {nowX >= 0 && <line x1={nowX} y1="0" x2={nowX} y2={H} stroke="rgba(255,255,255,0.55)" stroke-width="2" vector-effect="non-scaling-stroke" />}
    </svg>
  );
}

/** Phosphor: the melody as an oscilloscope trace on a graticule. */
export function ScopeTrace({ track, pattern }: Props) {
  const steps = useMemo(() => patternShape(track, pattern), [pattern, track.register, track.octave, track.rate]);
  const now = usePlayStep(track.id);
  const W = 1000;
  const H = 200;
  const w = W / steps.length;
  let y = H - 16;
  let d = `M0 ${y}`;
  steps.forEach((s, i) => {
    const x = i * w;
    const target = s.level ? H - 16 - s.level * (H - 40) : H - 16;
    if (target !== y) {
      d += ` L${x.toFixed(1)} ${y.toFixed(1)} L${x.toFixed(1)} ${target.toFixed(1)}`;
      y = target;
    }
    d += ` L${(x + w).toFixed(1)} ${y.toFixed(1)}`;
  });
  return (
    <div class="scope">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`${track.name} pattern`}>
        {Array.from({ length: 11 }, (_, i) => (
          <line x1={i * (W / 10)} y1="0" x2={i * (W / 10)} y2={H} class={i === 5 ? 'grat major' : 'grat'} vector-effect="non-scaling-stroke" />
        ))}
        {Array.from({ length: 9 }, (_, i) => (
          <line x1="0" y1={i * (H / 8)} x2={W} y2={i * (H / 8)} class={i === 4 ? 'grat major' : 'grat'} vector-effect="non-scaling-stroke" />
        ))}
        <path d={d} class="trace-glow" vector-effect="non-scaling-stroke" />
        <path d={d} class="trace" vector-effect="non-scaling-stroke" />
        {now >= 0 && <line x1={(now + 0.5) * w} y1="0" x2={(now + 0.5) * w} y2={H} class="scope-head" vector-effect="non-scaling-stroke" />}
      </svg>
      <span class="scope-label">
        CH {track.name.toUpperCase()} · {steps.length} STEPS
      </span>
    </div>
  );
}
