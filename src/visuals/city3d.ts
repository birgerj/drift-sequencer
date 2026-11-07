// Realistic night city (three.js): a drone glides down wet boulevards through a
// street grid, turning at an intersection every few bars. Lead notes switch on
// neon signs, bass notes send cars down the oncoming lane, pads raise
// searchlights over the skyline, and street lamps pulse on the kick.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

import type { NoteRole, RGB, Scene3D, SceneInput } from './scene3d';

// Grid in metres: streets run along x = k·P and z = k·P.
const P = 96;
const STREET = 22; // kerb to kerb plus pavements
const HALF = STREET / 2;
const ROAD_HALF = 7;
const BLOCK = P - STREET;
/** Turn radius through an intersection (camera runs on the centre line). */
const R = 11;
/** Turn at the next intersection every this many bars. */
export const TURN_BARS = 16;
const CRUISE = 14; // m/s at Drift's default speed
const BUILD_RADIUS = 6; // blocks around the camera with buildings
const LAMP_RADIUS = 4;
const MAX_BUILDINGS = 3400;
const MAX_LAMPS = 8 * (2 * LAMP_RADIUS + 1) ** 2;
const BAY = 2.6;
const FLOOR = 3.4;
const COLS = 16;
const ROWS = 64;
const FOG = 0.0042;
const POINT_LIGHTS = 5;
const SIGNS = 16;
const BEAMS = 4;
const CARS = 18;

/** Headings: 0 = −z, 1 = +x, 2 = +z, 3 = −x. Turning right adds one. */
const DIRS: [number, number][] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

function hash(a: number, b: number, c = 0): number {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 1440662683);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function vnoise(x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const s = (t: number) => t * t * (3 - 2 * t);
  const u = s(x - ix);
  const v = s(z - iz);
  const a = hash(ix, iz, 7);
  const b = hash(ix + 1, iz, 7);
  const c = hash(ix, iz + 1, 7);
  const d = hash(ix + 1, iz + 1, 7);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

interface Piece {
  s0: number;
  len: number;
  x: number;
  z: number;
  h: number;
  turn: -1 | 0 | 1;
}

interface Car {
  g: THREE.Group;
  dir: THREE.Vector3;
  v: number;
}

interface Sign {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  streak: THREE.Mesh;
  streakMat: THREE.ShaderMaterial;
  color: THREE.Color;
  vel: number;
  born: number;
  life: number;
}

interface Beam {
  g: THREE.Group;
  mat: THREE.ShaderMaterial;
  born: number;
  life: number;
  phase: number;
}

const STREAK_VERT = /* glsl */ `
uniform float uLen;
varying vec2 vQ;
varying vec3 vC;
varying float vD;
void main() {
  mat4 M = modelMatrix;
#ifdef USE_INSTANCING
  M = M * instanceMatrix;
#endif
  vec3 c = (M * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  float w = length(M[0].xyz);
  float len = length(M[2].xyz);
  vec2 toCam = cameraPosition.xz - c.xz;
  float d = length(toCam);
  toCam = d > 0.001 ? toCam / d : vec2(0.0, 1.0);
  len = min(len, d * 0.8);
  vec2 side = vec2(-toCam.y, toCam.x);
  float t = mix(-0.12, 1.0, position.y + 0.5);
  vec2 p = c.xz + side * position.x * w + toCam * t * len;
  vQ = vec2(position.x * 2.0, t);
  vC = vec3(1.0);
#ifdef USE_INSTANCING_COLOR
  vC = instanceColor;
#endif
  vD = length(cameraPosition - vec3(p.x, c.y, p.y));
  gl_Position = projectionMatrix * viewMatrix * vec4(p.x, c.y, p.y, 1.0);
}`;

const STREAK_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uGain;
uniform float uFog;
varying vec2 vQ;
varying vec3 vC;
varying float vD;
void main() {
  float a = exp(-vQ.x * vQ.x * 4.0) * exp(-max(vQ.y, 0.0) * 2.6) * smoothstep(-0.12, 0.0, vQ.y);
  float fog = exp(-pow(vD * uFog, 2.0));
  gl_FragColor = vec4(uColor * vC * a * uGain * fog, 1.0);
}`;

function streakMaterial(color: THREE.ColorRepresentation, gain: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uGain: { value: gain }, uFog: { value: FOG }, uLen: { value: 1 } },
    vertexShader: STREAK_VERT,
    fragmentShader: STREAK_FRAG,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });
}

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SKY_FRAG = /* glsl */ `
uniform float uTod;
uniform float uTime;
uniform float uPad;
uniform vec3 uTint;
uniform vec3 uSun;
varying vec3 vDir;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n2(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 4; i++) { s += a * n2(p); p *= 2.03; a *= 0.5; }
  return s;
}
vec3 horizon() { return mix(vec3(0.85, 0.42, 0.22), vec3(0.13, 0.075, 0.06), uTod); }
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 top = mix(vec3(0.07, 0.12, 0.30), vec3(0.006, 0.008, 0.022), uTod);
  vec3 hor = horizon();
  float g = pow(1.0 - clamp(h, 0.0, 1.0), 5.0);
  vec3 col = mix(top, hor, g);
  col += uTint * (0.05 + 0.12 * uPad) * g;
  vec2 cp = d.xz / max(h, 0.06) * 0.9 + vec2(uTime * 0.006, 0.0);
  float c = smoothstep(0.48, 0.85, fbm(cp));
  vec3 cloud = mix(vec3(0.55, 0.32, 0.30), vec3(0.09, 0.06, 0.055), uTod) + uTint * 0.03;
  col = mix(col, cloud, c * 0.6 * smoothstep(0.0, 0.25, h));
  float sun = max(dot(d, uSun), 0.0);
  col += (1.0 - uTod) * (vec3(1.0, 0.55, 0.25) * pow(sun, 10.0) * 0.7 + vec3(1.0, 0.8, 0.5) * pow(sun, 400.0) * 3.0);
  if (h < 0.0) col = hor * 0.6;
  gl_FragColor = vec4(col, 1.0);
}`;

const BEAM_VERT = /* glsl */ `
varying float vV;
varying vec3 vN;
varying vec3 vView;
void main() {
  vV = uv.y;
  vN = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;

const BEAM_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
varying float vV;
varying vec3 vN;
varying vec3 vView;
void main() {
  float edge = pow(abs(dot(normalize(vN), normalize(-vView))), 2.0);
  float a = uAlpha * pow(1.0 - vV, 1.6) * edge;
  gl_FragColor = vec4(uColor * a, 1.0);
}`;

const RAIN_VERT = /* glsl */ `
uniform vec3 uCam;
uniform float uTime;
attribute float tail;
varying float vA;
const vec3 BOX = vec3(70.0, 34.0, 70.0);
void main() {
  vec3 p = position;
  float y = mod(p.y - uTime * 17.0, BOX.y) - 3.0;
  vec2 xz = uCam.xz + mod(p.xz - uCam.xz - vec2(uTime * 1.2, 0.0), BOX.xz) - BOX.xz * 0.5;
  vec3 w = vec3(xz.x + tail * 0.06, y + tail * 0.8, xz.y);
  vA = smoothstep(36.0, 6.0, length(w - uCam));
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`;

const RAIN_FRAG = /* glsl */ `
uniform float uLevel;
varying float vA;
void main() { gl_FragColor = vec4(vec3(0.55, 0.62, 0.75) * vA * uLevel, 1.0); }`;

export class City implements Scene3D {
  readonly canvas: HTMLCanvasElement;
  readonly bass = true;
  private renderer: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.3, 1200);
  private pmrem: THREE.PMREMGenerator;
  private envScene = new THREE.Scene();
  private envTarget: THREE.WebGLRenderTarget | null = null;
  private envTod = -1;

  private skyMat!: THREE.ShaderMaterial;
  private sky!: THREE.Mesh;
  private ground!: THREE.Mesh;
  private buildings!: THREE.InstancedMesh;
  private buildMat!: THREE.MeshStandardMaterial;
  private builtAt = '';
  private poles!: THREE.InstancedMesh;
  private heads!: THREE.InstancedMesh;
  private pools!: THREE.InstancedMesh;
  private poolMat!: THREE.ShaderMaterial;
  private lampHeads: THREE.Vector3[] = [];
  private lampsAt = '';
  private points: THREE.PointLight[] = [];
  private hemi!: THREE.HemisphereLight;
  private sun!: THREE.DirectionalLight;
  private rainMat!: THREE.ShaderMaterial;
  private neonTex: THREE.CanvasTexture[] = [];
  private signs: Sign[] = [];
  private signNext = 0;
  private beams: Beam[] = [];
  private beamNext = 0;
  private cars: Car[] = [];
  private carGeo!: { body: THREE.BufferGeometry; cabin: THREE.BufferGeometry; lamp: THREE.BufferGeometry; streak: THREE.PlaneGeometry };
  private carMats!: { paint: THREE.MeshStandardMaterial[]; glass: THREE.MeshStandardMaterial; head: THREE.MeshBasicMaterial; tail: THREE.MeshBasicMaterial; headStreak: THREE.ShaderMaterial; tailStreak: THREE.ShaderMaterial };

  // Route through the grid.
  private pieces: Piece[] = [];
  private gx = 0;
  private gz = 0;
  private gh = 0;
  private gEnd = 0;
  private turnPending = false;
  private lastTurnBar = 0;
  private lastTurnTime = 0;

  private cam = 0;
  private time = 0;
  private speed = CRUISE;
  private roll = 0;
  private first = true;
  private tod = 1;
  private readonly pos = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly lookSm = new THREE.Vector3();
  private readonly tmpP = new THREE.Vector3();
  private readonly tmpD = new THREE.Vector3();
  private readonly m4 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v3 = new THREE.Vector3();
  private readonly s3 = new THREE.Vector3();
  private readonly col = new THREE.Color();
  private readonly tint = new THREE.Color();

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'vis-canvas';
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.fog = new THREE.FogExp2(0x221714, FOG);
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.8, 0.6, 0.85);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.buildSky();
    this.buildGround();
    this.buildBuildings();
    this.buildLamps();
    this.buildLights();
    this.buildRain();
    this.buildSigns();
    this.buildBeams();
    this.extendRoute();
    this.buildCars();
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
    if (role === 'bass') this.bassCar(vel);
    else if (role === 'pad') this.searchlight(color, vel, durS);
    else this.neon(color, pitch, vel, durS);
  }

  render(i: SceneInput): void {
    const dt = i.dt;
    this.time += dt;
    this.tod += ((i.tod ?? 1) - this.tod) * (1 - Math.exp(-dt * 2));

    // A turn at the next intersection every TURN_BARS bars (or every ~45 s when stopped).
    if (i.playing && i.bar !== undefined) {
      const b = Math.floor(i.bar / TURN_BARS);
      if (b !== this.lastTurnBar) {
        this.lastTurnBar = b;
        this.turnPending = true;
      }
    } else if (this.time - this.lastTurnTime > 45) {
      this.lastTurnTime = this.time;
      this.turnPending = true;
    }

    const cur = this.pieceAt(this.cam);
    const target = CRUISE * (i.travelSpeed / 0.4) * (cur?.turn ? 0.8 : 1);
    this.speed += (target - this.speed) * (1 - Math.exp(-dt * 0.8));
    this.cam += this.speed * dt;
    this.extendRoute();

    this.tint.setRGB(...(i.cols[0] ?? [0.6, 0.4, 0.9]));
    const m = Math.max(this.tint.r, this.tint.g, this.tint.b, 0.05);
    this.tint.multiplyScalar(1 / m);

    this.updateCamera(dt);
    this.updateWorld();
    this.updateAtmosphere(i);
    this.updateLamps(i);
    this.updateCars(dt);
    this.updateSigns(i);
    this.updateBeams();
    this.bloom.strength = 0.7 + i.kick * 0.3 + i.energy * 0.2;
    this.composer.render(dt);
  }

  // ---------- route ----------
  private extendRoute(): void {
    while (this.gEnd < this.cam + 240) {
      const [dx, dz] = DIRS[this.gh]!;
      const nx = this.gx + dx;
      const nz = this.gz + dz;
      this.pieces.push({ s0: this.gEnd, len: P - 2 * R, x: this.gx * P + dx * R, z: this.gz * P + dz * R, h: this.gh, turn: 0 });
      this.gEnd += P - 2 * R;
      let turn: -1 | 0 | 1 = 0;
      if (this.turnPending) {
        turn = Math.random() < 0.5 ? 1 : -1;
        this.turnPending = false;
      }
      const len = turn ? (Math.PI / 2) * R : 2 * R;
      this.pieces.push({ s0: this.gEnd, len, x: nx * P - dx * R, z: nz * P - dz * R, h: this.gh, turn });
      this.gEnd += len;
      this.gh = (this.gh + turn + 4) % 4;
      this.gx = nx;
      this.gz = nz;
    }
    while (this.pieces.length > 2 && this.pieces[0]!.s0 + this.pieces[0]!.len < this.cam - 30) this.pieces.shift();
  }

  private pieceAt(s: number): Piece | undefined {
    for (const p of this.pieces) if (s < p.s0 + p.len) return p;
    return this.pieces[this.pieces.length - 1];
  }

  /** Position and heading on the route, s metres from the start. */
  private pathAt(s: number, pos: THREE.Vector3, dir: THREE.Vector3): Piece | undefined {
    const p = this.pieceAt(s);
    if (!p) return undefined;
    const l = Math.max(0, s - p.s0);
    const [dx, dz] = DIRS[p.h]!;
    if (!p.turn) {
      pos.set(p.x + dx * l, 0, p.z + dz * l);
      dir.set(dx, 0, dz);
      return p;
    }
    const a = Math.min(l, p.len) / R;
    const rx = -dz * p.turn;
    const rz = dx * p.turn;
    const cx = p.x + rx * R;
    const cz = p.z + rz * R;
    const c = Math.cos(a);
    const sn = Math.sin(a);
    pos.set(cx - rx * R * c + dx * R * sn, 0, cz - rz * R * c + dz * R * sn);
    dir.set(rx * sn + dx * c, 0, rz * sn + dz * c).normalize();
    return p;
  }

  private updateCamera(dt: number): void {
    this.pathAt(this.cam, this.pos, this.dir);
    const bob = Math.sin(this.time * 0.31) * 0.5 + Math.sin(this.time * 0.13) * 0.4;
    this.camera.position.set(this.pos.x + Math.sin(this.time * 0.17) * 0.6, 5.6 + bob, this.pos.z);
    this.pathAt(this.cam + 30, this.look, this.tmpD);
    this.look.y = 5.2 + bob * 0.5;
    if (this.first) {
      this.lookSm.copy(this.look);
      this.first = false;
    }
    this.lookSm.lerp(this.look, 1 - Math.exp(-dt * 2.5));
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.lookSm);
    // Bank gently into turns.
    this.pathAt(this.cam + 14, this.tmpP, this.tmpD);
    const yaw = this.dir.x * this.tmpD.z - this.dir.z * this.tmpD.x;
    this.roll += (-yaw * 0.12 - this.roll) * (1 - Math.exp(-dt * 2));
    this.camera.rotateZ(this.roll);
    this.sky.position.copy(this.camera.position);
  }

  // ---------- world ----------
  private updateWorld(): void {
    const cx = this.camera.position.x;
    const cz = this.camera.position.z;
    const bx = Math.floor(cx / P);
    const bz = Math.floor(cz / P);
    const key = `${bx},${bz}`;
    if (key !== this.builtAt) {
      this.builtAt = key;
      this.fillBuildings(bx, bz);
      this.fillLamps(bx, bz);
    }
    this.ground.position.set(Math.round(cx / P) * P, 0, Math.round(cz / P) * P);
  }

  private fillBuildings(cbx: number, cbz: number): void {
    let n = 0;
    const put = (x: number, y0: number, z: number, w: number, h: number, d: number, c: number) => {
      if (n >= MAX_BUILDINGS) return;
      this.v3.set(x, y0 + h / 2, z);
      this.s3.set(w, h, d);
      this.m4.compose(this.v3, this.q.identity(), this.s3);
      this.buildings.setMatrixAt(n, this.m4);
      this.buildings.setColorAt(n, this.col.setHSL(0.06 + c * 0.08, 0.06 + c * 0.1, 0.32 + c * 0.38));
      n++;
    };
    for (let bx = cbx - BUILD_RADIUS; bx <= cbx + BUILD_RADIUS; bx++) {
      for (let bz = cbz - BUILD_RADIUS; bz <= cbz + BUILD_RADIUS; bz++) {
        const r = (k: number) => hash(bx, bz, k);
        const x0 = bx * P + HALF;
        const z0 = bz * P + HALF;
        if (r(1) < 0.07) {
          // A small square: low pavilion in the middle.
          put(x0 + BLOCK / 2, 0, z0 + BLOCK / 2, BLOCK - 4, 0.6, BLOCK - 4, 0.1);
          put(x0 + BLOCK / 2, 0, z0 + BLOCK / 2, 14, 5, 10, r(2));
          continue;
        }
        const town = vnoise(bx * 0.23 + 40, bz * 0.23 + 40);
        const tall = 20 + 170 * town * town;
        const nx = r(2) < 0.5 ? 2 : 3;
        const nz = r(3) < 0.5 ? 2 : 3;
        const gap = 1.6;
        const lw = (BLOCK - gap * (nx - 1)) / nx;
        const ld = (BLOCK - gap * (nz - 1)) / nz;
        for (let i = 0; i < nx; i++) {
          for (let j = 0; j < nz; j++) {
            const k = 10 + i * 5 + j;
            const h = 10 + Math.pow(r(k), 2.4) * tall;
            const x = x0 + i * (lw + gap) + lw / 2;
            const z = z0 + j * (ld + gap) + ld / 2;
            const c = r(k + 100);
            put(x, 0, z, lw, h, ld, c);
            if (h > 55 && r(k + 200) < 0.6) {
              const s = 0.5 + r(k + 300) * 0.25;
              put(x, h, z, lw * s, 6 + r(k + 400) * 22, ld * s, c);
            }
          }
        }
      }
    }
    this.buildings.count = n;
    this.buildings.instanceMatrix.needsUpdate = true;
    if (this.buildings.instanceColor) this.buildings.instanceColor.needsUpdate = true;
    this.buildings.computeBoundingSphere();
  }

  private fillLamps(cbx: number, cbz: number): void {
    let n = 0;
    this.lampHeads.length = 0;
    const N: [number, number][] = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    for (let bx = cbx - LAMP_RADIUS; bx <= cbx + LAMP_RADIUS; bx++) {
      for (let bz = cbz - LAMP_RADIUS; bz <= cbz + LAMP_RADIUS; bz++) {
        const ccx = bx * P + P / 2;
        const ccz = bz * P + P / 2;
        for (const [nx, nz] of N) {
          const tx = -nz;
          const tz = nx;
          const base = P / 2 - (HALF - 2.4);
          for (const t of [-0.25, 0.25]) {
            const px = ccx + nx * base + tx * BLOCK * t;
            const pz = ccz + nz * base + tz * BLOCK * t;
            const a = Math.atan2(-nz, nx);
            this.q.setFromAxisAngle(this.v3.set(0, 1, 0), a);
            this.m4.compose(this.v3.set(px, 0, pz), this.q, this.s3.set(1, 1, 1));
            this.poles.setMatrixAt(n, this.m4);
            this.heads.setMatrixAt(n, this.m4);
            const hx = px + nx * 2.4;
            const hz = pz + nz * 2.4;
            this.lampHeads.push(new THREE.Vector3(hx, 7.8, hz));
            this.q.identity();
            this.m4.compose(this.v3.set(hx, 0.03, hz), this.q, this.s3.set(2.6, 1, 14));
            this.pools.setMatrixAt(n, this.m4);
            n++;
          }
        }
      }
    }
    for (const m of [this.poles, this.heads, this.pools]) {
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
      m.computeBoundingSphere();
    }
  }

  // ---------- per frame ----------
  private updateAtmosphere(i: SceneInput): void {
    const night = this.tod;
    const u = this.skyMat.uniforms;
    u.uTod!.value = night;
    u.uTime!.value = this.time;
    u.uPad!.value = i.pad;
    (u.uTint!.value as THREE.Color).copy(this.tint);
    const fog = this.scene.fog as THREE.FogExp2;
    fog.color.setRGB(0.85, 0.42, 0.22).lerp(this.col.setRGB(0.13, 0.075, 0.06), night).multiplyScalar(0.75);
    this.hemi.color.setRGB(0.35, 0.45, 0.75).lerp(this.col.setRGB(0.12, 0.13, 0.22), night);
    this.hemi.intensity = 1.3 - night * 0.95 + i.pad * 0.15;
    this.sun.intensity = (1 - night) * 2.2;
    this.buildMat.emissiveIntensity = 0.35 + night * 0.7;
    this.rainMat.uniforms.uTime!.value = this.time;
    (this.rainMat.uniforms.uCam!.value as THREE.Vector3).copy(this.camera.position);
    this.rainMat.uniforms.uLevel!.value = 0.12 + night * 0.18 + i.hat * 0.1;
    if (Math.abs(night - this.envTod) > 0.06) {
      this.envTod = night;
      const t = this.pmrem.fromScene(this.envScene, 0, 1, 200);
      this.scene.environment = t.texture;
      this.envTarget?.dispose();
      this.envTarget = t;
    }
  }

  private updateLamps(i: SceneInput): void {
    const night = this.tod;
    const on = 0.35 + 0.65 * night;
    this.poolMat.uniforms.uGain!.value = (1.1 + i.kick * 0.9) * on;
    (this.heads.material as THREE.MeshBasicMaterial).color.setRGB(6, 4, 2.2).multiplyScalar(on * (0.85 + i.kick * 0.4));
    // Real point lights on the nearest lamps ahead, for highlights on the wet road and facades.
    const cam = this.camera.position;
    const fx = this.dir.x;
    const fz = this.dir.z;
    const best: { d: number; p: THREE.Vector3 }[] = [];
    for (const p of this.lampHeads) {
      const dx = p.x - cam.x;
      const dz = p.z - cam.z;
      if (dx * fx + dz * fz < -6) continue;
      const d = dx * dx + dz * dz;
      if (best.length < POINT_LIGHTS) best.push({ d, p });
      else {
        let w = 0;
        for (let k = 1; k < best.length; k++) if (best[k]!.d > best[w]!.d) w = k;
        if (d < best[w]!.d) best[w] = { d, p };
      }
    }
    this.points.forEach((l, k) => {
      const b = best[k];
      if (!b) {
        l.intensity = 0;
        return;
      }
      l.position.copy(b.p);
      l.intensity = 260 * on * (0.9 + i.kick * 0.35) * THREE.MathUtils.smoothstep(Math.sqrt(b.d), 110, 50);
    });
  }

  private updateCars(dt: number): void {
    const cam = this.camera.position;
    for (const c of this.cars) {
      c.g.position.addScaledVector(c.dir, c.v * dt);
      const dx = c.g.position.x - cam.x;
      const dz = c.g.position.z - cam.z;
      if (dx * dx + dz * dz > 340 * 340 || dx * this.dir.x + dz * this.dir.z < -40) this.spawnCar(c, false);
    }
  }

  private updateSigns(i: SceneInput): void {
    for (const s of this.signs) {
      if (!s.mesh.visible) continue;
      const age = this.time - s.born;
      const flash = Math.exp(-age * 5) * (0.8 + s.vel);
      const hold = age < s.life ? 1 : Math.max(0, 1 - (age - s.life) / 6);
      const flicker = 1 + i.snare * 0.25 * Math.sin(age * 90);
      const lvl = (0.9 + flash) * hold * flicker;
      // Neon stays lit at a low glow afterwards, so the street fills up as the music plays.
      s.mat.color.copy(s.color).multiplyScalar(Math.max(0.55, 2.2 * lvl));
      s.streakMat.uniforms.uGain!.value = Math.max(0.25, 0.9 * lvl);
    }
  }

  private updateBeams(): void {
    for (const b of this.beams) {
      if (!b.g.visible) continue;
      const age = this.time - b.born;
      const a = Math.min(1, age / 1.2) * Math.min(1, Math.max(0, (b.life - age) / 2));
      if (a <= 0 && age > 1) {
        b.g.visible = false;
        continue;
      }
      b.mat.uniforms.uAlpha!.value = a * 0.22;
      b.g.rotation.set(0.32 * Math.cos(this.time * 0.29 + b.phase), 0, 0.38 * Math.sin(this.time * 0.37 + b.phase));
    }
  }

  // ---------- note events ----------
  private neon(color: RGB, pitch: number, vel: number, durS: number): void {
    for (let tries = 0; tries < 6; tries++) {
      const s = this.cam + rnd(40, 150);
      const piece = this.pathAt(s, this.tmpP, this.tmpD);
      if (!piece || piece.turn) continue;
      const along = this.tmpD.x !== 0 ? this.tmpP.x : this.tmpP.z;
      if (Math.abs(along - Math.round(along / P) * P) < HALF + 3) continue;
      const side = Math.random() < 0.5 ? -1 : 1;
      const rx = -this.tmpD.z * side;
      const rz = this.tmpD.x * side;
      const sign = this.signs[this.signNext]!;
      this.signNext = (this.signNext + 1) % SIGNS;
      const blade = Math.random() < 0.7;
      const k = Math.floor(Math.random() * this.neonTex.length);
      sign.mat.map = blade ? this.neonTex[k % 2]! : this.neonTex[2 + (k % 2)]!;
      sign.mat.needsUpdate = true;
      const y = 4 + pitch * 9 + rnd(0, 2);
      if (blade) {
        sign.mesh.position.set(this.tmpP.x + rx * (HALF - 1.1), y, this.tmpP.z + rz * (HALF - 1.1));
        sign.mesh.rotation.set(0, Math.atan2(this.tmpD.x, this.tmpD.z), 0);
        sign.mesh.scale.set(1.3, rnd(3, 5), 1);
      } else {
        sign.mesh.position.set(this.tmpP.x + rx * (HALF - 0.05), y, this.tmpP.z + rz * (HALF - 0.05));
        sign.mesh.rotation.set(0, Math.atan2(-rx, -rz), 0);
        sign.mesh.scale.set(rnd(5, 8), 1.8, 1);
      }
      sign.streak.position.set(this.tmpP.x + rx * 5.5, 0.04, this.tmpP.z + rz * 5.5);
      sign.color.setRGB(...color);
      const m = Math.max(sign.color.r, sign.color.g, sign.color.b, 0.05);
      sign.color.multiplyScalar(1 / m);
      (sign.streakMat.uniforms.uColor!.value as THREE.Color).copy(sign.color);
      sign.vel = vel;
      sign.born = this.time;
      sign.life = Math.min(4, Math.max(0.8, durS + 0.6));
      sign.mesh.visible = true;
      sign.streak.visible = true;
      return;
    }
  }

  private searchlight(color: RGB, vel: number, durS: number): void {
    const b = this.beams[this.beamNext]!;
    this.beamNext = (this.beamNext + 1) % BEAMS;
    const side = Math.random() < 0.5 ? -1 : 1;
    const ahead = rnd(160, 320);
    const lat = side * rnd(40, 150);
    const cam = this.camera.position;
    b.g.position.set(cam.x + this.dir.x * ahead - this.dir.z * lat, rnd(50, 90), cam.z + this.dir.z * ahead + this.dir.x * lat);
    const c = (b.mat.uniforms.uColor!.value as THREE.Color).setRGB(...color);
    c.multiplyScalar((0.6 + vel * 0.6) / Math.max(c.r, c.g, c.b, 0.05));
    b.born = this.time;
    b.life = Math.min(12, durS + 4);
    b.phase = Math.random() * 10;
    b.g.visible = true;
  }

  private bassCar(vel: number): void {
    // Re-use the car furthest behind (or furthest away) as a fast oncoming car.
    const cam = this.camera.position;
    let pick: Car | undefined;
    let worst = -Infinity;
    for (const c of this.cars) {
      const dx = c.g.position.x - cam.x;
      const dz = c.g.position.z - cam.z;
      const score = Math.hypot(dx, dz) - (dx * this.dir.x + dz * this.dir.z) * 2;
      if (score > worst) {
        worst = score;
        pick = c;
      }
    }
    if (pick) this.spawnCar(pick, true, vel);
  }

  private spawnCar(c: Car, oncoming: boolean, vel = 0.5): void {
    // On the street the camera is on (or about to turn into).
    const s = this.cam + 10;
    let piece = this.pathAt(s, this.tmpP, this.tmpD);
    if (piece?.turn) piece = this.pathAt(piece.s0 + piece.len + 1, this.tmpP, this.tmpD);
    const fx = this.tmpD.x;
    const fz = this.tmpD.z;
    const same = !oncoming && Math.random() < 0.5;
    const lane = (Math.random() < 0.5 ? 1.75 : 5.25) * (same ? 1 : -1);
    const dist = oncoming ? rnd(120, 200) : rnd(30, 300);
    c.g.position.set(this.tmpP.x + fx * dist - fz * lane, 0, this.tmpP.z + fz * dist + fx * lane);
    c.dir.set(fx, 0, fz).multiplyScalar(same ? 1 : -1);
    c.v = same ? rnd(7, 12) : oncoming ? 16 + vel * 10 : rnd(10, 16);
    c.g.rotation.set(0, Math.atan2(c.dir.x, c.dir.z), 0);
  }

  // ---------- construction ----------
  private buildSky(): void {
    this.skyMat = new THREE.ShaderMaterial({
      uniforms: {
        uTod: { value: 1 },
        uTime: { value: 0 },
        uPad: { value: 0 },
        uTint: { value: new THREE.Color(0.5, 0.4, 0.9) },
        uSun: { value: new THREE.Vector3(-0.75, 0.06, -0.65).normalize() },
      },
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), this.skyMat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    this.scene.add(this.sky);
    const envSky = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), this.skyMat);
    this.envScene.add(envSky);
  }

  private buildGround(): void {
    const S = 1024;
    const k = S / P;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d')!;
    const mid = S / 2;
    g.fillStyle = '#1a1b1d';
    g.fillRect(0, 0, S, S);
    // Pavements, then roads over them (a cross centred on the intersection).
    g.fillStyle = '#4a4946';
    g.fillRect(mid - HALF * k, 0, STREET * k, S);
    g.fillRect(0, mid - HALF * k, S, STREET * k);
    g.fillStyle = '#5c5b57';
    for (let i = 0; i < S; i += 1.6 * k) {
      g.fillRect(mid - HALF * k, i, STREET * k, 1);
      g.fillRect(i, mid - HALF * k, 1, STREET * k);
    }
    g.fillStyle = '#242528';
    g.fillRect(mid - ROAD_HALF * k, 0, 2 * ROAD_HALF * k, S);
    g.fillRect(0, mid - ROAD_HALF * k, S, 2 * ROAD_HALF * k);
    // Asphalt grain.
    for (let n = 0; n < 60000; n++) {
      const x = Math.random() * S;
      const y = Math.random() * S;
      const l = 28 + Math.random() * 30;
      g.fillStyle = `rgba(${l},${l},${l + 3},0.35)`;
      g.fillRect(x, y, 2, 2);
    }
    g.fillStyle = '#cfcfc8';
    const curbIn = (ROAD_HALF + 0.15) * k;
    const stop = (HALF + 0.6) * k;
    const lane = 3.5 * k;
    for (const vertical of [true, false]) {
      const rect = (a: number, b: number, w: number, h: number) => (vertical ? g.fillRect(a, b, w, h) : g.fillRect(b, a, h, w));
      for (const [from, to] of [
        [0, mid - stop],
        [mid + stop, S],
      ] as const) {
        // Kerb lines, broken where the cross street meets them.
        rect(mid - curbIn, from, 3, to - from);
        rect(mid + curbIn - 3, from, 3, to - from);
        // Double centre line and dashed lane lines.
        rect(mid - 4, from, 2.5, to - from);
        rect(mid + 1.5, from, 2.5, to - from);
        for (let y = from; y < to - 3 * k; y += 9 * k) {
          rect(mid - lane - 1.5, y, 3, 3 * k);
          rect(mid + lane - 1.5, y, 3, 3 * k);
        }
      }
      // Zebra crossings on both sides of the intersection.
      for (const sgn of [-1, 1]) {
        const y0 = mid + sgn * (HALF + 0.8) * k - (sgn < 0 ? 3 * k : 0);
        for (let x = -ROAD_HALF + 0.5; x < ROAD_HALF - 0.5; x += 1.2) rect(mid + x * k, y0, 0.6 * k, 3 * k);
      }
    }
    const map = new THREE.CanvasTexture(c);
    map.colorSpace = THREE.SRGBColorSpace;
    // Wetness: shiny road with puddles, duller pavements.
    const RS = 512;
    const rc = document.createElement('canvas');
    rc.width = rc.height = RS;
    const rg = rc.getContext('2d')!;
    rg.fillStyle = '#d8d8d8';
    rg.fillRect(0, 0, RS, RS);
    const rk = RS / P;
    rg.fillStyle = '#9a9a9a';
    rg.fillRect(RS / 2 - HALF * rk, 0, STREET * rk, RS);
    rg.fillRect(0, RS / 2 - HALF * rk, RS, STREET * rk);
    rg.fillStyle = '#6e6e6e';
    rg.fillRect(RS / 2 - ROAD_HALF * rk, 0, 2 * ROAD_HALF * rk, RS);
    rg.fillRect(0, RS / 2 - ROAD_HALF * rk, RS, 2 * ROAD_HALF * rk);
    for (let n = 0; n < 160; n++) {
      const x = Math.random() * RS;
      const y = Math.random() * RS;
      const r = 4 + Math.random() * 16;
      const grd = rg.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, 'rgba(20,20,20,0.9)');
      grd.addColorStop(1, 'rgba(20,20,20,0)');
      rg.fillStyle = grd;
      rg.beginPath();
      rg.ellipse(x, y, r, r * (0.4 + Math.random() * 0.6), Math.random() * 3, 0, Math.PI * 2);
      rg.fill();
    }
    const rough = new THREE.CanvasTexture(rc);
    const REP = 2 * BUILD_RADIUS + 1;
    for (const t of [map, rough]) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(REP, REP);
      t.anisotropy = 8;
    }
    const mat = new THREE.MeshStandardMaterial({ map, roughnessMap: rough, roughness: 0.55, metalness: 0.15, envMapIntensity: 1.6 });
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(REP * P, REP * P), mat);
    this.ground.rotation.x = -Math.PI / 2;
    this.scene.add(this.ground);
  }

  private buildBuildings(): void {
    const W = COLS * 16;
    const H = ROWS * 16;
    const fc = document.createElement('canvas');
    const ec = document.createElement('canvas');
    fc.width = ec.width = W;
    fc.height = ec.height = H;
    const f = fc.getContext('2d')!;
    const e = ec.getContext('2d')!;
    f.fillStyle = '#b8b6b0';
    f.fillRect(0, 0, W, H);
    e.fillStyle = '#000';
    e.fillRect(0, 0, W, H);
    const lit = ['255,196,130', '255,214,160', '236,240,255', '210,225,255', '255,170,110', '170,200,255'];
    for (let row = 0; row < ROWS; row++) {
      const y = H - (row + 1) * 16; // row 0 is the ground floor at the bottom
      const density = row === 0 ? 0.8 : Math.random() < 0.25 ? rnd(0.6, 0.9) : rnd(0.08, 0.4);
      const warm = lit[Math.floor(Math.random() * lit.length)]!;
      for (let col = 0; col < COLS; col++) {
        const x = col * 16;
        if (row === 0) {
          // Shopfronts.
          f.fillStyle = '#2a2e36';
          f.fillRect(x + 1, y + 2, 14, 13);
          if (Math.random() < density) {
            const shop = lit[Math.floor(Math.random() * 3)]!;
            const grd = e.createLinearGradient(0, y + 3, 0, y + 15);
            grd.addColorStop(0, `rgba(${shop},${rnd(0.25, 0.45)})`);
            grd.addColorStop(1, `rgba(${shop},${rnd(0.5, 0.75)})`);
            e.fillStyle = grd;
            e.fillRect(x + 1, y + 3, 14, 12);
          }
          continue;
        }
        const g = 34 + Math.random() * 14;
        f.fillStyle = `rgb(${g},${g + 4},${g + 12})`;
        f.fillRect(x + 3, y + 3, 10, 9);
        if (Math.random() < density) {
          const c = Math.random() < 0.7 ? warm : lit[Math.floor(Math.random() * lit.length)]!;
          const a = rnd(0.3, 0.85);
          e.fillStyle = `rgba(${c},${a})`;
          e.fillRect(x + 3, y + 3, 10, 9);
          // Blinds: some windows only partly lit.
          if (Math.random() < 0.3) {
            e.fillStyle = 'rgba(0,0,0,0.7)';
            e.fillRect(x + 3, y + 3, 10, Math.floor(rnd(2, 7)));
          }
          f.fillStyle = 'rgba(255,240,210,0.25)';
          f.fillRect(x + 3, y + 3, 10, 9);
        }
      }
    }
    const map = new THREE.CanvasTexture(fc);
    const emi = new THREE.CanvasTexture(ec);
    for (const t of [map, emi]) {
      t.colorSpace = THREE.SRGBColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = 8;
    }
    this.buildMat = new THREE.MeshStandardMaterial({
      map,
      emissiveMap: emi,
      emissive: 0xffffff,
      emissiveIntensity: 1.2,
      roughness: 0.7,
      metalness: 0.25,
      envMapIntensity: 0.6,
    });
    // Window grid in metres: uv from the instance's size so every facade gets real-sized windows.
    this.buildMat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>
        {
          vec3 iS = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
          float hs = fract(sin(float(gl_InstanceID) * 12.9898) * 43758.5453);
          vec2 span = abs(normal.x) > 0.5 ? iS.zy : abs(normal.z) > 0.5 ? iS.xy : vec2(0.0);
          vec2 wuv = uv * span / vec2(${(BAY * COLS).toFixed(2)}, ${(FLOOR * ROWS).toFixed(2)}) + vec2(floor(hs * 16.0) / 16.0, 0.0);
          vMapUv = wuv;
          vEmissiveMapUv = wuv;
        }`,
      );
    };
    this.buildings = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), this.buildMat, MAX_BUILDINGS);
    this.buildings.setColorAt(0, new THREE.Color(1, 1, 1));
    this.buildings.count = 0;
    this.scene.add(this.buildings);
  }

  private buildLamps(): void {
    const pole = new THREE.BoxGeometry(0.22, 8, 0.22).translate(0, 4, 0);
    const arm = new THREE.BoxGeometry(2.5, 0.14, 0.14).translate(1.25, 7.95, 0);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.5, metalness: 0.6 });
    this.poles = new THREE.InstancedMesh(mergeGeometries([pole, arm])!, poleMat, MAX_LAMPS);
    const head = new THREE.BoxGeometry(1.0, 0.18, 0.45).translate(2.4, 7.82, 0);
    this.heads = new THREE.InstancedMesh(head, new THREE.MeshBasicMaterial({ color: 0xffb070 }), MAX_LAMPS);
    this.poolMat = streakMaterial(0xffa860, 0.6);
    this.pools = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), this.poolMat, MAX_LAMPS);
    this.pools.renderOrder = 2;
    for (const m of [this.poles, this.heads, this.pools]) {
      m.count = 0;
      this.scene.add(m);
    }
  }

  private buildLights(): void {
    this.hemi = new THREE.HemisphereLight(0x20243a, 0x2a1d14, 0.4);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffa060, 0);
    this.sun.position.set(-0.75, 0.12, -0.65).multiplyScalar(100);
    this.scene.add(this.sun);
    for (let k = 0; k < POINT_LIGHTS; k++) {
      const l = new THREE.PointLight(0xffb27a, 0, 60, 2);
      this.points.push(l);
      this.scene.add(l);
    }
  }

  private buildRain(): void {
    const N = 900;
    const pos = new Float32Array(N * 6);
    const tail = new Float32Array(N * 2);
    for (let k = 0; k < N; k++) {
      const x = Math.random() * 70;
      const y = Math.random() * 34;
      const z = Math.random() * 70;
      pos.set([x, y, z, x, y, z], k * 6);
      tail[k * 2 + 1] = 1;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('tail', new THREE.BufferAttribute(tail, 1));
    this.rainMat = new THREE.ShaderMaterial({
      uniforms: { uCam: { value: new THREE.Vector3() }, uTime: { value: 0 }, uLevel: { value: 0.2 } },
      vertexShader: RAIN_VERT,
      fragmentShader: RAIN_FRAG,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    const rain = new THREE.LineSegments(g, this.rainMat);
    rain.frustumCulled = false;
    this.scene.add(rain);
  }

  private buildSigns(): void {
    const draw = (w: number, h: number, paint: (g: CanvasRenderingContext2D) => void) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const g = c.getContext('2d')!;
      g.strokeStyle = '#fff';
      g.fillStyle = '#fff';
      g.shadowColor = '#fff';
      g.shadowBlur = 10;
      g.lineCap = 'round';
      paint(g);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    };
    const glyphs = (g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, n: number, vertical: boolean) => {
      g.lineWidth = 5;
      for (let i = 0; i < n; i++) {
        const cx = vertical ? x : x + (i * w) / n;
        const cy = vertical ? y + (i * h) / n : y;
        const cw = vertical ? w : w / n - 8;
        const ch = vertical ? h / n - 10 : h;
        g.beginPath();
        const kind = Math.floor(Math.random() * 4);
        if (kind === 0) g.rect(cx + 4, cy + 4, cw - 8, ch - 8);
        else if (kind === 1) g.ellipse(cx + cw / 2, cy + ch / 2, cw / 2 - 4, ch / 2 - 4, 0, 0, Math.PI * 2);
        else {
          g.moveTo(cx + 4, cy + ch - 4);
          g.lineTo(cx + cw / 2, cy + 4);
          g.lineTo(cx + cw - 4, cy + ch - 4);
          if (kind === 3) g.moveTo(cx + cw * 0.25, cy + ch * 0.6), g.lineTo(cx + cw * 0.75, cy + ch * 0.6);
        }
        g.stroke();
      }
    };
    // Two vertical blades and two horizontal fascia signs.
    for (let v = 0; v < 2; v++) {
      this.neonTex.push(
        draw(64, 256, (g) => {
          g.lineWidth = 4;
          g.strokeRect(6, 6, 52, 244);
          glyphs(g, 12, 14, 40, 232, 4 + v, true);
        }),
      );
    }
    for (let v = 0; v < 2; v++) {
      this.neonTex.push(
        draw(256, 64, (g) => {
          if (v === 0) {
            g.lineWidth = 4;
            g.strokeRect(6, 6, 244, 52);
          } else {
            g.lineWidth = 6;
            g.beginPath();
            g.moveTo(10, 54);
            g.lineTo(246, 54);
            g.stroke();
          }
          glyphs(g, 18, 12, 220, 38, 5 + v, false);
        }),
      );
    }
    const plane = new THREE.PlaneGeometry(1, 1);
    for (let k = 0; k < SIGNS; k++) {
      const mat = new THREE.MeshBasicMaterial({
        map: this.neonTex[0]!,
        color: 0xffffff,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(plane, mat);
      const streakMat = streakMaterial(0xffffff, 0.6);
      const streak = new THREE.Mesh(plane, streakMat);
      streak.scale.set(2.2, 1, 18);
      mesh.visible = streak.visible = false;
      streak.renderOrder = 2;
      this.scene.add(mesh, streak);
      this.signs.push({ mesh, mat, streak, streakMat, color: new THREE.Color(), vel: 0, born: -1e9, life: 1 });
    }
  }

  private buildBeams(): void {
    const geo = new THREE.CylinderGeometry(16, 0.5, 300, 24, 1, true).translate(0, 150, 0);
    for (let k = 0; k < BEAMS; k++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color(1, 1, 1) }, uAlpha: { value: 0 } },
        vertexShader: BEAM_VERT,
        fragmentShader: BEAM_FRAG,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const g = new THREE.Group();
      const cone = new THREE.Mesh(geo, mat);
      cone.frustumCulled = false;
      g.add(cone);
      g.visible = false;
      this.scene.add(g);
      this.beams.push({ g, mat, born: -1e9, life: 0, phase: 0 });
    }
  }

  private buildCars(): void {
    this.carGeo = {
      body: new RoundedBoxGeometry(1.9, 0.8, 4.5, 2, 0.22).translate(0, 0.65, 0),
      cabin: new RoundedBoxGeometry(1.7, 0.6, 2.3, 2, 0.2).translate(0, 1.3, -0.2),
      lamp: new THREE.BoxGeometry(0.45, 0.14, 0.06),
      streak: new THREE.PlaneGeometry(1, 1),
    };
    const paints = [0x1b1e24, 0x5a1414, 0x2b3a4f, 0x8a8c90, 0x101010, 0x36402c];
    this.carMats = {
      paint: paints.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.3, metalness: 0.7, envMapIntensity: 1.2 })),
      glass: new THREE.MeshStandardMaterial({ color: 0x0b0e14, roughness: 0.1, metalness: 0.9 }),
      head: new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 4.6, 4) }),
      tail: new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.3, 0.2) }),
      headStreak: streakMaterial(0xfff0dd, 0.8),
      tailStreak: streakMaterial(0xff2a1a, 0.6),
    };
    for (let k = 0; k < CARS; k++) {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(this.carGeo.body, this.carMats.paint[k % paints.length]!));
      g.add(new THREE.Mesh(this.carGeo.cabin, this.carMats.glass));
      for (const x of [-0.65, 0.65]) {
        const h = new THREE.Mesh(this.carGeo.lamp, this.carMats.head);
        h.position.set(x, 0.75, 2.26);
        const t = new THREE.Mesh(this.carGeo.lamp, this.carMats.tail);
        t.position.set(x, 0.85, -2.26);
        g.add(h, t);
      }
      const hs = new THREE.Mesh(this.carGeo.streak, this.carMats.headStreak);
      hs.position.set(0, 0.03, 3);
      hs.scale.set(2.2, 1, 12);
      const ts = new THREE.Mesh(this.carGeo.streak, this.carMats.tailStreak);
      ts.position.set(0, 0.03, -2.6);
      ts.scale.set(1.8, 1, 7);
      hs.renderOrder = ts.renderOrder = 2;
      g.add(hs, ts);
      this.scene.add(g);
      const car: Car = { g, dir: new THREE.Vector3(0, 0, -1), v: 10 };
      this.cars.push(car);
      this.spawnCar(car, false);
    }
  }
}
