#!/usr/bin/env node
// Bundle a midi.guide device as a built-in instrument definition.
// Usage: node scripts/import-midi-guide.ts <path/to/Device.csv> [out-dir]
// A sibling <Device>.triggers.csv is picked up automatically when present.
// (Users can also import definitions from inside the running app.)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { convertMidiGuide } from '../src/core/instruments/midiGuide.ts';

const csvPath = process.argv[2];
const outDir = process.argv[3] ?? 'src/core/instruments/data';
if (!csvPath) {
  console.error('Usage: node scripts/import-midi-guide.ts <Device.csv> [out-dir]');
  process.exit(1);
}

const triggersPath = csvPath.replace(/\.csv$/, '.triggers.csv');
const definition = convertMidiGuide(
  readFileSync(csvPath, 'utf8'),
  existsSync(triggersPath) ? readFileSync(triggersPath, 'utf8') : undefined,
);

mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, `${definition.id}.json`);
writeFileSync(outFile, JSON.stringify(definition, null, 2) + '\n');
console.log(`Wrote ${outFile} (${definition.params.length} params, ${definition.triggers.length} triggers)`);
