import type { Rng } from '../random/rng';
import type { Pattern } from '../pattern/pattern';

export type TrackType = 'motif' | 'arp' | 'bass' | 'chords' | 'drone' | 'drums';

export interface GeneratorContext {
  rng: Rng;
  stepsPerBar: number;
}

/**
 * A generator turns parameters into a chord-relative pattern and can mutate
 * an existing pattern a little, so music evolves without losing identity.
 */
export interface PatternGenerator<P> {
  readonly type: TrackType;
  defaults(): P;
  generate(params: P, ctx: GeneratorContext): Pattern;
  mutate(pattern: Pattern, params: P, ctx: GeneratorContext): Pattern;
}

/** Shared knobs every melodic generator understands. */
export interface CommonParams {
  lengthSteps: number;
  /** 0..1 — how much of the pattern changes on each mutation. */
  mutation: number;
  velocity: number;
  /** 0..1 — random spread around `velocity`. */
  velocityVariation: number;
}

export function humanizeVelocity(base: number, variation: number, rng: Rng, accent = 0): number {
  const spread = 40 * variation;
  const v = base + accent + (rng.next() * 2 - 1) * spread;
  return Math.max(1, Math.min(127, Math.round(v)));
}

export function isStrongStep(step: number, stepsPerBar: number): boolean {
  const beat = stepsPerBar / 4;
  return step % beat === 0;
}
