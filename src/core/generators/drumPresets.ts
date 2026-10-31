import type { Pattern, PatternEvent } from '../pattern/pattern';
import type { DrumVoice } from './drumGenerator';
import { TR8S_NOTES } from './drumGenerator';

export type DrumVoiceKey = keyof typeof TR8S_NOTES;

/** All 11 TR-8S instruments, in the order of the front panel. */
export const TR8S_VOICE_ORDER: DrumVoiceKey[] = ['BD', 'SD', 'LT', 'MT', 'HT', 'RS', 'CP', 'CH', 'OH', 'CC', 'RC'];

const BASE_VELOCITY: Record<DrumVoiceKey, number> = {
  BD: 110, SD: 100, LT: 95, MT: 95, HT: 95, RS: 90, CP: 95, CH: 80, OH: 85, CC: 100, RC: 80,
};

/** A full set of TR-8S voices; `pulses` 0 keeps a lane empty but visible. */
export function tr8sVoices(pulses: Partial<Record<DrumVoiceKey, [number, number]>> = {}): DrumVoice[] {
  return TR8S_VOICE_ORDER.map((name) => ({
    name,
    note: TR8S_NOTES[name],
    pulses: pulses[name]?.[0] ?? 0,
    rotate: pulses[name]?.[1] ?? 0,
    probability: 1,
    velocity: BASE_VELOCITY[name],
  }));
}

/**
 * A ready-made drum groove. Each row is one character per 16th step:
 *   X accent · x hit · o soft (ghost) · 2 / 3 ratchet · . rest
 * Rows of 16 steps repeat over longer patterns.
 */
export interface DrumPreset {
  id: string;
  name: string;
  genre: string;
  /** Suggested tempo; loading a preset doesn't change the project tempo. */
  bpm: number;
  rows: Partial<Record<DrumVoiceKey, string>>;
}

export const DRUM_PRESETS: DrumPreset[] = [
  {
    id: 'house', name: 'Classic house', genre: 'House', bpm: 124,
    rows: {
      BD: 'X...X...X...X...',
      CP: '....x.......x...',
      CH: 'o.o.o.o.o.o.o.o.',
      OH: '..x...x...x...x.',
    },
  },
  {
    id: 'deep-house', name: 'Deep house', genre: 'House', bpm: 120,
    rows: {
      BD: 'X...X...X...X...',
      RS: '......o.......o.',
      CP: '....x.......x...',
      CH: '.o.o.o.o.o.o.o.o',
      OH: '..x...x...x...x.',
      RC: 'o...o...o...o...',
    },
  },
  {
    id: 'disco', name: 'Disco', genre: 'House', bpm: 118,
    rows: {
      BD: 'X...X...X...X...',
      SD: '....X.......X...',
      CH: 'x.x.x.x.x.x.x.x.',
      OH: '..x...x...x...x.',
      CP: '....o.......o...',
    },
  },
  {
    id: 'afro-house', name: 'Afro house', genre: 'House', bpm: 122,
    rows: {
      BD: 'X...X...X...X...',
      LT: '......o.......o.',
      MT: '...o.......o....',
      HT: '.........o......',
      RS: '..x..x....x..x..',
      CP: '....x.......x...',
      CH: '.o.o.o.o.o.o.o.o',
    },
  },
  {
    id: 'techno', name: 'Driving techno', genre: 'Techno', bpm: 132,
    rows: {
      BD: 'X...X...X...X...',
      CP: '....x.......x...',
      CH: 'xoxoxoxoxoxoxoxo',
      OH: '..x...x...x...x.',
      RC: '..o...o...o...o.',
      RS: '...o..o....o..o.',
    },
  },
  {
    id: 'minimal', name: 'Minimal', genre: 'Techno', bpm: 126,
    rows: {
      BD: 'X...X...X...X...',
      RS: '..o..o....o..o..',
      CP: '....x.......x...',
      CH: '.o.o.o.o.o.o.o.o',
      OH: '..........o.....',
    },
  },
  {
    id: 'rumble', name: 'Hard techno rumble', genre: 'Techno', bpm: 145,
    rows: {
      BD: 'X..oX..oX..oX..o',
      CP: '....x.......x...',
      CH: 'oooooooooooooooo',
      OH: '..x...x...x...x.',
      RC: 'x.x.x.x.x.x.x.x.',
    },
  },
  {
    id: 'tribal', name: 'Tribal toms', genre: 'Techno', bpm: 128,
    rows: {
      BD: 'X...X...X...X...',
      LT: '..x.....x.x.....',
      MT: '....x......x....',
      HT: '......x.......x.',
      RS: '.o...o...o...o..',
      CH: '.o.o.o.o.o.o.o.o',
    },
  },
  {
    id: 'acid', name: 'Acid 909', genre: 'Acid', bpm: 128,
    rows: {
      BD: 'X...X...X...X...',
      SD: '....x.......x...',
      CP: '....x.......x..o',
      CH: 'x.x.x.x.x.x.x.x.',
      OH: '..x...x...x...x.',
    },
  },
  {
    id: 'electro', name: 'Electro', genre: 'Electro & breaks', bpm: 125,
    rows: {
      BD: 'X......x..X.....',
      SD: '....X.......X...',
      CP: '....x.......x...',
      CH: 'x.x.x.x.x.x.x.x.',
      HT: '..............o.',
      LT: '...........o....',
    },
  },
  {
    id: 'break', name: 'Funky break', genre: 'Electro & breaks', bpm: 130,
    rows: {
      BD: 'X.x.......x.....',
      SD: '....X..o.o..X..o',
      CH: 'x.x.x.x.x.x.x.x.',
      OH: '..........x.....',
    },
  },
  {
    id: 'garage', name: 'UK garage 2-step', genre: 'Electro & breaks', bpm: 132,
    rows: {
      BD: 'X.....x...x.....',
      SD: '....x.......x...',
      RS: '..o..o.....o..o.',
      CH: '.x.x.x.x.x.x.x.x',
      OH: '..............x.',
    },
  },
  {
    id: 'dnb', name: 'Drum & bass', genre: 'Electro & breaks', bpm: 172,
    rows: {
      BD: 'X.........X.....',
      SD: '....X.......X...',
      CH: 'x.x.x.x.x.x.x.x.',
      RC: 'o...o...o...o...',
      OH: '.......o........',
    },
  },
  {
    id: 'boom-bap', name: 'Boom bap', genre: 'Hip hop', bpm: 90,
    rows: {
      BD: 'X......x.xX.....',
      SD: '....X.......X...',
      CH: 'x.x.x.x.x.x.x.x.',
      OH: '..............x.',
    },
  },
  {
    id: 'trap', name: 'Trap (half time)', genre: 'Hip hop', bpm: 140,
    rows: {
      BD: 'X......x..x.....',
      SD: '........X.......',
      CP: '........x.......',
      CH: 'x.x.x.x.x.x3x.x2',
      OH: '...............o',
    },
  },
  {
    id: 'dembow', name: 'Dembow', genre: 'Hip hop', bpm: 96,
    rows: {
      BD: 'X...X...X...X...',
      SD: '...x..x....x..x.',
      CH: 'x.x.x.x.x.x.x.x.',
    },
  },
  {
    id: 'ambient', name: 'Sparse pulse', genre: 'Ambient', bpm: 100,
    rows: {
      BD: 'X.......X.......',
      RS: '......o.......o.',
      CH: '..o...o...o...o.',
      RC: 'x...x...x...x...',
    },
  },
];

/** Genres in the order they appear in the list. */
export const PRESET_GENRES = [...new Set(DRUM_PRESETS.map((p) => p.genre))];

const VELOCITY: Record<string, number> = { X: 120, x: 96, o: 62, '2': 90, '3': 90 };

/** The preset as a pattern of `lengthSteps` steps; rows repeat as needed. */
export function presetPattern(preset: DrumPreset, lengthSteps = 16): Pattern {
  const events: PatternEvent[] = [];
  for (const key of TR8S_VOICE_ORDER) {
    const row = preset.rows[key];
    if (!row) continue;
    for (let step = 0; step < lengthSteps; step++) {
      const c = row[step % row.length]!;
      const velocity = VELOCITY[c];
      if (velocity === undefined) continue;
      const ev: PatternEvent = { step, length: 0.5, velocity, pitch: { kind: 'fixed', note: TR8S_NOTES[key] } };
      if (c === '2' || c === '3') ev.ratchet = Number(c);
      events.push(ev);
    }
  }
  events.sort((a, b) => a.step - b.step);
  return { lengthSteps, events };
}

/**
 * Generator voices that roughly follow the preset (hits per bar, first hit),
 * so "New pattern" and mutations stay in the same style.
 */
export function presetVoices(preset: DrumPreset): DrumVoice[] {
  const pulses: Partial<Record<DrumVoiceKey, [number, number]>> = {};
  for (const key of TR8S_VOICE_ORDER) {
    const row = preset.rows[key]?.slice(0, 16);
    if (!row) continue;
    const hits = [...row].filter((c) => c in VELOCITY).length;
    const first = [...row].findIndex((c) => c in VELOCITY);
    pulses[key] = [hits, Math.max(0, first)];
  }
  return tr8sVoices(pulses);
}
