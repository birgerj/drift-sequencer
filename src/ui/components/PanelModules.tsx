import { useRef, useState } from 'preact/hooks';
import {
  choiceLabel,
  choiceValue,
  widgetParams,
  type InstrumentDefinition,
  type InstrumentParam,
  type PanelModule,
  type PanelWidget,
} from '../../core/instruments/instrument';
import type { TrackState } from '../../state/project';
import { useStore } from '../store';

/** Above this many controls a panel with several groups shows one group at a time. */
const TABS_ABOVE = 32;

/**
 * An instrument's panel: sections with a control per kind of parameter
 * (switches, faders, a filter pad, an envelope graph) instead of a page of
 * identical knobs. Kept compact so a whole synth fits on a screen; big
 * synths get a row of tabs, one per group.
 */
export function PanelModules({ track, instrument }: { track: TrackState; instrument: InstrumentDefinition }) {
  const byId = new Map(instrument.params.map((p) => [p.id, p]));
  const modules = instrument.panel ?? [];
  const groups = [...new Set(modules.map((m) => m.group).filter((g): g is string => !!g))];
  const controls = modules.reduce((n, m) => n + m.widgets.reduce((k, w) => k + widgetParams(w).length, 0), 0);
  const tabbed = groups.length > 1 && controls > TABS_ABOVE;
  const [picked, setPicked] = useState<string | undefined>(undefined);
  const group = tabbed ? (picked && groups.includes(picked) ? picked : groups[0]) : undefined;
  const shown = group ? modules.filter((m) => m.group === group) : modules;
  return (
    <>
      {tabbed && (
        <div class="panel-tabs segmented" role="tablist" aria-label="Panel sections">
          {groups.map((g) => (
            <button type="button" role="tab" aria-selected={g === group} aria-checked={g === group} onClick={() => setPicked(g)}>
              {g}
            </button>
          ))}
        </div>
      )}
      <div class="panel-modules">
        {shown.map((m, i) => (
          <Module key={`${group}-${i}`} module={m} track={track} byId={byId} />
        ))}
      </div>
    </>
  );
}

type Params = Map<string, InstrumentParam>;

function Module({ module, track, byId }: { module: PanelModule; track: TrackState; byId: Params }) {
  return (
    <section class={`panel-module ${module.wide ? 'wide' : ''}`}>
      <h3 class="eyebrow">{module.title}</h3>
      <div class="module-body">
        {module.widgets.map((w, i) => (
          <Widget key={i} widget={w} track={track} byId={byId} />
        ))}
      </div>
    </section>
  );
}

function Widget({ widget: w, track, byId }: { widget: PanelWidget; track: TrackState; byId: Params }) {
  const get = (id: string | undefined) => (id ? byId.get(id) : undefined);
  const list = (ids: string[]) => ids.map((id) => byId.get(id)).filter((p): p is InstrumentParam => !!p);
  switch (w.kind) {
    case 'knobs':
      return (
        <div class="mod-knobs">
          {list(w.params).map((p) => (
            <MiniKnob key={p.id} track={track} param={p} />
          ))}
        </div>
      );
    case 'switch': {
      const p = get(w.param);
      return p ? <ChoiceSwitch track={track} param={p} /> : null;
    }
    case 'faders':
      return (
        <div class="mod-faders">
          {list(w.params).map((p) => (
            <Fader key={p.id} track={track} param={p} vertical />
          ))}
        </div>
      );
    case 'sliders':
      return (
        <div class="mod-sliders">
          {list(w.params).map((p) => (
            <Fader key={p.id} track={track} param={p} />
          ))}
        </div>
      );
    case 'xy': {
      const x = get(w.x);
      const y = get(w.y);
      return x && y ? <FilterPad track={track} x={x} y={y} /> : null;
    }
    case 'adsr':
      return (
        <Envelope
          track={track}
          attack={get(w.attack)}
          decay={get(w.decay)}
          sustain={get(w.sustain)}
          release={get(w.release)}
          sustainLevel={w.sustainLevel ?? 1}
        />
      );
    case 'strips': {
      // Strips that repeat the same knobs get one legend column instead of labels on each knob.
      const names = (ids: string[]) => list(ids).map((p) => (p.short ?? p.name).toLowerCase().replace(/\s+/g, ''));
      const first = names(w.strips[0]?.params ?? []);
      const shared = w.strips.length > 1 && w.strips.every((st) => names(st.params).join('|') === first.join('|'));
      return (
        <div class="mod-strips">
          {shared && (
            <div class="strip strip-legend" aria-hidden="true">
              <span class="strip-title">&nbsp;</span>
              {list(w.strips[0]!.params).map((p) => (
                <span class="legend-cell">{p.short ?? p.name}</span>
              ))}
            </div>
          )}
          {w.strips.map((st) => {
            const level = get(st.level);
            return (
              <div class="strip" key={st.title} role="group" aria-label={st.title}>
                <span class="strip-title">{st.title}</span>
                {list(st.params).map((p) => (
                  <MiniKnob key={p.id} track={track} param={p} hideLabel={shared} />
                ))}
                {level && <Fader track={track} param={level} vertical bare />}
              </div>
            );
          })}
        </div>
      );
    }
    case 'lfo': {
      const rate = get(w.rate);
      return rate ? <LfoWave track={track} rate={rate} delay={get(w.delay)} /> : null;
    }
  }
}

// ---------------------------------------------------------------- shared

interface ParamState {
  cc: number;
  min: number;
  max: number;
  value: number;
  /** 0–1 position of the value in its range. */
  pos: number;
  stored: boolean;
  shown: string | number;
  /** Modulated range as 0–1 positions, when an LFO or motion drives this CC. */
  lfo?: [number, number];
  motion?: [number, number];
  set: (n: number) => void;
  setPos: (pos: number) => void;
  reset: () => void;
}

function useParam(track: TrackState, param: InstrumentParam | undefined): ParamState | undefined {
  const s = useStore();
  if (!param || param.msg.type !== 'cc') return undefined;
  const cc = param.msg.cc;
  const min = param.min ?? 0;
  const max = param.max ?? 127;
  const range = Math.max(1, max - min);
  const stored = track.panel?.values[cc];
  const value = stored ?? param.default ?? min;
  const lfo = track.modulations.find((m) => m.enabled && m.cc === cc);
  const motion = track.motions?.find((m) => m.enabled && m.cc === cc);
  const set = (n: number) => s.setPanelValue(track.id, cc, Math.max(min, Math.min(max, n)));
  const centre = Math.round((min + max + 1) / 2);
  return {
    cc,
    min,
    max,
    value,
    pos: (value - min) / range,
    stored: stored !== undefined,
    shown: choiceLabel(param, value) ?? (param.bipolar ? value - centre : value),
    lfo: lfo ? [lfo.min / 127, lfo.max / 127] : undefined,
    motion: motion ? [Math.min(...motion.values) / 127, Math.max(...motion.values) / 127] : undefined,
    set,
    setPos: (p: number) => set(min + Math.max(0, Math.min(1, p)) * range),
    reset: () => set(param.default ?? (param.bipolar ? centre : min)),
  };
}

/** Arrow / Page / Home / End keys for one value. Returns true when handled. */
function stepKeys(e: KeyboardEvent, p: ParamState, axis: 'x' | 'y' | 'both' = 'both'): boolean {
  const step = e.key.startsWith('Page') ? 10 : 1;
  const up = axis !== 'x' ? ['ArrowUp', 'PageUp'] : [];
  const down = axis !== 'x' ? ['ArrowDown', 'PageDown'] : [];
  if (axis !== 'y') up.push('ArrowRight');
  if (axis !== 'y') down.push('ArrowLeft');
  if (up.includes(e.key)) p.set(p.value + step);
  else if (down.includes(e.key)) p.set(p.value - step);
  else if (e.key === 'Home') p.set(p.min);
  else if (e.key === 'End') p.set(p.max);
  else return false;
  e.preventDefault();
  e.stopPropagation();
  return true;
}

/** Double-tap (or double-click) detection that ignores drags. */
function useDoubleTap(onDouble: () => void) {
  const last = useRef(0);
  return () => {
    const now = performance.now();
    if (now - last.current < 320) onDouble();
    last.current = now;
  };
}

// ---------------------------------------------------------------- knob

const ARC_START = -135;
const ARC_SWEEP = 270;

function polar(r: number, deg: number): [number, number] {
  const a = ((deg - 90) * Math.PI) / 180;
  return [24 + Math.cos(a) * r, 24 + Math.sin(a) * r];
}

function arc(r: number, from: number, to: number): string {
  if (to - from < 0.001) return '';
  const a = ARC_START + from * ARC_SWEEP;
  const b = ARC_START + to * ARC_SWEEP;
  const [x1, y1] = polar(r, a);
  const [x2, y2] = polar(r, b);
  return `M${x1.toFixed(2)} ${y1.toFixed(2)}A${r} ${r} 0 ${b - a > 180 ? 1 : 0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

/** Small knob with an arc: drag up/down, Shift for fine, double-tap resets. */
function MiniKnob({ track, param, hideLabel }: { track: TrackState; param: InstrumentParam; hideLabel?: boolean }) {
  const p = useParam(track, param)!;
  const drag = useRef<{ y: number; start: number; moved: boolean } | undefined>(undefined);
  const tap = useDoubleTap(p.reset);
  const range = p.max - p.min;
  const [from, to] = param.bipolar ? [Math.min(0.5, p.pos), Math.max(0.5, p.pos)] : [0, p.pos];
  const [px, py] = polar(13, ARC_START + p.pos * ARC_SWEEP);
  return (
    <div class={`mini-knob ${hideLabel ? 'no-label' : ''}`} title={param.usage ?? param.name}>
      <div
        class="mini-knob-dial"
        role="slider"
        tabIndex={0}
        aria-label={param.name}
        aria-valuemin={p.min}
        aria-valuemax={p.max}
        aria-valuenow={p.value}
        aria-valuetext={String(p.shown)}
        onPointerDown={(e) => {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          drag.current = { y: e.clientY, start: p.value, moved: false };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const dy = d.y - e.clientY;
          if (Math.abs(dy) > 2) d.moved = true;
          p.set(d.start + (dy * range) / (e.shiftKey ? 500 : 120));
        }}
        onPointerUp={() => {
          const d = drag.current;
          drag.current = undefined;
          if (!d?.moved) tap();
        }}
        onWheel={(e) => {
          e.preventDefault();
          p.set(p.value + (e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? 10 : 1));
        }}
        onKeyDown={(e) => stepKeys(e, p)}
      >
        <svg width="44" height="44" viewBox="0 0 48 48" aria-hidden="true">
          <path d={arc(20, 0, 1)} class="mk-track" />
          {p.motion && <path d={arc(20, p.motion[0], p.motion[1])} class="mk-motion" />}
          {p.lfo && <path d={arc(20, p.lfo[0], p.lfo[1])} class="mk-lfo" />}
          <path d={arc(20, from, to)} class="mk-value" />
          <circle cx="24" cy="24" r="14" class="mk-body" />
          <line x1="24" y1="24" x2={px.toFixed(2)} y2={py.toFixed(2)} class="mk-pointer" />
        </svg>
      </div>
      {!hideLabel && <span class="mk-label">{param.short ?? param.name}</span>}
      <span class={`mk-value-text mono ${p.stored ? '' : 'unset'}`}>{p.shown}</span>
    </div>
  );
}

// ---------------------------------------------------------------- switch

/** Segmented buttons for a param with named value bands. */
function ChoiceSwitch({ track, param }: { track: TrackState; param: InstrumentParam }) {
  const p = useParam(track, param)!;
  const choices = param.choices ?? [];
  const current = choices.findIndex((c) => p.value <= c.upTo);
  return (
    <div class="mod-switch">
      <span class="mod-label">{param.short ?? param.name}</span>
      <div class="segmented" role="radiogroup" aria-label={param.name}>
        {choices.map((c, i) => (
          <button type="button" role="radio" title={c.label} aria-checked={i === current} onClick={() => p.set(choiceValue(param, i))}>
            {c.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- fader

/** A fader: vertical for mixer channels, horizontal for levels and sends. Tap or drag to set. */
function Fader({ track, param, vertical, bare }: { track: TrackState; param: InstrumentParam; vertical?: boolean; bare?: boolean }) {
  const p = useParam(track, param)!;
  const tap = useDoubleTap(p.reset);
  const dragging = useRef(false);
  const posAt = (e: PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return vertical ? 1 - (e.clientY - r.top) / r.height : (e.clientX - r.left) / r.width;
  };
  const band = p.lfo ?? p.motion;
  const pct = `${(p.pos * 100).toFixed(1)}%`;
  return (
    <div class={`fader ${vertical ? 'vertical' : 'horizontal'}`} title={param.usage ?? param.name}>
      {!vertical && (
        <span class="fader-head">
          <span class="mod-label">{param.short ?? param.name}</span>
          <span class={`mono ${p.stored ? '' : 'unset'}`}>{p.shown}</span>
        </span>
      )}
      <div
        class="fader-track"
        role="slider"
        tabIndex={0}
        aria-label={param.name}
        aria-orientation={vertical ? 'vertical' : 'horizontal'}
        aria-valuemin={p.min}
        aria-valuemax={p.max}
        aria-valuenow={p.value}
        onPointerDown={(e) => {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          dragging.current = true;
          tap();
          p.setPos(posAt(e));
        }}
        onPointerMove={(e) => dragging.current && p.setPos(posAt(e))}
        onPointerUp={() => (dragging.current = false)}
        onWheel={(e) => {
          e.preventDefault();
          p.set(p.value + (e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? 10 : 1));
        }}
        onKeyDown={(e) => stepKeys(e, p)}
      >
        <span class="fader-rail" />
        {band && (
          <span
            class={`fader-band ${p.lfo ? 'lfo' : 'motion'}`}
            style={
              vertical
                ? { bottom: `${band[0] * 100}%`, height: `${(band[1] - band[0]) * 100}%` }
                : { left: `${band[0] * 100}%`, width: `${(band[1] - band[0]) * 100}%` }
            }
          />
        )}
        <span class="fader-fill" style={vertical ? { height: pct } : { width: pct }} />
        <span class="fader-thumb" style={vertical ? { bottom: pct } : { left: pct }} />
      </div>
      {vertical && (
        <>
          <span class={`mono fader-value ${p.stored ? '' : 'unset'}`}>{p.shown}</span>
          {!bare && <span class="mod-label fader-label">{param.short ?? param.name}</span>}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- filter pad

/** Cutoff left/right, resonance up/down, drawn as a low-pass response. */
function FilterPad({ track, x, y }: { track: TrackState; x: InstrumentParam; y: InstrumentParam }) {
  const px = useParam(track, x)!;
  const py = useParam(track, y)!;
  const tap = useDoubleTap(() => {
    px.reset();
    py.reset();
  });
  const dragging = useRef(false);
  const setAt = (e: PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    px.setPos((e.clientX - r.left) / r.width);
    py.setPos(1 - (e.clientY - r.top) / r.height);
  };
  // Response curve in a 200×100 box: flat pass band, resonant bump, roll-off.
  const cx = 8 + px.pos * 172;
  const peak = 52 - py.pos * 46;
  const curve = `M0 52 L${(cx - 22).toFixed(1)} 52 C${(cx - 9).toFixed(1)} 52 ${(cx - 6).toFixed(1)} ${peak.toFixed(1)} ${cx.toFixed(1)} ${peak.toFixed(1)} C${(cx + 7).toFixed(1)} ${peak.toFixed(1)} ${(cx + 10).toFixed(1)} 62 ${(cx + 40).toFixed(1)} 100`;
  return (
    <div class="filter-pad-wrap">
      <div
        class="filter-pad"
        role="group"
        aria-label={`${x.name} and ${y.name}`}
        onPointerDown={(e) => {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          dragging.current = true;
          tap();
          setAt(e);
        }}
        onPointerMove={(e) => dragging.current && setAt(e)}
        onPointerUp={() => (dragging.current = false)}
      >
        <svg viewBox="0 0 200 100" preserveAspectRatio="none" aria-hidden="true">
          <path d="M50 0V100M100 0V100M150 0V100M0 50H200" class="pad-grid" />
          {px.lfo && <rect x={px.lfo[0] * 200} y="0" width={(px.lfo[1] - px.lfo[0]) * 200} height="100" class="pad-lfo" />}
          {px.motion && !px.lfo && (
            <rect x={px.motion[0] * 200} y="0" width={(px.motion[1] - px.motion[0]) * 200} height="100" class="pad-motion" />
          )}
          <path d={`${curve} L0 100 Z`} class="pad-area" />
          <path d={curve} class="pad-curve" />
        </svg>
        <span
          class="pad-dot"
          role="slider"
          tabIndex={0}
          aria-label={`${x.name} (left/right), ${y.name} (up/down)`}
          aria-valuemin={px.min}
          aria-valuemax={px.max}
          aria-valuenow={px.value}
          aria-valuetext={`${x.name} ${px.shown}, ${y.name} ${py.shown}`}
          style={{ left: `${(cx / 200) * 100}%`, top: `${peak}%` }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') stepKeys(e, py, 'y');
            else stepKeys(e, px, 'x');
          }}
        />
        <span class="pad-readout mono pad-x">
          {x.short ?? x.name} {px.shown}
        </span>
        <span class="pad-readout mono pad-y">
          {y.short ?? y.name} {py.shown}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- envelope

const SEG = 55; // max width of the attack, decay and release segments (of 200)
const HOLD = 35;
const TOP = 6;
const BOTTOM = 76;

/** ADSR graph: drag the points. Attack/decay/release move sideways, sustain up/down. */
function Envelope(props: {
  track: TrackState;
  attack?: InstrumentParam;
  decay?: InstrumentParam;
  sustain?: InstrumentParam;
  release?: InstrumentParam;
  sustainLevel: number;
}) {
  const a = useParam(props.track, props.attack);
  const d = useParam(props.track, props.decay);
  const s = useParam(props.track, props.sustain);
  const r = useParam(props.track, props.release);
  const box = useRef<HTMLDivElement>(null);
  const active = useRef<string | undefined>(undefined);

  const sus = s ? s.pos : props.sustainLevel;
  const sy = BOTTOM - sus * (BOTTOM - TOP);
  const x1 = (a?.pos ?? 0) * SEG;
  const x2 = x1 + (d?.pos ?? 0) * SEG;
  const x3 = x2 + HOLD;
  const x4 = x3 + (r?.pos ?? 0) * SEG;
  const line = `M0 ${BOTTOM} L${x1.toFixed(1)} ${TOP} L${x2.toFixed(1)} ${sy.toFixed(1)} L${x3.toFixed(1)} ${sy.toFixed(1)} L${x4.toFixed(1)} ${BOTTOM}`;

  const toBox = (e: PointerEvent): [number, number] => {
    const rect = box.current!.getBoundingClientRect();
    return [((e.clientX - rect.left) / rect.width) * 200, ((e.clientY - rect.top) / rect.height) * 82];
  };
  const move = (e: PointerEvent) => {
    const [bx, by] = toBox(e);
    if (active.current === 'a') a?.setPos(bx / SEG);
    else if (active.current === 'd') {
      d?.setPos((bx - x1) / SEG);
      s?.setPos((BOTTOM - by) / (BOTTOM - TOP));
    } else if (active.current === 'r') r?.setPos((bx - x3) / SEG);
  };

  const handles = [
    a && { id: 'a', p: a, name: props.attack!.name, x: x1, y: TOP },
    (d || s) && { id: 'd', p: (d ?? s)!, name: [props.decay?.name, props.sustain?.name].filter(Boolean).join(' / '), x: x2, y: sy },
    r && { id: 'r', p: r, name: props.release!.name, x: x4, y: BOTTOM },
  ].filter(Boolean) as { id: string; p: ParamState; name: string; x: number; y: number }[];

  const values = [
    a && ['A', a],
    d && ['D', d],
    s && ['S', s],
    r && ['R', r],
  ].filter(Boolean) as [string, ParamState][];

  return (
    <div class="env-wrap">
      <div class="env-graph" ref={box} onPointerMove={(e) => active.current && move(e)} onPointerUp={() => (active.current = undefined)}>
        <svg viewBox="0 0 200 82" preserveAspectRatio="none" aria-hidden="true">
          <path d={`${line} Z`} class="pad-area" />
          <path d={line} class="pad-curve" />
        </svg>
        {handles.map((h) => (
          <span
            key={h.id}
            class="env-handle"
            role="slider"
            tabIndex={0}
            aria-label={h.name}
            aria-valuemin={h.p.min}
            aria-valuemax={h.p.max}
            aria-valuenow={h.p.value}
            style={{ left: `${(h.x / 200) * 100}%`, top: `${(h.y / 82) * 100}%` }}
            onPointerDown={(e) => {
              box.current!.setPointerCapture(e.pointerId);
              active.current = h.id;
              e.stopPropagation();
            }}
            onDblClick={() => {
              if (h.id === 'd') {
                d?.reset();
                s?.reset();
              } else h.p.reset();
            }}
            onKeyDown={(e) => {
              if (h.id === 'd' && s && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) stepKeys(e, s, 'y');
              else stepKeys(e, h.id === 'd' ? (d ?? s)! : h.p, h.id === 'd' && d ? 'x' : 'both');
            }}
          />
        ))}
      </div>
      <div class="env-values mono">
        {values.map(([k, p]) => (
          <span class={p.stored ? '' : 'unset'}>
            <b>{k}</b> {p.shown}
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- lfo

/** Shows the LFO's speed and fade-in; set them with the knobs beside it. */
function LfoWave({ track, rate, delay }: { track: TrackState; rate: InstrumentParam; delay?: InstrumentParam }) {
  const r = useParam(track, rate)!;
  const dl = useParam(track, delay);
  const cycles = 1 + r.pos * 7;
  const fade = (dl?.pos ?? 0) * 0.6;
  const pts: string[] = [];
  for (let i = 0; i <= 120; i++) {
    const t = i / 120;
    const amp = fade > 0 ? Math.min(1, t / fade) : 1;
    pts.push(`${(t * 200).toFixed(1)} ${(18 - Math.sin(t * cycles * 2 * Math.PI) * 14 * amp).toFixed(1)}`);
  }
  return (
    <div class="lfo-wave" aria-hidden="true">
      <svg viewBox="0 0 200 36" preserveAspectRatio="none">
        <path d="M0 18H200" class="pad-grid" />
        <path d={`M${pts.join('L')}`} class="lfo-curve" />
      </svg>
    </div>
  );
}
