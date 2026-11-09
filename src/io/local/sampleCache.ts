/**
 * Downloads for the sample-based Drift Synth sounds (drum kits, piano packs).
 * Files are kept in the browser's Cache Storage under a versioned name, so
 * they work offline and a rebuilt set replaces the cached one.
 */

/** Hosted copy (build-time VITE_PUBLIC_URL), used when Drift runs from a file:// standalone build. */
const PUBLISHED: string = (import.meta.env?.VITE_PUBLIC_URL ?? '').replace(/\/?$/, '/');

/** Base URL of a sample folder (e.g. "kits"), next to the app or on the published site. */
export function samplesBase(folder: string): string {
  if (typeof location !== 'undefined' && location.protocol.startsWith('http')) return new URL(`${folder}/`, document.baseURI).href;
  // No hosted copy configured: relative URL (fails from file://, so those sounds stay unavailable).
  return PUBLISHED === '/' ? `${folder}/` : `${PUBLISHED}${folder}/`;
}

/** A cache for one sample set: `prefix` + version, older versions are removed on first use. */
export class SampleCache {
  private pruned = false;

  constructor(
    private readonly prefix: string,
    private readonly version: string,
  ) {}

  private get name(): string {
    return `${this.prefix}${this.version}`;
  }

  async fetch(url: string): Promise<Response> {
    let cache: Cache | undefined;
    try {
      if (!this.pruned) {
        this.pruned = true;
        for (const k of await caches.keys()) if (k.startsWith(this.prefix) && k !== this.name) await caches.delete(k);
      }
      cache = await caches.open(this.name);
      const hit = await cache.match(url);
      if (hit) return hit;
    } catch {
      cache = undefined; // no Cache Storage (file://, private mode): just download
    }
    const res = await fetch(url);
    // A missing file can come back as the app's index.html (SPA fallback); never cache that.
    if (!res.ok || res.headers.get('content-type')?.includes('text/html')) throw new Error(`Not found: ${url}`);
    if (cache) await cache.put(url, res.clone()).catch(() => undefined);
    return res;
  }
}
