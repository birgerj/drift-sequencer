import { useEffect, useState } from 'preact/hooks';
import { DEFAULT_THEME, themeById, THEMES, type ThemeDef, type ThemeSlot } from './themes';

const KEY = 'drift.theme';
const listeners = new Set<() => void>();
let current: ThemeDef = themeById(DEFAULT_THEME);
const varCache = new Map<string, string>();

function readSaved(): string | undefined {
  try {
    return localStorage.getItem(KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

/** Apply a theme to the document (and remember it on this device). */
export function applyTheme(id: string, save = true): void {
  current = themeById(id);
  const root = document.documentElement;
  root.dataset.theme = current.id;
  varCache.clear();
  if (current.fontsHref && !document.querySelector(`link[data-theme-fonts="${current.id}"]`)) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = current.fontsHref;
    link.dataset.themeFonts = current.id;
    document.head.append(link);
  }
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', current.chrome);
  if (save) {
    try {
      localStorage.setItem(KEY, current.id);
    } catch {
      /* private mode */
    }
  }
  listeners.forEach((l) => l());
}

export function initTheme(): void {
  applyTheme(readSaved() ?? DEFAULT_THEME, false);
  // Another Drift window (e.g. Visuals) switched theme.
  window.addEventListener('storage', (e) => {
    if (e.key === KEY && e.newValue && e.newValue !== current.id) applyTheme(e.newValue, false);
  });
}

export function currentTheme(): ThemeDef {
  return current;
}

export function cycleTheme(): void {
  const i = THEMES.findIndex((t) => t.id === current.id);
  applyTheme(THEMES[(i + 1) % THEMES.length]!.id);
}

/** A CSS custom property of the active theme (cached), for canvas drawing. */
export function themeVar(name: string, fallback = '#000'): string {
  let v = varCache.get(name);
  if (v === undefined) {
    v = getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
    varCache.set(name, v);
  }
  return v;
}

/** Re-render on theme changes; returns the active theme. */
export function useTheme(): ThemeDef {
  const [, setTick] = useState(0);
  useEffect(() => {
    const l = () => setTick((t) => t + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return current;
}

export function hasSlot(slot: ThemeSlot): boolean {
  return current.slots.includes(slot);
}
