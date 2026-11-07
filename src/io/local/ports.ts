/**
 * Names of the built-in Web Audio instruments, shared by the audio code and
 * the parts of the app that only need to know which ports are built in
 * (without loading any audio code).
 */
export type LocalKind = 'lead' | 'bass' | 'pad' | 'drums' | 'juno' | 'mono' | 'piano' | 'hum';

export const LOCAL_PORTS: Record<LocalKind, string> = {
  lead: 'Drift Synth Lead',
  bass: 'Drift Synth Bass',
  pad: 'Drift Synth Pad',
  drums: 'Drift Synth Drums',
  juno: 'Drift Synth Juno',
  mono: 'Drift Synth Mono',
  piano: 'Drift Synth Piano',
  hum: 'Drift Synth Hum',
};

export function isLocalPort(name: string): boolean {
  return Object.values(LOCAL_PORTS).includes(name);
}

/** Instrument definition id of each built-in instrument. */
export const LOCAL_INSTRUMENT_IDS: Record<LocalKind, string> = {
  lead: 'drift-synth-lead',
  bass: 'drift-synth-bass',
  pad: 'drift-synth-pad',
  drums: 'drift-synth-drums',
  juno: 'drift-synth-juno',
  mono: 'drift-synth-mono',
  piano: 'drift-synth-piano',
  hum: 'drift-synth-hum',
};

/** The built-in port for an instrument definition id, if it is a built-in. */
export function localPortForInstrument(instrumentId: string): string | undefined {
  const kind = (Object.keys(LOCAL_INSTRUMENT_IDS) as LocalKind[]).find((k) => LOCAL_INSTRUMENT_IDS[k] === instrumentId);
  return kind ? LOCAL_PORTS[kind] : undefined;
}

/** The instrument definition id for a built-in port name. */
export function instrumentForLocalPort(portName: string): string | undefined {
  const kind = (Object.keys(LOCAL_PORTS) as LocalKind[]).find((k) => LOCAL_PORTS[k] === portName);
  return kind ? LOCAL_INSTRUMENT_IDS[kind] : undefined;
}

/** Built-ins that play one note at a time: two tracks shouldn't share one. */
export const MONO_LOCAL_INSTRUMENTS = new Set(['drift-synth-bass', 'drift-synth-mono']);

/** The kind of a built-in port, e.g. "Drift Synth Hum" → "hum". */
export function localKindOf(portName: string): LocalKind | undefined {
  return (Object.keys(LOCAL_PORTS) as LocalKind[]).find((k) => LOCAL_PORTS[k] === portName);
}

/** Short name of a built-in for chips: "Drift Synth Juno" → "Juno". */
export function builtInShortName(portName: string): string {
  return portName.replace(/^Drift Synth /, '');
}

/**
 * Where a track plays, for track headers: "Minilogue · ch 2" for a device or
 * port, "Synth Juno" for a built-in (built-ins ignore the MIDI channel).
 */
export function outputLabel(portName: string, channel: number, deviceName?: string): string {
  if (deviceName) return `${deviceName} · ch ${channel}`;
  if (isLocalPort(portName)) return portName.replace(/^Drift /, '');
  return `${portName} · ch ${channel}`;
}
