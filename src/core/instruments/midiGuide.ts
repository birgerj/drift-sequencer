import type { InstrumentDefinition, InstrumentParam, InstrumentTrigger } from './instrument';

/**
 * Converts midi.guide CSVs (github.com/pencilresearch/midi, CC BY-SA 4.0)
 * into an InstrumentDefinition. Used both by the in-app importer and by
 * scripts/import-midi-guide.ts. Keep this file free of runtime imports so
 * Node can run it directly with type stripping.
 */

export const MIDI_GUIDE_SOURCE = 'midi.guide (github.com/pencilresearch/midi), CC BY-SA 4.0';

/** RFC 4180-ish CSV parser: quoted fields, escaped quotes, CRLF. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    if (row.some((f) => f !== '')) rows.push(row);
  }
  const [header, ...body] = rows;
  if (!header) return [];
  const keys = header.map((h) => h.trim());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));
}

const num = (s: string | undefined): number | undefined => {
  if (s === undefined || s === '') return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
};

export const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** True for a parameter CSV; false for a `.triggers.csv` note map. */
export function isTriggerCsv(rows: Record<string, string>[]): boolean {
  return rows.length > 0 && 'sound_name' in rows[0]!;
}

/**
 * Best-guess musical role from a parameter's name, so LFOs and knobs can
 * target "filter cutoff" on any synth. midi.guide has no standard roles.
 * Only the first matching parameter per section matters for defaults.
 */
const TARGET_RULES: [RegExp, NonNullable<InstrumentParam['target']>][] = [
  [/cut-?off|filter (freq|frequency)|\bfreq(uency)?\b.*filter/i, 'filterCutoff'],
  [/reson|\bres\b|emphasis|\bq\b/i, 'filterResonance'],
  [/lfo.*(rate|speed|freq)/i, 'lfoRate'],
  [/lfo.*(depth|amount|amt|gain|int)/i, 'lfoDepth'],
  [/attack/i, 'envAttack'],
  [/decay/i, 'envDecay'],
  [/release/i, 'envRelease'],
  [/\btun(e|ing)\b|pitch/i, 'tune'],
  [/^(?!.*accent).*(\blevel\b|volume)/i, 'level'],
  [/delay|reverb|chorus|overdrive|drive|distortion/i, 'fx'],
];

export function guessTarget(name: string): InstrumentParam['target'] | undefined {
  return TARGET_RULES.find(([re]) => re.test(name))?.[1];
}

export function convertMidiGuide(paramsCsv: string, triggersCsv?: string): InstrumentDefinition {
  const rows = parseCsv(paramsCsv);
  if (rows.length === 0) throw new Error('The CSV file has no rows.');
  if (isTriggerCsv(rows)) throw new Error('This is a triggers file; import the device CSV (it may include the triggers file).');
  const first = rows[0]!;
  if (!('parameter_name' in first) || !('manufacturer' in first)) {
    throw new Error('Not a midi.guide CSV (missing manufacturer / parameter_name columns).');
  }

  const params: InstrumentParam[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const cc = num(r.cc_msb);
    const nrpnMsb = num(r.nrpn_msb);
    const nrpnLsb = num(r.nrpn_lsb);
    let msg: InstrumentParam['msg'];
    if (cc !== undefined) {
      const lsb = num(r.cc_lsb);
      msg = lsb !== undefined ? { type: 'cc', cc, lsb } : { type: 'cc', cc };
    } else if (nrpnMsb !== undefined && nrpnLsb !== undefined) {
      msg = { type: 'nrpn', msb: nrpnMsb, lsb: nrpnLsb };
    } else continue; // no addressable message

    const isCc = msg.type === 'cc';
    let id = slug(`${r.section ?? ''} ${r.parameter_name ?? ''}`) || `param-${params.length}`;
    while (seen.has(id)) id += '-2';
    seen.add(id);

    const param: InstrumentParam = {
      id,
      name: r.parameter_name ?? id,
      msg,
      min: num(isCc ? r.cc_min_value : r.nrpn_min_value) ?? 0,
      max: num(isCc ? r.cc_max_value : r.nrpn_max_value) ?? (isCc ? 127 : 16383),
      bipolar: r.orientation === 'centered',
    };
    const def = num(isCc ? r.cc_default_value : r.nrpn_default_value);
    if (def !== undefined) param.default = def;
    if (r.section) param.section = r.section;
    if (r.usage) param.usage = r.usage;
    const target = guessTarget(`${r.section ?? ''} ${param.name}`);
    if (target) param.target = target;
    params.push(param);
  }

  const triggers: InstrumentTrigger[] = [];
  if (triggersCsv) {
    for (const t of parseCsv(triggersCsv)) {
      const note = num(t.note_number_default_value) ?? num(t.note_number_min_value);
      if (note === undefined) continue;
      const trigger: InstrumentTrigger = { name: t.sound_name ?? `Note ${note}`, note };
      const ch = num(t.midi_channel);
      if (ch !== undefined) trigger.channel = ch;
      if (t.section) trigger.map = t.section;
      triggers.push(trigger);
    }
  }

  const manufacturer = first.manufacturer ?? 'Unknown';
  const device = first.device ?? 'Device';
  const defaultChannel = triggers.find((t) => t.channel !== undefined)?.channel;
  const definition: InstrumentDefinition = {
    id: slug(`${manufacturer} ${device}`),
    manufacturer,
    device,
    params,
    triggers,
    source: MIDI_GUIDE_SOURCE,
  };
  if (defaultChannel !== undefined) definition.defaultChannel = defaultChannel;
  return definition;
}
