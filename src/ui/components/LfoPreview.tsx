import { themeVar } from '../theme/theme';
import { useEffect, useRef } from 'preact/hooks';
import { lfoValue } from '../../core/engine/lfo';
import type { CcModulation } from '../../state/project';
import { store } from '../store';

/**
 * Draws one LFO cycle between min and max (on the 0–127 CC scale) and a
 * moving indicator at the LFO's current position while playing.
 */
export function LfoPreview({ mod, color }: { mod: CcModulation; color: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const valueRef = useRef<HTMLSpanElement>(null);
  const modRef = useRef(mod);
  modRef.current = mod;

  useEffect(() => {
    const canvas = canvasRef.current!;
    const height = 84;
    let width = 0;
    let last = '';
    let raf = 0;
    const ro = new ResizeObserver(() => {
      width = canvas.clientWidth;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      last = '';
    });
    ro.observe(canvas);

    const frame = () => {
      const m = modRef.current;
      const stepsPerBar = store.project.stepsPerBar;
      const period = Math.max(1, m.periodBars * stepsPerBar);
      const playing = store.sequencer.playing && store.live.step >= 0;
      const step = playing ? store.live.step : -1;
      const phase = step >= 0 ? (step % period) / period : -1;
      const cycle = step >= 0 ? Math.floor(step / period) : 0;
      const key = `${width}|${m.shape}|${m.min}|${m.max}|${m.periodBars}|${m.enabled}|${step}`;
      if (key !== last) {
        last = key;
        draw(canvas, width, height, m, phase, cycle, color);
        if (valueRef.current) {
          valueRef.current.textContent =
            phase >= 0 && m.enabled ? String(Math.round(m.min + (m.max - m.min) * lfoValue(m.shape, phase, cycle))) : '—';
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [color]);

  return (
    <div class="lfo-preview">
      <canvas ref={canvasRef} style={{ height: '84px' }} role="img" aria-label={`${mod.shape} LFO from ${mod.min} to ${mod.max} over ${mod.periodBars} bars`} />
      <div class="lfo-readout">
        <span class="eyebrow">Value</span>
        <span class="mono" ref={valueRef}>
          —
        </span>
      </div>
    </div>
  );
}

function draw(canvas: HTMLCanvasElement, width: number, height: number, m: CcModulation, phase: number, cycle: number, color: string) {
  const ctx = canvas.getContext('2d');
  if (!ctx || width === 0) return;
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = themeVar('--canvas-bg');
  ctx.fillRect(0, 0, width, height);

  const pad = 6;
  const y = (cc: number) => height - pad - (cc / 127) * (height - 2 * pad);
  const value = (p: number) => m.min + (m.max - m.min) * lfoValue(m.shape, p, cycle);

  // Range band and bar divisions
  ctx.fillStyle = themeVar('--playhead-fill');
  ctx.fillRect(0, y(Math.max(m.min, m.max)), width, Math.abs(y(m.min) - y(m.max)));
  ctx.fillStyle = themeVar('--canvas-beat');
  for (let b = 1; b < m.periodBars; b++) ctx.fillRect(Math.round((b / m.periodBars) * width), 0, 1, height);

  // Waveform
  ctx.globalAlpha = m.enabled ? 1 : 0.35;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  const samples = Math.max(64, Math.round(width));
  for (let i = 0; i <= samples; i++) {
    const p = Math.min(0.9999, i / samples);
    const px = (i / samples) * width;
    const py = y(value(p));
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();

  // Live position
  if (phase >= 0 && m.enabled) {
    const px = phase * width;
    ctx.fillStyle = themeVar('--canvas-label');
    ctx.fillRect(Math.round(px), 0, 1, height);
    ctx.globalAlpha = 1;
    ctx.fillStyle = themeVar('--text');
    ctx.beginPath();
    ctx.arc(px, y(value(phase)), 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}
