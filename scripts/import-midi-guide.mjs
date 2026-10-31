#!/usr/bin/env node
// Converts midi.guide CSVs (https://github.com/pencilresearch/midi, CC BY-SA 4.0)
// into InstrumentDefinition JSON for src/core/instruments/data/.
//
// Usage: node scripts/import-midi-guide.mjs <path/to/Device.csv> [out-dir]
// A sibling <Device>.triggers.csv is picked up automatically when present.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows;
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

const num = (s) => (s === '' || s === undefined ? undefined : Number(s));
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const csvPath = process.argv[2];
const outDir = process.argv[3] ?? 'src/core/instruments/data';
if (!csvPath) {
  console.error('Usage: node scripts/import-midi-guide.mjs <Device.csv> [out-dir]');
  process.exit(1);
}

const rows = parseCsv(readFileSync(csvPath, 'utf8'));
const first = rows[0];
const params = rows.map((r) => {
  const cc = num(r.cc_msb);
  const msg = cc !== undefined
    ? { type: 'cc', cc, ...(num(r.cc_lsb) !== undefined ? { lsb: num(r.cc_lsb) } : {}) }
    : { type: 'nrpn', msb: num(r.nrpn_msb), lsb: num(r.nrpn_lsb) };
  const min = num(cc !== undefined ? r.cc_min_value : r.nrpn_min_value) ?? 0;
  const max = num(cc !== undefined ? r.cc_max_value : r.nrpn_max_value) ?? 127;
  const def = num(cc !== undefined ? r.cc_default_value : r.nrpn_default_value);
  return {
    id: slug(`${r.section} ${r.parameter_name}`),
    name: r.parameter_name,
    ...(r.section ? { section: r.section } : {}),
    msg,
    min,
    max,
    ...(def !== undefined ? { default: def } : {}),
    bipolar: r.orientation === 'centered',
    ...(r.usage ? { usage: r.usage } : {}),
  };
});

const triggersPath = csvPath.replace(/\.csv$/, '.triggers.csv');
const triggers = existsSync(triggersPath)
  ? parseCsv(readFileSync(triggersPath, 'utf8')).map((t) => ({
      name: t.sound_name,
      note: num(t.note_number_default_value),
      ...(num(t.midi_channel) !== undefined ? { channel: num(t.midi_channel) } : {}),
      ...(t.section ? { map: t.section } : {}),
    }))
  : [];

const channels = triggers.map((t) => t.channel).filter((c) => c !== undefined);
const definition = {
  id: slug(`${first.manufacturer} ${first.device}`),
  manufacturer: first.manufacturer,
  device: first.device,
  ...(channels.length ? { defaultChannel: channels[0] } : {}),
  params,
  triggers,
  source: 'midi.guide (github.com/pencilresearch/midi), CC BY-SA 4.0',
};

mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, `${definition.id}.json`);
writeFileSync(outFile, JSON.stringify(definition, null, 2) + '\n');
console.log(`Wrote ${outFile} (${params.length} params, ${triggers.length} triggers) from ${basename(dirname(csvPath))}/${basename(csvPath)}`);
