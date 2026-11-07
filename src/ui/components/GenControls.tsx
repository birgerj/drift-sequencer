import { useRef } from 'preact/hooks';
import { euclid } from '../../core/generators/euclid';
import { arc, polar } from './PanelModules';

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const snap = (v: number, min: number, step: number) => min + Math.round((v - min) / step) * step;

/** Arrow keys, Page keys, Home and End for a role="slider" element. */
function sliderKeys(e: KeyboardEvent, value: number, min: number, max: number, step: number, set: (v: number) => void) {
  const big = Math.max(step, (max - min) / 10);
  const map: Record<string, number> = {
    ArrowUp: value + step,
    ArrowRight: value + step,
    ArrowDown: value - step,
    ArrowLeft: value - step,
    PageUp: value + big,
    PageDown: value - big,
    Home: min,
    End: max,
  };
  if (!(e.key in map)) return;
  e.preventDefault();
  e.stopPropagation();
  set(map[e.key]!);
}

/**
 * Knob for a generator setting: drag up or down (Shift for fine), scroll, or
 * use the arrow keys. Same look as the knobs on the Panel tab.
 */
export function GenKnob(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}) {
  const { min, max, step } = props;
  const drag = useRef<{ y: number; start: number } | undefined>(undefined);
  const set = (v: number) => {
    const next = clamp(snap(v, min, step), min, max);
    if (next !== props.value) props.onChange(Number(next.toFixed(4)));
  };
  const pos = (props.value - min) / (max - min || 1);
  const [px, py] = polar(13, -135 + pos * 270);
  const shown = props.format ? props.format(props.value) : String(props.value);
  return (
    <div class="mini-knob gen-knob" title={props.label}>
      <div
        class="mini-knob-dial"
        role="slider"
        tabIndex={0}
        aria-label={props.label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={props.value}
        aria-valuetext={shown}
        onPointerDown={(e) => {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          drag.current = { y: e.clientY, start: props.value };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          set(d.start + ((d.y - e.clientY) * (max - min)) / (e.shiftKey ? 600 : 150));
        }}
        onPointerUp={() => (drag.current = undefined)}
        onPointerCancel={() => (drag.current = undefined)}
        onWheel={(e) => {
          e.preventDefault();
          set(props.value + (e.deltaY < 0 ? 1 : -1) * Math.max(step, (max - min) / 100));
        }}
        onKeyDown={(e) => sliderKeys(e, props.value, min, max, Math.max(step, (max - min) / 100), set)}
      >
        <svg width="44" height="44" viewBox="0 0 48 48" aria-hidden="true">
          <path d={arc(20, 0, 1)} class="mk-track" />
          <path d={arc(20, 0, pos)} class="mk-value" />
          <circle cx="24" cy="24" r="14" class="mk-body" />
          <line x1="24" y1="24" x2={px.toFixed(2)} y2={py.toFixed(2)} class="mk-pointer" />
        </svg>
      </div>
      <span class="mk-value-text mono gen-knob-value">{shown}</span>
      <span class="mk-label gen-knob-label">{props.label}</span>
    </div>
  );
}

/** One button per whole number, for small ranges such as Max leap or Octaves. */
export function StepButtons(props: { label: string; value: number; min: number; max: number; format?: (v: number) => string; onChange: (v: number) => void }) {
  const values: number[] = [];
  for (let v = props.min; v <= props.max; v++) values.push(v);
  return (
    <div class="field">
      <div class="gen-field-head">
        <span class="field-label">{props.label}</span>
        {props.format && <output class="mono gen-readout">{props.format(props.value)}</output>}
      </div>
      <div class="segmented gen-steps" role="radiogroup" aria-label={props.label}>
        {values.map((v) => (
          <button type="button" role="radio" aria-checked={v === props.value} onClick={() => props.onChange(v)}>
            {v}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Melody range as a ladder of scale degrees. Tap a degree to set the range up
 * to it; chord tones (1, 3, 5) inside the range light up brightest.
 */
export function DegreeLadder(props: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  const cells: number[] = [];
  for (let d = 1; d <= props.max; d++) cells.push(d);
  return (
    <div class="field">
      <div class="gen-field-head">
        <span class="field-label">{props.label}</span>
        <output class="mono gen-readout">{props.value} degrees</output>
      </div>
      <div class="degree-ladder" role="radiogroup" aria-label={props.label}>
        {cells.map((d) => {
          const inside = d <= props.value;
          const chordTone = inside && [1, 3, 5].includes(((d - 1) % 7) + 1);
          return (
            <button
              type="button"
              role="radio"
              aria-checked={d === props.value}
              aria-label={`${d} degrees`}
              disabled={d < props.min}
              class={chordTone ? 'tone' : inside ? 'in' : ''}
              onClick={() => props.onChange(Math.max(props.min, d))}
            >
              {d}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Pulses per bar as tappable blocks: tap the fourth to get four pulses. */
export function PulseDots(props: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  const cells: number[] = [];
  for (let n = 1; n <= props.max; n++) cells.push(n);
  return (
    <div class="field">
      <div class="gen-field-head">
        <span class="field-label">{props.label}</span>
        <output class="mono gen-readout">{props.value}</output>
      </div>
      <div class="pulse-dots" role="radiogroup" aria-label={props.label}>
        {cells.map((n) => (
          <button
            type="button"
            role="radio"
            aria-checked={n === props.value}
            aria-label={`${n} per bar`}
            class={n <= props.value ? 'on' : ''}
            onClick={() => props.onChange(Math.max(props.min, n))}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Note length: a row of steps with the note drawn at the gate length, plus a slider. */
export function GateControl(props: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  const pct = Math.round(props.value * 100);
  const fill = ((props.value - props.min) / (props.max - props.min || 1)) * 100;
  return (
    <div class="field gate-control" style={{ '--gate': `${pct}%`, '--fill': `${fill}%` }}>
      <div class="gen-field-head">
        <span class="field-label">{props.label}</span>
        <output class="mono gen-readout">{pct}%</output>
      </div>
      <div class="gate-steps" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
      </div>
      <div class="slider compact">
        <input
          type="range"
          aria-label={props.label}
          min={props.min}
          max={props.max}
          step={props.step}
          value={props.value}
          onInput={(e) => props.onChange(Number((e.target as HTMLInputElement).value))}
        />
      </div>
    </div>
  );
}

/**
 * Velocity and its variation as one control: the dot is the velocity, the
 * band around it the variation. Drag the dot, or drag the band's edge.
 */
export function VelocityBar(props: {
  velocity: number;
  variation?: number;
  onVelocity: (v: number) => void;
  onVariation?: (v: number) => void;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const mode = useRef<'velocity' | 'variation' | undefined>(undefined);
  const hasVar = props.variation !== undefined && props.onVariation !== undefined;
  const variation = props.variation ?? 0;
  const base = (props.velocity / 127) * 100;
  const half = variation * 30;
  const lo = clamp(base - half, 0, 100);
  const hi = clamp(base + half, 0, 100);
  const at = (e: PointerEvent) => {
    const r = bar.current!.getBoundingClientRect();
    return clamp((e.clientX - r.left) / (r.width || 1), 0, 1);
  };
  const apply = (e: PointerEvent) => {
    const x = at(e) * 100;
    if (mode.current === 'variation' && props.onVariation) props.onVariation(Number(clamp(Math.abs(x - base) / 30, 0, 1).toFixed(2)));
    else props.onVelocity(Math.round(clamp((x / 100) * 127, 1, 127)));
  };
  const text = hasVar ? `${Math.round(props.velocity)} · ±${Math.round(variation * 100)}%` : String(Math.round(props.velocity));
  return (
    <div class="field velocity-bar">
      <div class="gen-field-head">
        <span class="field-label">{hasVar ? 'Velocity · variation' : 'Velocity'}</span>
        <output class="mono gen-readout">{text}</output>
      </div>
      <div
        class="vb-track"
        ref={bar}
        onPointerDown={(e) => {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          const x = at(e) * 100;
          // Grab the band edge when the press lands near it, else the dot.
          const nearEdge = hasVar && Math.abs(x - base) > 4 && (Math.abs(x - lo) < 5 || Math.abs(x - hi) < 5);
          mode.current = nearEdge ? 'variation' : 'velocity';
          apply(e);
        }}
        onPointerMove={(e) => mode.current && apply(e)}
        onPointerUp={() => (mode.current = undefined)}
        onPointerCancel={() => (mode.current = undefined)}
      >
        <div class="vb-rail" />
        <div class="vb-level" style={{ width: `${base}%` }} />
        {hasVar && <div class="vb-band" style={{ left: `${lo}%`, width: `${hi - lo}%` }} />}
        {hasVar && (
          <div
            class="vb-edge"
            role="slider"
            tabIndex={0}
            aria-label="Velocity variation"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(variation * 100)}
            aria-valuetext={`±${Math.round(variation * 100)}%`}
            style={{ left: `${hi}%` }}
            onKeyDown={(e) => sliderKeys(e, variation, 0, 1, 0.01, (v) => props.onVariation!(Number(clamp(v, 0, 1).toFixed(2))))}
          />
        )}
        <div
          class="vb-dot"
          role="slider"
          tabIndex={0}
          aria-label="Velocity"
          aria-valuemin={1}
          aria-valuemax={127}
          aria-valuenow={Math.round(props.velocity)}
          style={{ left: `${base}%` }}
          onKeyDown={(e) => sliderKeys(e, props.velocity, 1, 127, 1, (v) => props.onVelocity(Math.round(clamp(v, 1, 127))))}
        />
      </div>
      <div class="vb-scale mono" aria-hidden="true">
        <span>pp</span>
        <span>mf</span>
        <span>ff</span>
      </div>
    </div>
  );
}

/** A euclidean rhythm drawn as a ring of 16 steps, hits joined into a polygon. */
export function EuclidRing({ pulses, rotate, size = 44 }: { pulses: number; rotate: number; size?: number }) {
  const steps = euclid(pulses, 16, rotate);
  const pts = steps.map((_, i) => {
    const a = (i / 16) * Math.PI * 2 - Math.PI / 2;
    return [24 + 19 * Math.cos(a), 24 + 19 * Math.sin(a)] as const;
  });
  const hits = pts.filter((_, i) => steps[i]);
  const poly = hits.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('') + (hits.length > 2 ? 'Z' : '');
  return (
    <svg class="euclid-ring" width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      {hits.length > 1 && <path d={poly} class="er-poly" />}
      {pts.map(([x, y], i) => (
        <circle cx={x.toFixed(1)} cy={y.toFixed(1)} r="2.6" class={steps[i] ? 'er-hit' : 'er-off'} />
      ))}
    </svg>
  );
}

/** One bar of a euclidean voice; steps that only play by chance are dimmer. */
export function EuclidLane({ pulses, rotate, probability, muted }: { pulses: number; rotate: number; probability: number; muted?: boolean }) {
  const steps = euclid(pulses, 16, rotate);
  return (
    <div class={`euclid-lane ${muted ? 'muted' : ''}`} aria-hidden="true">
      {steps.map((hit, i) => (
        <span class={hit ? (probability >= 1 ? 'hit' : 'maybe') : i % 4 === 0 ? 'beat' : ''} />
      ))}
    </div>
  );
}

/** A compact value box with a level line; drag sideways, or use the arrow keys. */
export function BarField(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; start: number } | undefined>(undefined);
  const { min, max, step } = props;
  const set = (v: number) => {
    const next = clamp(snap(v, min, step), min, max);
    if (next !== props.value) props.onChange(Number(next.toFixed(4)));
  };
  const pct = ((props.value - min) / (max - min || 1)) * 100;
  const shown = props.format ? props.format(props.value) : String(props.value);
  return (
    <div
      ref={box}
      class="bar-field mono"
      role="slider"
      tabIndex={0}
      aria-label={props.label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={props.value}
      aria-valuetext={shown}
      onPointerDown={(e) => {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, start: props.value };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const w = box.current?.clientWidth || 80;
        set(d.start + ((e.clientX - d.x) / (w * 1.5)) * (max - min));
      }}
      onPointerUp={() => (drag.current = undefined)}
      onPointerCancel={() => (drag.current = undefined)}
      onKeyDown={(e) => sliderKeys(e, props.value, min, max, step, set)}
    >
      {shown}
      <i style={{ width: `${pct}%` }} />
    </div>
  );
}
