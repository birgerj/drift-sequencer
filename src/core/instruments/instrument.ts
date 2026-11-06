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
  /** Hand-made panel layout; without one the panel shows paged knobs. */
  panel?: PanelModule[];
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
  /** Shorter label for compact panels; `name` stays the accessible name. */
  short?: string;
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

/**
 * One section of a hand-made panel. Widgets name params by id; each kind
 * suits a kind of parameter: switches for stepped choices, faders for
 * mixer levels, an XY pad for cutoff × resonance, an envelope graph.
 */
export interface PanelModule {
  title: string;
  /** Takes about twice the width of a normal module. */
  wide?: boolean;
  widgets: PanelWidget[];
}

export type PanelWidget =
  | { kind: 'knobs'; params: string[] }
  /** Segmented buttons from the param's `choices`. */
  | { kind: 'switch'; param: string }
  /** Vertical faders side by side, like a mixer. */
  | { kind: 'faders'; params: string[] }
  /** Horizontal sliders, for levels and sends. */
  | { kind: 'sliders'; params: string[] }
  /** Drag a point: x and y each drive a param. Drawn as a filter response. */
  | { kind: 'xy'; x: string; y: string }
  /** Envelope graph with draggable points. A missing sustain uses `sustainLevel` (0–1). */
  | { kind: 'adsr'; attack?: string; decay?: string; sustain?: string; release?: string; sustainLevel?: number }
  /** Display only: an LFO wave from its rate (and delay). */
  | { kind: 'lfo'; rate: string; delay?: string };

/** Param ids a panel widget controls (the lfo preview controls none). */
export function widgetParams(w: PanelWidget): string[] {
  switch (w.kind) {
    case 'knobs':
    case 'faders':
    case 'sliders':
      return w.params;
    case 'switch':
      return [w.param];
    case 'xy':
      return [w.x, w.y];
    case 'adsr':
      return [w.attack, w.decay, w.sustain, w.release].filter((x): x is string => !!x);
    case 'lfo':
      return [];
  }
}

/** A value inside a choice band, to send when that choice is picked. */
export function choiceValue(param: InstrumentParam, index: number): number {
  const c = param.choices ?? [];
  const lo = index === 0 ? param.min : c[index - 1]!.upTo + 1;
  const hi = c[index]?.upTo ?? param.max;
  return Math.round((lo + hi) / 2);
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
