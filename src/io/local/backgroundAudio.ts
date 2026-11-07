/**
 * Keep the built-in synths audible like a music app:
 * - `navigator.audioSession.type = 'playback'` (Safari 17+): sound plays
 *   with the iPhone's silent switch on, and may continue in the background.
 * - On iOS, the output also runs through a hidden <audio> element. iOS treats
 *   a playing media element as music playback, which shows controls on the
 *   lock screen and keeps the page running longer after switching apps.
 *   The direct path to the speakers stays until that element actually plays,
 *   so a refused or interrupted element never leaves Drift silent.
 * Everything here is best-effort and skipped where unsupported.
 */

interface AudioSessionLike {
  type: string;
}

/** Ask for media playback: ignores the silent switch, like music apps. */
export function usePlaybackSession(): void {
  try {
    const session = (navigator as Navigator & { audioSession?: AudioSessionLike }).audioSession;
    if (session && session.type !== 'playback') session.type = 'playback';
  } catch {
    /* not supported */
  }
}

/** iPhone, iPod and iPad (iPadOS reports itself as a Mac with touch). */
export function isIOS(nav: Pick<Navigator, 'userAgent' | 'maxTouchPoints'> = navigator): boolean {
  return /iPad|iPhone|iPod/.test(nav.userAgent) || (/Macintosh/.test(nav.userAgent) && nav.maxTouchPoints > 1);
}

type Ctx = Pick<AudioContext, 'destination' | 'createMediaStreamDestination'>;

/**
 * Routes a bus to the speakers. On iOS also through a hidden <audio>
 * element (see top); call `wake()` from a click to (re)start that element.
 */
export class OutputRoute {
  private element: HTMLAudioElement | undefined;
  private direct = true;

  constructor(
    private readonly ctx: Ctx,
    private readonly out: AudioNode,
    useElement = typeof navigator !== 'undefined' && isIOS(),
  ) {
    out.connect(ctx.destination);
    if (!useElement || typeof document === 'undefined') return;
    try {
      const stream = ctx.createMediaStreamDestination();
      out.connect(stream);
      const el = document.createElement('audio');
      el.setAttribute('playsinline', '');
      el.srcObject = stream.stream;
      el.addEventListener('playing', () => this.setDirect(false));
      for (const ev of ['pause', 'ended', 'error', 'emptied']) el.addEventListener(ev, () => this.setDirect(true));
      this.element = el;
    } catch {
      this.element = undefined;
    }
  }

  /** Whether sound currently goes straight to the speakers (false: via the media element). */
  get isDirect(): boolean {
    return this.direct;
  }

  wake(): void {
    usePlaybackSession();
    const el = this.element;
    if (el?.paused) void el.play().catch(() => this.setDirect(true));
  }

  private setDirect(on: boolean): void {
    if (on === this.direct) return;
    this.direct = on;
    try {
      if (on) this.out.connect(this.ctx.destination);
      else this.out.disconnect(this.ctx.destination);
    } catch {
      this.direct = true;
    }
  }
}

usePlaybackSession();
