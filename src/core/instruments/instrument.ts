/**
 * Instrument definitions: which CCs/NRPNs a device responds to and which
 * notes trigger its drum voices. Shape follows the midi.guide CSV columns
 * (github.com/pencilresearch/midi) so its data imports directly.
 */
export interface InstrumentDefinition {
  id: string;
  manufacturer: string;
  device: string;
  defaultChannel?: number;
  params: InstrumentParam[];
  triggers: InstrumentTrigger[];
  /** Ready-made sounds for the knob panel. */
  presets?: InstrumentPreset[];
  /** Attribution for third-party data. */
  source?: string;
}

/** Common musical roles, so a modulation can target "filterCutoff" on any synth. */
export type ParamTarget =
  | 'filterCutoff'
  | 'filterResonance'
  | 'lfoRate'
  | 'lfoDepth'
  | 'envAttack'
  | 'envDecay'
  | 'envRelease'
  | 'tune'
  | 'level'
  | 'fx';

/** A named set of knob values; knobs it leaves out go to their default. */
export interface InstrumentPreset {
  name: string;
  /** Param id → value. */
  values: Record<string, number>;
}

/** Every CC knob's value (by CC number) for a preset: its own value, else the knob's default. */
export function presetCcValues(instrument: InstrumentDefinition, preset: InstrumentPreset): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of instrument.params) {
    if (p.msg.type !== 'cc' || p.msg.lsb !== undefined) continue;
    const v = preset.values[p.id] ?? p.default;
    if (v !== undefined) out[p.msg.cc] = Math.max(p.min, Math.min(p.max, Math.round(v)));
  }
  return out;
}

export interface InstrumentParam {
  id: string;
  name: string;
  section?: string;
  /** Set by hand for devices you own; midi.guide has no standard roles. */
  target?: ParamTarget;
  msg: { type: 'cc'; cc: number; lsb?: number } | { type: 'nrpn'; msb: number; lsb: number };
  min: number;
  max: number;
  default?: number;
  bipolar: boolean;
  usage?: string;
  /** Named value bands for stepped knobs (kit pickers): each label covers values up to `upTo`. */
  choices?: { upTo: number; label: string }[];
}

/** The label of the band a value falls in, for knobs that pick from a list. */
export function choiceLabel(param: InstrumentParam, value: number): string | undefined {
  return param.choices?.find((c) => value <= c.upTo)?.label;
}

export interface InstrumentTrigger {
  name: string;
  note: number;
  channel?: number;
  map?: string;
}

export function findParam(def: InstrumentDefinition, name: string): InstrumentParam | undefined {
  const n = name.toLowerCase();
  return def.params.find((p) => p.name.toLowerCase() === n || p.id === n);
}

export function paramsByTarget(def: InstrumentDefinition, target: ParamTarget): InstrumentParam[] {
  return def.params.filter((p) => p.target === target);
}
