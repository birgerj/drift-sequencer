import type { TrackType } from '../core/generators/types';
import { presetCcValues, type InstrumentDefinition } from '../core/instruments/instrument';
import { instrumentForLocalPort, isLocalPort, localPortForInstrument, MONO_LOCAL_INSTRUMENTS } from '../io/local/ports';
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

/**
 * Built-in synths that used to be "My devices" entries, by their old device
 * id, so projects saved back then still play them. The rack itself only
 * holds external hardware now; tracks pick built-ins directly.
 */
export type BuiltInAliases = Record<string, MidiTarget>;

const ALIASES_KEY = 'drift.rack.builtIns';

/** Takes the built-in synths out of a rack; returns the hardware rack and what was taken out. */
export function splitBuiltIns(rack: Rack): { rack: Rack; aliases: BuiltInAliases } {
  const aliases: BuiltInAliases = {};
  const devices = rack.devices.filter((d) => {
    if (!isLocalPort(d.portName)) return true;
    aliases[d.id] = { portName: d.portName, channel: d.channel };
    return false;
  });
  return devices.length === rack.devices.length ? { rack, aliases } : { rack: { devices }, aliases };
}

/** Tracks that played a built-in through a (removed) device now play it directly, keeping their sound. */
export function releaseBuiltIns(project: ProjectState, aliases: BuiltInAliases): ProjectState {
  let changed = false;
  const tracks = project.tracks.map((t) => {
    const target = t.deviceId ? aliases[t.deviceId] : undefined;
    if (!target) return t;
    changed = true;
    const { deviceId: _old, ...rest } = t;
    return { ...rest, output: { ...target }, instrumentId: instrumentForLocalPort(target.portName) ?? t.instrumentId };
  });
  return changed ? { ...project, tracks } : project;
}

export function loadBuiltInAliases(storage: Pick<Storage, 'getItem'> | undefined = safeStorage()): BuiltInAliases {
  try {
    const raw = storage?.getItem(ALIASES_KEY);
    const parsed = raw ? (JSON.parse(raw) as BuiltInAliases) : undefined;
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {
    /* fall through */
  }
  return {};
}

export function saveBuiltInAliases(aliases: BuiltInAliases, storage: Pick<Storage, 'setItem'> | undefined = safeStorage()): void {
  try {
    storage?.setItem(ALIASES_KEY, JSON.stringify(aliases));
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
    // A track set to a built-in synth on purpose keeps it.
    if (!t.deviceId && !force && isLocalPort(t.output.portName)) return t;
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
  const skip = /through|thru|midi \d$|virtual|iac|ctrl|control|\bdaw\b|remote|drift synth/i;
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

/**
 * Devices for connected hardware ports that aren't in the rack yet, with
 * their roles guessed from the port names (drum machine, bass synth, pad
 * synth, the rest as lead) and their instrument definition suggested. The
 * drum machine gets channel 10, and clock when no device sends it yet.
 */
export function devicesFromPorts(ports: string[], rack: Rack, instruments: InstrumentDefinition[]): RackDevice[] {
  const used = new Set(rack.devices.map((d) => d.portName));
  const fresh = ports.filter((p) => !used.has(p) && !isLocalPort(p));
  const guess = guessPorts(fresh);
  const hasRole = (role: DeviceRole) => rack.devices.some((d) => d.roles.includes(role));
  const hasClock = rack.devices.some((d) => d.clock);
  return fresh.map((portName) => {
    const roles = (Object.keys(guess) as DeviceRole[]).filter((r) => guess[r] === portName && !hasRole(r));
    const suggestion = suggestInstrument(portName, instruments);
    const drums = roles.includes('drums');
    return newDevice({
      portName,
      name: suggestion?.device ?? portName,
      channel: drums ? 10 : 1,
      roles,
      clock: drums && !hasClock,
      ...(suggestion ? { instrumentId: suggestion.id } : {}),
    });
  });
}

/** Find a definition whose device name appears in the port name. */
export function suggestInstrument(portName: string, instruments: InstrumentDefinition[]): InstrumentDefinition | undefined {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const port = norm(portName);
  return [...instruments]
    .sort((a, b) => b.device.length - a.device.length)
    .find((d) => norm(d.device).length >= 3 && port.includes(norm(d.device)));
}

/** Instruments that suit a role when a track names none; best first. */
export const DEFAULT_PREFER: Record<DeviceRole, string[]> = {
  lead: ['asm-hydrasynth', 'drift-synth-lead', 'drift-synth-mono'],
  bass: ['roland-tb-03', 'drift-synth-mono', 'drift-synth-bass'],
  pad: ['korg-wavestate', 'drift-synth-juno', 'drift-synth-pad'],
  drums: ['roland-tr-8s', 'drift-synth-drums'],
};

/** The instrument definition a rack device plays: chosen, or guessed from its port name. */
export function deviceInstrumentId(device: RackDevice, instruments: InstrumentDefinition[]): string | undefined {
  return device.instrumentId ?? suggestInstrument(device.portName, instruments)?.id;
}

/**
 * Give every track the most suitable instrument:
 *  1. a device from "My devices" playing one of the track's preferred instruments,
 *  2. otherwise an unused device with the track's role (your own synths come first),
 *  3. otherwise a preferred built-in synth, so nothing stays silent.
 * A hardware device gets one track (most synths play one part); a call-and-
 * response answer plays on the same instrument as its call. When the chosen
 * instrument has the sound the track asks for (`sounds`), its knobs are set to it.
 */
export function assignBestFit(
  project: ProjectState,
  rack: Rack,
  instruments: InstrumentDefinition[],
  sounds: Record<string, Record<string, string>> = {},
): ProjectState {
  const used = new Set<string>();
  const out: TrackState[] = [];
  const instrumentOf = new Map(rack.devices.map((d) => [d.id, deviceInstrumentId(d, instruments)]));
  for (const track of project.tracks) {
    const source = track.phrase?.answer ? out.find((t) => t.id === track.phrase!.answer!.from) : undefined;
    if (source) {
      out.push({
        ...track,
        deviceId: source.deviceId,
        output: { ...source.output },
        ...(source.instrumentId ? { instrumentId: source.instrumentId } : {}),
      });
      continue;
    }
    const role = roleOf(track);
    const prefer = track.prefer?.length ? track.prefer : DEFAULT_PREFER[role];
    const free = (d: RackDevice) => !used.has(d.id);
    const device =
      prefer.map((id) => rack.devices.find((d) => free(d) && instrumentOf.get(d.id) === id)).find(Boolean) ??
      rack.devices.find((d) => free(d) && d.roles.includes(role));
    let next: TrackState;
    let instrumentId: string | undefined;
    if (device) {
      used.add(device.id);
      instrumentId = instrumentOf.get(device.id);
      next = { ...track, deviceId: device.id };
    } else {
      const builtIns = prefer.filter((id) => localPortForInstrument(id));
      instrumentId =
        builtIns.find((id) => !used.has(id)) ?? builtIns.find((id) => !MONO_LOCAL_INSTRUMENTS.has(id)) ?? builtIns[0];
      const port = instrumentId && localPortForInstrument(instrumentId);
      if (instrumentId && port) {
        used.add(instrumentId);
        next = { ...track, deviceId: undefined, output: { portName: port, channel: role === 'drums' ? 10 : 1 }, instrumentId };
      } else {
        const fallback = deviceForRole(rack, role);
        next = fallback ? { ...track, deviceId: fallback.id } : track;
        instrumentId = fallback && instrumentOf.get(fallback.id);
      }
    }
    if (instrumentId) used.add(instrumentId);
    const def = instrumentId ? instruments.find((d) => d.id === instrumentId) : undefined;
    const soundName = instrumentId ? sounds[track.name]?.[instrumentId] : undefined;
    const preset = soundName ? def?.presets?.find((p) => p.name === soundName) : undefined;
    if (def && preset) {
      const values = presetCcValues(def, preset);
      next = { ...next, panel: { values, preset: { name: preset.name, values } } };
    }
    out.push(next);
  }
  return { ...project, tracks: out };
}

function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}
