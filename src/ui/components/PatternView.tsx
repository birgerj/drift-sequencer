import { useEffect, useRef } from 'preact/hooks';
import type { Pattern } from '../../core/pattern/pattern';
import { resolvePitch } from '../../core/pattern/resolve';
import type { Harmony } from '../../core/theory/harmony';
import type { DrumParams } from '../../core/generators/drumGenerator';
import { noteName } from '../../core/theory/note';
import type { TrackState } from '../../state/project';
import { store } from '../store';

interface Props {
  track: TrackState;
  pattern: Pattern;
  harmony: Harmony;
  height: number;
  showLabels?: boolean;
}

const BG = '#0f1115';
const GRID = '#171a20';
const BEAT = '#252932';
const BAR = '#3a3f4a';
const LABEL = '#9aa1ac';

/**
 * Canvas piano roll (melodic tracks) or step grid (drums) with a live
 * playhead. Redraws only when the step or the pattern changes.
 */
export function PatternView({ track, pattern, harmony, height, showLabels }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const propsRef = useRef({ track, pattern, harmony, showLabels });
  propsRef.current = { track, pattern, harmony, showLabels };

  useEffect(() => {
    const canvas = canvasRef.current!;
    let width = 0;
    let lastKey = '';
    let raf = 0;
    const ro = new ResizeObserver(() => {
      width = canvas.clientWidth;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      lastKey = '';
    });
    ro.observe(canvas);

    let lastInputs: unknown[] = [];
    const frame = () => {
      const { track: t, showLabels: labels } = propsRef.current;
      // Read live engine state so mutations show up the moment they happen.
      const p = store.sequencer.track(t.id)?.pattern ?? propsRef.current.pattern;
      const h = store.sequencer.currentHarmony ?? propsRef.current.harmony;
      const step = store.sequencer.playing ? store.live.step : -1;
      const key = `${step}|${width}`;
      const inputs = [p, t, h];
      if (key !== lastKey || inputs.some((x, i) => x !== lastInputs[i])) {
        lastKey = key;
        lastInputs = inputs;
        draw(canvas, width, height, t, p, h, step, !!labels);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [height]);

  return <canvas ref={canvasRef} class="pattern-view" style={{ height: `${height}px` }} aria-label={`${track.name} pattern`} role="img" />;
}

function draw(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  track: TrackState,
  pattern: Pattern,
  harmony: Harmony,
  step: number,
  labels: boolean,
) {
  const ctx = canvas.getContext('2d');
  if (!ctx || width === 0) return;
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, width, height);

  const len = pattern.lengthSteps;
  const stepsPerBar = store.project.stepsPerBar;
  const labelW = labels ? 40 : 0;
  const w = width - labelW;
  const sx = (s: number) => labelW + (s / len) * w;
  const local = step >= 0 ? step % len : -1;
  const color = track.color;

  // Grid
  for (let s = 0; s <= len; s++) {
    ctx.fillStyle = s % stepsPerBar === 0 ? BAR : s % 4 === 0 ? BEAT : GRID;
    ctx.fillRect(Math.round(sx(s)), 0, 1, height);
  }

  if (track.generator.type === 'drums') {
    const voices = (track.generator.params as DrumParams).voices;
    const rowH = height / Math.max(1, voices.length);
    voices.forEach((v, row) => {
      const y = row * rowH;
      if (labels) {
        ctx.fillStyle = LABEL;
        ctx.font = '11px "JetBrains Mono", monospace';
        ctx.textBaseline = 'middle';
        ctx.fillText(v.name, 4, y + rowH / 2);
      }
      for (const e of pattern.events) {
        if (e.pitch.kind !== 'fixed' || e.pitch.note !== v.note) continue;
        const x = sx(e.step) + 1.5;
        const cw = w / len - 3;
        ctx.globalAlpha = 0.35 + 0.65 * (e.probability ?? 1);
        ctx.fillStyle = e.step === local ? '#ffffff' : color;
        roundRect(ctx, x, y + 2, cw, rowH - 4, 3);
      }
      ctx.globalAlpha = 1;
    });
  } else {
    const blockStartBar = step >= 0 ? Math.floor(step / len) * (len / stepsPerBar) : 0;
    const state = {};
    const resolved = pattern.events.map((e) => {
      const bar = blockStartBar + Math.floor(e.step / stepsPerBar);
      return { e, notes: resolvePitch(e.pitch, harmony.at(bar), track.register, state) };
    });
    const all = resolved.flatMap((r) => r.notes);
    if (all.length) {
      const lo = Math.min(...all) - 1;
      const hi = Math.max(...all) + 1;
      const span = Math.max(12, hi - lo + 1);
      const mid = (lo + hi) / 2;
      const bottom = Math.round(mid - span / 2);
      const rowH = height / span;
      const y = (n: number) => height - (n - bottom + 1) * rowH;
      if (labels) {
        ctx.fillStyle = LABEL;
        ctx.font = '10px "JetBrains Mono", monospace';
        ctx.textBaseline = 'middle';
        for (let n = bottom; n < bottom + span; n++) {
          if (harmony.scale.contains(n) && n % 12 === harmony.scale.root % 12) ctx.fillText(noteName(n), 4, y(n) + rowH / 2);
        }
      }
      for (const { e, notes } of resolved) {
        const active = local >= e.step && local < e.step + e.length;
        ctx.fillStyle = active ? '#ffffff' : color;
        for (const n of notes) {
          roundRect(ctx, sx(e.step) + 1, y(n) + 1, Math.max(3, (e.length / len) * w - 2), Math.max(2, rowH - 2), 2);
        }
      }
    }
  }

  if (local >= 0) {
    ctx.fillStyle = '#f2f4f7';
    ctx.fillRect(Math.round(sx(local)), 0, 2, height);
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.min(r, h / 2, w / 2));
  ctx.fill();
}
