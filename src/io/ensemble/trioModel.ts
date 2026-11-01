import type { TrioNote } from '../../core/ensemble/trio';

/**
 * Magenta's MusicVAE "trio_4bar" model (melody + bass + drums), run in a
 * Web Worker so decoding never blocks the scheduler on the main thread.
 *
 * Nothing is bundled: the worker loads TensorFlow.js and Magenta from a CDN
 * and the checkpoint from Google's bucket, only when the user asks for it.
 * The worker comes from an inline Blob, like the clock worker, so this also
 * works in the single-file build.
 */
export const TRIO_MODEL = {
  tfjs: 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@2.8.6/dist/tf.min.js',
  magenta: 'https://cdn.jsdelivr.net/npm/@magenta/music@1.23.1/es6/music_vae.js',
  checkpoint: 'https://storage.googleapis.com/magentadata/js/checkpoints/music_vae/trio_4bar',
};

const WORKER_SOURCE = `
let model;
let loading;
async function load(m) {
  importScripts(m.tfjs, m.magenta);
  const webgl = await tf.setBackend('webgl').catch(() => false);
  if (!webgl) await tf.setBackend('cpu');
  const vae = new music_vae.MusicVAE(m.checkpoint);
  await vae.initialize();
  model = vae;
}
self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.type === 'load') {
      if (!model) await (loading = loading || load(m));
      self.postMessage({ type: 'loaded', id: m.id, zDims: model.zDims, backend: tf.getBackend() });
    } else if (m.type === 'decode') {
      const z = tf.tensor2d(m.zs);
      const out = await model.decode(z, m.temperature);
      z.dispose();
      const sequences = out.map((ns) =>
        ns.notes.map((n) => {
          const start = n.quantizedStartStep || 0;
          return { pitch: n.pitch, start, end: n.quantizedEndStep || start + 1, instrument: n.instrument || 0, isDrum: !!n.isDrum };
        }),
      );
      self.postMessage({ type: 'decoded', id: m.id, sequences });
    }
  } catch (err) {
    loading = undefined;
    self.postMessage({ type: 'error', id: m.id, message: String((err && err.message) || err) });
  }
};
`;

type Reply =
  | { type: 'loaded'; id: number; zDims: number; backend: string }
  | { type: 'decoded'; id: number; sequences: TrioNote[][] }
  | { type: 'error'; id: number; message: string };

export class TrioModel {
  private worker: Worker | undefined;
  private nextId = 1;
  private waiting = new Map<number, { resolve: (r: Reply) => void; reject: (e: Error) => void }>();
  zDims = 0;
  backend = '';

  constructor(private readonly urls = TRIO_MODEL) {}

  get ready(): boolean {
    return this.zDims > 0;
  }

  async load(): Promise<void> {
    const r = await this.call({ type: 'load', ...this.urls }, 180_000);
    if (r.type !== 'loaded') return;
    this.zDims = r.zDims;
    this.backend = r.backend;
  }

  /** Decode several latent points in one batch (each decode samples, so the same point can sound different). */
  async decode(zs: readonly (readonly number[])[], temperature: number): Promise<TrioNote[][]> {
    for (const z of zs) if (z.length !== this.zDims) throw new Error(`Latent has ${z.length} values, the model expects ${this.zDims}`);
    const r = await this.call({ type: 'decode', zs: zs.map((z) => [...z]), temperature }, 60_000);
    return r.type === 'decoded' ? r.sequences : [];
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = undefined;
    for (const w of this.waiting.values()) w.reject(new Error('Model closed'));
    this.waiting.clear();
    this.zDims = 0;
  }

  private call(message: Record<string, unknown>, timeoutMs: number): Promise<Reply> {
    const worker = this.ensureWorker();
    const id = this.nextId++;
    return new Promise<Reply>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        reject(new Error('The model took too long to answer'));
      }, timeoutMs);
      this.waiting.set(id, {
        resolve: (r) => {
          clearTimeout(timer);
          if (r.type === 'error') reject(new Error(r.message));
          else resolve(r);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      worker.postMessage({ ...message, id });
    });
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' }));
    const worker = new Worker(url);
    URL.revokeObjectURL(url);
    worker.onmessage = (e: MessageEvent<Reply>) => {
      const w = this.waiting.get(e.data.id);
      if (!w) return;
      this.waiting.delete(e.data.id);
      w.resolve(e.data);
    };
    worker.onerror = (e) => {
      const err = new Error(e.message || 'The model worker failed');
      for (const w of this.waiting.values()) w.reject(err);
      this.waiting.clear();
    };
    this.worker = worker;
    return worker;
  }
}
