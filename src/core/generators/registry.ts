import type { Pattern } from '../pattern/pattern';
import { ArpGenerator, type ArpParams } from './arpGenerator';
import { BassGenerator, type BassParams } from './bassGenerator';
import { ChordGenerator, type ChordParams } from './chordGenerator';
import { DroneGenerator, type DroneParams } from './droneGenerator';
import { DrumGenerator, type DrumParams } from './drumGenerator';
import { MotifGenerator, type MotifParams } from './motifGenerator';
import type { GeneratorContext, TrackType } from './types';

/** A track's generator choice and its parameters, as stored in a project. */
export type GeneratorConfig =
  | { type: 'motif'; params: MotifParams }
  | { type: 'arp'; params: ArpParams }
  | { type: 'bass'; params: BassParams }
  | { type: 'chords'; params: ChordParams }
  | { type: 'drone'; params: DroneParams }
  | { type: 'drums'; params: DrumParams };

const generators = {
  motif: new MotifGenerator(),
  arp: new ArpGenerator(),
  bass: new BassGenerator(),
  chords: new ChordGenerator(),
  drone: new DroneGenerator(),
  drums: new DrumGenerator(),
};

export function defaultConfig(type: TrackType): GeneratorConfig {
  switch (type) {
    case 'motif':
      return { type, params: generators.motif.defaults() };
    case 'arp':
      return { type, params: generators.arp.defaults() };
    case 'bass':
      return { type, params: generators.bass.defaults() };
    case 'chords':
      return { type, params: generators.chords.defaults() };
    case 'drone':
      return { type, params: generators.drone.defaults() };
    case 'drums':
      return { type, params: generators.drums.defaults() };
  }
}

export function generatePattern(config: GeneratorConfig, ctx: GeneratorContext): Pattern {
  switch (config.type) {
    case 'motif':
      return generators.motif.generate(config.params, ctx);
    case 'arp':
      return generators.arp.generate(config.params, ctx);
    case 'bass':
      return generators.bass.generate(config.params, ctx);
    case 'chords':
      return generators.chords.generate(config.params, ctx);
    case 'drone':
      return generators.drone.generate(config.params, ctx);
    case 'drums':
      return generators.drums.generate(config.params, ctx);
  }
}

export function mutatePattern(config: GeneratorConfig, pattern: Pattern, ctx: GeneratorContext): Pattern {
  switch (config.type) {
    case 'motif':
      return generators.motif.mutate(pattern, config.params, ctx);
    case 'arp':
      return generators.arp.mutate(pattern, config.params, ctx);
    case 'bass':
      return generators.bass.mutate(pattern, config.params, ctx);
    case 'chords':
      return generators.chords.mutate(pattern, config.params, ctx);
    case 'drone':
      return generators.drone.mutate(pattern);
    case 'drums':
      return generators.drums.mutate(pattern, config.params, ctx);
  }
}
