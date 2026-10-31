import { useEffect } from 'preact/hooks';
import { normalizeRate, TRACK_RATES } from '../core/engine/trackRuntime';
import { store, type AppStore } from './store';

/** Tabs of the track detail pane, in order, with their shortcut keys. */
export const SECTIONS = [
  { id: 'overview', label: 'Overview', icon: 'list', key: 'Q' },
  { id: 'pattern', label: 'Pattern', icon: 'grid', key: 'W' },
  { id: 'generator', label: 'Generator', icon: 'sliders', key: 'E' },
  { id: 'modulation', label: 'Modulation', icon: 'wave', key: 'R' },
  { id: 'output', label: 'Output', icon: 'output', key: 'T' },
] as const;

export type SectionId = (typeof SECTIONS)[number]['id'];

/** Shown in the "?" overlay. */
export const SHORTCUT_HELP: { keys: string; action: string }[] = [
  { keys: 'Space', action: 'Play / stop' },
  { keys: '1 – 9', action: 'Select track 1–9' },
  { keys: '↑  ↓', action: 'Previous / next track' },
  { keys: 'Q W E R T', action: 'Track tabs: Overview, Pattern, Generator, Modulation, Output' },
  { keys: 'M  S', action: 'Mute / solo the selected track' },
  { keys: 'N', action: 'New pattern' },
  { keys: 'F', action: 'Freeze / unfreeze' },
  { keys: '[  ]', action: 'Octave down / up' },
  { keys: '←  →', action: 'Pattern length shorter / longer' },
  { keys: 'Shift + ←  →', action: 'Speed slower / faster' },
  { keys: ',  .', action: 'Tempo −1 / +1 (Shift: ±5)' },
  { keys: 'O', action: 'All tracks (Overview page)' },
  { keys: '?', action: 'Show this list' },
  { keys: 'Esc', action: 'Close' },
];

const LENGTHS = [8, 16, 32, 64];

function isTyping(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null;
  if (!node?.closest) return false;
  if (node.closest('textarea, select, [contenteditable="true"]')) return true;
  const input = node.closest('input');
  return !!input && !['range', 'checkbox', 'radio', 'button'].includes((input as HTMLInputElement).type);
}

/** Handle one key press. Returns true when the key did something. */
export function handleShortcut(s: AppStore, e: Pick<KeyboardEvent, 'key' | 'code' | 'shiftKey'>): boolean {
  const tracks = s.project.tracks;
  const track = s.currentTrack;
  const index = track ? tracks.indexOf(track) : -1;
  const key = e.key;

  if (key === 'Escape') {
    if (!s.shortcutsOpen) return false;
    s.setShortcutsOpen(false);
    return true;
  }
  if (key === '?') {
    s.setShortcutsOpen(!s.shortcutsOpen);
    return true;
  }
  if (e.code === 'Space') {
    void s.togglePlay();
    return true;
  }
  if (/^[1-9]$/.test(key)) {
    const t = tracks[Number(key) - 1];
    if (!t) return false;
    s.go({ name: 'track', trackId: t.id });
    return true;
  }
  if (key === 'ArrowUp' || key === 'ArrowDown') {
    if (!tracks.length) return false;
    const next = index < 0 ? 0 : (index + (key === 'ArrowDown' ? 1 : -1) + tracks.length) % tracks.length;
    s.go({ name: 'track', trackId: tracks[next]!.id });
    return true;
  }
  if (key === 'o' || key === 'O') {
    s.go({ name: 'performance' });
    return true;
  }
  if (key === ',' || key === '.' || key === '<' || key === '>') {
    const delta = (key === ',' || key === '<' ? -1 : 1) * (e.shiftKey ? 5 : 1);
    s.change((p) => ({ ...p, bpm: Math.max(20, Math.min(300, p.bpm + delta)) }));
    return true;
  }

  // Everything below acts on the selected track.
  if (!track) return false;
  const section = SECTIONS.find((x) => x.key === key.toUpperCase());
  if (section) {
    s.setTrackTab(section.id);
    return true;
  }
  switch (key.toLowerCase()) {
    case 'm':
      s.updateTrack(track.id, { muted: !track.muted });
      return true;
    case 's':
      s.updateTrack(track.id, { solo: !track.solo });
      return true;
    case 'n':
      s.regenerate(track.id);
      return true;
    case 'f':
      s.updateTrack(track.id, { frozen: !track.frozen });
      return true;
    case '[':
    case ']': {
      if (track.generator.type === 'drums') return false;
      const octave = Math.max(-3, Math.min(3, (track.octave ?? 0) + (key === ']' ? 1 : -1)));
      s.updateTrack(track.id, { octave });
      return true;
    }
  }
  if (key === 'ArrowLeft' || key === 'ArrowRight') {
    const dir = key === 'ArrowRight' ? 1 : -1;
    if (e.shiftKey) {
      // TRACK_RATES runs fast → slow, so "faster" is a step towards the start.
      const i = TRACK_RATES.indexOf(normalizeRate(track.rate) as (typeof TRACK_RATES)[number]);
      const rate = TRACK_RATES[Math.max(0, Math.min(TRACK_RATES.length - 1, i - dir))]!;
      s.updateTrack(track.id, { rate });
    } else {
      const current = s.sequencer.track(track.id)?.pattern.lengthSteps ?? track.generator.params.lengthSteps;
      const i = Math.max(0, LENGTHS.indexOf(current));
      const next = LENGTHS[Math.max(0, Math.min(LENGTHS.length - 1, i + dir))]!;
      if (next !== current) s.setTrackLength(track.id, next);
    }
    return true;
  }
  return false;
}

/** Global keyboard shortcuts; ignored while typing in a text field. */
export function useShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat && e.code === 'Space') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTyping(e.target)) return;
      // Arrow keys on a focused slider move the slider.
      if (e.key.startsWith('Arrow') && (e.target as HTMLElement | null)?.matches?.('input[type="range"]')) return;
      if (handleShortcut(store, e)) {
        e.preventDefault();
        // A focused button would otherwise also react to Space / arrows.
        if (e.code === 'Space') (e.target as HTMLElement | null)?.blur?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
