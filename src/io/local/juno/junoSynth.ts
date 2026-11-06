import type * as ToneNS from 'tone';
import { channelCc, norm, type Channel, type Instrument } from '../common';
import workletSource from './junoProcessor.js?raw';
import { JUNO_MSG, JUNO_PROCESSOR, junoDefaultValues, junoParam, type JunoParam } from './junoParams';

/**
 * Juno-60-style polysynth: six voices in one AudioWorkletNode
 * (junoProcessor.js). The worklet is loaded from an inline Blob on first
 * use, so it also works in the single-file build. Notes carry their
 * AudioContext time and start on the exact frame.
 */
export class JunoSynth implements Instrument {
  private node: AudioWorkletNode | undefined;
  private loading: Promise<void> | undefined;
  /** Knob values that arrive while the worklet loads. */
  private pending = new Map<JunoParam, number>();

  constructor(
    private readonly T: typeof ToneNS,
    private readonly ch: Channel,
  ) {}

  /** Load the worklet (once). Resolves also when it fails; the synth then stays silent. */
  load(): Promise<void> {
    this.loading ??= this.start().catch((e: unknown) => {
      console.warn('Drift Synth Juno: AudioWorklet unavailable (needs https or localhost).', e);
    });
    return this.loading;
  }

  private async start(): Promise<void> {
    const options = { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] };
    const ctx = this.T.getContext();
    let node: AudioWorkletNode;
    try {
      // Straight to the context's worklet: Tone's own loader only ever loads one module.
      const worklet = (ctx.rawContext as unknown as BaseAudioContext).audioWorklet;
      if (!worklet) throw new Error('No AudioWorklet');
      // Opened from disk: Blob URLs can't load as worklets (see startNative).
      if (globalThis.origin === 'null') throw new Error('Opaque origin');
      const url = URL.createObjectURL(new Blob([workletSource], { type: 'text/javascript' }));
      try {
        await worklet.addModule(url);
      } finally {
        URL.revokeObjectURL(url);
      }
      node = ctx.createAudioWorkletNode(JUNO_PROCESSOR, options);
      this.T.connect(node, this.ch.out);
    } catch (e) {
      node = await this.startNative(options, e);
    }
    for (const [key, value] of junoDefaultValues()) node.port.postMessage([JUNO_MSG.param, key, value]);
    for (const [key, value] of this.pending) node.port.postMessage([JUNO_MSG.param, key, value]);
    this.pending.clear();
    this.node = node;
  }

  /**
   * Opened from disk (file://), a worklet only loads from a data: URL, while
   * Tone's wrapper (standardized-audio-context) always re-loads it as a Blob.
   * Then go to the native context and gain node underneath instead.
   */
  private async startNative(options: AudioWorkletNodeOptions, cause: unknown): Promise<AudioWorkletNode> {
    const raw = this.T.getContext().rawContext as unknown as { _nativeAudioContext?: BaseAudioContext };
    const native = raw._nativeAudioContext;
    const target = (this.ch.out.input as unknown as { _nativeAudioNode?: AudioNode })._nativeAudioNode;
    if (!native?.audioWorklet || !target || typeof AudioWorkletNode === 'undefined') throw cause;
    await native.audioWorklet.addModule(`data:text/javascript;charset=utf-8,${encodeURIComponent(workletSource)}`);
    const node = new AudioWorkletNode(native, JUNO_PROCESSOR, options);
    node.connect(target);
    // The wrapper mutes a gain node it thinks has no inputs; a silent source keeps it open.
    const keepOpen = this.T.getContext().createConstantSource();
    keepOpen.offset.value = 0;
    keepOpen.connect(this.ch.out.input as unknown as AudioNode);
    keepOpen.start();
    return node;
  }

  noteOn(note: number, velocity: number, time: number) {
    if (!this.node) return void this.load();
    this.node.port.postMessage([JUNO_MSG.noteOn, note, norm(velocity), time]);
  }

  noteOff(note: number, time: number) {
    this.node?.port.postMessage([JUNO_MSG.noteOff, note, 0, time]);
  }

  allOff(time: number) {
    this.node?.port.postMessage([JUNO_MSG.allOff, 0, 0, time]);
  }

  cc(cc: number, value: number) {
    if (channelCc(this.ch, cc, value)) return;
    const param = junoParam(cc, value);
    if (!param) return;
    if (this.node) this.node.port.postMessage([JUNO_MSG.param, param[0], param[1]]);
    else {
      this.pending.set(param[0], param[1]);
      void this.load();
    }
  }
}
