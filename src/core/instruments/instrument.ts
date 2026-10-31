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
