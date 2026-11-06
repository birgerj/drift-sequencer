#!/usr/bin/env node
// Builds Drift Synth Piano's downloadable sample packs from the sources in
// pianos.config.mjs: every zone becomes a trimmed mono FLAC (32 kHz) in
// public/pianos/<id>/, plus a piano.json manifest per pack and
// public/pianos/ATTRIBUTION.md.
//
//   node scripts/pianos/build-pianos.mjs <sources-dir>
//   node scripts/pianos/build-pianos.mjs <sources-dir> --list   # source files it needs
//
// Needs ffmpeg on the PATH.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, basename, join } from 'node:path';
import { PIANOS } from './pianos.config.mjs';

const SR = 32000;
const src = process.argv[2];
if (!src) throw new Error('usage: build-pianos.mjs <sources-dir> [--list]');
const out = 'public/pianos';

/** Reads <region>s from an sfz file: key range, key centre, tune, volume and sample. */
function sfzRegions({ sfz, dir, ext, lovel }) {
  const zones = [];
  let groupLovel = 0;
  for (const raw of readFileSync(join(src, sfz), 'utf8').split(/\r?\n/)) {
    const line = raw.replace(/\/\/.*$/, '').trim();
    const lv = /^lovel=(\d+)/.exec(line);
    if (lv) groupLovel = Number(lv[1]);
    if (!line.startsWith('<region>')) continue;
    if (lovel !== undefined && groupLovel !== lovel) continue;
    const num = (name) => {
      const m = new RegExp(`\\b${name}=(-?[\\d.]+)`).exec(line);
      return m ? Number(m[1]) : undefined;
    };
    // The sample name may hold spaces; it runs up to the next opcode.
    const sample = /\bsample=(.+?)(?=\s+\w+=|$)/.exec(line)?.[1]?.trim().replace('$EXT', ext);
    if (!sample) continue;
    const key = num('pitch_keycenter');
    zones.push({
      lo: num('lokey') ?? key,
      hi: num('hikey') ?? key,
      key,
      tune: num('tune') ?? 0,
      volume: num('volume') ?? 0,
      file: join(dir, sample),
    });
  }
  if (zones.length === 0) throw new Error(`no regions in ${sfz}`);
  return zones.sort((a, b) => a.lo - b.lo);
}

/** The file as it is on disk; sfz files don't always match the case of the sample names. */
function onDisk(rel) {
  if (existsSync(join(src, rel))) return rel;
  const d = dirname(rel);
  const want = basename(rel).toLowerCase();
  const hit = readdirSync(join(src, d)).find((f) => f.toLowerCase() === want);
  if (!hit) throw new Error(`missing ${rel}`);
  return join(d, hit);
}

/**
 * Keeps zones at least `spacing` semitones apart (a sample stretched ±1–2
 * semitones still sounds natural) and gives each kept zone the keys halfway
 * to its neighbours, so the whole keyboard stays covered.
 */
function thin(zones, spacing) {
  const kept = [];
  for (const z of zones) if (!kept.length || z.key - kept.at(-1).key >= spacing) kept.push(z);
  return kept.map((z, i) => ({
    ...z,
    lo: i === 0 ? Math.min(z.lo, 21) : Math.floor((kept[i - 1].key + z.key) / 2) + 1,
    hi: i === kept.length - 1 ? Math.max(z.hi, 108) : Math.floor((z.key + kept[i + 1].key) / 2),
  }));
}

const layersOf = (piano) =>
  piano.layers.map((l) => {
    const zones = (l.zones ?? sfzRegions(l.regions)).map((z) => ({ tune: 0, volume: 0, ...z }));
    return { hivel: l.hivel, zones: thin(zones, piano.spacing ?? 3) };
  });

if (process.argv.includes('--list')) {
  const files = new Set();
  for (const p of PIANOS) for (const l of layersOf(p)) for (const z of l.zones) files.add(z.file);
  console.log([...files].join('\n'));
  process.exit(0);
}

function decode(path) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', path, '-f', 'f32le', '-ac', '1', '-ar', String(SR), '-'], { maxBuffer: 1 << 29 });
  if (r.status !== 0) throw new Error(`ffmpeg failed on ${path}: ${r.stderr}`);
  const b = r.stdout;
  return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4).slice();
}

const peakOf = (a) => a.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
const rmsOf = (a, seconds = 0.5) => {
  const n = Math.min(a.length, Math.round(seconds * SR));
  let s = 0;
  for (let i = 0; i < n; i++) s += a[i] * a[i];
  return Math.sqrt(s / Math.max(1, n));
};

/** How long a note may ring: low notes longer, high notes die out sooner anyway. */
const maxSecondsFor = (key) => (key < 40 ? 5.5 : key < 60 ? 4.5 : key < 80 ? 3.2 : 2);

/** Drop leading silence, cut the tail below -60 dB, cap the length, fade out. */
function trim(a, maxSeconds) {
  const pk = peakOf(a) || 1;
  let start = 0;
  while (start < a.length && Math.abs(a[start]) < pk * 0.004) start++;
  start = Math.max(0, start - 8);
  let end = a.length - 1;
  while (end > start && Math.abs(a[end]) < pk * 0.001) end--;
  end = Math.min(a.length, end + 1, start + Math.round(maxSeconds * SR));
  const o = a.slice(start, end);
  const fade = Math.min(o.length, Math.round(0.4 * SR));
  for (let i = 0; i < fade; i++) o[o.length - 1 - i] *= (i / fade) ** 2;
  return o;
}

function encode(samples, path) {
  const r = spawnSync(
    'ffmpeg',
    ['-v', 'error', '-y', '-f', 'f32le', '-ac', '1', '-ar', String(SR), '-i', '-', '-sample_fmt', 's16', '-compression_level', '8', path],
    { input: Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength) },
  );
  if (r.status !== 0) throw new Error(`encode failed: ${r.stderr}`);
}

rmSync(out, { recursive: true, force: true });
const hash = createHash('sha256');
const credits = [];
const loudness = [];
let total = 0;
for (const piano of PIANOS) {
  const dir = join(out, piano.id);
  mkdirSync(dir, { recursive: true });
  const layers = layersOf(piano).map((l, li) => ({
    hivel: l.hivel,
    zones: l.zones.map((z) => ({ ...z, audio: trim(decode(join(src, onDisk(z.file))), maxSecondsFor(z.key)), name: `${li + 1}-${z.key}.flac` })),
  }));
  // One gain for the whole pack, so soft layers stay soft and the keyboard stays even.
  const pk = Math.max(...layers.flatMap((l) => l.zones.map((z) => peakOf(z.audio) * 10 ** (z.volume / 20)))) || 1;
  let bytes = 0;
  const manifestLayers = layers.map((l) => ({
    hivel: l.hivel,
    zones: l.zones.map((z) => {
      const g = (10 ** (z.volume / 20) / pk) * 0.97;
      for (let i = 0; i < z.audio.length; i++) z.audio[i] *= g;
      encode(z.audio, join(dir, z.name));
      bytes += statSync(join(dir, z.name)).size;
      hash.update(readFileSync(join(dir, z.name)));
      return { lo: z.lo, hi: z.hi, key: z.key, ...(z.tune ? { tune: z.tune } : {}), file: z.name };
    }),
  }));
  // Even out loudness between packs: the hard layer around middle C.
  const hard = layers.at(-1).zones.filter((z) => z.key >= 54 && z.key <= 70);
  const level = hard.reduce((s, z) => s + rmsOf(z.audio), 0) / Math.max(1, hard.length);
  loudness.push({ piano, level });
  const { layers: _l, ...meta } = piano;
  piano.manifest = { ...meta, layers: manifestLayers };
  credits.push(
    `## ${piano.name} (\`${piano.id}/\`)\n\n- ${piano.description}\n- Source: ${piano.source}\n- License: [${piano.license}](${piano.licenseUrl})\n- Changes: two velocity layers selected, mixed to mono, resampled to 32 kHz, trimmed with a fade-out and normalised.\n`,
  );
  total += bytes;
  console.log(`${piano.id}: ${manifestLayers.map((l) => l.zones.length).join('+')} zones, ${(bytes / 1048576).toFixed(2)} MB`);
}
const target = Math.min(...loudness.map((l) => l.level));
for (const { piano, level } of loudness) {
  const json = JSON.stringify({ ...piano.manifest, gain: +(target / level).toFixed(3) }, null, 2) + '\n';
  hash.update(json);
  writeFileSync(join(out, piano.id, 'piano.json'), json);
}
writeFileSync(
  join(out, 'ATTRIBUTION.md'),
  `# Piano sample packs\n\nDrift downloads these packs on demand when you pick one on Drift Synth Piano.\nBuilt by \`scripts/pianos/build-pianos.mjs\`.\n\nThe samples keep their own licenses, listed per pack. Music you make with\nthem is yours.\n\n${credits.join('\n')}`,
);
// The app keys its download cache on this, so rebuilt packs replace cached ones.
writeFileSync('src/io/local/pianosVersion.json', JSON.stringify({ version: hash.digest('hex').slice(0, 12) }) + '\n');
console.log(`total ${(total / 1048576).toFixed(2)} MB`);
