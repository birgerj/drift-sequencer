/**
 * While playing, keep the browser from pausing Drift:
 * - a Web Lock: Chrome and Edge don't freeze or put to sleep a tab that
 *   holds one (memory saver / sleeping tabs);
 * - a screen Wake Lock: the screen (and laptop) doesn't sleep mid-set.
 * Both are best-effort and silently skipped where unsupported.
 */
interface WakeLockSentinelLike {
  release(): Promise<void>;
}

let releaseWebLock: (() => void) | undefined;
let wakeLock: WakeLockSentinelLike | undefined;
let wanted = false;

export async function keepAwake(on: boolean): Promise<void> {
  wanted = on;
  if (on) {
    if (!releaseWebLock && 'locks' in navigator) {
      void navigator.locks
        .request('drift-playing', () => new Promise<void>((resolve) => (releaseWebLock = resolve)))
        .catch(() => undefined);
    }
    await requestWakeLock();
  } else {
    releaseWebLock?.();
    releaseWebLock = undefined;
    const w = wakeLock;
    wakeLock = undefined;
    await w?.release().catch(() => undefined);
  }
}

async function requestWakeLock(): Promise<void> {
  if (wakeLock || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
  try {
    const nav = navigator as Navigator & { wakeLock: { request(type: 'screen'): Promise<WakeLockSentinelLike> } };
    wakeLock = await nav.wakeLock.request('screen');
    // The browser drops the wake lock when the page is hidden.
    (wakeLock as unknown as EventTarget).addEventListener?.('release', () => (wakeLock = undefined));
  } catch {
    wakeLock = undefined;
  }
}

// Re-acquire the screen lock when coming back to the page while still playing.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (wanted && document.visibilityState === 'visible') void requestWakeLock();
  });
}
