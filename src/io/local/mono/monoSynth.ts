import type * as ToneNS from 'tone';
import type { Channel } from '../common';
import { WorkletSynth } from '../workletSynth';
import workletSource from './monoProcessor.js?raw';
import { MONO_PROCESSOR, monoDefaultValues, monoParam } from './monoParams';

/**
 * Monophonic bass/lead synth (Minimoog / SH-101 style) in one
 * AudioWorkletNode (monoProcessor.js), loaded on first use.
 */
export class MonoSynth extends WorkletSynth {
  constructor(T: typeof ToneNS, ch: Channel) {
    super(T, ch, {
      label: 'Drift Synth Mono',
      source: workletSource,
      processor: MONO_PROCESSOR,
      param: monoParam,
      defaults: monoDefaultValues,
    });
  }
}
