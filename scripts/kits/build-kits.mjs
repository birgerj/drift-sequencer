#!/usr/bin/env node
// Builds Drift's downloadable drum kits from the sources in kits.config.mjs:
// every layer becomes a trimmed, peak-normalised mono FLAC in public/kits/<id>/,
// plus a kit.json manifest per kit and public/kits/ATTRIBUTION.md.
//
//   node scripts/kits/build-kits.mjs <sources-dir>
//
// Needs ffmpeg on the PATH.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { KITS } from './kits.config.mjs';

const SR = 44100;
const src = process.argv[2];
if (!src) throw new Error('usage: build-kits.mjs <sources-dir>');
const out = 'public/kits';

const CYMBALS = new Set(['crash', 'ride', 'rideBell', 'hatOpen']);

function decode(path) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', path, '-f', 'f32le', '-ac', '1', '-ar', String(SR), '-'], { maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`ffmpeg failed on ${path}: ${r.stderr}`);
  const b = r.stdout;
  return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4).slice();
}

function mix(paths) {
  const parts = paths.map((p) => decode(join(src, p)));
  const n = Math.max(...parts.map((p) => p.length));
  const acc = new Float32Array(n);
  for (const p of parts) for (let i = 0; i < p.length; i++) acc[i] += p[i];
  return acc;
}

const peakOf = (a) => a.reduce((m, x) => Math.max(m, Math.abs(x)), 0);

/** Drop leading silence, cut the tail below -60 dB of peak, short fade-out. */
function trim(a, maxSeconds) {
  const pk = peakOf(a) || 1;
  const floor = pk * 0.001;
  let start = 0;
  while (start < a.length && Math.abs(a[start]) < pk * 0.003) start++;
  start = Math.max(0, start - 16);
  let end = a.length - 1;
  while (end > start && Math.abs(a[end]) < floor) end--;
  end = Math.min(a.length, end + Math.round(0.01 * SR), start + Math.round(maxSeconds * SR));
  const o = a.slice(start, end);
  const fade = Math.min(o.length, Math.round(0.03 * SR));
  for (let i = 0; i < fade; i++) o[o.length - 1 - i] *= i / fade;
  return o;
}

function encode(samples, path) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'f32le', '-ac', '1', '-ar', String(SR), '-i', '-', '-sample_fmt', 's16', '-compression_level', '8', path], {
    input: Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength),
  });
  if (r.status !== 0) throw new Error(`encode failed: ${r.stderr}`);
}

rmSync(out, { recursive: true, force: true });
let total = 0;
const hash = createHash('sha256');
const credits = [];
for (const kit of KITS) {
  const dir = join(out, kit.id);
  mkdirSync(dir, { recursive: true });
  const pieces = {};
  let kitBytes = 0;
  for (const [name, piece] of Object.entries(kit.pieces)) {
    const maxSeconds = piece.maxSeconds ?? (CYMBALS.has(name) ? 3 : 1.6);
    const layers = piece.layers.map((paths) => trim(mix(paths), maxSeconds));
    // Normalise the piece as a whole so softer layers stay softer.
    const pk = Math.max(...layers.map(peakOf)) || 1;
    const files = layers.map((l, i) => {
      for (let j = 0; j < l.length; j++) l[j] = (l[j] / pk) * 0.97;
      const file = `${name}-${i + 1}.flac`;
      encode(l, join(dir, file));
      kitBytes += statSync(join(dir, file)).size;
      hash.update(readFileSync(join(dir, file)));
      return file;
    });
    pieces[name] = { layers: files, gain: +((piece.gain ?? 1) * (kit.kitGain ?? 1)).toFixed(3), ...(piece.pan ? { pan: piece.pan } : {}) };
  }
  const manifest = { id: kit.id, name: kit.name, description: kit.description, source: kit.source, license: kit.license, licenseUrl: kit.licenseUrl, pieces };
  const json = JSON.stringify(manifest, null, 2) + '\n';
  hash.update(json);
  writeFileSync(join(dir, 'kit.json'), json);
  credits.push(`## ${kit.name} (\`${kit.id}/\`)\n\n- Source: ${kit.source}\n- License: [${kit.license}](${kit.licenseUrl})\n- Changes: selected hits, mixed to mono, trimmed and normalised.\n`);
  total += kitBytes;
  console.log(`${kit.id}: ${Object.keys(pieces).length} pieces, ${(kitBytes / 1048576).toFixed(2)} MB`);
}
writeFileSync(
  join(out, 'ATTRIBUTION.md'),
  `# Sampled drum kits\n\nDrift downloads these kits on demand when you pick one with the *Samples* knob\non Drift Synth Drums. Built by \`scripts/kits/build-kits.mjs\`.\n\nThe samples keep their own licenses, listed per kit. Kits under CC BY-SA are\nshared under the same license as modified sample sets. Music you make with\nthem is yours.\n\n${credits.join('\n')}`,
);
// The app keys its download cache on this, so rebuilt kits replace cached ones.
writeFileSync('src/io/local/kitsVersion.json', JSON.stringify({ version: hash.digest('hex').slice(0, 12) }) + '\n');
console.log(`total ${(total / 1048576).toFixed(2)} MB`);
