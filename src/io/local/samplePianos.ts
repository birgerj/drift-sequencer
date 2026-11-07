/**
 * Sample packs for Drift Synth Piano. They are not bundled: picking one
 * with the Pack knob downloads its FLAC zones (1–4 MB) from pianos/<id>/,
 * keeps them in the browser's Cache Storage and decodes them for playback.
 * See public/pianos/ATTRIBUTION.md for sources and licenses.
 */

import pianosVersion from './pianosVersion.json';
import { SampleCache, samplesBase } from './sampleCache';

export type PianoPackId = 'grand' | 'steinway' | 'studio' | 'wurli';

export const PIANO_PACKS: { id: PianoPackId; name: string }[] = [
  { id: 'grand', name: 'Concert Grand' },
  { id: 'steinway', name: 'Steinway' },
  { id: 'studio', name: 'Studio Grand' },
  { id: 'wurli', name: 'Wurlitzer' },
];

/** Pack knob value (0–127) → pack, in four equal bands. */
export function pianoPackFromCc(value: number): PianoPackId {
  const v = Math.max(0, Math.min(127, value));
  return PIANO_PACKS[Math.min(PIANO_PACKS.length - 1, Math.floor((v * PIANO_PACKS.length) / 128))]!.id;
}

/** A sample and the keys it plays: `key` is its own pitch, `tune` a correction in cents. */
export interface PianoZone<B = string> {
  lo: number;
  hi: number;
  key: number;
  tune?: number;
  file: B;
}

export interface PianoLayer<B = string> {
  /** Highest MIDI velocity (1–127) this layer plays; layers go soft to hard. */
  hivel: number;
  zones: PianoZone<B>[];
}

export interface PianoManifest {
  id: PianoPackId;
  name: string;
  gain: number;
  layers: PianoLayer[];
}

export interface LoadedPiano {
  id: PianoPackId;
  name: string;
  gain: number;
  layers: PianoLayer<AudioBuffer>[];
}

/** The layer for a velocity 0..1: the first whose upper velocity it doesn't exceed. */
export function pianoLayerFor<B>(layers: PianoLayer<B>[], velocity: number): PianoLayer<B> {
  const v = Math.max(1, Math.round(velocity * 127));
  return layers.find((l) => v <= l.hivel) ?? layers[layers.length - 1]!;
}

/** The zone that plays a note: the one whose range holds it, else the nearest sample. */
export function pianoZoneFor<B>(layer: PianoLayer<B>, note: number): PianoZone<B> {
  const hit = layer.zones.find((z) => note >= z.lo && note <= z.hi);
  if (hit) return hit;
  return layer.zones.reduce((best, z) => (Math.abs(z.key - note) < Math.abs(best.key - note) ? z : best));
}

/** Playback rate for a note on a zone's sample. */
export function pianoRate(zone: PianoZone<unknown>, note: number): number {
  return Math.pow(2, (note - zone.key - (zone.tune ?? 0) / 100) / 12);
}

const cache = new SampleCache('drift-pianos-', pianosVersion.version);

export type PianoStatus = { id: PianoPackId; name: string; state: 'loading' | 'ready' | 'error'; error?: string };
const listeners = new Set<(s: PianoStatus) => void>();
export function onPianoStatus(fn: (s: PianoStatus) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const emit = (s: PianoStatus) => listeners.forEach((fn) => fn(s));

const loaded = new Map<PianoPackId, Promise<LoadedPiano>>();

/** Download (or take from cache) and decode a pack. Concurrent calls share one load. */
export function loadPianoPack(ctx: BaseAudioContext, id: PianoPackId): Promise<LoadedPiano> {
  const existing = loaded.get(id);
  if (existing) return existing;
  const name = PIANO_PACKS.find((p) => p.id === id)?.name ?? id;
  emit({ id, name, state: 'loading' });
  const base = new URL(`${id}/`, samplesBase('pianos')).href;
  const p = (async () => {
    const manifest = (await (await cache.fetch(base + 'piano.json')).json()) as PianoManifest;
    // Layers share no files, but a file may serve several zones: decode each once.
    const buffers = new Map<string, Promise<AudioBuffer>>();
    const buffer = (file: string) => {
      let b = buffers.get(file);
      if (!b) {
        b = cache.fetch(base + file).then(async (r) => ctx.decodeAudioData(await r.arrayBuffer()));
        buffers.set(file, b);
      }
      return b;
    };
    const layers = await Promise.all(
      manifest.layers.map(async (l) => ({
        hivel: l.hivel,
        zones: await Promise.all(l.zones.map(async (z) => ({ ...z, file: await buffer(z.file) }))),
      })),
    );
    const piano: LoadedPiano = { id, name: manifest.name, gain: manifest.gain, layers };
    emit({ id, name: piano.name, state: 'ready' });
    return piano;
  })();
  p.catch((e: unknown) => {
    loaded.delete(id); // allow a retry
    emit({ id, name, state: 'error', error: e instanceof Error ? e.message : String(e) });
  });
  loaded.set(id, p);
  return p;
}
