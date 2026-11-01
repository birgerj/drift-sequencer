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
  // Without a colour, inherit --accent (setting it to var(--accent) would be a cycle and hide the track).
  const style = (props.color ? { '--fill': `${pct}%`, '--accent': props.color } : { '--fill': `${pct}%` }) as Record<string, string>;
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
  // Track types
  motif: 'M9 18V5l9-2v13M9 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0zM18 16a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z',
  acid: 'M2 16c2.7 0 2.7-9 5.3-9s2.7 9 5.4 9 2.6-9 5.3-9S20.7 11.5 22 11.5',
  chords: 'M4 5h16M4 12h16M4 19h16M8 5v14M16 5v14',
  drone: 'M2 12h20M5 8v8M19 8v8M12 5v14',
  arp: 'M3 19l4-4 4 3 4-7 4 3 2-8',
  bass: 'M4 15c0-3 3-5 6-5h1V5l6 3v8a4 4 0 1 1-4-4h-3c-2 0-3 1-3 3z',
  drums: 'M3 9c0-2.2 4-4 9-4s9 1.8 9 4-4 4-9 4-9-1.8-9-4zM3 9v6c0 2.2 4 4 9 4s9-1.8 9-4V9',
  // Sections and views
  wave: 'M2 12c2.5-8 5-8 7.5 0s5 8 7.5 0 3.5-5 5-2.5',
  output: 'M4 12h12M12 7l5 5-5 5M20 4v16',
  list: 'M4 6h16M4 12h16M4 18h16',
  devices: 'M3 6h18v10H3zM7 16v3M17 16v3M7 10h1.5M11 10h1.5M15 10h2',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  speaker: 'M4 9h4l5-4v14l-5-4H4zM17 8.5a5 5 0 0 1 0 7',
  mute: 'M4 9h4l5-4v14l-5-4H4zM17 9l5 6M22 9l-5 6',
  keyboard: 'M3 6h18v12H3zM7 10h.01M11 10h.01M15 10h.01M7 14h10',
  knob: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM12 12l3.5-3.5M4 20l1.5-1.5M20 20l-1.5-1.5',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  // Drum instruments
  kick: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM5 20l-1.5 2M19 20l1.5 2',
  snare: 'M4 10c0-1.4 3.6-2.5 8-2.5s8 1.1 8 2.5-3.6 2.5-8 2.5S4 11.4 4 10zM4 10v6c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5v-6M8 12.3v6M12 12.5v6M16 12.3v6M9 2l4 5M17 2l-3 5',
  tom: 'M5 8c0-1.4 3.1-2.5 7-2.5s7 1.1 7 2.5-3.1 2.5-7 2.5S5 9.4 5 8zM5 8v8c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V8M12 18.5V22',
  rim: 'M4 13c0-1.4 3.6-2.5 8-2.5s8 1.1 8 2.5-3.6 2.5-8 2.5S4 14.4 4 13zM4 13v4c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5v-4M5 11L19 5',
  clap: 'M8 21l-3-6V9a1.5 1.5 0 0 1 3 0v4M8 13V6.5a1.5 1.5 0 0 1 3 0V13M11 12V5.5a1.5 1.5 0 0 1 3 0V13M14 12.5V8a1.5 1.5 0 0 1 3 0v6c0 3-2 5-4 7M19 3l1.5-1.5M20 6h2M4 4L2.5 2.5',
  hatClosed: 'M3 8.5h18M5 10h14M12 10v12M12 4v4.5M8 22h8',
  hatOpen: 'M3 6h18M5 11h14M12 11v11M12 3v3M8 22h8M10 8.5h4',
  crash: 'M2 11l20-4M12 9v13M8 22h8M17 2l1-2M20 4l2-1M14 3l-.5-2',
  ride: 'M2 9.5h20M12 7.5a2 2 0 0 0-2 2h4a2 2 0 0 0-2-2zM12 9.5V22M8 22h8',
};

/** Icon per drum voice, by TR-8S style name (falls back to the GM note). */
export function drumIcon(name: string, note: number): string {
  const n = name.toUpperCase();
  if (n.startsWith('BD') || note === 35 || note === 36) return 'kick';
  if (n.startsWith('SD') || note === 38 || note === 40) return 'snare';
  if (n.startsWith('RS') || note === 37) return 'rim';
  if (n.startsWith('CP') || n.startsWith('HC') || note === 39) return 'clap';
  if (n.startsWith('CH') || note === 42 || note === 44) return 'hatClosed';
  if (n.startsWith('OH') || note === 46) return 'hatOpen';
  if (n.startsWith('CC') || note === 49 || note === 57) return 'crash';
  if (n.startsWith('RC') || note === 51 || note === 59) return 'ride';
  if (/T$|TOM/.test(n) || [41, 43, 45, 47, 48, 50].includes(note)) return 'tom';
  return 'drums';
}

/** Icon name per generator type. */
export const TYPE_ICONS: Record<string, string> = {
  motif: 'motif',
  acid: 'acid',
  chords: 'chords',
  drone: 'drone',
  arp: 'arp',
  bass: 'bass',
  drums: 'drums',
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
