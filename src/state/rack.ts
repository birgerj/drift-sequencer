import type { TrackType } from '../core/generators/types';
import type { InstrumentDefinition } from '../core/instruments/instrument';
import { newId, type MidiTarget, type ProjectState, type TrackState } from './project';

/**
 * The user's hardware setup ("rack"), stored per device — not in projects.
 * Tracks pick a rack device; templates pick one by role. So switching
 * templates or importing a project never loses the MIDI setup.
 */
export type DeviceRole = 'lead' | 'bass' | 'pad' | 'drums';

export const DEVICE_ROLES: { role: DeviceRole; label: string; hint: string }[] = [
  { role: 'lead', label: 'Lead', hint: 'Melodies and arpeggios' },
  { role: 'bass', label: 'Bass', hint: 'Bass lines' },
  { role: 'pad', label: 'Pad / chords', hint: 'Chords and drones' },
  { role: 'drums', label: 'Drums', hint: 'Drum machine, e.g. TR-8S' },
];

export interface RackDevice {
  id: string;
  /** Your name for it, e.g. "Minilogue". */
  name: string;
  portName: string;
  /** 1..16 */
  channel: number;
  instrumentId?: string;
  /** What this device is used for; templates pick devices by role. */
  roles: DeviceRole[];
  /** Receives MIDI clock and start/stop. */
  clock: boolean;
  /** MIDI input this device sends its knobs on; empty = guess from the port name, "off" = ignore. */
  inputName?: string;
}

/** The MIDI input that belongs to a device: chosen, or the one whose name matches its output. */
export function inputForDevice(device: RackDevice, inputs: string[]): string | undefined {
  if (device.inputName === 'off') return undefined;
  if (device.inputName) return inputs.includes(device.inputName) ? device.inputName : undefined;
  const exact = inputs.find((i) => i === device.portName);
  if (exact) return exact;
  const first = (n: string) => n.toLowerCase().split(/[\s:_-]+/).find(Boolean) ?? '';
  const key = first(device.portName);
  const matches = key.length >= 3 ? inputs.filter((i) => first(i) === key) : [];
  return matches.length === 1 ? matches[0] : undefined;
}

export interface Rack {
  devices: RackDevice[];
}

const KEY = 'drift.rack';

export function loadRack(storage: Pick<Storage, 'getItem'> | undefined = safeStorage()): Rack {
  try {
    const raw = storage?.getItem(KEY);
    const rack = raw ? (JSON.parse(raw) as Rack) : undefined;
    if (rack && Array.isArray(rack.devices)) return { devices: rack.devices.filter(isValidDevice) };
  } catch {
    /* fall through */
  }
  return { devices: [] };
}

export function saveRack(rack: Rack, storage: Pick<Storage, 'setItem'> | undefined = safeStorage()): void {
  try {
    storage?.setItem(KEY, JSON.stringify(rack));
  } catch {
    /* storage unavailable */
  }
}

function isValidDevice(d: RackDevice): boolean {
  return typeof d?.id === 'string' && typeof d.portName === 'string' && d.channel >= 1 && d.channel <= 16;
}

export function newDevice(partial: Partial<RackDevice> & Pick<RackDevice, 'portName'>): RackDevice {
  return {
    id: newId(),
    name: partial.name ?? partial.portName,
    channel: 1,
    roles: [],
    clock: false,
    ...partial,
  };
}

/** The role a track plays, from its explicit role or its generator type. */
export function roleOf(track: Pick<TrackState, 'role' | 'generator'>): DeviceRole {
  if (track.role) return track.role;
  return roleForType(track.generator.type);
}

export function roleForType(type: TrackType): DeviceRole {
  switch (type) {
    case 'drums':
      return 'drums';
    case 'bass':
    case 'acid':
      return 'bass';
    case 'chords':
    case 'drone':
      return 'pad';
    default:
      return 'lead';
  }
}

/** First device for a role; pads fall back to the lead device. */
export function deviceForRole(rack: Rack, role: DeviceRole): RackDevice | undefined {
  return (
    rack.devices.find((d) => d.roles.includes(role)) ??
    (role === 'pad' ? rack.devices.find((d) => d.roles.includes('lead')) : undefined)
  );
}

/**
 * Give every track without a (known) device the rack device for its role.
 * With `force`, reassign all tracks by role.
 */
export function assignDevices(project: ProjectState, rack: Rack, force = false): ProjectState {
  if (rack.devices.length === 0) return project;
  let changed = false;
  const tracks = project.tracks.map((t) => {
    const known = t.deviceId && rack.devices.some((d) => d.id === t.deviceId);
    if (known && !force) return t;
    const device = deviceForRole(rack, roleOf(t));
    if (!device || device.id === t.deviceId) return t;
    changed = true;
    return { ...t, deviceId: device.id };
  });
  return changed ? { ...project, tracks } : project;
}

/** The MIDI target a track actually uses. */
export function effectiveOutput(track: TrackState, rack: Rack): MidiTarget {
  const d = track.deviceId ? rack.devices.find((x) => x.id === track.deviceId) : undefined;
  return d ? { portName: d.portName, channel: d.channel } : track.output;
}

export function effectiveInstrumentId(track: TrackState, rack: Rack): string | undefined {
  const d = track.deviceId ? rack.devices.find((x) => x.id === track.deviceId) : undefined;
  return d?.instrumentId ?? track.instrumentId;
}

/**
 * The project as the engine should see it: outputs, instruments and clock
 * targets filled in from the rack.
 */
export function resolveProject(project: ProjectState, rack: Rack): ProjectState {
  if (rack.devices.length === 0) return project;
  const tracks = project.tracks.map((t) => {
    const output = effectiveOutput(t, rack);
    return output === t.output ? t : { ...t, output, instrumentId: effectiveInstrumentId(t, rack) };
  });
  const clockPorts = rack.devices.filter((d) => d.clock).map((d) => d.portName);
  return { ...project, tracks, clock: { sendTo: [...new Set(clockPorts)] } };
}

/** Guess which port is which: drum machines by name, the rest in order. */
export function guessPorts(ports: string[]): Partial<Record<DeviceRole, string>> {
  const drumLike = /tr-?\d|drum|rhythm|beat|rd-?\d|machinedrum|digitakt|syntakt|rytm|tr8|tr-8|\bdrm\b/i;
  const bassLike = /tb-?0?3|td-?3|303|bass|mono ?station|sh-?101/i;
  // Thru/virtual ports and secondary control ports (e.g. "TR-8S CTRL") aren't instruments.
  const skip = /through|thru|midi \d$|virtual|iac|ctrl|control|\bdaw\b|remote/i;
  const usable = ports.filter((p) => !skip.test(p));
  const drums = usable.find((p) => drumLike.test(p));
  const bassNamed = usable.find((p) => p !== drums && bassLike.test(p));
  const padLike = /wavestate|pad|string|ensemble|choir|organ|wavetable|opsix|modwave/i;
  const padNamed = usable.find((p) => p !== drums && p !== bassNamed && padLike.test(p));
  const others = usable.filter((p) => p !== drums && p !== bassNamed && p !== padNamed);
  const guess: Partial<Record<DeviceRole, string>> = {};
  if (drums) guess.drums = drums;
  const lead = others[0] ?? padNamed;
  if (lead) guess.lead = lead;
  const bass = bassNamed ?? others[1];
  if (bass) guess.bass = bass;
  const pad = padNamed ?? others.filter((p) => p !== bass)[1] ?? lead;
  if (pad) guess.pad = pad;
  return guess;
}

/** Find a definition whose device name appears in the port name. */
export function suggestInstrument(portName: string, instruments: InstrumentDefinition[]): InstrumentDefinition | undefined {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const port = norm(portName);
  return [...instruments]
    .sort((a, b) => b.device.length - a.device.length)
    .find((d) => norm(d.device).length >= 3 && port.includes(norm(d.device)));
}

function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}
