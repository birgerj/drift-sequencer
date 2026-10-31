/**
 * Installable-app support: registers the service worker (only on https or
 * localhost — not when opened from disk) and exposes the browser's install
 * prompt and update notifications to the UI.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

type Listener = () => void;

class Pwa {
  private installEvent: BeforeInstallPromptEvent | undefined;
  private waiting: ServiceWorker | undefined;
  private listeners = new Set<Listener>();

  get canInstall(): boolean {
    return this.installEvent !== undefined;
  }

  get updateReady(): boolean {
    return this.waiting !== undefined;
  }

  get installed(): boolean {
    return matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: window-controls-overlay)').matches;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  init(): void {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.installEvent = e as BeforeInstallPromptEvent;
      this.emit();
    });
    window.addEventListener('appinstalled', () => {
      this.installEvent = undefined;
      this.emit();
    });

    const secure = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if (!secure || !('serviceWorker' in navigator) || import.meta.env.DEV) return;

    navigator.serviceWorker
      .register('./sw.js')
      .then((reg) => {
        const track = (sw: ServiceWorker | null) => {
          if (!sw) return;
          sw.addEventListener('statechange', () => {
            // A new version is ready while an older one controls the page.
            if (sw.state === 'installed' && navigator.serviceWorker.controller) {
              this.waiting = sw;
              this.emit();
            }
          });
        };
        if (reg.waiting && navigator.serviceWorker.controller) {
          this.waiting = reg.waiting;
          this.emit();
        }
        reg.addEventListener('updatefound', () => track(reg.installing));
        // Check for a new release every hour while the app is open.
        setInterval(() => void reg.update(), 60 * 60 * 1000);
      })
      .catch(() => {
        /* offline support is optional */
      });

    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return;
      reloading = true;
      location.reload();
    });
  }

  async install(): Promise<void> {
    const e = this.installEvent;
    if (!e) return;
    await e.prompt();
    await e.userChoice;
    this.installEvent = undefined;
    this.emit();
  }

  applyUpdate(): void {
    this.waiting?.postMessage('skip-waiting');
  }

  private emit(): void {
    this.listeners.forEach((l) => l());
  }
}

export const pwa = new Pwa();
