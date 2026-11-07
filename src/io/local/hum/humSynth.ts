import type * as ToneNS from 'tone';
import type { Channel } from '../common';
import { WorkletSynth } from '../workletSynth';
import workletSource from './humProcessor.js?raw';
import { HUM_PROCESSOR, humDefaultValues, humParam } from './humParams';

/**
 * A sung / hummed voice (formant synthesis): eight voices in one
 * AudioWorkletNode (humProcessor.js), loaded on first use. Each note sings a
 * syllable ("laa", "doo", "pa", "yay" …) picked with the Syllable switch.
 */
export class HumSynth extends WorkletSynth {
  constructor(T: typeof ToneNS, ch: Channel) {
    super(T, ch, {
      label: 'Drift Synth Hum',
      source: workletSource,
      processor: HUM_PROCESSOR,
      param: humParam,
      defaults: humDefaultValues,
    });
  }
}
