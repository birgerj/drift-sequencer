import type { LfoShape } from '../../state/project';

/** Value of an LFO in [0, 1] at a phase in [0, 1). */
export function lfoValue(shape: LfoShape, phase: number, randomSeed = 0): number {
  const p = phase - Math.floor(phase);
  switch (shape) {
    case 'sine':
      return 0.5 - 0.5 * Math.cos(2 * Math.PI * p);
    case 'triangle':
      return p < 0.5 ? p * 2 : 2 - p * 2;
    case 'saw':
      return p;
    case 'square':
      return p < 0.5 ? 1 : 0;
    case 'random': {
      // Sample-and-hold: 8 steps per cycle, deterministic per cycle index.
      const slot = Math.floor(p * 8) + randomSeed * 8;
      const x = Math.sin(slot * 12.9898) * 43758.5453;
      return x - Math.floor(x);
    }
  }
}
