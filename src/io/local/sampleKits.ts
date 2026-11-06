/**
 * Sampled drum kits for Drift Synth Drums. They are not bundled: picking one
 * with the Samples knob downloads its FLAC hits (0.5–4 MB) from kits/<id>/,
 * keeps them in the browser's Cache Storage and decodes them for playback.
 * See public/kits/ATTRIBUTION.md for sources and licenses.
 */

import kitsVersion from './kitsVersion.json';
import { SampleCache, samplesBase } from './sampleCache';

export type SampleKitId = 'acoustic' | 'vintage' | 'jazz' | 'deep-house' | 'linn';

export const SAMPLE_KITS: { id: SampleKitId; name: string }[] = [
  { id: 'acoustic', name: 'Acoustic' },
  { id: 'vintage', name: 'Vintage' },
  { id: 'jazz', name: 'Jazz brushes' },
  { id: 'deep-house', name: 'Deep house' },
  { id: 'linn', name: '80s Linn' },
];

/** Samples knob (CC 15): 0–20 keeps the synthesized kit, then one band per sampled kit. */
export const SAMPLES_CC = 15;
const SYNTH_BAND = 21;

export function sampleKitFromCc(value: number): SampleKitId | undefined {
  if (value < SYNTH_BAND) return undefined;
  const band = Math.floor(((value - SYNTH_BAND) * SAMPLE_KITS.length) / (128 - SYNTH_BAND));
  return SAMPLE_KITS[Math.min(SAMPLE_KITS.length - 1, band)]!.id;
}

export type Piece =
  | 'kick'
  | 'snare'
  | 'snareAlt'
  | 'rim'
  | 'clap'
  | 'hatClosed'
  | 'hatPedal'
  | 'hatOpen'
  | 'tomLow'
  | 'tomMid'
  | 'tomHigh'
  | 'crash'
  | 'ride'
  | 'rideBell'
  | 'tambourine'
  | 'cowbell'
  | 'shaker'
  | 'clave'
  | 'congaLow'
  | 'congaHigh';

/** GM drum note → kit pieces to try, in order. Unmapped notes fall back to the synth kit. */
const NOTE_PIECES: Record<number, Piece[]> = {
  35: ['kick'],
  36: ['kick'],
  37: ['rim'],
  38: ['snare'],
  39: ['clap'],
  40: ['snareAlt', 'snare'],
  41: ['tomLow'],
  42: ['hatClosed'],
  43: ['tomLow'],
  44: ['hatPedal', 'hatClosed'],
  45: ['tomMid'],
  46: ['hatOpen'],
  47: ['tomMid'],
  48: ['tomHigh'],
  49: ['crash'],
  50: ['tomHigh'],
  51: ['ride'],
  52: ['crash'],
  53: ['rideBell', 'ride'],
  54: ['tambourine'],
  55: ['crash'],
  56: ['cowbell'],
  57: ['crash'],
  59: ['ride'],
  60: ['congaHigh'],
  61: ['congaLow'],
  62: ['congaHigh'],
  63: ['congaHigh'],
  64: ['congaLow'],
  69: ['shaker'],
  70: ['shaker'],
  75: ['clave'],
  76: ['clave'],
  82: ['shaker'],
};

export function piecesForNote(note: number): Piece[] {
  return NOTE_PIECES[note] ?? [];
}

/** Which knob group (tune/decay/level) a piece answers to. */
export function voiceOfPiece(p: Piece): 'kick' | 'snare' | 'clap' | 'closedHat' | 'openHat' | 'toms' | 'cymbals' | 'percussion' {
  switch (p) {
    case 'kick':
      return 'kick';
    case 'snare':
    case 'snareAlt':
      return 'snare';
    case 'clap':
      return 'clap';
    case 'hatClosed':
    case 'hatPedal':
      return 'closedHat';
    case 'hatOpen':
      return 'openHat';
    case 'tomLow':
    case 'tomMid':
    case 'tomHigh':
      return 'toms';
    case 'crash':
    case 'ride':
    case 'rideBell':
      return 'cymbals';
    default:
      return 'percussion';
  }
}

/** Velocity 0..1 → layer index; layers are ordered soft to hard. */
export function layerFor(velocity: number, layers: number): number {
  return Math.max(0, Math.min(layers - 1, Math.floor(velocity * layers)));
}

interface PieceManifest {
  layers: string[];
  gain: number;
  pan?: number;
}

export interface KitManifest {
  id: SampleKitId;
  name: string;
  pieces: Partial<Record<Piece, PieceManifest>>;
}

export interface LoadedPiece {
  layers: AudioBuffer[];
  gain: number;
  pan: number;
}

export interface LoadedKit {
  id: SampleKitId;
  name: string;
  pieces: Partial<Record<Piece, LoadedPiece>>;
}

/** Changes whenever the kits are rebuilt, so stale cached hits are never mixed in. */
const cache = new SampleCache('drift-kits-', kitsVersion.version);
const fetchCached = (url: string) => cache.fetch(url);

export type KitStatus = { id: SampleKitId; name: string; state: 'loading' | 'ready' | 'error'; error?: string };
const listeners = new Set<(s: KitStatus) => void>();
export function onKitStatus(fn: (s: KitStatus) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const emit = (s: KitStatus) => listeners.forEach((fn) => fn(s));

const loaded = new Map<SampleKitId, Promise<LoadedKit>>();

/** Download (or take from cache) and decode a kit. Concurrent calls share one load. */
export function loadSampleKit(ctx: BaseAudioContext, id: SampleKitId): Promise<LoadedKit> {
  const existing = loaded.get(id);
  if (existing) return existing;
  const name = SAMPLE_KITS.find((k) => k.id === id)?.name ?? id;
  emit({ id, name, state: 'loading' });
  const base = new URL(`${id}/`, samplesBase('kits')).href;
  const p = (async () => {
    const manifest = (await (await fetchCached(base + 'kit.json')).json()) as KitManifest;
    const pieces: LoadedKit['pieces'] = {};
    await Promise.all(
      (Object.entries(manifest.pieces) as [Piece, PieceManifest][]).map(async ([piece, m]) => {
        const layers = await Promise.all(
          m.layers.map(async (file) => ctx.decodeAudioData(await (await fetchCached(base + file)).arrayBuffer())),
        );
        pieces[piece] = { layers, gain: m.gain, pan: m.pan ?? 0 };
      }),
    );
    const kit: LoadedKit = { id, name: manifest.name, pieces };
    emit({ id, name: kit.name, state: 'ready' });
    return kit;
  })();
  p.catch((e: unknown) => {
    loaded.delete(id); // allow a retry
    emit({ id, name, state: 'error', error: e instanceof Error ? e.message : String(e) });
  });
  loaded.set(id, p);
  return p;
}
