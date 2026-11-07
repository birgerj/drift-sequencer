/**
 * Lock-screen and notification controls (Media Session API): the project
 * name with play/pause, so Drift can be stopped without reopening it.
 * Shown by the OS while a media element plays (see backgroundAudio).
 */
export interface MediaControls {
  play(): void;
  pause(): void;
}

function session(): MediaSession | undefined {
  return typeof navigator !== 'undefined' && 'mediaSession' in navigator ? navigator.mediaSession : undefined;
}

export function initMediaSession(controls: MediaControls): void {
  const s = session();
  if (!s) return;
  const set = (action: MediaSessionAction, fn: () => void) => {
    try {
      s.setActionHandler(action, fn);
    } catch {
      /* action not supported */
    }
  };
  set('play', controls.play);
  set('pause', controls.pause);
  set('stop', controls.pause);
}

export function updateMediaSession(title: string, playing: boolean): void {
  const s = session();
  if (!s) return;
  try {
    if (typeof MediaMetadata !== 'undefined' && s.metadata?.title !== title) {
      s.metadata = new MediaMetadata({ title: title || 'Drift', artist: 'Drift' });
    }
    s.playbackState = playing ? 'playing' : 'paused';
  } catch {
    /* not supported */
  }
}
