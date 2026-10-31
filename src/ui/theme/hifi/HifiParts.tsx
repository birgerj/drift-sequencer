import { useEffect, useMemo, useRef } from 'preact/hooks';
import { normalizeRate, shiftRegister } from '../../../core/engine/trackRuntime';
import type { Pattern } from '../../../core/pattern/pattern';
import { resolvePitch } from '../../../core/pattern/resolve';
import { Chord } from '../../../core/theory/chord';
import { NOTE_NAMES } from '../../../core/theory/note';
import type { TrackState } from '../../../state/project';
import type { RackDevice } from '../../../state/rack';
import { inputForDevice } from '../../../state/rack';
import { store, useLive, useStore } from '../../store';

/*
 * Components the Hi-Fi theme puts in its slots (see themes.ts). They show
 * the same state as the default UI; only the presentation differs.
 */

const polar = (cx: number, cy: number, deg: number, r: number) => {
  const a = ((deg - 90) * Math.PI) / 180;
  return [cx + Math.cos(a) * r, cy + Math.sin(a) * r] as const;
};

const RHYTHM = new Set(['drums', 'bass', 'acid']);

/** Arc around the needle pivot (60, 78), so scale, red zone and ticks share one centre. */
function vuArc(fromDeg: number, toDeg: number, r: number): string {
  const [x1, y1] = polar(60, 78, fromDeg, r);
  const [x2, y2] = polar(60, 78, toDeg, r);
  return `M${x1.toFixed(2)} ${y1.toFixed(2)} A${r} ${r} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}
const VU_SCALE = vuArc(-50, 50, 48);
/** Red zone: the top quarter of the scale (0 VU and up). */
const VU_RED = vuArc(25, 50, 48);

/** Two analogue VU meters: rhythm (drums + bass) and melody (lead + pads). */
export function VuMeters() {
  const left = useRef<SVGLineElement>(null);
  const right = useRef<SVGLineElement>(null);
  useEffect(() => {
    let raf = 0;
    const level = [0, 0];
    const tick = () => {
      const now = performance.now();
      const target = [0, 0];
      for (const t of store.project.tracks) {
        const n = store.live.now[t.id];
        if (!n || n.until < now - 40 || t.muted) continue;
        const side = RHYTHM.has(t.generator.type) ? 0 : 1;
        target[side] = (target[side] ?? 0) + 0.3 + 0.08 * n.notes.length;
      }
      const playing = store.sequencer.playing;
      [left, right].forEach((ref, i) => {
        const goal = playing ? Math.min(1, target[i]!) : 0;
        // Needle ballistics: quick up, slow fall.
        level[i]! += (goal - level[i]!) * (goal > level[i]! ? 0.35 : 0.06);
        ref.current?.setAttribute('transform', `rotate(${(-50 + level[i]! * 100).toFixed(1)} 60 78)`);
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div class="hifi-vu" aria-hidden="true">
      {[
        ['RHYTHM', left],
        ['MELODY', right],
      ].map(([label, ref]) => (
        <svg viewBox="0 0 120 82" class="vu-face">
          <path d={VU_SCALE} fill="none" stroke="#2a2d31" stroke-width="1.5" />
          <path d={VU_RED} fill="none" stroke="#c0392b" stroke-width="3" />
          {Array.from({ length: 9 }, (_, j) => {
            const d = -50 + j * 12.5;
            const [x1, y1] = polar(60, 78, d, 50);
            const [x2, y2] = polar(60, 78, d, j % 2 ? 54 : 57);
            return <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#2a2d31" stroke-width="1.2" />;
          })}
          <text x="60" y="58" text-anchor="middle" font-size="9" fill="#2a2d31" letter-spacing="1">
            {label as string}
          </text>
          <line ref={ref as typeof left} x1="60" y1="78" x2="60" y2="24" stroke="#111" stroke-width="1.6" transform="rotate(-50 60 78)" />
          <circle cx="60" cy="78" r="5" fill="#2a2d31" />
        </svg>
      ))}
    </div>
  );
}

const SEGMENTS = 14;

/** The pattern as an LED ladder (graphic-equaliser style), one column per step. */
export function LedLadder({ track, pattern }: { track: TrackState; pattern: Pattern }) {
  const columns = useMemo(() => {
    const len = pattern.lengthSteps;
    const reg = shiftRegister(track.register, track.octave ?? 0);
    const state = {};
    const rate = normalizeRate(track.rate);
    const spb = store.project.stepsPerBar;
    const notes = pattern.events.map((e) => ({
      e,
      n: Math.max(...resolvePitch(e.pitch, store.sequencer.harmonyAt(Math.floor(e.step / rate / spb)), reg, state)),
    }));
    const all = notes.map((x) => x.n).filter(Number.isFinite);
    const lo = Math.min(...all, 127);
    const hi = Math.max(...all, 0);
    const level = new Array<number>(len).fill(0);
    const held = new Array<boolean>(len).fill(false);
    for (const { e, n } of notes) {
      if (!Number.isFinite(n)) continue;
      const h = hi > lo ? 3 + Math.round(((n - lo) / (hi - lo)) * (SEGMENTS - 4)) : 8;
      level[e.step] = Math.max(level[e.step]!, h);
      for (let k = 1; k < Math.min(len, Math.round(e.length)); k++) {
        const s = (e.step + k) % len;
        if (!level[s]) {
          level[s] = Math.max(1, h - 2);
          held[s] = true;
        }
      }
    }
    return level.map((h, i) => ({ h, held: held[i]! }));
  }, [pattern, track.register, track.octave, track.rate]);
  const now = useLive((l) => {
    const rt = store.sequencer.track(track.id);
    return store.sequencer.playing && l.step >= 0 && rt ? rt.patternStepAt(l.step) : -1;
  });
  return (
    <div class="led-ladder" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }} role="img" aria-label={`${track.name} pattern`}>
      {columns.map((c, i) => (
        <div class={`led-col ${i === now ? 'now' : ''} ${i % 4 === 0 ? 'beat' : ''}`}>
          {Array.from({ length: SEGMENTS }, (_, s) => {
            const on = s < c.h;
            const zone = s >= SEGMENTS - 3 ? 'hot' : s >= SEGMENTS - 6 ? 'warm' : 'cool';
            return <span class={`seg ${on ? `on ${zone}` : ''} ${on && c.held ? 'held' : ''}`} />;
          })}
        </div>
      ))}
    </div>
  );
}

const FIFTHS = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];

/** Radio-tuner hero: keys on the circle of fifths, chords as stations, a needle on now. */
export function HarmonyTuner() {
  const s = useStore();
  const p = s.project;
  const harmony = s.sequencer.currentHarmony;
  const totalBars = Math.max(1, p.progression.reduce((a, b) => a + b.bars, 0));
  const pos = useLive((l) => {
    if (!s.sequencer.playing || l.step < 0) return -1;
    const bars = l.bar + (l.step % p.stepsPerBar) / p.stepsPerBar;
    return (bars % totalBars) / totalBars;
  });
  let acc = 0;
  return (
    <section class="hifi-tuner" aria-label="Harmony tuner">
      <div class="tuner-glass">
        <div class="tuner-keys" role="radiogroup" aria-label="Key">
          {FIFTHS.map((pc) => (
            <button
              type="button"
              role="radio"
              aria-checked={pc === p.key.root}
              onClick={() => s.change((x) => ({ ...x, key: { ...x.key, root: pc } }))}
            >
              {NOTE_NAMES[pc]}
            </button>
          ))}
        </div>
        <div class="tuner-scale" aria-hidden="true">
          {Array.from({ length: 49 }, (_, i) => (
            <i class={i % 4 === 0 ? 'major' : ''} />
          ))}
        </div>
        <div class="tuner-stations">
          {p.progression.map((step, i) => {
            const start = acc / totalBars;
            acc += step.bars;
            const end = acc / totalBars;
            const active = pos >= start && pos < end;
            const chord = Chord.fromDegree(harmony.scale, step.degree, step.size ?? 3);
            return (
              <div class={`station ${active ? 'on' : ''}`} style={{ flex: String(step.bars) }} key={i}>
                <b>{chord.symbol()}</b>
                <span>
                  {chord.roman()} · {step.bars} bar{step.bars === 1 ? '' : 's'}
                </span>
              </div>
            );
          })}
        </div>
        {pos >= 0 && <span class="tuner-needle" style={{ left: `calc(24px + (100% - 48px) * ${pos.toFixed(4)})` }} />}
        <span class="tuner-band" aria-hidden="true">
          {NOTE_NAMES[p.key.root]} {p.key.mode.toUpperCase()}
        </span>
      </div>
    </section>
  );
}

/** Rear-panel MIDI jacks with OUT / IN lamps for a device card. */
export function DeviceJacks({ device }: { device: RackDevice }) {
  const s = useStore();
  const out = s.ports.includes(device.portName);
  const input = inputForDevice(device, s.inputs);
  return (
    <div class="hifi-jacks" aria-label={`${device.name}: out ${out ? 'connected' : 'not connected'}, in ${input ? input : 'none'}`}>
      {[
        ['OUT', out],
        ['IN', !!input],
      ].map(([label, on]) => (
        <div class="jack">
          <svg viewBox="0 0 58 58" aria-hidden="true">
            <circle cx="29" cy="29" r="26" fill="#9aa1ac" />
            <circle cx="29" cy="29" r="22" fill="#0d0e10" />
            <circle cx="16" cy="27" r="2.6" fill="#c9ced3" />
            <circle cx="42" cy="27" r="2.6" fill="#c9ced3" />
            <circle cx="20" cy="18" r="2.6" fill="#c9ced3" />
            <circle cx="38" cy="18" r="2.6" fill="#c9ced3" />
            <circle cx="29" cy="15" r="2.6" fill="#c9ced3" />
            <rect x="26" y="45" width="6" height="4" fill="#9aa1ac" />
          </svg>
          <span class={`jack-lamp ${on ? (label === 'OUT' ? 'out' : 'in') : ''}`} />
          {label as string}
        </div>
      ))}
    </div>
  );
}
