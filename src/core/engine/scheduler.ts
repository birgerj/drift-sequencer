export interface TimerHost {
  now(): number;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export const browserTimerHost: TimerHost = {
  now: () => performance.now(),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
};

export interface SchedulerOptions {
  bpm: number;
  stepsPerBeat?: number;
  /** How far ahead steps are scheduled. */
  lookaheadMs?: number;
  /** How often the scheduler wakes up. */
  intervalMs?: number;
  /** 0..1 — delays every odd step by this fraction of a step. */
  swing?: number;
}

export type StepHandler = (step: number, timeMs: number, stepDurationMs: number) => void;

/**
 * Lookahead scheduler: a coarse JS timer wakes up often and schedules every
 * step that falls inside the lookahead window with an exact timestamp. Web
 * MIDI then sends at that timestamp, so timer jitter doesn't reach the music.
 */
export class LookaheadScheduler {
  private bpm: number;
  private swing: number;
  private readonly stepsPerBeat: number;
  private lookaheadMs: number;
  private readonly intervalMs: number;
  private handle: unknown;
  private nextStep = 0;
  private nextStepTime = 0;
  private handler: StepHandler | undefined;

  constructor(
    options: SchedulerOptions,
    private readonly timer: TimerHost = browserTimerHost,
  ) {
    this.bpm = options.bpm;
    this.swing = options.swing ?? 0;
    this.stepsPerBeat = options.stepsPerBeat ?? 4;
    this.lookaheadMs = options.lookaheadMs ?? 100;
    this.intervalMs = options.intervalMs ?? 25;
  }

  get running(): boolean {
    return this.handle !== undefined;
  }

  get stepDurationMs(): number {
    return 60000 / this.bpm / this.stepsPerBeat;
  }

  setBpm(bpm: number): void {
    this.bpm = Math.max(20, Math.min(300, bpm));
  }

  /**
   * A longer lookahead survives late timer ticks (e.g. a hidden tab) at the
   * cost of changes taking a bit longer to be heard.
   */
  setLookahead(ms: number): void {
    this.lookaheadMs = Math.max(20, Math.min(1000, ms));
  }

  setSwing(swing: number): void {
    this.swing = Math.max(0, Math.min(0.75, swing));
  }

  start(handler: StepHandler, startDelayMs = 50): void {
    this.stop();
    this.handler = handler;
    this.nextStep = 0;
    this.nextStepTime = this.timer.now() + startDelayMs;
    this.tick();
    this.handle = this.timer.setInterval(() => this.tick(), this.intervalMs);
  }

  stop(): void {
    if (this.handle !== undefined) this.timer.clearInterval(this.handle);
    this.handle = undefined;
  }

  /** Called with the number of steps skipped after the browser paused us. */
  onSkip: ((steps: number, gapMs: number) => void) | undefined;

  /** Exposed for tests; normally driven by the interval. */
  tick(): void {
    if (!this.handler) return;
    const now = this.timer.now();
    // If the browser paused us (sleep, frozen tab, long task), don't replay
    // every missed step at once — that floods the MIDI service. Skip ahead,
    // keeping the musical position.
    const dur = this.stepDurationMs;
    const gap = now - this.nextStepTime;
    if (gap > Math.max(250, dur * 2)) {
      const missed = Math.ceil(gap / dur);
      this.nextStep += missed;
      this.nextStepTime += missed * dur;
      this.onSkip?.(missed, gap);
    }
    const horizon = now + this.lookaheadMs;
    while (this.nextStepTime < horizon) {
      const dur = this.stepDurationMs;
      const swingOffset = this.nextStep % 2 === 1 ? this.swing * dur * 0.5 : 0;
      this.handler(this.nextStep, this.nextStepTime + swingOffset, dur);
      this.nextStep++;
      this.nextStepTime += dur;
    }
  }
}
