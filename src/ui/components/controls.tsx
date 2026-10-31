import type { ComponentChildren } from 'preact';
import { useId } from 'preact/hooks';

/** Large, touch-friendly slider with label and value readout. */
export function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format?: (v: number) => string;
  color?: string;
  compact?: boolean;
  onInput: (v: number) => void;
}) {
  const id = useId();
  const pct = ((props.value - props.min) / (props.max - props.min || 1)) * 100;
  const style = { '--fill': `${pct}%`, '--accent': props.color ?? 'var(--accent)' } as Record<string, string>;
  return (
    <div class={`slider ${props.compact ? 'compact' : ''}`} style={style}>
      <label for={id}>
        <span>{props.label}</span>
        <output>{props.format ? props.format(props.value) : props.value}</output>
      </label>
      <input
        id={id}
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onInput={(e) => props.onInput(Number((e.target as HTMLInputElement).value))}
      />
    </div>
  );
}

export function Toggle(props: { label: string; description?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div class="toggle-row">
      <div>
        <div class="toggle-label">{props.label}</div>
        {props.description && <div class="hint">{props.description}</div>}
      </div>
      <button
        type="button"
        role="switch"
        class="switch"
        aria-checked={props.checked}
        aria-label={props.label}
        onClick={() => props.onChange(!props.checked)}
      >
        <span />
      </button>
    </div>
  );
}

export function Segmented<T extends string | number>(props: {
  label?: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div class="field">
      {props.label && <span class="field-label">{props.label}</span>}
      <div class="segmented" role="radiogroup" aria-label={props.label}>
        {props.options.map((o) => (
          <button
            type="button"
            role="radio"
            aria-checked={o.value === props.value}
            onClick={() => props.onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Number with big − / + buttons; tap the value to type. */
export function Stepper(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}) {
  const step = props.step ?? 1;
  const clamp = (v: number) => Math.max(props.min, Math.min(props.max, v));
  return (
    <div class="stepper" role="group" aria-label={props.label}>
      <button type="button" aria-label={`Decrease ${props.label}`} onClick={() => props.onChange(clamp(props.value - step))}>
        <Icon name="minus" />
      </button>
      <input
        type="number"
        inputMode="decimal"
        aria-label={props.label}
        value={props.value}
        min={props.min}
        max={props.max}
        onChange={(e) => {
          const v = Number((e.target as HTMLInputElement).value);
          if (Number.isFinite(v)) props.onChange(clamp(v));
        }}
      />
      <button type="button" aria-label={`Increase ${props.label}`} onClick={() => props.onChange(clamp(props.value + step))}>
        <Icon name="plus" />
      </button>
    </div>
  );
}

export function Select<T extends string | number>(props: {
  label: string;
  value: T;
  options: { value: T; label: string; warn?: boolean }[];
  onChange: (v: T) => void;
  hideLabel?: boolean;
}) {
  const id = useId();
  const numeric = typeof props.value === 'number';
  return (
    <div class="field">
      <label for={id} class={props.hideLabel ? 'sr-only' : 'field-label'}>
        {props.label}
      </label>
      <select
        id={id}
        value={String(props.value)}
        onChange={(e) => {
          const raw = (e.target as HTMLSelectElement).value;
          props.onChange((numeric ? Number(raw) : raw) as T);
        }}
      >
        {props.options.map((o) => (
          <option value={String(o.value)}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

export function Card(props: { title?: string; actions?: ComponentChildren; children: ComponentChildren; class?: string }) {
  return (
    <section class={`card ${props.class ?? ''}`}>
      {(props.title || props.actions) && (
        <div class="card-head">
          {props.title && <h2 class="eyebrow">{props.title}</h2>}
          {props.actions && <div class="card-actions">{props.actions}</div>}
        </div>
      )}
      {props.children}
    </section>
  );
}

const PATHS: Record<string, string> = {
  play: 'M7 4.5v15l12-7.5z',
  stop: 'M6 6h12v12H6z',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  back: 'M15 5l-7 7 7 7',
  trash: 'M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12',
  refresh: 'M19 12a7 7 0 1 1-2.05-4.95M19 5v4h-4',
  dice: 'M3 7h3.5l9 10H21M3 17h3.5l2.5-2.8M13 9.8L15.5 7H21M18 4l3 3-3 3M18 14l3 3-3 3',
  snow: 'M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9',
  upload: 'M12 16V4M7 9l5-5 5 5M5 20h14',
  download: 'M12 4v12M7 11l5 5 5-5M5 20h14',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  sliders: 'M4 7h10M18 7h2M4 17h4M12 17h8M14 4v6M8 14v6',
  music: 'M9 18V6l10-2v12M9 18a3 3 0 1 1-3-3 3 3 0 0 1 3 3zM19 16a3 3 0 1 1-3-3 3 3 0 0 1 3 3z',
  check: 'M5 12l5 5 9-10',
  close: 'M6 6l12 12M18 6L6 18',
};

export function Icon(props: { name: keyof typeof PATHS | string; size?: number }) {
  const filled = props.name === 'play' || props.name === 'stop';
  return (
    <svg
      width={props.size ?? 20}
      height={props.size ?? 20}
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d={PATHS[props.name] ?? ''} />
    </svg>
  );
}
