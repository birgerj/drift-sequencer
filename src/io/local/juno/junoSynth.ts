import type * as ToneNS from 'tone';
import type { Channel } from '../common';
import { WorkletSynth } from '../workletSynth';
import workletSource from './junoProcessor.js?raw';
import { JUNO_PROCESSOR, junoDefaultValues, junoParam } from './junoParams';

/**
 * Juno-60-style polysynth: six voices in one AudioWorkletNode
 * (junoProcessor.js), loaded on first use.
 */
export class JunoSynth extends WorkletSynth {
  constructor(T: typeof ToneNS, ch: Channel) {
    super(T, ch, {
      label: 'Drift Synth Juno',
      source: workletSource,
      processor: JUNO_PROCESSOR,
      param: junoParam,
      defaults: junoDefaultValues,
    });
  }
}
