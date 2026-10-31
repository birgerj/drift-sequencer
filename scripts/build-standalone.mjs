#!/usr/bin/env node
// Builds Drift as ONE self-contained HTML file (JS, CSS and icon inlined) in
// docs/index.html. It runs by double-clicking it (file://), from any static
// host, or from GitHub Pages ("Deploy from a branch" → /docs).

import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'vite';

const tmp = '.standalone-build';
const outFile = 'docs/index.html';

await build({
  logLevel: 'warn',
  build: {
    outDir: tmp,
    emptyOutDir: true,
    modulePreload: false,
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    rolldownOptions: { output: { codeSplitting: false } },
  },
});

const assets = join(tmp, 'assets');
const files = readdirSync(assets);
const read = (f) => readFileSync(join(assets, f), 'utf8');
let html = readFileSync(join(tmp, 'index.html'), 'utf8');

// Inline the stylesheet.
html = html.replace(/<link rel="stylesheet"[^>]*href="\.\/assets\/([^"]+\.css)"[^>]*>/g, (_, f) => `<style>\n${read(f)}\n</style>`);

// Inline the script. An inline module script works from file:// (only
// external module files are blocked there).
html = html.replace(/<script type="module"[^>]*src="\.\/assets\/([^"]+\.js)"[^>]*><\/script>/g, (_, f) => {
  const code = read(f).replace(/<\/script/gi, '<\\/script');
  return `<script type="module">\n${code}\n</script>`;
});

// Inline the favicon.
const icon = readFileSync(join(tmp, 'favicon.svg'), 'utf8');
html = html.replace(/href="\.\/favicon\.svg"/, `href="data:image/svg+xml,${encodeURIComponent(icon)}"`);

if (/\.\/assets\//.test(html)) throw new Error('Some assets were not inlined: ' + files.join(', '));

mkdirSync('docs', { recursive: true });
writeFileSync(outFile, html);
writeFileSync('docs/.nojekyll', '');

// PWA files (manifest, icons, service worker) sit next to index.html. They are
// only used when served over https (GitHub Pages); opening the file from disk
// ignores them. The service worker's cache name changes with every build.
const version = createHash('sha256').update(html).digest('hex').slice(0, 12);
for (const entry of readdirSync(tmp)) {
  if (entry === 'index.html' || entry === 'assets') continue;
  const from = join(tmp, entry);
  const to = join('docs', entry);
  if (entry === 'sw.js') writeFileSync(to, readFileSync(from, 'utf8').replace("'__BUILD__'", `'${version}'`));
  else cpSync(from, to, { recursive: true });
}
rmSync(tmp, { recursive: true, force: true });
console.log(`Wrote ${outFile} (${Math.round(html.length / 1024)} kB) — open it directly in Chrome or Edge.`);
