import { useRef, useState } from 'preact/hooks';
import type { InstrumentDefinition, InstrumentParam } from '../../core/instruments/instrument';
import type { TrackState } from '../../state/project';
import { store, useLive, useStore } from '../store';
import { Card } from './controls';

const KNOBS_PER_PAGE = 8;
const LEDS = 15;

export interface PanelPage {
  id: string;
  name: string;
  params: InstrumentParam[];
}

/** Plain 7-bit CC parameters, grouped by section and split into pages of 8. */
export function panelPages(instrument: InstrumentDefinition | undefined): PanelPage[] {
  const params = (instrument?.params ?? []).filter((p) => p.msg.type === 'cc' && p.msg.lsb === undefined);
  const bySection = new Map<string, InstrumentParam[]>();
  for (const p of params) {
    const section = !p.section || /^all/i.test(p.section) ? 'Main' : p.section;
    bySection.set(section, [...(bySection.get(section) ?? []), p]);
  }
  // Within a section, the sound-shaping knobs come first.
  const KEY = [/cutoff/i, /res/i, /env/i, /decay/i, /attack/i, /sustain/i, /release/i, /accent/i, /drive/i];
  const weight = (p: InstrumentParam) => {
    const i = KEY.findIndex((r) => r.test(p.name));
    return i < 0 ? KEY.length : i;
  };
  for (const [k, list] of bySection) bySection.set(k, list.map((p, i) => ({ p, i })).sort((a, b) => weight(a.p) - weight(b.p) || a.i - b.i).map((x) => x.p));
  // Most-used sections first; the rest keep the definition's order.
  const PRIORITY = ['main', 'filter', 'envelope', 'env', 'lfo', 'osc', 'oscillator', 'mixer', 'amp', 'effects', 'fx', 'arp', 'macro'];
  const rank = (name: string) => {
    const i = PRIORITY.findIndex((p) => name.toLowerCase().startsWith(p));
    return i < 0 ? PRIORITY.length : i;
  };
  const groups = [...bySection.entries()].sort((a, b) => rank(a[0]) - rank(b[0]));
  const pages: PanelPage[] = [];
  let small: { names: string[]; params: InstrumentParam[] } | undefined;
  const flushSmall = () => {
    if (small) pages.push({ id: `mix-${pages.length}`, name: small.names.join(' · '), params: small.params });
    small = undefined;
  };
  for (const [section, list] of groups) {
    // Sections with only a few knobs share a page.
    if (list.length < 4) {
      if (small && small.params.length + list.length > KNOBS_PER_PAGE) flushSmall();
      small = small ?? { names: [], params: [] };
      small.names.push(section);
      small.params.push(...list);
      continue;
    }
    const count = Math.ceil(list.length / KNOBS_PER_PAGE);
    for (let i = 0; i < count; i++) {
      pages.push({
        id: `${section}-${i}`,
        name: count > 1 ? `${section} ${i + 1}` : section,
        params: list.slice(i * KNOBS_PER_PAGE, (i + 1) * KNOBS_PER_PAGE),
      });
    }
  }
  flushSmall();
  return pages;
}

function ccOf(p: InstrumentParam): number {
  return p.msg.type === 'cc' ? p.msg.cc : -1;
}

/** Hydrasynth-style panel: pages on the left, encoders with their own display. */
export function KnobPanel({ track, instrument }: { track: TrackState; instrument: InstrumentDefinition | undefined }) {
  const s = useStore();
  const pages = panelPages(instrument);
  const [pageId, setPageId] = useState<string | undefined>(undefined);
  const page = pages.find((p) => p.id === pageId) ?? pages[0];

  if (!instrument || !page) {
    return (
      <Card title="Panel">
        <div class="empty">
          <p>
            {instrument
              ? `${instrument.device} has no CC parameters to show.`
              : 'Choose which synth this device is (Devices → instrument) to get its knobs here.'}
          </p>
          <button type="button" class="primary" onClick={() => s.go({ name: 'instruments' })}>
            Open devices
          </button>
        </div>
      </Card>
    );
  }

  const snapshots = track.panel?.snapshots ?? {};
  return (
    <div class="knob-panel" style={{ '--accent': track.color }}>
      <nav class="panel-pages" aria-label="Panel pages">
        <span class="eyebrow">Pages</span>
        {pages.map((p) => (
          <button type="button" aria-current={p.id === page.id} onClick={() => setPageId(p.id)}>
            <span class="page-led" />
            {p.name}
          </button>
        ))}
      </nav>

      <div class="panel-main">
        <div class="encoders">
          {page.params.map((p) => (
            <Encoder key={p.id} track={track} param={p} />
          ))}
        </div>

        <MotionRecorder track={track} />

        <div class="panel-bar">
          <span class="eyebrow">Snapshots</span>
          {['A', 'B', 'C', 'D'].map((slot) => (
            <button
              type="button"
              class={`snap ${snapshots[slot] ? 'filled' : ''}`}
              title={snapshots[slot] ? 'Tap to recall · Shift+tap to overwrite' : 'Tap to store the current knobs'}
              onClick={(e) =>
                snapshots[slot] && !e.shiftKey ? s.recallPanelSnapshot(track.id, slot) : s.storePanelSnapshot(track.id, slot)
              }
            >
              {slot}
            </button>
          ))}
          <div class="spacer" />
          <span class="hint">Drag up/down · Shift for fine · double-tap resets</span>
          <button type="button" onClick={() => s.sendPanel(track.id)}>
            Send all values
          </button>
        </div>
      </div>
    </div>
  );
}

function Encoder({ track, param }: { track: TrackState; param: InstrumentParam }) {
  const s = useStore();
  const cc = ccOf(param);
  const min = param.min ?? 0;
  const max = param.max ?? 127;
  const stored = track.panel?.values[cc];
  const value = stored ?? param.default ?? min;
  const range = Math.max(1, max - min);
  const v = (value - min) / range;
  const lfo = track.modulations.find((m) => m.enabled && m.cc === cc);
  const motion = track.motions?.find((m) => m.enabled && m.cc === cc);
  const motionRange = motion ? [Math.min(...motion.values) / 127, Math.max(...motion.values) / 127] : undefined;
  const lfoIndex = lfo ? track.modulations.indexOf(lfo) + 1 : 0;
  const drag = useRef<{ y: number; start: number; moved: boolean } | undefined>(undefined);
  const lastTap = useRef(0);

  const set = (n: number) => s.setPanelValue(track.id, cc, Math.max(min, Math.min(max, n)));
  const shown = param.bipolar ? value - Math.round((min + max + 1) / 2) : value;

  const leds = Array.from({ length: LEDS }, (_, i) => {
    const angle = -135 + (i * 270) / (LEDS - 1);
    const pos = i / (LEDS - 1);
    const lit = param.bipolar ? (v >= 0.5 ? pos >= 0.5 && pos <= v : pos <= 0.5 && pos >= v) : pos <= v && v > 0;
    const inLfo = lfo && pos >= lfo.min / 127 && pos <= lfo.max / 127;
    const inMotion = motionRange && pos >= motionRange[0]! && pos <= motionRange[1]!;
    return (
      <rect
        x="61"
        y="6"
        width="6"
        height="11"
        rx="2"
        class={lit ? 'led on' : inLfo ? 'led lfo' : inMotion ? 'led motion' : 'led'}
        transform={`rotate(${angle.toFixed(1)} 64 62)`}
      />
    );
  });
  const a = ((-135 + v * 270 - 90) * Math.PI) / 180;

  return (
    <div class="encoder">
      <div class="oled" title={param.name}>
        <span class="oled-label">{param.name}</span>
        <span class="oled-line" />
        <span class="oled-value">{stored === undefined ? '—' : shown}</span>
      </div>
      <div
        class="knob"
        role="slider"
        tabIndex={0}
        aria-label={param.name}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        onPointerDown={(e) => {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          drag.current = { y: e.clientY, start: value, moved: false };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const dy = d.y - e.clientY;
          if (Math.abs(dy) > 2) d.moved = true;
          set(d.start + (dy * range) / (e.shiftKey ? 600 : 160));
        }}
        onPointerUp={() => {
          const d = drag.current;
          drag.current = undefined;
          if (d?.moved) return;
          const now = performance.now();
          if (now - lastTap.current < 320) set(param.default ?? (param.bipolar ? Math.round((min + max + 1) / 2) : min));
          lastTap.current = now;
        }}
        onWheel={(e) => {
          e.preventDefault();
          set(value + (e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? 10 : 1));
        }}
        onKeyDown={(e) => {
          const step = e.key.startsWith('Page') ? 10 : 1;
          if (e.key === 'ArrowUp' || e.key === 'ArrowRight' || e.key === 'PageUp') set(value + step);
          else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'PageDown') set(value - step);
          else if (e.key === 'Home') set(min);
          else if (e.key === 'End') set(max);
          else return;
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        <svg width="128" height="120" viewBox="0 0 128 120" aria-hidden="true">
          {leds}
          <circle cx="64" cy="62" r="33" class="knob-body" />
          <circle cx="64" cy="62" r="26" class="knob-cap" />
          <line x1="64" y1="62" x2={(64 + Math.cos(a) * 21).toFixed(1)} y2={(62 + Math.sin(a) * 21).toFixed(1)} class="knob-pointer" />
        </svg>
      </div>
      <span class={`encoder-meta mono ${lfo ? 'lfo' : motion ? 'motion' : ''}`}>
        CC {cc}
        {lfo ? ` · LFO ${lfoIndex}` : motion ? ' · Motion' : ''}
      </span>
    </div>
  );
}

const REC_BARS = [1, 2, 4, 8];

/** Input status and recording knob movements into a looping motion. */
function MotionRecorder({ track }: { track: TrackState }) {
  const s = useStore();
  const [bars, setBars] = useState(4);
  const input = s.trackInput(track);
  const rec = s.recording?.trackId === track.id ? s.recording : undefined;
  const progress = useLive((l) => {
    const r = store.recording;
    if (!r || r.trackId !== track.id || r.startStep === undefined) return -1;
    return Math.min(1, (l.step - r.startStep + 1) / (r.bars * store.project.stepsPerBar));
  });
  const receiving = useLive(() => performance.now() - (store.lastInput.get(track.id) ?? -1e9) < 600);
  return (
    <div class="panel-bar recorder">
      <span class={`in-dot ${receiving ? 'on' : ''}`} aria-hidden="true" />
      <span class="small">
        {input ? (
          <>
            From synth: <b>{input}</b>
          </>
        ) : (
          <span class="muted">Not receiving knobs: pick this synth’s MIDI input under Devices</span>
        )}
      </span>
      <div class="spacer" />
      {rec ? (
        <>
          <span class="rec-state">
            <span class="rec-dot" />
            {rec.startStep === undefined ? 'Armed · starts on the next bar' : `Recording · ${Math.round(Math.max(0, progress) * 100)}%`}
          </span>
          <button type="button" onClick={() => s.cancelMotionRecording()}>
            Cancel
          </button>
        </>
      ) : (
        <>
          <div class="segmented" role="radiogroup" aria-label="Motion length in bars">
            {REC_BARS.map((b) => (
              <button type="button" role="radio" aria-checked={b === bars} onClick={() => setBars(b)}>
                {b} bar{b === 1 ? '' : 's'}
              </button>
            ))}
          </div>
          <button type="button" class="rec-button" onClick={() => s.startMotionRecording(track.id, bars)}>
            <span class="rec-dot" /> Record motion
          </button>
        </>
      )}
    </div>
  );
}
