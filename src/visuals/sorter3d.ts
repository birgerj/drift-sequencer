// Parcel hub as an empty club (three.js). Four infeeds at two heights run
// through scan tunnels and merge onto an endless tilt-tray loop sorter, which
// tips parcels into chutes, sends some up a lift into a high-bay store and
// takes them out again. Some chutes end at pickup stations where sort robots
// take the parcels to rows of open bins (sorterFloor.ts), under flow
// projectors. Forklifts drive around, moving heads and a
// mirror ball light the haze. Everything moves on the beat: belts travel
// BEAT_M metres per beat, inductions, diverts and scans land on beats, lead
// notes feed parcels in the track's colour, bass notes drive the lift, pad
// notes call parcels back from the store and tint the lights.
//
// Two looks, switched with the time-of-day button: "Night" is the club;
// "Day" is a product-illustration style — a light hall, equipment in
// black outlines with teal sorters and roll cages, orange scan tunnels,
// a purple workstation, magenta GPU racks, people and hanging signs, and
// a blue outline on the followed parcel.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

import type { NoteRole, RGB, Scene3D, SceneControl, SceneInput } from './scene3d';
import { RobotFloor } from './sorterFloor';
import type { FleetEvent } from './robotFleet';

type V3 = THREE.Vector3;
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const pick = <T>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)]!;
const UP = new THREE.Vector3(0, 1, 0);
const ZERO = new THREE.Vector3();

/** Metres a belt moves per beat. Every belt, carrier and induction is locked to this. */
export const BEAT_M = 2;
/** Tray pitch on the loop: one tray every eighth note. */
const PITCH = 1;
const LOOP_Y = 4;
const LOOP_R = 7;
/** One lap is 50 beats, so every whole-metre-pair mark on the loop is passed on a beat. */
export const LOOP_LEN = 100;
const STRAIGHT = (LOOP_LEN - 2 * Math.PI * LOOP_R) / 2;
/** Centre x of the left bend; the loop runs +x along z = −R first. */
const LX = 4;
const TRAYS = LOOP_LEN / PITCH;
const HX = 62;
const HZ = 34;
const HH = 11;
const MAX_PARCELS = 280;

// Loop positions (metres from the start of the near straight; all even, so on a beat).
const INDUCT = [2, 6, 10, 14];
const LANE_Z = [-14.5, -17, -19.5, -22];
const LANE_Y = [1.0, 1.0, 7.0, 7.0];
const LANE_TUNNEL_X = -50;
const LOOP_TUNNELS = [18, 50];
const STORE_OUT = 36;
const STORE_BACK = 44;
/** Where the station chutes end, at the back of the pickup roller tables. */
const STATION_Z = 13.5;
/** Chutes: loop position and side (1 outside the loop, −1 inside). */
const CHUTES: [number, number][] = [
  [22, 1], [26, 1], [54, 1], [58, 1], [62, 1], [66, 1], [70, 1], [74, 1],
  [56, -1], [60, -1], [64, -1], [68, -1], [72, -1], [84, 1], [90, 1],
];

// Lift and high-bay store.
const LIFT_X = 49;
const SHUTTLE_X = 50.2;
const SLOT_X = 51.6;
const RACK_X0 = 50.9;
const RACK_X1 = 52.3;
const LEVELS = [0.7, 2.3, 3.9, 5.5, 7.1, 8.7];
const BAY = 1.6;
const BAYS = 17; // bays each side of the lift
const DYN = 8; // bays each side that hold real parcels

const PARCEL_COLS = [0xb08a5e, 0xa07c52, 0xc4a070, 0x8f6c48, 0xb08a5e, 0xc4a070, 0xf2c200, 0xf2c200, 0x4a2f1a, 0x4a2f1a, 0xe6e4de, 0xb3122a, 0x4b1a86, 0x1d4f9a];

/** Day palette, after a parcel-sorting product illustration. */
const DAY = {
  bg: 0xeef1f4,
  floor: 0xf6f7f9,
  wall: 0xe6e9ed,
  ceiling: 0xf3f4f6,
  steel: 0xb9c0c8,
  teal: 0x2fa58f,
  tealD: 0x1f7f6c,
  tealL: 0x86d3c3,
  tealP: 0xdff3ee,
  orange: 0xf2a51a,
  orangeL: 0xfbd47c,
  purple: 0x6b3fd1,
  magenta: 0xd6339a,
  red: 0xe2231a,
  ink: 0x1d1d1f,
  blue: 0x1755fe,
};

function loopAt(s: number, pos: V3, tan: V3): void {
  s = ((s % LOOP_LEN) + LOOP_LEN) % LOOP_LEN;
  const S = STRAIGHT;
  const B = Math.PI * LOOP_R;
  if (s < S) {
    pos.set(LX + s, LOOP_Y, -LOOP_R);
    tan.set(1, 0, 0);
  } else if (s < S + B) {
    const f = (s - S) / LOOP_R;
    pos.set(LX + S + LOOP_R * Math.sin(f), LOOP_Y, -LOOP_R * Math.cos(f));
    tan.set(Math.cos(f), 0, Math.sin(f));
  } else if (s < 2 * S + B) {
    pos.set(LX + S - (s - S - B), LOOP_Y, LOOP_R);
    tan.set(-1, 0, 0);
  } else {
    const f = (s - 2 * S - B) / LOOP_R;
    pos.set(LX - LOOP_R * Math.sin(f), LOOP_Y, LOOP_R * Math.cos(f));
    tan.set(-Math.cos(f), 0, -Math.sin(f));
  }
}
/** Outward normal of the loop for a tangent. */
const outward = (tan: V3, out: V3) => out.set(tan.z, 0, -tan.x);

/** Beats from loop position a to b going forward (at least one lap if equal). */
export function beatsAlong(a: number, b: number): number {
  const d = (((b - a) % LOOP_LEN) + LOOP_LEN) % LOOP_LEN;
  return Math.round((d === 0 ? LOOP_LEN : d) / BEAT_M);
}

/** Which tray sits at loop position s at beat t. */
export function trayAt(s: number, t: number): number {
  return ((Math.round((s - t * BEAT_M) / PITCH) % TRAYS) + TRAYS) % TRAYS;
}

/** A smooth path through dense points; corners are rounded in 3D, so ramps and bends flow. */
export class Path {
  readonly acc: number[] = [0];
  readonly len: number;
  constructor(
    readonly pts: V3[],
    readonly closed = false,
  ) {
    for (let i = 1; i < pts.length; i++) this.acc.push(this.acc[i - 1]! + pts[i]!.distanceTo(pts[i - 1]!));
    this.len = this.acc[this.acc.length - 1]!;
  }

  static fillet(ctrl: V3[], r: number): Path {
    const out: V3[] = [ctrl[0]!.clone()];
    const line = (to: V3) => {
      const from = out[out.length - 1]!;
      const n = Math.max(1, Math.ceil(from.distanceTo(to) / 0.5));
      for (let k = 1; k <= n; k++) out.push(from.clone().lerp(to, k / n));
    };
    for (let i = 1; i < ctrl.length - 1; i++) {
      const A = ctrl[i - 1]!;
      const P = ctrl[i]!;
      const C = ctrl[i + 1]!;
      const a = P.clone().sub(A);
      const la = a.length();
      a.divideScalar(la);
      const b = C.clone().sub(P);
      const lb = b.length();
      b.divideScalar(lb);
      const ang = Math.acos(clamp(a.dot(b), -1, 1));
      const t = Math.min(r * Math.tan(ang / 2), la * (i === 1 ? 0.9 : 0.5), lb * (i === ctrl.length - 2 ? 0.9 : 0.5));
      const e0 = P.clone().addScaledVector(a, -t);
      const e1 = P.clone().addScaledVector(b, t);
      line(e0);
      for (let k = 1; k <= 16; k++) {
        const u = k / 16;
        const w = 1 - u;
        out.push(new THREE.Vector3().addScaledVector(e0, w * w).addScaledVector(P, 2 * w * u).addScaledVector(e1, u * u));
      }
    }
    line(ctrl[ctrl.length - 1]!);
    return new Path(out);
  }

  at(s: number, pos: V3, tan?: V3): void {
    const L = this.len;
    s = this.closed ? ((s % L) + L) % L : clamp(s, 0, L);
    let lo = 0;
    let hi = this.acc.length - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (this.acc[m]! <= s) lo = m;
      else hi = m;
    }
    const a = this.pts[lo]!;
    const b = this.pts[hi]!;
    const seg = this.acc[hi]! - this.acc[lo]!;
    pos.lerpVectors(a, b, seg > 0 ? (s - this.acc[lo]!) / seg : 0);
    if (tan) tan.subVectors(b, a).normalize();
  }
}

/** Sweeps a 2D profile (across, up) along a path. uv.y is the distance in metres. */
function extrude(path: Path, prof: [number, number][], s0 = 0, s1 = path.len, step = 0.35): THREE.BufferGeometry {
  const n = Math.max(2, Math.ceil((s1 - s0) / step) + 1);
  const segs = prof.length - 1;
  const pos = new Float32Array(n * segs * 2 * 3);
  const uv = new Float32Array(n * segs * 2 * 2);
  const idx: number[] = [];
  const P = new THREE.Vector3();
  const T = new THREE.Vector3();
  const Sd = new THREE.Vector3();
  const N = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const s = s0 + ((s1 - s0) * i) / (n - 1);
    path.at(s, P, T);
    Sd.crossVectors(T, UP).normalize();
    N.crossVectors(Sd, T).normalize();
    for (let j = 0; j < segs; j++) {
      for (let k = 0; k < 2; k++) {
        const [px, py] = prof[j + k]!;
        const o = (j * n + i) * 2 + k;
        pos[o * 3] = P.x + Sd.x * px + N.x * py;
        pos[o * 3 + 1] = P.y + Sd.y * px + N.y * py;
        pos[o * 3 + 2] = P.z + Sd.z * px + N.z * py;
        uv[o * 2] = k;
        uv[o * 2 + 1] = s;
      }
    }
  }
  for (let j = 0; j < segs; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = (j * n + i) * 2;
      const b = a + 2;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A closed rounded rectangle on the floor (forklift routes). */
function roundRect(cx: number, cz: number, w: number, d: number, r: number): Path {
  const pts: V3[] = [];
  const x0 = cx - w / 2 + r;
  const x1 = cx + w / 2 - r;
  const z0 = cz - d / 2 + r;
  const z1 = cz + d / 2 - r;
  const corners: [number, number, number][] = [
    [x1, z0, -Math.PI / 2],
    [x1, z1, 0],
    [x0, z1, Math.PI / 2],
    [x0, z0, Math.PI],
  ];
  for (const [x, z, a0] of corners) {
    for (let k = 0; k <= 10; k++) {
      const a = a0 + (k / 10) * (Math.PI / 2);
      pts.push(v(x + r * Math.cos(a), 0, z + r * Math.sin(a)));
    }
  }
  pts.push(pts[0]!.clone());
  const dense: V3[] = [pts[0]!];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const n = Math.max(1, Math.ceil(a.distanceTo(b) / 0.6));
    for (let k = 1; k <= n; k++) dense.push(a.clone().lerp(b, k / n));
  }
  return new Path(dense, true);
}

// ---------- shaders ----------
const STRIP_VERT = /* glsl */ `
varying float vS;
void main() { vS = uv.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const STRIP_FRAG = /* glsl */ `
uniform vec3 uCol;
uniform float uBeat;
uniform float uKick;
uniform float uGain;
uniform float uDay;
uniform vec3 uDayCol;
varying float vS;
void main() {
  float ph = fract(vS * 0.125 - uBeat * 0.5);
  float chase = smoothstep(0.8, 1.0, ph);
  vec3 night = uCol * (0.3 + uKick * 0.9 + chase * 1.7) * uGain;
  gl_FragColor = vec4(mix(night, uDayCol * (1.0 + chase * 0.35), uDay), 1.0);
}`;
const BEAM_VERT = /* glsl */ `
varying float vY;
varying vec3 vN;
varying vec3 vV;
void main() {
  vY = uv.y;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vV = normalize(-mv.xyz);
  vN = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * mv;
}`;
const BEAM_FRAG = /* glsl */ `
uniform vec3 uCol;
uniform float uO;
varying float vY;
varying vec3 vN;
varying vec3 vV;
void main() {
  float f = pow(abs(dot(vN, vV)), 1.5);
  gl_FragColor = vec4(uCol * uO * f * pow(vY, 1.6), 1.0);
}`;

// ---------- textures ----------
function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, srgb = true): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (g) draw(g);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}
/** Belt surface: dark rubber by night, light rollers by day. */
function drawBelt(t: THREE.CanvasTexture, day: boolean): void {
  const c = t.image as HTMLCanvasElement;
  const g = c.getContext('2d');
  if (!g) return;
  g.fillStyle = day ? '#eef0f3' : '#1f2125';
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = day ? '#c4cad1' : '#34373d';
  for (let y = 0; y < c.height; y += 8) g.fillRect(0, y, c.width, day ? 2 : 3);
  t.needsUpdate = true;
}

const SIGN_FONT = 'Futura, "Futura PT", "Century Gothic", "Trebuchet MS", sans-serif';

function letterTex(letter: string): THREE.CanvasTexture {
  return canvasTex(64, 64, (g) => {
    g.fillStyle = '#86d3c3';
    g.fillRect(0, 0, 64, 64);
    g.strokeStyle = '#1d1d1f';
    g.lineWidth = 4;
    g.strokeRect(2, 2, 60, 60);
    g.fillStyle = '#1d1d1f';
    g.font = `700 40px ${SIGN_FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(letter, 32, 34);
  });
}

function barcodeTex(): THREE.CanvasTexture {
  return canvasTex(128, 32, (g) => {
    g.fillStyle = '#f2a51a';
    g.fillRect(0, 0, 128, 32);
    g.fillStyle = '#1d1d1f';
    for (let x = 20; x < 108; ) {
      const w = 1 + Math.floor(Math.random() * 4);
      g.fillRect(x, 6, w, 20);
      x += w + 2;
    }
  });
}

function eyeTex(): THREE.CanvasTexture {
  return canvasTex(64, 64, (g) => {
    g.fillStyle = '#f2a51a';
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(32, 32, 22, 0, 7);
    g.fill();
    g.strokeStyle = '#1d1d1f';
    g.lineWidth = 4;
    g.beginPath();
    g.ellipse(32, 32, 15, 9, 0, 0, 7);
    g.stroke();
    g.fillStyle = '#1d1d1f';
    g.beginPath();
    g.arc(32, 32, 5, 0, 7);
    g.fill();
  });
}

/** A hanging sign like the labels in the illustration: a round icon and the name in the product colour. */
function signTex(text: string, color: string, icon: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  return canvasTex(512, 128, (g) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 512, 128);
    g.strokeStyle = '#1d1d1f';
    g.lineWidth = 5;
    g.strokeRect(3, 3, 506, 122);
    g.fillStyle = color;
    g.beginPath();
    g.arc(64, 64, 40, 0, 7);
    g.fill();
    g.save();
    g.translate(64, 64);
    g.strokeStyle = '#ffffff';
    g.fillStyle = '#ffffff';
    g.lineWidth = 5;
    icon(g);
    g.restore();
    g.fillStyle = color;
    g.font = `600 40px ${SIGN_FONT}`;
    g.textBaseline = 'middle';
    const words = text.toUpperCase().split(' ');
    if (words.length > 1 && text.length > 14) {
      g.fillText(words[0]!, 124, 42);
      g.fillText(words.slice(1).join(' '), 124, 88);
    } else g.fillText(text.toUpperCase(), 124, 66);
  });
}

function noise(g: CanvasRenderingContext2D, w: number, h: number, base: number, amp: number) {
  const id = g.createImageData(w, h);
  for (let i = 0; i < id.data.length; i += 4) {
    const n = base + (Math.random() - 0.5) * amp;
    id.data[i] = id.data[i + 1] = id.data[i + 2] = n;
    id.data[i + 3] = 255;
  }
  g.putImageData(id, 0, 0);
}

type Mode = 'path' | 'loop' | 'tween' | 'carriage' | 'shuttle' | 'fixed' | 'queue' | 'table' | 'robot';

interface Parcel {
  id: number;
  w: number;
  h: number;
  d: number;
  col: THREE.Color;
  /** Glow colour once scanned: destination colour, or the track colour for lead parcels. */
  glow: THREE.Color;
  lead: boolean;
  scanned: boolean;
  flash: number;
  /** Chute index, or −1 for the store. */
  dest: number;
  mode: Mode;
  path?: Path;
  pathKind: 'lane' | 'chute' | 'intake' | 'back';
  lane: number;
  t0: number;
  t1: number;
  ease: 0 | 1;
  sPrev: number;
  sIn: number;
  tIn: number;
  divertAt: number;
  tray: number;
  from: V3;
  to: V3;
  off: V3;
  shuttle: number;
  done?: () => void;
  pos: V3;
  q: THREE.Quaternion;
  yawQ: THREE.Quaternion;
  vel: V3;
  dead: boolean;
  slot?: Slot;
  /** At a pickup station, or riding a robot: which one, since when, and the bin it goes to. */
  station?: number;
  bot?: number;
  rideAt?: number;
  bin?: number;
  dropAt?: number;
}

interface Slot {
  level: number;
  z: number;
  parcel: Parcel | null;
  reserved: boolean;
}

interface Lane {
  path: Path;
  tunnelS: number;
  lastArrive: number;
  lastSpawn: number;
  tunnel: Tunnel;
  door: THREE.MeshBasicMaterial;
  doorFlash: number;
  doorCol: THREE.Color;
}

interface Tunnel {
  ring: THREE.MeshBasicMaterial;
  curtain: THREE.MeshBasicMaterial;
  flash: number;
  col: THREE.Color;
}

interface Chute {
  s: number;
  side: number;
  path: Path;
  col: THREE.Color;
  lamp: THREE.MeshBasicMaterial;
  flash: number;
}

interface Head {
  piv: THREE.Group;
  u: { uCol: { value: THREE.Color }; uO: { value: number } };
  pos: V3;
  light?: THREE.SpotLight;
  rx: number;
  rz: number;
}

/** A stop on the fly-mode tour: where the camera hovers and what it looks at (both may follow something that moves). */
interface Poi {
  name: string;
  at: (pos: V3, look: V3) => boolean;
}

interface Tour {
  poi: number;
  curve: THREE.CatmullRomCurve3;
  len: number;
  s: number;
  lookFrom: V3;
  /** Beats to hover once arrived. */
  dwell: number;
  arrivedAt: number;
  /** Camera offset from the look point while hovering, slowly turning. */
  offset: V3;
}

/** Height at which the camera travels between stops: above the high infeeds and frames, below ducts and signs. */
const CRUISE_Y = 8;
/** Things the tour must fly around at cruise height: x, z, radius. */
const TOUR_OBSTACLES: [number, number, number][] = [
  [-50, -19.5, 2.4],
  [-50, -22, 2.4],
  [18, 0, 2.2],
];

interface Forklift {
  g: THREE.Group;
  route: Path;
  s: number;
  speed: number;
  forks: THREE.Group;
  beacon: THREE.MeshBasicMaterial;
}

type StepRun = () => number | (() => boolean);
interface Step {
  /** Waits for a trigger (a bass note, or two idle beats) before it starts. */
  gate?: boolean;
  skip?: () => boolean;
  run: StepRun;
}

/** Runs steps one after another; a step lasts a number of beats or until its predicate holds. */
export class Runner {
  steps: Step[] = [];
  private busyUntil = 0;
  private waitFor: (() => boolean) | null = null;

  /** Returns true when a gated step used the trigger. */
  update(bt: number, trig: boolean): boolean {
    let used = false;
    for (let guard = 0; guard < 8; guard++) {
      if (this.waitFor) {
        if (!this.waitFor()) return used;
        this.waitFor = null;
      }
      if (bt < this.busyUntil) return used;
      const st = this.steps[0];
      if (!st) return used;
      if (st.skip?.()) {
        this.steps.shift();
        continue;
      }
      if (st.gate) {
        if (!trig) return used;
        used = true;
        trig = false;
      }
      this.steps.shift();
      const r = st.run();
      if (typeof r === 'number') {
        this.busyUntil = bt + r;
        if (r > 0) return used;
      } else this.waitFor = r;
    }
    return used;
  }

  get busy(): boolean {
    return this.steps.length > 0 || this.waitFor !== null;
  }
}

interface Anim {
  a: number;
  b: number;
  t0: number;
  t1: number;
}
const smooth01 = (x: number) => {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};
const easeIO = (x: number) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);
function animAt(an: Anim, bt: number): number {
  if (bt >= an.t1) return an.b;
  if (bt <= an.t0) return an.a;
  return an.a + (an.b - an.a) * easeIO((bt - an.t0) / (an.t1 - an.t0));
}

type CamMode = 'auto' | 'fly' | 'follow';
const CAM_KEY = 'drift.visuals.sorter.cam';

export class Sorter implements Scene3D {
  readonly canvas: HTMLCanvasElement;
  readonly bass = true;
  private renderer: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 260);

  // Music clock: beats since start, locked to Drift's beat phase.
  private bt = 0;
  private lastBeats = Number.NaN;
  private offset = 0;
  private time = 0;
  private kick = 0;
  private snare = 0;
  private hat = 0;
  private bassEnv = 0;
  private bassPending = false;
  private lastLead = -99;
  private padCol = new THREE.Color(1, 1, 1);
  private padUntil = 0;
  private lastPad = -99;
  private cols: THREE.Color[] = [new THREE.Color(0.3, 0.5, 1), new THREE.Color(0.8, 0.3, 1), new THREE.Color(1, 0.6, 0.2)];

  // Conveyors.
  private lanes: Lane[] = [];
  private chutes: Chute[] = [];
  private loopTunnels: { s: number; t: Tunnel }[] = [];
  private intake!: Path;
  private back!: Path;
  private backLast = -99;
  private beltTex!: THREE.CanvasTexture;
  private strips: THREE.ShaderMaterial[] = [];
  private trays!: THREE.InstancedMesh;
  private trayOwner: (Parcel | null)[] = new Array<Parcel | null>(TRAYS).fill(null);
  private trayTilt = new Float32Array(TRAYS);

  // Parcels.
  private parcels: Parcel[] = [];
  private parcelMesh!: THREE.InstancedMesh;
  private labelMesh!: THREE.InstancedMesh;
  private glowAttr!: THREE.InstancedBufferAttribute;
  private nextId = 400000 + Math.floor(Math.random() * 500000);
  private queue: Parcel[] = [];

  // Lift and store.
  private lift = new Runner();
  private liftAnim: Anim = { a: LOOP_Y, b: LOOP_Y, t0: 0, t1: 0 };
  private liftLastMove = 0;
  private carriage!: THREE.Group;
  private liftLamp!: THREE.MeshBasicMaterial;
  private shuttles: { runner: Runner; anim: Anim; mesh: THREE.Mesh }[] = [];
  private slots: Slot[] = [];
  private retrieving = 0;
  private lastRetrieve = 0;
  private retrieveShot = 0;

  // Club.
  private heads: Head[] = [];
  private ball!: THREE.Mesh;
  private sparkPos!: Float32Array;
  private sparkGeo!: THREE.BufferGeometry;
  private sparkDirs: V3[] = [];
  private sparkMat!: THREE.PointsMaterial;
  private hazePos!: Float32Array;
  private hazeGeo!: THREE.BufferGeometry;
  private hazeSeed: number[][] = [];
  private hazeMat!: THREE.PointsMaterial;
  // Robots, bins and flow projectors south of the loop.
  private floor!: RobotFloor;
  /** Chute index → pickup station index, for chutes that end at a robot station. */
  private stationOf = new Map<number, number>();
  private stationQueue: Parcel[][] = [];
  private stationXs: number[] = [];
  private cages = new Map<number, THREE.Vector3>();
  private botParcel = new Map<number, Parcel>();
  private strobe!: THREE.MeshBasicMaterial;
  private hemi!: THREE.HemisphereLight;
  private forklifts: Forklift[] = [];

  // Day / night look.
  private day = 0;
  private dayShown: boolean | null = null;
  private themed: { m: THREE.MeshStandardMaterial; n: THREE.Color; d: THREE.Color; nr: number; dr: number; nm: number; dm: number }[] = [];
  readonly dayOnly: THREE.Object3D[] = [];
  readonly nightOnly: THREE.Object3D[] = [];
  /** Which look the objects being built belong to (undefined: both). */
  only: 'day' | 'night' | undefined;
  private readonly ink = new THREE.LineBasicMaterial({ color: DAY.ink });
  private nightEnv: THREE.Texture | null = null;
  private keyLight!: THREE.DirectionalLight;
  private hull!: THREE.InstancedMesh;
  private cageLine!: THREE.LineBasicMaterial;

  // Camera.
  private camMode: CamMode = 'auto';
  private follow: Parcel | null = null;
  private autoFollow = false;
  private lastShotBar = -1;
  /** Fly mode: a random tour past points of interest. */
  private tour: Tour | null = null;
  private recent: number[] = [];
  private pois: Poi[] = [];
  private first = true;
  private readonly look = new THREE.Vector3(18, 3, 0);
  private readonly want = new THREE.Vector3();
  private readonly wantLook = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3(1, 0, 0);

  // Scratch.
  private readonly p = new THREE.Vector3();
  private readonly t = new THREE.Vector3();
  private readonly n = new THREE.Vector3();
  private readonly o = new THREE.Object3D();
  private readonly m4 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly qLabel = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  private readonly c = new THREE.Color();
  private readonly white = new THREE.Color(1, 1, 1);

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'vis-canvas';
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.scene.background = new THREE.Color(0x0b0910);
    this.scene.fog = new THREE.FogExp2(0x0b0910, 0.017);
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.8, 0.55, 0.6);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    try {
      const saved = localStorage.getItem(CAM_KEY);
      if (saved === 'auto' || saved === 'fly' || saved === 'follow') this.camMode = saved;
    } catch {
      /* no storage */
    }
    this.buildEnv();
    this.buildHall();
    this.buildConveyors();
    this.buildStore();
    this.buildParcels();
    this.buildClub();
    this.buildForklifts();
    this.floor = new RobotFloor(this, this.stationXs, this.cages, {
      waiting: (st) => (this.stationQueue[st]?.length ?? 0) > 0,
      event: (e) => this.onFleet(e),
    });
    this.buildDay();
    this.buildCamera();
    this.prefill();
    this.applyTheme(0);
  }

  resize(w: number, h: number, ratio: number): void {
    const r = Math.max(0.3, ratio);
    if (this.renderer.getPixelRatio() !== r) {
      this.renderer.setPixelRatio(r);
      this.composer.setPixelRatio(r);
    }
    const size = this.renderer.getSize(new THREE.Vector2());
    if (size.x !== w || size.y !== h) {
      this.renderer.setSize(w, h, false);
      this.composer.setSize(w, h);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
  }

  note(color: RGB, pitch: number, vel: number, durS: number, role?: NoteRole): void {
    if (role === 'bass') {
      this.bassPending = true;
      this.bassEnv = Math.max(this.bassEnv, 0.5 + vel * 0.5);
    } else if (role === 'pad') {
      this.padCol.setRGB(...color);
      this.padUntil = this.time + Math.max(1, durS);
      this.lastPad = this.bt;
      this.requestRetrieve();
    } else {
      this.lastLead = this.bt;
      this.spawnLead(color, pitch, vel);
    }
  }

  caption(): string {
    const f = this.follow;
    if (!f || this.camMode === 'fly' || (this.camMode === 'auto' && !this.autoFollow)) return '';
    if (f.mode === 'table') return `Parcel ${f.id} · waiting for a robot`;
    if (f.mode === 'robot') {
      const bot = this.floor.robotNumber(f.bot!);
      return f.bin === undefined ? `Parcel ${f.id} · loading onto robot ${bot}` : `Parcel ${f.id} · robot ${bot} → bin ${this.floor.bins[f.bin]!.code}`;
    }
    const where =
      f.mode === 'fixed'
        ? 'stored'
        : f.dest < 0
          ? f.mode === 'loop' || f.pathKind === 'lane'
            ? 'to the store'
            : 'in the store'
          : f.pathKind === 'back'
            ? `out of the store → chute ${f.dest + 1}`
            : this.stationOf.has(f.dest)
              ? 'to the robots'
              : `chute ${f.dest + 1}`;
    return `Parcel ${f.id} · ${where}`;
  }

  controls(): SceneControl[] {
    return [
      {
        kind: 'choice', id: 'cam', label: 'Camera', title: 'Fly around the hall, follow a parcel, or switch every 8 bars', value: this.camMode,
        options: [
          { value: 'auto', label: 'Auto' },
          { value: 'fly', label: 'Fly' },
          { value: 'follow', label: 'Follow' },
        ],
      },
      { kind: 'action', id: 'next', label: 'Next parcel', title: 'Follow another parcel' },
    ];
  }

  setControl(id: string, value: boolean | string): void {
    if (id === 'cam' && (value === 'auto' || value === 'fly' || value === 'follow')) {
      this.camMode = value;
      this.follow = null;
      this.autoFollow = false;
      try {
        localStorage.setItem(CAM_KEY, value);
      } catch {
        /* no storage */
      }
    } else if (id === 'next') {
      if (this.camMode === 'fly') this.camMode = 'follow';
      this.autoFollow = true;
      this.pickFollow();
    }
  }

  render(i: SceneInput): void {
    const dt = Math.min(0.1, i.dt);
    this.time += dt;
    // Beat clock: follow Drift's beats; on a jump, move forward to the same phase.
    const prev = this.bt;
    if (Number.isNaN(this.lastBeats)) this.offset = -i.beats;
    else {
      const d = i.beats - this.lastBeats;
      if (d < 0 || d > 0.5) this.offset = Math.ceil(prev - i.beats);
    }
    this.lastBeats = i.beats;
    this.bt = Math.max(prev, i.beats + this.offset);
    const bt = this.bt;
    const crossed = Math.floor(bt) !== Math.floor(prev);

    this.kick += (i.kick - this.kick) * Math.min(1, dt * 20);
    this.snare += (i.snare - this.snare) * Math.min(1, dt * 20);
    this.hat += (i.hat - this.hat) * Math.min(1, dt * 20);
    this.bassEnv *= Math.exp(-dt * 4);
    i.cols.forEach((c, k) => {
      const t = this.cols[k];
      if (!t) return;
      this.c.setRGB(...c);
      const m = Math.max(this.c.r, this.c.g, this.c.b, 0.05);
      t.lerp(this.c.multiplyScalar(1 / m), Math.min(1, dt * 3));
    });
    const bar = i.playing && i.bar !== undefined ? i.bar : bt / 4;

    if (crossed) {
      for (let b = Math.floor(prev) + 1; b <= Math.floor(bt); b++) this.onBeat(b);
    }
    const liftTrig = this.bassPending || (crossed && bt - this.liftLastMove >= 2);
    if (this.lift.update(bt, liftTrig)) this.bassPending = false;
    if (!this.lift.busy) this.bassPending = false;
    for (const s of this.shuttles) s.runner.update(bt, false);
    // Without pads, call a parcel back from the store every 8 bars.
    if (Math.floor(bar / 8) !== this.retrieveShot) {
      this.retrieveShot = Math.floor(bar / 8);
      if (bt - this.lastPad > 16) this.requestRetrieve();
    }

    // Time of day: "dusk" (0) is the day look, "night" (1) the club.
    this.applyTheme(1 - smooth01((i.tod ?? 0) * 1.6 - 0.3));

    this.floor.update(dt, bt, {
      kick: this.kick,
      snare: this.snare,
      hat: this.hat,
      day: this.day,
      dayShown: !!this.dayShown,
      cols: this.cols,
      pad: this.time < this.padUntil ? this.padCol : null,
      bar,
    });
    this.updateParcels(dt);
    this.updateTrays(dt);
    this.updateStore();
    this.updateClub(dt, bar);
    this.updateForklifts(dt, prev);
    this.updateCamera(dt, bar, i.travelSpeed);
    this.bloom.strength = (0.75 + this.kick * 0.35 + this.snare * 0.15) * (1 - this.day);
    this.bloom.enabled = this.day < 0.98;
    this.composer.render(dt);
  }

  // ---------- music events ----------
  private onBeat(b: number): void {
    this.floor.beat(b);
    if (b % 2 === 0) this.floor.tableBeat(b / 2, this.cols);
    // Keep parcels flowing when no lead plays; fewer when one does.
    const quiet = b - this.lastLead > 2;
    if (Math.random() < (quiet ? 0.8 : 0.25)) this.spawn(Math.floor(Math.random() * 4), null, false);
  }

  /** Robots take parcels from the stations and tip them into bins. */
  private onFleet(e: FleetEvent): void {
    if (e.t === 'load') {
      const p = this.stationQueue[e.station]!.shift();
      if (!p) return;
      p.mode = 'robot';
      p.bot = e.bot;
      p.rideAt = Math.floor(this.bt);
      p.dropAt = undefined;
      this.botParcel.set(e.bot, p);
    } else if (e.t === 'loaded') {
      const p = this.botParcel.get(e.bot);
      if (p) p.bin = e.bin;
    } else if (e.t === 'drop') {
      const p = this.botParcel.get(e.bot);
      if (p) p.dropAt = this.bt;
    } else if (e.t === 'dropped') {
      const p = this.botParcel.get(e.bot);
      if (p) p.dead = true;
      this.botParcel.delete(e.bot);
    }
  }

  private spawnLead(color: RGB, pitch: number, vel: number): void {
    const pair = pitch >= 0.5 ? [2, 3] : [0, 1];
    if (Math.random() < 0.5) pair.reverse();
    for (const k of pair) {
      const lane = this.lanes[k]!;
      lane.doorFlash = 0.6 + vel * 0.4;
      lane.doorCol.setRGB(...color);
      if (this.bt - lane.lastSpawn >= 0.5 && this.spawn(k, color, true)) return;
    }
  }

  private requestRetrieve(): void {
    if (this.retrieving >= 2 || this.lift.steps.length > 8) return;
    const full = this.slots.filter((s) => s.parcel && !s.reserved && s.parcel.mode === 'fixed');
    if (!full.length) return;
    this.retrieve(pick(full));
  }

  // ---------- parcels ----------
  private newParcel(): Parcel | null {
    if (this.parcels.length >= MAX_PARCELS) return null;
    const env = Math.random() < 0.18;
    const p: Parcel = {
      id: this.nextId++,
      w: env ? rnd(0.7, 0.9) : rnd(0.35, 0.95),
      h: env ? rnd(0.06, 0.12) : rnd(0.22, 0.7),
      d: env ? rnd(0.5, 0.7) : rnd(0.35, 0.85),
      col: new THREE.Color(env ? pick([0xe8e6e0, 0xd6d3cc, 0xbfc4cc]) : pick(PARCEL_COLS)),
      glow: new THREE.Color(),
      lead: false,
      scanned: false,
      flash: 0,
      dest: Math.floor(Math.random() * CHUTES.length),
      mode: 'fixed',
      pathKind: 'lane',
      lane: 0,
      t0: 0,
      t1: 1,
      ease: 0,
      sPrev: 0,
      sIn: 0,
      tIn: 0,
      divertAt: 0,
      tray: -1,
      from: new THREE.Vector3(),
      to: new THREE.Vector3(),
      off: new THREE.Vector3(),
      shuttle: 0,
      pos: new THREE.Vector3(),
      q: new THREE.Quaternion(),
      yawQ: new THREE.Quaternion().setFromAxisAngle(UP, rnd(-0.25, 0.25)),
      vel: new THREE.Vector3(),
      dead: false,
    };
    this.parcels.push(p);
    return p;
  }

  /** Puts a parcel on a lane, timed to land on a free tray on a beat. Returns false if the lane is full. */
  private spawn(k: number, color: RGB | null, lead: boolean): boolean {
    const lane = this.lanes[k]!;
    const bt = this.bt;
    let arrive = Math.max(Math.ceil(bt + lane.path.len / BEAT_M), lane.lastArrive + 2);
    let tries = 0;
    while (this.trayOwner[trayAt(INDUCT[k]!, arrive)] && tries++ < 6) arrive++;
    const tray = trayAt(INDUCT[k]!, arrive);
    if (this.trayOwner[tray]) return false;
    const p = this.newParcel();
    if (!p) return false;
    lane.lastArrive = arrive;
    lane.lastSpawn = bt;
    this.trayOwner[tray] = p;
    p.tray = tray;
    p.lane = k;
    p.lead = lead;
    if (lead && color) p.glow.setRGB(...color);
    const free = this.slots.filter((s) => !s.parcel && !s.reserved);
    const toStore = this.parcels.filter((x) => x.dest < 0 && x.mode !== 'fixed' && x.pathKind !== 'back').length;
    if (free.length > 4 && toStore < 3 && this.lift.steps.length < 6 && Math.random() < 0.14) {
      const slot = pick(free);
      slot.reserved = true;
      p.slot = slot;
      p.dest = -1;
    }
    if (!lead) p.glow.copy(p.dest >= 0 ? this.chutes[p.dest]!.col : this.white);
    this.onPath(p, lane.path, 'lane', bt, arrive, 0);
    return true;
  }

  private onPath(p: Parcel, path: Path, kind: Parcel['pathKind'], t0: number, t1: number, ease: 0 | 1): void {
    p.mode = 'path';
    p.path = path;
    p.pathKind = kind;
    p.t0 = t0;
    p.t1 = Math.max(t0 + 0.05, t1);
    p.ease = ease;
    p.sPrev = 0;
  }

  private tween(p: Parcel, to: V3, beats: number, done: () => void): void {
    p.mode = 'tween';
    p.from.copy(p.pos);
    p.to.copy(to);
    p.t0 = this.bt;
    p.t1 = this.bt + beats;
    p.done = done;
  }

  private induct(p: Parcel, s: number, t: number): void {
    p.mode = 'loop';
    p.sIn = s;
    p.tIn = t;
    p.sPrev = s;
    const target = p.dest >= 0 ? this.chutes[p.dest]!.s : STORE_OUT;
    p.divertAt = t + beatsAlong(s, target);
  }

  private updateParcels(dt: number): void {
    const bt = this.bt;
    for (const p of this.parcels) {
      const before = this.p.copy(p.pos);
      switch (p.mode) {
        case 'path': {
          const path = p.path!;
          let f = clamp((bt - p.t0) / (p.t1 - p.t0), 0, 1);
          if (p.ease) f = f * f;
          const s = f * path.len;
          path.at(s, p.pos, this.t);
          this.orient(p, this.t);
          if (p.pathKind === 'lane') {
            const lane = this.lanes[p.lane]!;
            if (p.sPrev < lane.tunnelS && s >= lane.tunnelS) this.scan(p, lane.tunnel);
          }
          p.sPrev = s;
          if (bt >= p.t1) this.pathEnd(p);
          break;
        }
        case 'loop': {
          const s = p.sIn + (Math.min(bt, p.divertAt) - p.tIn) * BEAT_M;
          loopAt(s, p.pos, this.t);
          this.orient(p, this.t);
          for (const lt of this.loopTunnels) {
            if (Math.floor((p.sPrev - lt.s) / LOOP_LEN) !== Math.floor((s - lt.s) / LOOP_LEN)) this.scan(p, lt.t);
          }
          p.sPrev = s;
          if (bt >= p.divertAt) this.divert(p);
          break;
        }
        case 'tween': {
          const f = clamp((bt - p.t0) / (p.t1 - p.t0), 0, 1);
          p.pos.lerpVectors(p.from, p.to, easeIO(f));
          if (f >= 1) {
            const d = p.done;
            p.done = undefined;
            d?.();
          }
          break;
        }
        case 'carriage':
          p.pos.set(LIFT_X + p.off.x, animAt(this.liftAnim, bt), p.off.z);
          break;
        case 'shuttle': {
          const sh = this.shuttles[p.shuttle]!;
          p.pos.set(SHUTTLE_X, LEVELS[p.shuttle]!, animAt(sh.anim, bt));
          break;
        }
        case 'queue': {
          const k = this.queue.indexOf(p);
          const target = this.intake.len - 0.5 - Math.max(0, k) * 1.2;
          p.sPrev += (target - p.sPrev) * Math.min(1, dt * 4);
          this.intake.at(p.sPrev, p.pos, this.t);
          this.orient(p, this.t);
          break;
        }
        case 'table': {
          const q = this.stationQueue[p.station!]!;
          this.floor.tableSlot(p.station!, Math.max(0, q.indexOf(p)), this.p);
          p.pos.lerp(this.p, Math.min(1, dt * 8));
          this.orient(p, this.t.set(0, 0, 1));
          break;
        }
        case 'robot': {
          const yaw = this.floor.robotTop(p.bot!, this.p);
          if (p.dropAt !== undefined) {
            // Tipped off the robot into its bin.
            const f = clamp(bt - p.dropAt, 0, 1);
            this.floor.binPos(p.bin!, this.n);
            p.pos.lerpVectors(this.p, this.n, f * f);
          } else if (bt - p.rideAt! < 1) {
            this.floor.tableSlot(p.station!, 0, this.n);
            p.pos.lerpVectors(this.n, this.p, easeIO(clamp(bt - p.rideAt!, 0, 1)));
          } else p.pos.copy(this.p);
          this.orient(p, this.t.set(Math.sin(yaw), 0, Math.cos(yaw)));
          break;
        }
        case 'fixed':
          break;
      }
      if (dt > 0) p.vel.subVectors(p.pos, before).divideScalar(dt);
      p.flash = Math.max(0, p.flash - dt * 2.5);
    }
    // Drop finished parcels.
    if (this.parcels.some((p) => p.dead)) {
      this.parcels = this.parcels.filter((p) => !p.dead);
      if (this.follow?.dead) this.follow = null;
    }
    this.writeParcels();
  }

  private orient(p: Parcel, tan: V3): void {
    if (tan.lengthSq() < 1e-6) return;
    this.m4.lookAt(ZERO, tan, UP);
    p.q.setFromRotationMatrix(this.m4).multiply(p.yawQ);
  }

  private scan(p: Parcel, t: Tunnel): void {
    p.scanned = true;
    p.flash = 1;
    t.flash = 1;
    t.col.copy(p.glow);
  }

  private pathEnd(p: Parcel): void {
    switch (p.pathKind) {
      case 'lane':
        this.induct(p, INDUCT[p.lane]!, p.t1);
        break;
      case 'back':
        this.induct(p, STORE_BACK, p.t1);
        break;
      case 'chute': {
        const ch = this.chutes[p.dest]!;
        ch.flash = 1;
        const st = this.stationOf.get(p.dest);
        if (st !== undefined && this.stationQueue[st]!.length < 4) {
          // Onto the roller table, to wait for a robot.
          p.mode = 'table';
          p.station = st;
          this.stationQueue[st]!.push(p);
        } else {
          if (st === undefined) this.floor.flashCage(p.dest, ch.col);
          p.dead = true;
        }
        break;
      }
      case 'intake':
        p.mode = 'queue';
        p.sPrev = this.intake.len - 0.5;
        this.queue.push(p);
        this.store(p);
        break;
    }
  }

  private divert(p: Parcel): void {
    if (p.tray >= 0) {
      if (this.trayOwner[p.tray] === p) this.trayOwner[p.tray] = null;
      this.trayTilt[p.tray] = p.dest >= 0 ? this.chutes[p.dest]!.side : 1;
      p.tray = -1;
    }
    if (p.dest >= 0) this.onPath(p, this.chutes[p.dest]!.path, 'chute', p.divertAt, p.divertAt + 1.5, 1);
    else this.onPath(p, this.intake, 'intake', p.divertAt, p.divertAt + Math.max(1, Math.round(this.intake.len / BEAT_M)), 0);
  }

  // ---------- lift and store ----------
  private liftTo(y: number): Step {
    return {
      gate: true,
      skip: () => Math.abs(this.liftAnim.b - y) < 0.01 && this.bt >= this.liftAnim.t1,
      run: () => {
        const a = animAt(this.liftAnim, this.bt);
        const d = 0.5 + Math.abs(y - a) * 0.08;
        this.liftAnim = { a, b: y, t0: this.bt, t1: this.bt + d };
        this.liftLastMove = this.bt + d;
        return d;
      },
    };
  }

  private shuttleTo(k: number, z: number): Step {
    return {
      run: () => {
        const sh = this.shuttles[k]!;
        const a = animAt(sh.anim, this.bt);
        const d = 0.25 + Math.abs(z - a) / 8;
        sh.anim = { a, b: z, t0: this.bt, t1: this.bt + d };
        return d;
      },
    };
  }

  private store(p: Parcel): void {
    const slot = p.slot!;
    const k = slot.level;
    const y = LEVELS[k]!;
    const sh = this.shuttles[k]!;
    this.lift.steps.push(
      this.liftTo(LOOP_Y),
      {
        run: () => {
          this.queue.splice(this.queue.indexOf(p), 1);
          this.tween(p, v(LIFT_X - 0.1, LOOP_Y, -0.9), 0.5, () => {
            p.mode = 'carriage';
            p.off.set(-0.1, 0, -0.9);
          });
          return () => p.mode === 'carriage';
        },
      },
      this.liftTo(y),
      {
        run: () => {
          sh.runner.steps.push(
            this.shuttleTo(k, 0),
            {
              run: () => {
                this.tween(p, v(SHUTTLE_X, y, 0), 0.4, () => {
                  p.mode = 'shuttle';
                  p.shuttle = k;
                });
                return 0.45;
              },
            },
            this.shuttleTo(k, slot.z),
            {
              run: () => {
                this.tween(p, v(SLOT_X, y, slot.z), 0.4, () => {
                  p.mode = 'fixed';
                  slot.parcel = p;
                  slot.reserved = false;
                  this.orient(p, this.t.set(1, 0, 0));
                });
                return 0.45;
              },
            },
            this.shuttleTo(k, 0),
          );
          return () => p.mode !== 'carriage';
        },
      },
    );
  }

  private retrieve(slot: Slot): void {
    const p = slot.parcel!;
    const k = slot.level;
    const y = LEVELS[k]!;
    const sh = this.shuttles[k]!;
    slot.reserved = true;
    this.retrieving++;
    this.lastRetrieve = this.bt;
    p.dest = Math.floor(Math.random() * CHUTES.length);
    p.glow.copy(this.chutes[p.dest]!.col);
    p.pathKind = 'back';
    sh.runner.steps.push(
      this.shuttleTo(k, slot.z),
      {
        run: () => {
          this.tween(p, v(SHUTTLE_X, y, slot.z), 0.4, () => {
            p.mode = 'shuttle';
            p.shuttle = k;
            slot.parcel = null;
            slot.reserved = false;
          });
          return 0.45;
        },
      },
      this.shuttleTo(k, 0),
    );
    this.lift.steps.push(
      this.liftTo(y),
      { run: () => () => p.mode === 'shuttle' && this.bt >= sh.anim.t1 && sh.anim.b === 0 },
      {
        run: () => {
          this.tween(p, v(LIFT_X - 0.1, y, 0.9), 0.4, () => {
            p.mode = 'carriage';
            p.off.set(-0.1, 0, 0.9);
          });
          return () => p.mode === 'carriage';
        },
      },
      this.liftTo(LOOP_Y),
      {
        run: () => {
          this.back.at(0, this.p);
          this.tween(p, this.p.clone(), 0.4, () => this.sendBack(p));
          return 0.45;
        },
      },
    );
  }

  private sendBack(p: Parcel): void {
    this.retrieving = Math.max(0, this.retrieving - 1);
    const bt = this.bt;
    let arrive = Math.max(Math.ceil(bt + this.back.len / BEAT_M), this.backLast + 2);
    let tries = 0;
    while (this.trayOwner[trayAt(STORE_BACK, arrive)] && tries++ < 10) arrive++;
    const tray = trayAt(STORE_BACK, arrive);
    this.trayOwner[tray] = p;
    p.tray = tray;
    this.backLast = arrive;
    p.scanned = true;
    this.onPath(p, this.back, 'back', bt, arrive, 0);
  }

  private updateStore(): void {
    const bt = this.bt;
    const y = animAt(this.liftAnim, bt);
    this.carriage.position.y = y;
    const moving = bt < this.liftAnim.t1;
    this.liftLamp.color.setRGB(3, 1.4, 0.2).multiplyScalar(moving ? (Math.sin(this.time * 18) > 0 ? 1 : 0.15) : 0.12 + this.bassEnv * 0.6);
    this.shuttles.forEach((s) => (s.mesh.position.z = animAt(s.anim, bt)));
  }

  /** Fills part of the store at the start so pads have something to call back. */
  private prefill(): void {
    for (const s of this.slots) {
      if (Math.random() > 0.45) continue;
      const p = this.newParcel();
      if (!p) return;
      p.mode = 'fixed';
      p.pos.set(SLOT_X, LEVELS[s.level]!, s.z);
      this.orient(p, this.t.set(1, 0, 0));
      s.parcel = p;
    }
  }

  // ---------- per-frame drawing ----------
  private writeParcels(): void {
    const glow = this.glowAttr.array as Float32Array;
    const kick = 0.55 + this.kick * 0.8;
    const o = this.o;
    let k = 0;
    for (const p of this.parcels) {
      if (k >= MAX_PARCELS) break;
      this.n.set(0, 1, 0).applyQuaternion(p.q);
      o.position.copy(p.pos).addScaledVector(this.n, p.h / 2);
      o.quaternion.copy(p.q);
      o.scale.set(p.w, p.h, p.d);
      o.updateMatrix();
      this.parcelMesh.setMatrixAt(k, o.matrix);
      this.parcelMesh.setColorAt(k, p.col);
      if (this.dayShown) {
        // Outline: a slightly larger box drawn inside out; the followed parcel in blue.
        const e = p === this.follow ? 0.12 : 0.05;
        o.scale.set(p.w + e, p.h + e, p.d + e);
        o.updateMatrix();
        this.hull.setMatrixAt(k, o.matrix);
        this.hull.setColorAt(k, this.c.setHex(p === this.follow ? DAY.blue : DAY.ink));
      }
      const g = (p.scanned ? (p.lead ? 0.38 : 0.16) * kick + (p === this.follow ? 0.25 : 0) : p.lead ? 0.25 : 0) * (1 - this.day * 0.85);
      this.c.copy(p.glow).multiplyScalar(g).lerp(this.white, p.flash * 0.8);
      glow[k * 3] = this.c.r + p.flash * 0.6;
      glow[k * 3 + 1] = this.c.g + p.flash * 0.6;
      glow[k * 3 + 2] = this.c.b + p.flash * 0.6;
      o.position.copy(p.pos).addScaledVector(this.n, p.h + 0.004);
      o.quaternion.copy(p.q).multiply(this.qLabel);
      o.scale.set(Math.min(p.w * 0.6, 0.34), Math.min(p.d * 0.6, 0.24), 1);
      o.updateMatrix();
      this.labelMesh.setMatrixAt(k, o.matrix);
      k++;
    }
    this.parcelMesh.count = k;
    this.labelMesh.count = k;
    this.hull.count = this.dayShown ? k : 0;
    this.hull.instanceMatrix.needsUpdate = true;
    if (this.hull.instanceColor) this.hull.instanceColor.needsUpdate = true;
    this.parcelMesh.instanceMatrix.needsUpdate = true;
    this.labelMesh.instanceMatrix.needsUpdate = true;
    if (this.parcelMesh.instanceColor) this.parcelMesh.instanceColor.needsUpdate = true;
    this.glowAttr.needsUpdate = true;
  }

  private updateTrays(dt: number): void {
    const o = this.o;
    const bt = this.bt;
    for (let c = 0; c < TRAYS; c++) {
      loopAt(c * PITCH + bt * BEAT_M, this.p, this.t);
      this.m4.lookAt(ZERO, this.t, UP);
      o.quaternion.setFromRotationMatrix(this.m4);
      const tilt = this.trayTilt[c]!;
      if (tilt) {
        o.quaternion.multiply(this.q.setFromAxisAngle(this.n.set(0, 0, 1), tilt * 0.38));
        this.trayTilt[c] = Math.abs(tilt) < 0.01 ? 0 : tilt * Math.exp(-dt * 3);
      }
      o.position.copy(this.p);
      o.position.y -= 0.07;
      o.scale.set(1, 1, 1);
      o.updateMatrix();
      this.trays.setMatrixAt(c, o.matrix);
    }
    this.trays.instanceMatrix.needsUpdate = true;
  }

  private updateClub(dt: number, bar: number): void {
    const bt = this.bt;
    const ph = bt % 1;
    this.beltTex.offset.y = -((bt * BEAT_M) / 1.2) % 1;
    this.strips.forEach((m, k) => {
      const u = m.uniforms;
      (u.uCol!.value as THREE.Color).copy(this.cols[k % 3]!);
      u.uBeat!.value = bt;
      u.uKick!.value = this.kick + (k === 1 ? this.bassEnv * 0.6 : 0);
      u.uDay!.value = this.day;
    });
    const pad = this.time < this.padUntil ? 1 : 0;
    for (const lane of this.lanes) {
      lane.doorFlash = Math.max(0, lane.doorFlash - dt * 1.5);
      lane.door.color.copy(lane.doorCol).multiplyScalar(0.25 + lane.doorFlash * 3);
      this.tunnelGlow(lane.tunnel, dt);
    }
    for (const lt of this.loopTunnels) this.tunnelGlow(lt.t, dt);
    for (const ch of this.chutes) {
      ch.flash = Math.max(0, ch.flash - dt * 2);
      ch.lamp.color.copy(ch.col).multiplyScalar(0.35 + ch.flash * 3 + this.kick * 0.3);
    }

    // Moving heads: a new figure every bar, moving with the beat.
    const pattern = Math.floor(bar) % 4;
    const swing = Math.sin(Math.PI * (bt % 2));
    this.heads.forEach((h, k) => {
      let rx = 0;
      let rz = 0;
      const side = k % 2 ? 1 : -1;
      if (pattern === 0) {
        rx = 0.55 * swing;
        rz = 0.25 * Math.sin(Math.PI * bt * 0.5);
      } else if (pattern === 1) {
        rx = 0.5 * swing * side;
        rz = 0.4 * Math.cos(Math.PI * bt * 0.5) * side;
      } else if (pattern === 2) {
        rx = 0.45 * Math.cos((Math.PI * bt) / 2 + k);
        rz = 0.45 * Math.sin((Math.PI * bt) / 2 + k);
      } else {
        // Converge on the mirror ball, wobbling on the beat.
        const dx = this.ball.position.x - h.pos.x;
        const dz = this.ball.position.z - h.pos.z;
        rz = Math.atan2(dx, 6) * 0.6 + 0.08 * swing;
        rx = -Math.atan2(dz, 6) * 0.6;
      }
      h.rx += (rx - h.rx) * Math.min(1, dt * 5);
      h.rz += (rz - h.rz) * Math.min(1, dt * 5);
      h.piv.rotation.set(h.rx, 0, h.rz);
      this.c.copy(pad ? this.padCol : this.cols[k % 3]!);
      h.u.uCol.value.copy(this.c);
      h.u.uO.value = 0.16 + this.kick * 0.22 + pad * 0.06;
      if (h.light) {
        h.light.color.copy(this.c);
        h.light.intensity = 260 * (0.6 + this.kick * 0.8);
        h.piv.updateMatrixWorld();
        this.p.set(0, -16, 0).applyMatrix4(h.piv.matrixWorld);
        h.light.target.position.copy(this.p);
        h.light.target.updateMatrixWorld();
      }
    });

    if (this.dayShown) {
      this.hemi.intensity = 1.0 + this.snare * 0.08;
      return;
    }
    // Mirror ball and its spots on walls, floor and ceiling.
    const ba = this.time * 0.35;
    this.ball.rotation.y = ba;
    const ca = Math.cos(ba);
    const sa = Math.sin(ba);
    const B = this.ball.position;
    for (let k = 0; k < this.sparkDirs.length; k++) {
      const d = this.sparkDirs[k]!;
      const dx = d.x * ca - d.z * sa;
      const dz = d.x * sa + d.z * ca;
      const dy = d.y;
      let t = 1e9;
      if (dx) t = Math.min(t, ((dx > 0 ? HX - 0.1 : -HX + 0.1) - B.x) / dx);
      if (dy) t = Math.min(t, ((dy > 0 ? HH - 0.05 : 0.03) - B.y) / dy);
      if (dz) t = Math.min(t, ((dz > 0 ? HZ - 0.1 : -HZ + 0.1) - B.z) / dz);
      this.sparkPos[k * 3] = B.x + dx * t;
      this.sparkPos[k * 3 + 1] = B.y + dy * t;
      this.sparkPos[k * 3 + 2] = B.z + dz * t;
    }
    this.sparkGeo.attributes.position!.needsUpdate = true;
    this.sparkMat.opacity = 0.35 + 0.4 * pad + this.kick * 0.25;
    this.sparkMat.color.copy(this.white).lerp(this.cols[1]!, 0.3);

    // Haze drifts slowly and takes the pad colour.
    this.hazeSeed.forEach((h, k) => {
      this.hazePos[k * 3] = h[0]! + Math.sin(this.time * 0.05 + h[3]!) * 4;
      this.hazePos[k * 3 + 1] = h[1]! + Math.sin(this.time * 0.07 + h[3]! * 2) * 0.8;
      this.hazePos[k * 3 + 2] = h[2]! + Math.cos(this.time * 0.04 + h[3]!) * 4;
    });
    this.hazeGeo.attributes.position!.needsUpdate = true;
    this.hazeMat.color.setRGB(0.16, 0.13, 0.26).lerp(this.c.copy(this.padCol).multiplyScalar(0.3), pad * 0.6);


    this.strobe.color.setRGB(1, 1, 1).multiplyScalar(this.snare * this.snare * 4 + (1 - ph) ** 8 * 0.3);
    this.hemi.intensity = 0.45 + this.snare * 0.25;
  }

  private tunnelGlow(t: Tunnel, dt: number): void {
    t.flash = Math.max(0, t.flash - dt * 3);
    t.ring.color.copy(t.col).multiplyScalar(0.25 + t.flash * 3).lerp(this.white, t.flash * 0.4);
    if (this.day > 0) t.ring.color.lerp(this.c.setHex(DAY.orangeL).lerp(this.white, t.flash * 0.8), this.day);
    t.curtain.opacity = (0.1 + t.flash * 0.45 + this.snare * 0.35) * (1 - this.day);
  }

  private updateForklifts(dt: number, prevBt: number): void {
    const bt = this.bt;
    const db = bt - prevBt;
    void dt;
    for (const f of this.forklifts) {
      // Surge on every beat: fast on the downbeat, nearly still between.
      const surge = 1 - Math.cos(2 * Math.PI * (bt % 1));
      f.s += f.speed * db * surge;
      f.route.at(f.s, this.p, this.t);
      f.g.position.copy(this.p);
      f.g.lookAt(this.p.x + this.t.x, 0, this.p.z + this.t.z);
      f.forks.position.y = 0.15 + this.snare * 0.9;
      f.beacon.color.setRGB(3, 1.3, 0.1).multiplyScalar(0.1 + (1 - (bt % 1)) ** 4);
    }
  }

  // ---------- camera ----------
  private pickFollow(): void {
    const fresh = this.parcels.filter((p) => p.mode === 'path' && p.pathKind === 'lane' && (p.path?.len ?? 0) * clamp((this.bt - p.t0) / (p.t1 - p.t0), 0, 1) < 20);
    const pool = fresh.length ? fresh : this.parcels.filter((p) => p.mode === 'loop');
    const leads = pool.filter((p) => p.lead);
    const stores = pool.filter((p) => p.dest < 0);
    const r = Math.random();
    this.follow = (r < 0.35 && stores.length ? pick(stores) : leads.length && r < 0.7 ? pick(leads) : pool.length ? pick(pool) : null) ?? null;
  }

  private updateCamera(dt: number, bar: number, travel: number): void {
    const shot = Math.floor(bar / 8);
    if (this.camMode === 'auto' && shot !== this.lastShotBar) {
      this.lastShotBar = shot;
      this.autoFollow = !this.autoFollow;
      if (this.autoFollow) this.pickFollow();
    }
    const following = this.camMode === 'follow' || (this.camMode === 'auto' && this.autoFollow);
    if (following && !this.follow) {
      if (this.camMode === 'follow' || bar - shot * 8 < 6) this.pickFollow();
      if (!this.follow && this.camMode === 'auto') this.autoFollow = false;
    }
    const p = following ? this.follow : null;
    if (p && p.mode === 'fixed' && p.pathKind !== 'back') this.follow = null;
    if (p) {
      // Back in fly mode, the tour starts afresh from wherever the camera is.
      this.tour = null;
      const c = this.p.copy(p.pos);
      c.y += p.h / 2;
      if (p.mode === 'carriage' || p.mode === 'shuttle' || p.mode === 'fixed' || (p.mode === 'tween' && p.pos.x > 44)) {
        this.want.set(43.5, clamp(c.y + 1.6, 2, 10), c.z - 5);
        this.wantLook.copy(c);
      } else {
        const h = this.n.set(p.vel.x, 0, p.vel.z);
        if (h.lengthSq() > 0.04) this.fwd.lerp(h.normalize(), 1 - Math.exp(-dt * 2)).normalize();
        const side = this.t.set(-this.fwd.z, 0, this.fwd.x);
        this.want.copy(c).addScaledVector(this.fwd, -4.6).addScaledVector(side, 2.2);
        this.want.y = clamp(c.y + 2.6, 1.2, HH - 0.8);
        this.wantLook.copy(c).addScaledVector(this.fwd, 2.2);
      }
    } else this.flyTour(dt, travel);
    // Stay inside the hall.
    this.want.x = clamp(this.want.x, -HX + 1.5, HX - 1.5);
    this.want.z = clamp(this.want.z, -HZ + 1.5, HZ - 1.5);
    const k = this.first ? 1 : 1 - Math.exp(-dt * (p ? 2.6 : 1.2));
    this.camera.position.lerp(this.want, k);
    this.look.lerp(this.wantLook, this.first ? 1 : 1 - Math.exp(-dt * 3.2));
    this.first = false;
    this.camera.lookAt(this.look);
  }

  // ---------- building ----------
  private buildEnv(): void {
    const pm = new THREE.PMREMGenerator(this.renderer);
    const es = new THREE.Scene();
    es.background = new THREE.Color(0x05050a);
    const add = (c: number, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(6, 1, 6), new THREE.MeshBasicMaterial({ color: c }));
      m.position.set(x, y, z);
      es.add(m);
    };
    add(0x6a4cff, -10, 6, 0);
    add(0xff3fa0, 10, 6, 0);
    add(0x30d5ff, 0, 8, 10);
    add(0x9999aa, 0, 10, -10);
    this.nightEnv = pm.fromScene(es, 0.04).texture;
    this.scene.environment = this.nightEnv;
    pm.dispose();
    this.hemi = new THREE.HemisphereLight(0x6a6aa0, 0x1a1410, 0.45);
    this.scene.add(this.hemi);
    const key = new THREE.DirectionalLight(0xb0b8ff, 0.3);
    key.position.set(-10, 20, 8);
    this.scene.add(key);
    this.keyLight = key;
  }

  private boxes = new Map<string, { mat: THREE.Material; list: number[][]; only: 'day' | 'night' | undefined }>();
  box(key: string, mat: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number, col?: number, ry = 0): void {
    let e = this.boxes.get(key);
    if (!e) this.boxes.set(key, (e = { mat, list: [], only: this.only }));
    e.list.push([x, y, z, sx, sy, sz, col ?? -1, ry]);
  }
  private flushBoxes(): void {
    const g = new THREE.BoxGeometry(1, 1, 1);
    const o = this.o;
    const edges = new THREE.EdgesGeometry(g).getAttribute('position');
    for (const { mat, list, only } of this.boxes.values()) {
      const im = new THREE.InstancedMesh(g, mat, list.length);
      list.forEach((e, k) => {
        o.position.set(e[0]!, e[1]!, e[2]!);
        o.rotation.set(0, e[7]!, 0);
        o.scale.set(e[3]!, e[4]!, e[5]!);
        o.updateMatrix();
        im.setMatrixAt(k, o.matrix);
        if (e[6]! >= 0) im.setColorAt(k, this.c.setHex(e[6]!));
      });
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      this.put(im, only);
      // Day look: black outlines on solid parts (not on lights, lines or thin rods).
      if (only === 'night' || !(mat instanceof THREE.MeshStandardMaterial)) continue;
      const pos: number[] = [];
      const vtx = new THREE.Vector3();
      for (const e of list) {
        const dims = [e[3]!, e[4]!, e[5]!].sort((a, b) => a - b);
        if (dims[1]! < 0.09) continue;
        o.position.set(e[0]!, e[1]!, e[2]!);
        o.rotation.set(0, e[7]!, 0);
        o.scale.set(e[3]!, e[4]!, e[5]!);
        o.updateMatrix();
        for (let j = 0; j < edges.count; j++) {
          vtx.fromBufferAttribute(edges, j).applyMatrix4(o.matrix);
          pos.push(vtx.x, vtx.y, vtx.z);
        }
      }
      if (!pos.length) continue;
      const lg = new THREE.BufferGeometry();
      lg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      this.put(new THREE.LineSegments(lg, this.ink), 'day');
    }
    this.boxes.clear();
  }

  private mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    this.put(m);
    return m;
  }

  /** Adds to the scene; objects of one look are shown only in that look. */
  put(obj: THREE.Object3D, only = this.only): void {
    this.scene.add(obj);
    if (only === 'day') this.dayOnly.push(obj);
    else if (only === 'night') this.nightOnly.push(obj);
  }

  /** Black outline for a mesh, shown by day. */
  inkify(m: THREE.Mesh, angle = 25): void {
    const l = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, angle), this.ink);
    m.add(l);
    this.dayOnly.push(l);
  }

  /** A material that takes another colour (and a matte finish) by day. */
  private theme<M extends THREE.MeshStandardMaterial>(m: M, day: number, rough = 0.85, metal = 0.05): M {
    this.themed.push({ m, n: m.color.clone(), d: new THREE.Color(day), nr: m.roughness, dr: rough, nm: m.metalness, dm: metal });
    return m;
  }

  std(color: number, rough = 0.7, metal = 0.2, day?: number): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
    return day === undefined ? m : this.theme(m, day);
  }

  /** Blends between the club (0) and the day look (1). */
  private applyTheme(day: number): void {
    if (Math.abs(day - this.day) < 0.002 && this.dayShown !== null) return;
    this.day = day;
    for (const t of this.themed) {
      t.m.color.lerpColors(t.n, t.d, day);
      t.m.roughness = t.nr + (t.dr - t.nr) * day;
      t.m.metalness = t.nm + (t.dm - t.nm) * day;
    }
    const bg = this.scene.background as THREE.Color;
    bg.setHex(0x0b0910).lerp(this.c.setHex(DAY.bg), day);
    const fog = this.scene.fog as THREE.FogExp2;
    fog.color.copy(bg);
    fog.density = 0.017 + (0.009 - 0.017) * day;
    this.renderer.toneMappingExposure = 1.15 - 0.2 * day;
    this.hemi.color.setHex(0x6a6aa0).lerp(this.c.setHex(0xffffff), day);
    this.hemi.groundColor.setHex(0x1a1410).lerp(this.c.setHex(0xc9cfd6), day);
    this.hemi.intensity = 0.45 + 0.55 * day;
    this.keyLight.color.setHex(0xb0b8ff).lerp(this.white, day);
    this.keyLight.intensity = 0.3 + 0.7 * day;
    this.cageLine.color.setHex(0x8a8f96).lerp(this.c.setHex(DAY.tealD), day);
    const show = day > 0.5;
    if (show === this.dayShown) return;
    this.dayShown = show;
    for (const o of this.dayOnly) o.visible = show;
    for (const o of this.nightOnly) o.visible = !show;
    this.scene.environment = show ? null : this.nightEnv;
    // Flat, bright colours by day, like the illustration; filmic tone mapping for the club.
    this.renderer.toneMapping = show ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
    drawBelt(this.beltTex, show);
  }

  private buildHall(): void {
    const concrete = canvasTex(256, 256, (g) => {
      noise(g, 256, 256, 120, 40);
      for (let k = 0; k < 50; k++) {
        const c = Math.random() < 0.5 ? 60 : 180;
        g.fillStyle = `rgba(${c},${c},${c},0.07)`;
        g.beginPath();
        g.arc(Math.random() * 256, Math.random() * 256, 8 + Math.random() * 40, 0, 7);
        g.fill();
      }
      g.strokeStyle = 'rgba(25,25,25,0.7)';
      g.lineWidth = 2;
      g.strokeRect(0, 0, 256, 256);
    });
    concrete.repeat.set(20, 11);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(HX * 2, HZ * 2),
      new THREE.MeshStandardMaterial({ color: 0x7c7c82, map: concrete, roughnessMap: concrete, roughness: 0.55, metalness: 0.05 }),
    );
    floor.rotation.x = -Math.PI / 2;
    this.put(floor, 'night');
    // Walkway lines.
    const yel = new THREE.MeshBasicMaterial({ color: 0x8a7420 });
    for (const z of [-24.6, -31.5, 16.5, 24.8]) this.box('line', yel, 10, 0.012, z, 100, 0.01, 0.15);
    for (const x of [-56, 53.4]) this.box('line', yel, x, 0.012, 0, 0.15, 0.01, 60);

    const ribs = canvasTex(128, 128, (g) => {
      g.fillStyle = '#26282e';
      g.fillRect(0, 0, 128, 128);
      g.fillStyle = '#1b1c21';
      for (let y = 0; y < 128; y += 16) g.fillRect(0, y, 128, 5);
    });
    const wallMat = (rx: number, ry: number) => {
      const t = ribs.clone();
      t.repeat.set(rx, ry);
      t.needsUpdate = true;
      return new THREE.MeshStandardMaterial({ map: t, roughness: 0.85, metalness: 0.3, side: THREE.DoubleSide });
    };
    const wx = wallMat(30, 4);
    const wz = wallMat(16, 4);
    for (const z of [-HZ, HZ]) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(HX * 2, HH), wx);
      w.position.set(0, HH / 2, z);
      this.put(w, 'night');
    }
    for (const x of [-HX, HX]) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(HZ * 2, HH), wz);
      w.position.set(x, HH / 2, 0);
      w.rotation.y = Math.PI / 2;
      this.put(w, 'night');
    }
    const ceilT = ribs.clone();
    ceilT.repeat.set(40, 1);
    ceilT.rotation = Math.PI / 2;
    ceilT.needsUpdate = true;
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(HX * 2, HZ * 2), new THREE.MeshStandardMaterial({ map: ceilT, color: 0x77777a, roughness: 0.9, metalness: 0.2 }));
    ceil.rotation.x = Math.PI / 2;
    ceil.position.y = HH;
    this.put(ceil, 'night');

    const steel = this.std(0x4c515a, 0.5, 0.7, DAY.steel);
    for (let x = -60; x <= 60; x += 10) this.box('steel', steel, x, HH - 0.5, 0, 0.35, 0.8, HZ * 2);
    for (let z = -32; z <= 32; z += 8) this.box('steel', steel, 0, HH - 0.12, z, HX * 2, 0.18, 0.18);
    // Columns: red at the foot, as in the photos.
    const col = this.std(0x3a3d45, 0.6, 0.6, 0xf3f4f6);
    const colRed = this.std(0x7a1a20, 0.6, 0.3, 0xe2231a);
    for (let x = -44; x <= 56; x += 25) {
      for (const z of [-32.5, 32.5]) {
        this.box('colred', colRed, x, 0.9, z, 0.76, 1.8, 0.76);
        this.box('col', col, x, 1.8 + (HH - 1.8) / 2, z, 0.7, HH - 1.8, 0.7);
      }
    }
    // Ducts and sprinkler mains.
    const duct = this.std(0x9aa0a8, 0.35, 0.9, 0xd5d9de);
    for (const z of [-27, 27]) {
      const d = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, HX * 2, 20), duct);
      d.rotation.z = Math.PI / 2;
      d.position.set(0, HH - 1.4, z);
      this.put(d);
      this.inkify(d, 40);
    }
    const spr = this.std(0xa01818, 0.5, 0.4, DAY.red);
    for (const z of [-20, 0, 20]) {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, HX * 2, 6), spr);
      pipe.rotation.z = Math.PI / 2;
      pipe.position.set(0, HH - 0.25, z);
      this.put(pipe);
    }
    // High-bay lamps, mostly off; a few glow warm.
    const lampOn = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.2, 1.0, 0.7) });
    const lampOff = new THREE.MeshBasicMaterial({ color: 0x1e1e22 });
    const lampG = new THREE.CylinderGeometry(0.45, 0.6, 0.3, 16);
    for (let x = -55; x <= 55; x += 15) {
      for (const z of [-24, -8, 8, 24]) {
        const m = new THREE.Mesh(lampG, Math.random() < 0.25 ? lampOn : lampOff);
        m.position.set(x, HH - 0.6, z);
        this.put(m, 'night');
      }
    }
    // Strobe panels on the ceiling.
    this.strobe = new THREE.MeshBasicMaterial({ color: 0x000000 });
    this.only = 'night';
    for (let x = -40; x <= 40; x += 20) this.box('strobe', this.strobe, x, HH - 0.3, 0, 2.4, 0.08, 0.5);
    this.only = undefined;

    // Dock doors on the right wall (behind the store) with traffic lights.
    const door = this.std(0x2c3038, 0.6, 0.5, 0xd5dae0);
    const amber = new THREE.MeshBasicMaterial({ color: new THREE.Color(2, 1.1, 0.1) });
    for (const z of [-24, -12, 12, 24]) {
      this.box('door', door, HX - 0.15, 2.6, z, 0.2, 5.2, 4.2);
      this.box('doorled', amber, HX - 0.3, 5.4, z, 0.1, 0.1, 4.4);
    }
    // Mezzanine for the high infeeds, with stairs.
    const grate = this.std(0x3a3e45, 0.6, 0.7, 0xc9ced4);
    const rail = this.std(0xd9a400, 0.5, 0.4);
    this.box('grate', grate, -48, 6.15, -24.4, 28, 0.12, 2.2);
    this.box('rail', rail, -48, 7.2, -25.4, 28, 0.06, 0.06);
    for (let x = -62; x <= -34; x += 2) this.box('rail', rail, x, 6.65, -25.4, 0.06, 1.1, 0.06);
    for (let k = 0; k < 20; k++) this.box('grate', grate, -33 + k * 0.6, 6.0 - k * 0.3, -24.4, 0.6, 0.08, 1.2);
    for (let x = -60; x <= -36; x += 6) this.box('steel', steel, x, 3.05, -25.3, 0.2, 6.1, 0.2);
    // Control room with lit windows.
    this.box('room', this.std(0x30343b, 0.6, 0.4, DAY.wall), -30, 1.7, 26, 10, 3.4, 5);
    const win = new THREE.Mesh(new THREE.PlaneGeometry(8.6, 1.3), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 0.55, 1.1) }));
    win.position.set(-30, 2.2, 23.48);
    win.rotation.y = Math.PI;
    this.put(win);
    // Pallets with wrapped goods along the walls.
    const pal = this.std(0x8a6a44, 0.9, 0);
    const wrap = new THREE.MeshStandardMaterial({ color: 0xd8d4cc, roughness: 0.35, metalness: 0 });
    const stack = (x: number, z: number) => {
      const h = rnd(0.8, 2);
      this.box('pal', pal, x, 0.07, z, 1.2, 0.14, 1);
      this.box('wrap', wrap, x, 0.14 + h / 2, z, 1.15, h, 0.95);
    };
    for (let x = -54; x < 40; x += 1.6) if (Math.random() < 0.65) stack(x, -32.6);
    for (let k = 0; k < 18; k++) stack(rnd(-58, -44), rnd(0, 20));
    for (let x = -20; x < 40; x += 1.6) if (Math.random() < 0.5) stack(x, 32.6);
  }

  private buildConveyors(): void {
    this.beltTex = canvasTex(32, 64, (g) => {
      g.fillStyle = '#1f2125';
      g.fillRect(0, 0, 32, 64);
      g.fillStyle = '#34373d';
      for (let y = 0; y < 64; y += 8) g.fillRect(0, y, 32, 3);
    });
    this.beltTex.repeat.set(1, 1 / 1.2);
    const beltMat = this.theme(new THREE.MeshStandardMaterial({ map: this.beltTex, roughness: 0.55, metalness: 0.1, side: THREE.DoubleSide }), 0xffffff);
    const frameMat = this.theme(new THREE.MeshStandardMaterial({ color: 0x2b5ea8, roughness: 0.4, metalness: 0.6, side: THREE.DoubleSide }), DAY.teal);
    const chuteMat = this.theme(new THREE.MeshStandardMaterial({ color: 0xa8b0ba, roughness: 0.3, metalness: 0.9, side: THREE.DoubleSide }), DAY.tealP);
    const trackMat = this.theme(new THREE.MeshStandardMaterial({ color: 0x3c4048, roughness: 0.45, metalness: 0.7, side: THREE.DoubleSide }), DAY.teal);
    const legMat = this.std(0x6b7280, 0.5, 0.7, DAY.teal);
    const strip = () => {
      const m = new THREE.ShaderMaterial({
        uniforms: { uCol: { value: new THREE.Color() }, uBeat: { value: 0 }, uKick: { value: 0 }, uGain: { value: 1 }, uDay: { value: 0 }, uDayCol: { value: new THREE.Color(DAY.tealD) } },
        vertexShader: STRIP_VERT,
        fragmentShader: STRIP_FRAG,
        side: THREE.DoubleSide,
      });
      this.strips.push(m);
      return m;
    };
    const stripIn = strip();
    const stripLoop = strip();
    const stripChute = strip();
    const geo: Record<string, THREE.BufferGeometry[]> = { belt: [], frame: [], chute: [], track: [], sIn: [], sLoop: [], sChute: [] };
    const BELT: [number, number][] = [[-0.6, 0], [0.6, 0]];
    const FRAME: [number, number][] = [[-0.68, 0.1], [-0.68, -0.28], [0.68, -0.28], [0.68, 0.1]];
    const LEDL: [number, number][] = [[-0.69, -0.07], [-0.69, -0.15]];
    const LEDR: [number, number][] = [[0.69, -0.07], [0.69, -0.15]];
    const legs = (path: Path, s0: number, s1: number, half: number) => {
      for (let s = s0 + 1; s < s1; s += 3.2) {
        path.at(s, this.p, this.t);
        const h = this.p.y - 0.3;
        if (h < 0.3) continue;
        this.n.set(-this.t.z, 0, this.t.x).normalize();
        for (const sg of [-1, 1]) this.box('leg', legMat, this.p.x + this.n.x * half * sg, h / 2, this.p.z + this.n.z * half * sg, 0.1, h, 0.1);
        this.box('leg', legMat, this.p.x, h - 0.05, this.p.z, Math.abs(this.n.x) * half * 2 + 0.1, 0.08, Math.abs(this.n.z) * half * 2 + 0.1);
      }
    };
    const belt = (path: Path, s0: number, s1: number, led = stripIn) => {
      geo.belt!.push(extrude(path, BELT, s0, s1));
      geo.frame!.push(extrude(path, FRAME, s0, s1));
      const k = led === stripIn ? 'sIn' : led === stripLoop ? 'sLoop' : 'sChute';
      geo[k]!.push(extrude(path, LEDL, s0, s1), extrude(path, LEDR, s0, s1));
      legs(path, s0, s1, 0.6);
    };

    // Infeeds: four lanes side by side, two low and two high, each through its own scan tunnel.
    for (let k = 0; k < 4; k++) {
      const y = LANE_Y[k]!;
      const z = LANE_Z[k]!;
      loopAt(INDUCT[k]!, this.p, this.t);
      const xi = this.p.x;
      const path = Path.fillet(
        [v(-HX - 1, y, z), v(-42, y, z), v(xi - 16, LOOP_Y, z), v(xi - 3.2, LOOP_Y, -LOOP_R - 1.85), v(xi, LOOP_Y, -LOOP_R)],
        5,
      );
      belt(path, 0.6, path.len - 1.0);
      const tunnel = this.tunnel(path, LANE_TUNNEL_X + HX + 1, 1.2);
      const doorMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
      // Lit opening in the wall where the lane comes in.
      this.box('dark', new THREE.MeshBasicMaterial({ color: 0x020203 }), -HX + 0.05, y + 0.6, z, 0.05, 1.8, 1.8);
      this.box(`door${k}`, doorMat, -HX + 0.1, y + 1.55, z, 0.08, 0.1, 2.0);
      this.box(`door${k}`, doorMat, -HX + 0.1, y + 0.6, z - 0.95, 0.08, 1.9, 0.1);
      this.box(`door${k}`, doorMat, -HX + 0.1, y + 0.6, z + 0.95, 0.08, 1.9, 0.1);
      this.lanes.push({ path, tunnelS: LANE_TUNNEL_X + HX + 1, lastArrive: -99, lastSpawn: -99, tunnel, door: doorMat, doorFlash: 0, doorCol: new THREE.Color(1, 1, 1) });
    }

    // The loop: a track with trays riding on it and LEDs along both sides.
    const loopPts: V3[] = [];
    for (let s = 0; s <= LOOP_LEN; s += 0.25) {
      loopAt(s, this.p, this.t);
      loopPts.push(this.p.clone());
    }
    const loop = new Path(loopPts, true);
    geo.track!.push(extrude(loop, [[-0.78, -0.16], [-0.78, -0.6], [0.78, -0.6], [0.78, -0.16]], 0, LOOP_LEN, 0.25));
    geo.sLoop!.push(extrude(loop, [[-0.79, -0.3], [-0.79, -0.42]], 0, LOOP_LEN, 0.25), extrude(loop, [[0.79, -0.3], [0.79, -0.42]], 0, LOOP_LEN, 0.25));
    for (let s = 1; s < LOOP_LEN; s += 4) {
      loopAt(s, this.p, this.t);
      this.box('leg', legMat, this.p.x, (LOOP_Y - 0.6) / 2, this.p.z, 0.22, LOOP_Y - 0.6, 0.22);
    }
    const trayMat = this.theme(new THREE.MeshStandardMaterial({ color: 0x8c96a4, roughness: 0.35, metalness: 0.85 }), 0xffffff, 0.7);
    this.trays = new THREE.InstancedMesh(new THREE.BoxGeometry(1.25, 0.12, PITCH * 0.9), trayMat, TRAYS);
    this.trays.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.trays.frustumCulled = false;
    this.put(this.trays);
    for (const s of LOOP_TUNNELS) this.loopTunnels.push({ s, t: this.tunnel(loop, s, 1.6) });

    // Chutes: steel slides that bend away from the loop and down into roll cages.
    const cageMat = new THREE.LineBasicMaterial({ color: 0x8a8f96 });
    this.cageLine = cageMat;
    const meshMat = new THREE.MeshBasicMaterial({ color: DAY.tealL, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide });
    const panelGeo = new THREE.BoxGeometry(1.4, 1.6, 1.0);
    const cageGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.4, 1.6, 1.0, 2, 3, 1));
    CHUTES.forEach(([s, side], k) => {
      loopAt(s, this.p, this.t);
      outward(this.t, this.n).multiplyScalar(side);
      const E = this.p.clone();
      const T = this.t.clone();
      const N = this.n.clone();
      const at = (f: number, o: number, y: number) => E.clone().addScaledVector(T, f).addScaledVector(N, o).setY(y);
      // The outer chutes of the front straight end at robot pickup stations, square to the robot floor.
      const station = side === 1 && s >= 54 && s <= 74;
      const end = at(2.4, 6.5, 1.0);
      if (station) {
        end.x = RobotFloor.stationX(end.x);
        end.z = STATION_Z;
      }
      const path = Path.fillet([E, at(0.2, 0.9, LOOP_Y), at(1.6, 3, LOOP_Y - 1.1), end], 2.5);
      geo.chute!.push(extrude(path, [[-0.75, 0.45], [-0.68, 0], [0.68, 0], [0.75, 0.45]], 0.9, path.len));
      geo.sChute!.push(extrude(path, [[-0.77, 0.4], [-0.77, 0.32]], 0.9, path.len), extrude(path, [[0.77, 0.4], [0.77, 0.32]], 0.9, path.len));
      legs(path, 1.2, path.len - 0.6, 0.7);
      const col = new THREE.Color().setHSL(k / CHUTES.length, 0.85, 0.55);
      const lamp = new THREE.MeshBasicMaterial({ color: 0x000000 });
      if (station) {
        this.stationOf.set(k, this.stationXs.length);
        this.stationXs.push(end.x);
        this.stationQueue.push([]);
        this.chutes.push({ s, side, path, col, lamp, flash: 0 });
        return;
      }
      // Roll cage and a lamp on a post at the end.
      path.at(path.len, this.p, this.t);
      const cx = this.p.x + this.t.x * 0.9;
      const cz = this.p.z + this.t.z * 0.9;
      const cage = new THREE.LineSegments(cageGeo, cageMat);
      cage.position.set(cx, 0.85, cz);
      cage.rotation.y = Math.atan2(this.t.x, this.t.z);
      this.put(cage);
      // By day: teal mesh sides and a letter board, as in the illustration.
      const panel = new THREE.Mesh(panelGeo, meshMat);
      cage.add(panel);
      this.dayOnly.push(panel);
      const board = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.55), new THREE.MeshBasicMaterial({ map: letterTex(String.fromCharCode(65 + k)) }));
      board.position.set(0, 0.05, 0.52);
      cage.add(board);
      this.dayOnly.push(board);
      this.box('cagebase', legMat, cx, 0.05, cz, 1.4, 0.06, 1.4);
      this.box('post', legMat, cx + 0.8, 1.4, cz, 0.08, 2.8, 0.08);
      this.box(`lamp${k}`, lamp, cx + 0.8, 2.9, cz, 0.3, 0.3, 0.3);
      this.cages.set(k, v(cx, 0, cz));
      this.chutes.push({ s, side, path, col, lamp, flash: 0 });
    });

    // To and from the store: off the loop's far bend and back on, tangentially.
    {
      loopAt(STORE_OUT, this.p, this.t);
      outward(this.t, this.n);
      const E = this.p.clone();
      const at = (f: number, o: number) => E.clone().addScaledVector(this.t, f).addScaledVector(this.n, o);
      this.intake = Path.fillet([E, at(1.6, 0.9), at(4, 2.6), v(LIFT_X - 3.5, LOOP_Y, -0.9), v(LIFT_X - 0.9, LOOP_Y, -0.9)], 2);
      belt(this.intake, 0.9, this.intake.len, stripLoop);
    }
    {
      loopAt(STORE_BACK, this.p, this.t);
      outward(this.t, this.n);
      const E = this.p.clone();
      const at = (f: number, o: number) => E.clone().addScaledVector(this.t, f).addScaledVector(this.n, o);
      this.back = Path.fillet([v(LIFT_X - 0.9, LOOP_Y, 0.9), v(LIFT_X - 3.5, LOOP_Y, 0.9), at(-4, 2.6), at(-1.6, 0.9), E], 2);
      belt(this.back, 0, this.back.len - 0.9, stripLoop);
    }

    const merged = (list: THREE.BufferGeometry[], mat: THREE.Material) => {
      if (!list.length) return;
      const g = mergeGeometries(list);
      if (g) {
        const m = this.mesh(g, mat);
        if (mat instanceof THREE.MeshStandardMaterial) this.inkify(m, 35);
      }
      list.forEach((x) => x.dispose());
    };
    merged(geo.belt!, beltMat);
    merged(geo.frame!, frameMat);
    merged(geo.chute!, chuteMat);
    merged(geo.track!, trackMat);
    merged(geo.sIn!, stripIn);
    merged(geo.sLoop!, stripLoop);
    merged(geo.sChute!, stripChute);
    stripChute.uniforms.uGain!.value = 0.7;
  }

  /** A scan arch over a path at distance s, with LED rings and a light curtain. */
  private tunnel(path: Path, s: number, width: number): Tunnel {
    path.at(s, this.p, this.t);
    const g = new THREE.Group();
    g.position.copy(this.p);
    g.rotation.y = Math.atan2(this.t.x, this.t.z);
    this.put(g);
    const shell = this.std(0x8a9099, 0.35, 0.8, DAY.orange);
    const W = width + 1.0;
    const H = 1.9;
    const D = 2.6;
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      g.add(m);
      return m;
    };
    this.inkify(add(new THREE.BoxGeometry(0.3, H, D), shell, -W / 2, H / 2 - 0.3, 0));
    this.inkify(add(new THREE.BoxGeometry(0.3, H, D), shell, W / 2, H / 2 - 0.3, 0));
    this.inkify(add(new THREE.BoxGeometry(W + 0.3, 0.4, D), shell, 0, H - 0.1, 0));
    // By day: a barcode panel on both faces and the eye mark on the side, as in the illustration.
    for (const z of [D / 2 + 0.02, -D / 2 - 0.02]) {
      const p = add(new THREE.PlaneGeometry(Math.min(1.4, W - 0.2), 0.3), new THREE.MeshBasicMaterial({ map: barcodeTex() }), 0, H - 0.1, z);
      if (z < 0) p.rotation.y = Math.PI;
      this.dayOnly.push(p);
    }
    for (const x of [W / 2 + 0.16, -W / 2 - 0.16]) {
      const e = add(new THREE.PlaneGeometry(0.6, 0.6), new THREE.MeshBasicMaterial({ map: eyeTex() }), x, H / 2 - 0.3, 0);
      e.rotation.y = x > 0 ? Math.PI / 2 : -Math.PI / 2;
      this.dayOnly.push(e);
    }
    const ring = new THREE.MeshBasicMaterial({ color: 0x103020 });
    for (const z of [-D / 2 - 0.01, D / 2 + 0.01]) {
      add(new THREE.BoxGeometry(W + 0.32, 0.08, 0.04), ring, 0, H - 0.32, z);
      add(new THREE.BoxGeometry(0.08, H - 0.4, 0.04), ring, -W / 2 + 0.17, H / 2 - 0.5, z);
      add(new THREE.BoxGeometry(0.08, H - 0.4, 0.04), ring, W / 2 - 0.17, H / 2 - 0.5, z);
    }
    const curtain = new THREE.MeshBasicMaterial({ color: 0xff2a2a, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
    for (const z of [-0.5, 0.5]) add(new THREE.PlaneGeometry(W - 0.3, H - 0.5), curtain, 0, H / 2 - 0.35, z);
    // Legs down to the floor for raised tunnels.
    if (this.p.y > 0.8) {
      const leg = this.std(0x6b7280, 0.5, 0.7, DAY.orange);
      for (const x of [-W / 2, W / 2]) add(new THREE.BoxGeometry(0.15, this.p.y - 0.3, 0.15), leg, x, -(this.p.y + 0.3) / 2, 0);
    }
    return { ring, curtain, flash: 0, col: new THREE.Color(0.3, 1, 0.5) };
  }

  private buildStore(): void {
    const upr = this.std(0x2b4fa0, 0.5, 0.5, DAY.teal);
    const beam = this.std(0xe0661a, 0.5, 0.5, DAY.teal);
    const zMax = BAYS * BAY + BAY / 2;
    for (let z = -zMax; z <= zMax + 0.01; z += BAY) {
      for (const x of [RACK_X0, RACK_X1]) this.box('upr', upr, x, 4.8, z, 0.1, 9.6, 0.1);
    }
    const carton = this.std(0xffffff, 0.88, 0);
    for (const y of LEVELS) {
      for (const x of [RACK_X0, RACK_X1]) this.box('beam', beam, x, y - 0.08, 0, 0.08, 0.14, zMax * 2);
      this.box('srail', this.std(0x50555e, 0.4, 0.8, DAY.tealD), SHUTTLE_X, y - 0.2, 0, 0.9, 0.06, zMax * 2);
    }
    for (let b = -BAYS; b <= BAYS; b++) {
      const z = b * BAY;
      for (let k = 0; k < LEVELS.length; k++) {
        if (Math.abs(b) <= DYN && b !== 0) {
          this.slots.push({ level: k, z, parcel: null, reserved: false });
          continue;
        }
        if (b === 0 || Math.random() < 0.15) continue;
        const h = rnd(0.5, 1.3);
        this.box('carton', carton, SLOT_X, LEVELS[k]! + h / 2, z + rnd(-0.1, 0.1), rnd(0.9, 1.2), h, rnd(0.9, 1.3), pick([0xb08860, 0x9c7650, 0xc49a6c, 0x8a6a48, 0xd8d4cc]));
      }
    }
    // Shuttles, one per level.
    const shMat = this.std(0xd9a400, 0.45, 0.5, DAY.tealL);
    for (let k = 0; k < LEVELS.length; k++) {
      const m = this.mesh(new THREE.BoxGeometry(0.95, 0.18, 1.2), shMat, SHUTTLE_X, LEVELS[k]! - 0.1, 0);
      this.inkify(m);
      this.shuttles.push({ runner: new Runner(), anim: { a: 0, b: 0, t0: 0, t1: 0 }, mesh: m });
    }
    // Lift mast and carriage.
    const mast = this.std(0x50555e, 0.4, 0.8, DAY.teal);
    for (const z of [-1.75, 1.75]) this.box('mast', mast, LIFT_X + 0.95, 5.2, z, 0.25, 10.4, 0.25);
    this.box('mast', mast, LIFT_X + 0.95, 10.45, 0, 0.3, 0.3, 3.8);
    this.carriage = new THREE.Group();
    this.carriage.position.set(LIFT_X, LOOP_Y, 0);
    this.put(this.carriage);
    const cm = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      this.carriage.add(m);
      return m;
    };
    this.inkify(cm(new THREE.BoxGeometry(1.7, 0.14, 3.2), this.theme(new THREE.MeshStandardMaterial({ color: 0x8c96a4, roughness: 0.35, metalness: 0.85 }), DAY.tealL), -0.1, -0.08, 0));
    this.inkify(cm(new THREE.BoxGeometry(0.1, 0.5, 3.2), this.std(0xd9a400, 0.5, 0.4, DAY.teal), 0.8, 0.2, 0));
    this.liftLamp = new THREE.MeshBasicMaterial({ color: 0x000000 });
    for (const z of [-1.6, 1.6]) cm(new THREE.BoxGeometry(0.16, 0.16, 0.16), this.liftLamp, 0.8, 0.55, z);
  }

  private buildParcels(): void {
    const cardboard = canvasTex(128, 128, (g) => {
      noise(g, 128, 128, 225, 26);
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.fillRect(52, 0, 24, 128);
      g.strokeStyle = 'rgba(0,0,0,0.25)';
      g.lineWidth = 3;
      g.strokeRect(1, 1, 126, 126);
    });
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: cardboard, roughness: 0.82, metalness: 0, envMapIntensity: 0.5 });
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec3 aGlow;\nvarying vec3 vGlow;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vGlow;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vGlow;');
    };
    const geo = new THREE.BoxGeometry(1, 1, 1);
    this.glowAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PARCELS * 3), 3);
    this.glowAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aGlow', this.glowAttr);
    this.parcelMesh = new THREE.InstancedMesh(geo, mat, MAX_PARCELS);
    this.parcelMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.parcelMesh.setColorAt(0, this.white);
    this.parcelMesh.frustumCulled = false;
    this.parcelMesh.count = 0;
    this.put(this.parcelMesh);
    this.hull = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.BackSide }), MAX_PARCELS);
    this.hull.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.hull.setColorAt(0, this.white);
    this.hull.frustumCulled = false;
    this.hull.count = 0;
    this.put(this.hull, 'day');
    const barcode = canvasTex(64, 44, (g) => {
      g.fillStyle = '#fff';
      g.fillRect(0, 0, 64, 44);
      g.fillStyle = '#111';
      for (let x = 4; x < 60; ) {
        const w = 1 + Math.floor(Math.random() * 3);
        g.fillRect(x, 6, w, 22);
        x += w + 1 + Math.floor(Math.random() * 2);
      }
      g.fillRect(4, 32, 30, 4);
    });
    this.labelMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ map: barcode, roughness: 0.5 }), MAX_PARCELS);
    this.labelMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.labelMesh.frustumCulled = false;
    this.labelMesh.count = 0;
    this.put(this.labelMesh);
  }

  private buildClub(): void {
    this.only = 'night';
    const blob = canvasTex(64, 64, (g) => {
      const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(255,255,255,1)');
      gr.addColorStop(0.4, 'rgba(255,255,255,0.4)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, 64, 64);
    });
    // Mirror ball over the middle of the loop.
    this.ball = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.9, 2),
      new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.12, flatShading: true }),
    );
    this.ball.position.set(18, 9.2, 0);
    this.put(this.ball);
    this.box('ballrod', this.std(0x6b7280, 0.5, 0.7), 18, 10.2, 0, 0.04, 1.6, 0.04);
    const N = 480;
    this.sparkPos = new Float32Array(N * 3);
    for (let k = 0; k < N; k++) this.sparkDirs.push(v(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).normalize());
    this.sparkGeo = new THREE.BufferGeometry();
    this.sparkGeo.setAttribute('position', new THREE.BufferAttribute(this.sparkPos, 3));
    this.sparkMat = new THREE.PointsMaterial({ size: 0.35, map: blob, color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const sparks = new THREE.Points(this.sparkGeo, this.sparkMat);
    sparks.frustumCulled = false;
    this.put(sparks);
    // Haze.
    const H = 80;
    this.hazePos = new Float32Array(H * 3);
    for (let k = 0; k < H; k++) this.hazeSeed.push([rnd(-58, 58), rnd(1, HH - 2), rnd(-30, 30), rnd(0, 6)]);
    this.hazeGeo = new THREE.BufferGeometry();
    this.hazeGeo.setAttribute('position', new THREE.BufferAttribute(this.hazePos, 3));
    this.hazeMat = new THREE.PointsMaterial({ size: 16, map: blob, color: 0x2a2244, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false });
    const haze = new THREE.Points(this.hazeGeo, this.hazeMat);
    haze.frustumCulled = false;
    this.put(haze);
    // Moving heads on two trusses; every other one also casts real light.
    const truss = this.std(0x2a2c31, 0.5, 0.7);
    for (const z of [-14, 14]) this.box('truss', truss, 5, HH - 0.55, z, 96, 0.4, 0.4);
    const cone = new THREE.ConeGeometry(2.4, 16, 24, 1, true);
    let k = 0;
    for (const x of [-36, -8, 20, 46]) {
      for (const z of [-14, 14]) {
        const pos = v(x, HH - 0.9, z);
        this.box('head', this.std(0x111114, 0.5, 0.5), x, HH - 0.75, z, 0.5, 0.5, 0.5);
        const piv = new THREE.Group();
        piv.position.copy(pos);
        this.put(piv);
        const u = { uCol: { value: new THREE.Color(1, 1, 1) }, uO: { value: 0.2 } };
        const m = new THREE.Mesh(
          cone,
          new THREE.ShaderMaterial({ uniforms: u, vertexShader: BEAM_VERT, fragmentShader: BEAM_FRAG, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
        );
        m.position.y = -8;
        piv.add(m);
        const h: Head = { piv, u, pos, rx: 0, rz: 0 };
        if (k % 2 === 0) {
          const l = new THREE.SpotLight(0xffffff, 200, 40, 0.17, 0.5, 1.6);
          l.position.copy(pos);
          this.put(l);
          this.put(l.target);
          h.light = l;
        }
        this.heads.push(h);
        k++;
      }
    }
    this.only = undefined;
  }

  private buildForklifts(): void {
    // (The south side of the hall is the robot floor now.)
    const routes = [roundRect(14, -28.2, 44, 4.4, 2), roundRect(57.6, 0, 6, 44, 2.4)];
    const yellow = this.std(0xe8b400, 0.45, 0.3);
    const black = this.std(0x1b1c1f, 0.7, 0.3);
    routes.forEach((route, k) => {
      const g = new THREE.Group();
      const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = g) => {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(x, y, z);
        parent.add(m);
        if (!(geo instanceof THREE.SphereGeometry)) this.inkify(m, 35);
        return m;
      };
      add(new THREE.BoxGeometry(1.2, 1, 2.2), yellow, 0, 0.8, 0);
      add(new THREE.BoxGeometry(1.1, 0.08, 1.2), black, 0, 2.2, -0.2);
      for (const sx of [-0.5, 0.5]) for (const sz of [-0.5, 0.5]) add(new THREE.BoxGeometry(0.06, 1.4, 0.06), black, sx, 1.55, sz - 0.2);
      for (const sx of [-0.35, 0.35]) add(new THREE.BoxGeometry(0.1, 2.6, 0.1), black, sx, 1.3, 1.2);
      const forks = new THREE.Group();
      forks.position.set(0, 0.15, 0);
      g.add(forks);
      for (const sx of [-0.25, 0.25]) add(new THREE.BoxGeometry(0.12, 0.05, 1.1), black, sx, 0, 1.75, forks);
      add(new THREE.BoxGeometry(1.1, 0.12, 1.0), this.std(0x8a6a44, 0.9, 0), 0, 0.1, 1.75, forks);
      add(new THREE.BoxGeometry(1.0, 0.8, 0.9), this.std(pick([0xb08860, 0xd8d4cc]), 0.6, 0), 0, 0.56, 1.75, forks);
      const wg = new THREE.CylinderGeometry(0.3, 0.3, 0.25, 16);
      for (const sx of [-0.6, 0.6]) for (const sz of [-0.7, 0.7]) add(wg, black, sx, 0.3, sz).rotation.z = Math.PI / 2;
      const beacon = new THREE.MeshBasicMaterial({ color: 0x000000 });
      add(new THREE.SphereGeometry(0.09, 8, 8), beacon, 0, 2.32, -0.2);
      this.put(g);
      this.forklifts.push({ g, route, s: rnd(0, route.len), speed: 1.1 + k * 0.15, forks, beacon });
    });
  }

  /** The day look's own scenery: a light hall, the illustration's workstation, GPU racks, people and signs. */
  private buildDay(): void {
    this.only = 'day';
    const grid = canvasTex(64, 64, (g) => {
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, 64, 64);
      g.strokeStyle = '#dfe3e8';
      g.lineWidth = 2;
      g.strokeRect(0, 0, 64, 64);
    });
    grid.repeat.set(HX / 2, HZ / 2);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(HX * 2, HZ * 2), new THREE.MeshStandardMaterial({ color: DAY.floor, map: grid, roughness: 0.95, metalness: 0 }));
    floor.rotation.x = -Math.PI / 2;
    this.put(floor);
    // Flat walls and ceiling, as in a drawing.
    const wall = new THREE.MeshBasicMaterial({ color: DAY.wall, side: THREE.DoubleSide });
    for (const z of [-HZ, HZ]) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(HX * 2, HH), wall);
      w.position.set(0, HH / 2, z);
      this.put(w);
    }
    for (const x of [-HX, HX]) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(HZ * 2, HH), wall);
      w.position.set(x, HH / 2, 0);
      w.rotation.y = Math.PI / 2;
      this.put(w);
    }
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(HX * 2, HZ * 2), new THREE.MeshBasicMaterial({ color: DAY.ceiling, side: THREE.DoubleSide }));
    ceil.rotation.x = Math.PI / 2;
    ceil.position.y = HH;
    this.put(ceil);
    const sky = new THREE.MeshBasicMaterial({ color: 0xffffff });
    for (let x = -55; x <= 55; x += 10) for (const z of [-20, 0, 20]) this.box('sky', sky, x + 5, HH - 0.03, z, 6, 0.04, 4);

    // Monitoring: a purple workstation in front of the control room.
    const purple = this.std(DAY.purple, 0.8, 0.05);
    const dx = -30;
    const dz = 20.6;
    this.box('desk', purple, dx, 1.2, dz, 3.2, 0.12, 1.6);
    for (const sx of [-1.5, 1.5]) for (const sz of [-0.7, 0.7]) this.box('desk', purple, dx + sx, 0.6, dz + sz, 0.1, 1.2, 0.1);
    this.box('desk', purple, dx, 2.0, dz + 0.5, 1.8, 1.1, 0.12);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.9), new THREE.MeshBasicMaterial({ map: this.dashTex() }));
    screen.position.set(dx, 2.0, dz + 0.43);
    screen.rotation.y = Math.PI;
    this.put(screen);
    this.person(dx, dz - 1.1, 0);

    // Computing: magenta GPU racks next to the control room.
    const magenta = this.std(DAY.magenta, 0.7, 0.1);
    const gpu = canvasTex(128, 64, (g) => {
      g.fillStyle = '#d6339a';
      g.fillRect(0, 0, 128, 64);
      g.fillStyle = '#1d1d1f';
      g.font = `700 34px ${SIGN_FONT}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('GPU', 64, 34);
    });
    const leds = new THREE.MeshBasicMaterial({ color: 0xffd6ec });
    for (let k = 0; k < 3; k++) {
      const x = -44.5 + k * 1.8;
      this.box('gpu', magenta, x, 2.1, 27.6, 1.5, 4.2, 1.5);
      const p = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.5), new THREE.MeshBasicMaterial({ map: gpu }));
      p.position.set(x, 3.5, 26.84);
      p.rotation.y = Math.PI;
      this.put(p);
      for (let j = 0; j < 5; j++) this.box('leds', leds, x, 0.8 + j * 0.45, 26.84, 1.1, 0.05, 0.02);
    }

    // People and parcel trolleys.
    this.person(-57, -12, Math.PI / 2);
    this.person(34, 12.8, Math.PI);
    this.person(47, -6, -Math.PI / 2);
    this.person(-8, -15.5, 0.4);
    this.person(62 - 8, 18, Math.PI * 0.8);
    this.trolley(-58.5, -8.5);
    this.trolley(-56, -29.5);
    this.trolley(-24, 18);

    // Hanging signs, as the labels in the illustration.
    this.sign('Scanning', '#e8960c', -50, 9.6, -18.2, Math.PI / 2, (g) => {
      g.beginPath();
      g.ellipse(0, 0, 24, 14, 0, 0, 7);
      g.stroke();
      g.beginPath();
      g.arc(0, 0, 6, 0, 7);
      g.fill();
    });
    this.sign('Sorting', '#2fa58f', 18, 9.2, 0, 0, (g) => {
      g.strokeRect(-18, -16, 36, 24);
      g.beginPath();
      for (const x of [-12, -4, 4, 12]) g.arc(x, 16, 3, 0, 7);
      g.fill();
    });
    this.sign('Monitoring', '#6b3fd1', -30, 5.4, 23.2, 0, (g) => {
      g.strokeRect(-20, -18, 40, 36);
      for (const [x, h] of [[-12, 10], [-3, 20], [6, 14], [14, 24]] as const) g.fillRect(x - 3, 14 - h, 6, h);
    });
    this.sign('Computing', '#d6339a', -42.7, 6.6, 26, 0, (g) => {
      g.strokeRect(-14, -20, 28, 22);
      g.beginPath();
      g.moveTo(0, 2);
      g.lineTo(0, 12);
      g.moveTo(-14, 12);
      g.lineTo(14, 12);
      g.stroke();
      for (const x of [-14, 0, 14]) g.fillRect(x - 5, 12, 10, 10);
    });
    this.only = undefined;
    this.flushBoxes();
  }

  private dashTex(): THREE.CanvasTexture {
    return canvasTex(256, 144, (g) => {
      g.fillStyle = '#eee8fc';
      g.fillRect(0, 0, 256, 144);
      g.fillStyle = '#6b3fd1';
      for (let k = 0; k < 8; k++) {
        const h = 20 + ((k * 37) % 70);
        g.fillRect(20 + k * 18, 120 - h, 12, h);
      }
      g.strokeStyle = '#d6339a';
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(176, 110);
      for (let k = 0; k < 6; k++) g.lineTo(176 + k * 13, 110 - ((k * 23) % 60) - 10);
      g.stroke();
    });
  }

  /** A person in the illustration style: white shirt, blue trousers, cap. */
  person(x: number, z: number, ry: number): void {
    const c = Math.cos(ry);
    const sn = Math.sin(ry);
    const at = (lx: number, lz: number): [number, number] => [x + lx * c + lz * sn, z - lx * sn + lz * c];
    const shirt = this.std(0xffffff, 0.9, 0);
    const trousers = this.std(0x3d4b8f, 0.9, 0);
    for (const lx of [-0.14, 0.14]) {
      const [px, pz] = at(lx, 0);
      this.box('legs', trousers, px, 0.45, pz, 0.2, 0.9, 0.22, undefined, ry);
    }
    this.box('shirt', shirt, x, 1.3, z, 0.6, 0.8, 0.32, undefined, ry);
    for (const lx of [-0.38, 0.38]) {
      const [px, pz] = at(lx, 0.08);
      this.box('shirt', shirt, px, 1.3, pz, 0.14, 0.7, 0.16, undefined, ry);
    }
    const head = this.mesh(new THREE.SphereGeometry(0.2, 14, 10), this.std(0xf3d3b5, 0.9, 0), x, 1.95, z);
    this.dayOnly.push(head);
    this.inkify(head, 60);
    const cap = this.mesh(new THREE.CylinderGeometry(0.2, 0.21, 0.12, 14), this.std(0x2f3b6b, 0.9, 0), x, 2.1, z);
    this.dayOnly.push(cap);
    this.inkify(cap, 60);
  }

  /** A white parcel trolley with a few boxes on it. */
  private trolley(x: number, z: number): void {
    const white = this.std(0xffffff, 0.8, 0.05);
    const card = this.std(0xd9b07a, 0.9, 0);
    this.box('trolley', white, x, 0.4, z, 2.2, 0.15, 1.6);
    for (const sx of [-1.1, 1.1]) this.box('trolley', white, x + sx, 1.1, z, 0.1, 1.4, 1.6);
    for (let k = 0; k < 5; k++) this.box('tbox', card, x - 0.6 + Math.random() * 1.2, 0.68 + Math.floor(k / 3) * 0.42, z - 0.4 + Math.random() * 0.8, rnd(0.55, 0.85), 0.4, 0.5, undefined, rnd(0, 1));
  }

  /** A sign hanging from the ceiling on two red cables. */
  sign(text: string, color: string, x: number, y: number, z: number, ry: number, icon: (g: CanvasRenderingContext2D) => void): void {
    const mat = new THREE.MeshBasicMaterial({ map: signTex(text, color, icon) });
    for (const flip of [0, Math.PI]) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(4.8, 1.2), mat);
      p.position.set(x, y, z);
      p.rotation.y = ry + flip;
      this.put(p);
    }
    const pts: number[] = [];
    for (const d of [-2, 2]) {
      const cx = x + Math.cos(ry) * d;
      const cz = z - Math.sin(ry) * d;
      pts.push(cx, y + 0.6, cz, cx, HH, cz);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.put(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: DAY.red })));
  }

  private buildCamera(): void {
    const fixed = (name: string, pos: V3, look: V3): Poi => ({
      name,
      at: (p, l) => {
        p.copy(pos);
        l.copy(look);
        return true;
      },
    });
    this.pois = [
      fixed('infeeds', v(-55, 3, -11), v(-44, 1.2, -16)),
      fixed('scan tunnels', v(-45, 4.5, -12), v(-50, 2.2, -18)),
      fixed('high infeeds', v(-38, 8, -15), v(-50, 7.2, -21)),
      fixed('merge', v(-6, 5, -12.5), v(6, 3.5, -7)),
      fixed('loop scanner', v(15.5, 6, -13), v(22, 4.3, -7)),
      fixed('loop', v(5, 7, 2), v(30, 3, 0)),
      fixed('chutes', v(35, 4.5, -18), v(28, 1.2, -13)),
      fixed('store', v(43, 5, -7), v(51, 4.5, 0)),
      fixed('lift', v(44.5, 3.5, 4), v(49, 4, 0)),
      fixed('pickup stations', v(14, 4, 10.5), v(14, 1.2, 15)),
      fixed('projectors', v(9, 6.6, 11.5), v(14, 5.8, 15)),
      fixed('bins', v(36, 3.5, 20.5), v(20, 0.8, 25)),
      fixed('parking', v(3, 3.2, 19.5), v(-4, 0.6, 24)),
      fixed('manual sorting', v(-9, 3.6, 17.5), v(-15, 1, 22)),
      fixed('control room', v(-24, 4, 16.5), v(-36, 2, 26)),
      {
        name: 'forklift',
        at: (p, l) => {
          const f = this.forklifts[0];
          if (!f) return false;
          l.copy(f.g.position).setY(1.4);
          p.copy(l).add(this.t.set(-4, 2.4, 4));
          return true;
        },
      },
      {
        name: 'robot',
        at: (p, l) => {
          const busy = this.floor.fleet.bots.filter((b) => b.state === 'toDrop' || b.state === 'toPick');
          const b = busy[this.tourRobot % Math.max(1, busy.length)] ?? this.floor.fleet.bots[0];
          if (!b) return false;
          this.floor.robotTop(b.k, l);
          l.y = 1.2;
          p.copy(l).add(this.t.set(-3.2, 2.6, -3.2));
          return true;
        },
      },
    ];
    this.camera.position.set(-50, 6, -20);
  }

  private tourRobot = 0;

  /** Fly mode: travel at cruise height to a random stop, hover and look around, then on to the next. */
  private flyTour(dt: number, travel: number): void {
    const t = this.tour;
    const speed = 6.5 * clamp(travel / 0.4, 0.4, 2.5);
    if (!t || (t.s >= t.len && this.bt - t.arrivedAt > t.dwell)) {
      this.planTour(t);
      return this.flyTour(dt, travel);
    }
    const poi = this.pois[t.poi]!;
    const pos = this.p;
    const look = this.n;
    if (!poi.at(pos, look)) {
      this.tour = null;
      return;
    }
    if (t.s < t.len) {
      t.s = Math.min(t.len, t.s + speed * dt);
      const u = t.s / t.len;
      t.curve.getPointAt(u, this.want);
      // Look ahead along the way, then settle on the stop.
      t.curve.getPointAt(Math.min(1, u + 0.08), this.wantLook);
      this.wantLook.y -= 1.5;
      const settle = smooth01((u - 0.55) / 0.45);
      this.wantLook.lerp(look, settle);
      if (u < 0.2) this.wantLook.lerp(t.lookFrom, 1 - u / 0.2);
      if (t.s >= t.len) {
        t.arrivedAt = this.bt;
        t.offset.subVectors(this.want, look);
      }
    } else {
      // Hover: turn slowly around what we look at, following it if it moves.
      const a = (this.bt - t.arrivedAt) * 0.04;
      this.want.copy(t.offset).applyAxisAngle(UP, a).add(look);
      this.wantLook.copy(look);
    }
  }

  private planTour(prev: Tour | null): void {
    const from = this.camera.position.clone();
    const lookFrom = prev ? this.wantLook.clone() : v(0, 2, 0);
    let k = 0;
    for (let tries = 0; tries < 20; tries++) {
      k = Math.floor(Math.random() * this.pois.length);
      if (!this.recent.includes(k)) break;
    }
    this.recent.push(k);
    if (this.recent.length > 5) this.recent.shift();
    if (this.pois[k]!.name === 'robot') this.tourRobot++;
    const pos = new THREE.Vector3();
    const look = new THREE.Vector3();
    if (!this.pois[k]!.at(pos, look)) pos.copy(from);
    const pts = [from];
    const flat = Math.hypot(pos.x - from.x, pos.z - from.z);
    if (flat > 12) {
      // Up to cruise height, across, and down to the stop; around obstacles.
      const dir = this.t.set(pos.x - from.x, 0, pos.z - from.z).normalize();
      const a = from.clone().addScaledVector(dir, 3).setY(CRUISE_Y);
      const b = pos.clone().addScaledVector(dir, -5).setY(CRUISE_Y);
      pts.push(a);
      for (const [ox, oz, r] of TOUR_OBSTACLES) {
        const ab = this.n.set(b.x - a.x, 0, b.z - a.z);
        const l2 = ab.lengthSq();
        const f = clamp(((ox - a.x) * ab.x + (oz - a.z) * ab.z) / (l2 || 1), 0, 1);
        const cx = a.x + ab.x * f;
        const cz = a.z + ab.z * f;
        const d = Math.hypot(cx - ox, cz - oz);
        if (d < r && f > 0.05 && f < 0.95) {
          const side = Math.sign((cx - ox) * -dir.z + (cz - oz) * dir.x) || 1;
          pts.push(v(ox - dir.z * side * (r + 1.5), CRUISE_Y, oz + dir.x * side * (r + 1.5)));
        }
      }
      pts.push(b);
    } else pts.push(from.clone().lerp(pos, 0.5).setY(Math.max(from.y, pos.y) + 1.5));
    pts.push(pos);
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    this.tour = { poi: k, curve, len: curve.getLength(), s: 0, lookFrom, dwell: 6 + Math.floor(Math.random() * 6), arrivedAt: 0, offset: new THREE.Vector3() };
  }
}
