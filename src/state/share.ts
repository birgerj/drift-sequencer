/**
 * Share a song as a link. Everything that shapes the music (tempo, key,
 * chords, every track's generator, seed, written pattern, knobs) and the
 * active visual go into the URL fragment, compressed, so no server is
 * involved and the fragment never leaves the browser.
 *
 * To keep links short, a track that came from a template only stores what
 * differs from that template track, plus a hash of the template track: if a
 * later Drift version changes the template, the link still opens but the
 * receiver is told it may sound different.
 *
 * Left out on purpose: ids (made fresh on opening), the sharer's MIDI ports
 * and devices (the receiver's own synths are picked instead), timestamps.
 */
import { DEFAULT_PREFER, roleOf } from './rack';
import { newId, SCHEMA_VERSION, type ProjectState, type TrackState } from './project';
import { createProject, TEMPLATES } from './templates';
import { instrumentForLocalPort, isLocalPort, LOCAL_PORTS, localKindOf, type LocalKind } from '../io/local/ports';
import type { Pattern, PatternEvent } from '../core/pattern/pattern';

export const SHARE_PREFIX = '#s=1.';

/** Visual settings that travel with a song. */
export interface SharedVisuals {
  scene?: string;
  speed?: number;
  tod?: string;
  notes?: boolean;
  strobe?: boolean;
  auto?: boolean;
}

export interface SharedSong {
  project: ProjectState;
  visuals?: SharedVisuals;
  /** Tracks that played hardware for the sharer: track id → instrument id, to be matched to the receiver's synths. */
  hardware: Record<string, string>;
  /** Some template-based tracks no longer match the template they were shared from. */
  changedTemplates: boolean;
}

/** Track fields that are not shared, or shared separately. */
const SKIP = new Set(['id', 'seed', 'deviceId', 'output', 'instrumentId', 'slideCc']);

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
type Obj = Record<string, Json>;

// ---------- encode ----------

export async function encodeShare(project: ProjectState, visuals?: SharedVisuals): Promise<string> {
  const ids = project.tracks.map((t) => t.id);
  const data: Obj = {
    n: project.name,
    b: project.bpm,
    sw: project.swing,
    sp: project.stepsPerBar,
    k: [project.key.root, project.key.mode],
    p: project.progression as unknown as Json,
    t: project.tracks.map((t) => encodeTrack(t, ids)),
  };
  if (project.harmonyEvolve) data.he = project.harmonyEvolve as unknown as Json;
  if (visuals) data.v = visuals as unknown as Json;
  return SHARE_PREFIX + toBase64Url(await deflate(JSON.stringify(data)));
}

function encodeTrack(track: TrackState, ids: string[]): Obj {
  const own = normalize(track, ids);
  let best: Obj = { ...own };
  let bestLen = JSON.stringify(best).length;
  for (const ref of templateTracks()) {
    const diff: Obj = { r: [ref.template, ref.index, ref.hash] };
    for (const key of new Set([...Object.keys(own), ...Object.keys(ref.fields)])) {
      if (JSON.stringify(own[key]) !== JSON.stringify(ref.fields[key])) diff[key] = own[key] ?? null;
    }
    const len = JSON.stringify(diff).length;
    if (len < bestLen) {
      best = diff;
      bestLen = len;
    }
  }
  best.s = track.seed;
  const kind = localKindOf(track.output.portName);
  if (kind) best.o = kind;
  else if (track.instrumentId) best.h = track.instrumentId;
  const ch = track.output.channel;
  if (ch !== (roleOf(track) === 'drums' ? 10 : 1)) best.c = ch;
  return best;
}

/**
 * The shared fields of a track in a stable, compact form: other tracks
 * referred to by index ("@2"), nested ids dropped, written patterns as
 * number lists, and default flags left out.
 */
function normalize(track: TrackState, ids: string[]): Obj {
  const out: Obj = {};
  for (const [key, value] of Object.entries(track)) {
    if (SKIP.has(key) || value === undefined) continue;
    if ((key === 'muted' || key === 'solo' || key === 'frozen') && value === false) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    out[key] = refIds(value, ids) as Json;
  }
  if (track.userPattern) out.userPattern = packPattern(track.userPattern);
  for (const key of ['modulations', 'motions'] as const) {
    const list = out[key];
    if (Array.isArray(list)) out[key] = list.map((m) => withoutId(m as Obj));
  }
  return out;
}

function refIds(value: unknown, ids: string[]): unknown {
  if (typeof value === 'string') {
    const i = ids.indexOf(value);
    return i >= 0 ? `@${i}` : value;
  }
  if (Array.isArray(value)) return value.map((v) => refIds(v, ids));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).map(([k, v]) => [k, refIds(v, ids)]));
  }
  return value;
}

function withoutId(o: Obj): Obj {
  const { id: _id, ...rest } = o;
  return rest;
}

function packPattern(p: Pattern): Json {
  return [p.lengthSteps, p.events.map(packEvent)];
}

function packEvent(e: PatternEvent): Json {
  const { step, length, velocity, pitch, ...rest } = e;
  const a: Json[] = [step, length, velocity, pitch as unknown as Json];
  const extra = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
  if (Object.keys(extra).length) a.push(extra as Json);
  return a;
}

function unpackPattern(j: Json): Pattern {
  const [lengthSteps, events] = j as [number, Json[][]];
  return {
    lengthSteps,
    events: events.map((a) => ({
      step: a[0] as number,
      length: a[1] as number,
      velocity: a[2] as number,
      pitch: a[3] as unknown as PatternEvent['pitch'],
      ...((a[4] as object | undefined) ?? {}),
    })),
  };
}

// ---------- templates ----------

interface TemplateTrack {
  template: string;
  index: number;
  hash: string;
  fields: Obj;
}

let cache: TemplateTrack[] | undefined;

/** Every template track in normalized form (built once). */
function templateTracks(): TemplateTrack[] {
  if (!cache) {
    cache = [];
    for (const t of TEMPLATES) {
      const project = createProject(t.id);
      const ids = project.tracks.map((x) => x.id);
      project.tracks.forEach((track, index) => {
        const fields = normalize(track, ids);
        cache!.push({ template: t.id, index, fields, hash: hash(JSON.stringify(fields)) });
      });
    }
  }
  return cache;
}

/** FNV-1a, base 36: enough to notice that a template changed. */
export function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

// ---------- decode ----------

export async function decodeShare(fragment: string): Promise<SharedSong> {
  if (!fragment.startsWith(SHARE_PREFIX)) throw new Error('This link is not a Drift song.');
  const data = JSON.parse(await inflate(fromBase64Url(fragment.slice(SHARE_PREFIX.length)))) as Obj;
  const raw = data.t as Obj[];
  const ids = raw.map(() => newId());
  const hardware: Record<string, string> = {};
  let changedTemplates = false;
  const tracks = raw.map((enc, i) => {
    let fields: Obj = {};
    const r = enc.r as [string, number, string] | undefined;
    if (r) {
      const ref = templateTracks().find((x) => x.template === r[0] && x.index === r[1]);
      if (!ref || ref.hash !== r[2]) changedTemplates = true;
      fields = { ...(ref?.fields ?? {}) };
    }
    for (const [key, value] of Object.entries(enc)) {
      if (key === 'r' || key === 's' || key === 'o' || key === 'h' || key === 'c') continue;
      if (value === null) delete fields[key];
      else fields[key] = value;
    }
    const track = resolveIds(fields, ids) as unknown as TrackState;
    if (fields.userPattern) track.userPattern = unpackPattern(fields.userPattern);
    for (const key of ['modulations', 'motions'] as const) {
      const list = track[key] as { id: string }[] | undefined;
      if (list) (track as unknown as Record<string, unknown>)[key] = list.map((m) => ({ ...m, id: newId() }));
    }
    track.id = ids[i]!;
    track.seed = enc.s as number;
    track.muted ??= false;
    track.solo ??= false;
    track.frozen ??= false;
    track.modulations ??= [];
    const role = roleOf(track);
    const channel = (enc.c as number | undefined) ?? (role === 'drums' ? 10 : 1);
    const kind = enc.o as LocalKind | undefined;
    if (kind && LOCAL_PORTS[kind]) {
      const portName = LOCAL_PORTS[kind];
      track.output = { portName, channel };
      track.instrumentId = instrumentForLocalPort(portName);
    } else {
      // Played hardware: the receiver's synths are matched to it later.
      track.output = { portName: '', channel };
      const hw = enc.h as string | undefined;
      hardware[track.id] = hw ?? '';
      track.prefer = [...new Set([...(hw ? [hw] : []), ...DEFAULT_PREFER[role]])];
    }
    return track;
  });
  const [root, mode] = data.k as [ProjectState['key']['root'], ProjectState['key']['mode']];
  const project: ProjectState = {
    schemaVersion: SCHEMA_VERSION,
    id: newId(),
    name: String(data.n ?? 'Shared song'),
    bpm: data.b as number,
    swing: data.sw as number,
    stepsPerBar: data.sp as number,
    key: { root, mode },
    progression: data.p as unknown as ProjectState['progression'],
    ...(data.he ? { harmonyEvolve: data.he as unknown as ProjectState['harmonyEvolve'] } : {}),
    clock: { sendTo: [] },
    tracks,
    updatedAt: new Date().toISOString(),
  };
  return { project, visuals: data.v as SharedVisuals | undefined, hardware, changedTemplates };
}

function resolveIds(value: unknown, ids: string[]): unknown {
  if (typeof value === 'string') {
    const m = /^@(\d+)$/.exec(value);
    return m && ids[Number(m[1])] ? ids[Number(m[1])] : value;
  }
  if (Array.isArray(value)) return value.map((v) => resolveIds(v, ids));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveIds(v, ids)]));
  return value;
}

/** Whether a track plays a built-in synth (shared as such) rather than hardware. */
export function playsBuiltIn(track: TrackState): boolean {
  return isLocalPort(track.output.portName);
}

// ---------- bytes ----------

async function deflate(text: string): Promise<Uint8Array> {
  const stream = new Blob([new TextEncoder().encode(text)]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function inflate(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).text();
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
