import { Chord, type ChordSize } from './chord';
import { mod } from './note';
import { Scale } from './scale';

export interface ProgressionStep {
  /** 0-based scale degree of the chord root. */
  degree: number;
  /** How many bars the chord lasts. */
  bars: number;
  size?: ChordSize;
}

export interface HarmonicMoment {
  scale: Scale;
  chord: Chord;
  /** Index of the current progression step. */
  stepIndex: number;
  /** Bar within the current chord (0-based). */
  barInChord: number;
}

/**
 * The single source of truth for key and chords. Every track asks the
 * harmony what is sounding at a given bar, so all instruments stay in key
 * and on the same chord.
 */
export class Harmony {
  constructor(
    readonly scale: Scale,
    readonly progression: readonly ProgressionStep[],
  ) {
    if (progression.length === 0) throw new Error('Progression needs at least one step');
    if (progression.some((s) => s.bars <= 0)) throw new Error('Progression steps need bars > 0');
  }

  get lengthBars(): number {
    return this.progression.reduce((sum, s) => sum + s.bars, 0);
  }

  at(bar: number): HarmonicMoment {
    let b = mod(Math.floor(bar), this.lengthBars);
    for (let i = 0; i < this.progression.length; i++) {
      const step = this.progression[i]!;
      if (b < step.bars) {
        return {
          scale: this.scale,
          chord: Chord.fromDegree(this.scale, step.degree, step.size ?? 3),
          stepIndex: i,
          barInChord: b,
        };
      }
      b -= step.bars;
    }
    throw new Error('unreachable');
  }

  withProgression(progression: readonly ProgressionStep[]): Harmony {
    return new Harmony(this.scale, progression);
  }

  withScale(scale: Scale): Harmony {
    return new Harmony(scale, this.progression);
  }
}
