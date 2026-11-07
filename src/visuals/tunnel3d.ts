// Realistic road tunnel (three.js): a slowly winding 2×2-lane bore with traffic,
// tiled walls and ceiling light rows that react to the music.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

type RGB = [number, number, number];

/** What the visuals window tells the tunnel every frame. */
export interface TunnelInput {
  dt: number;
  /** Continuous beat count (quarter notes). */
  beats: number;
  playing: boolean;
  kick: number;
  snare: number;
  hat: number;
  energy: number;
  bass: number;
  pad: number;
  /** Chord colours from Drift (root, third, fifth), 0..1. */
  cols: RGB[];
  /** Drift's travel speed; 0.4 is the default cruising speed. */
  travelSpeed: number;
}

interface Car {
  mode: 'convoy' | 'over' | 'oncoming';
  rel: number;
  base: number;
  phase: number;
  v: number;
  lane: number;
  g: THREE.Group;
}

interface Flare {
  d: number;
  row: number;
  color: THREE.Color;
  vel: number;
  born: number;
  life: number;
}

interface Frame {
  p: THREE.Vector3;
  t: THREE.Vector3;
  s: THREE.Vector3;
  u: THREE.Vector3;
}

const mkFrame = (): Frame => ({ p: new THREE.Vector3(), t: new THREE.Vector3(), s: new THREE.Vector3(), u: new THREE.Vector3() });
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

// Cross-section in metres: +x is right, +y is up. Right-hand traffic.
const ROAD_W = 14.8;
const WALL_X = 8.3;
const LEDGE_Y = 0.25;
const TILE_TOP = LEDGE_Y + 3.9;
const CEIL = 5.9;
const CAM_LANE = 5.35;
const CRUISE = 25; // m/s at Drift's default speed (90 km/h)
const FIX_SP = 4;
const LROW = 10;
const CEIL_LIGHTS = 8;
const HM0 = 12.0;

export class Tunnel {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 700);

  private L = 0;
  private N = 0;
  private STEP = 2;
  private P: THREE.Vector3[] = [];
  private T: THREE.Vector3[] = [];
  private S: THREE.Vector3[] = [];
  private U: THREE.Vector3[] = [];

  private fixtures!: THREE.InstancedMesh;
  private fixN = 0;
  private ceilLights: THREE.PointLight[] = [];
  private oncomingLights: THREE.PointLight[] = [];
  private headBeam!: THREE.SpotLight;
  private hemi!: THREE.HemisphereLight;
  private cars: Car[] = [];
  private flares: Flare[] = [];

  private cam = 0;
  private time = 0;
  private speed = CRUISE;
  private first = true;
  private readonly tmpF = mkFrame();
  private readonly carF = mkFrame();
  private readonly camF = mkFrame();
  private readonly lookF = mkFrame();
  private readonly lookSm = new THREE.Vector3();
  private readonly fc = new THREE.Color();
  private readonly lc = new THREE.Color();
  private readonly hA = new THREE.Color();
  private readonly hB = new THREE.Color();

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'vis-canvas';
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.scene.background = new THREE.Color(0x030304);
    this.scene.fog = new THREE.FogExp2(0x040506, 0.0085);
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.85, 0.55, 0.82);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.buildPath();
    this.buildShell();
    this.buildProps();
    this.buildLights();
    this.buildTraffic();
  }

  /** Size in CSS pixels; ratio is device pixels per CSS pixel (lowered when the GPU struggles). */
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

  /** A melodic note lights a stretch of ceiling ahead in the track's colour. Higher notes land further away. */
  note(color: RGB, pitch: number, vel: number, durS: number): void {
    const d = this.cam + 22 + pitch * 70 + Math.random() * 10;
    this.flares.push({ d, row: Math.random() < 0.5 ? 0 : 1, color: new THREE.Color(...color), vel, born: this.time, life: Math.min(3, Math.max(0.6, durS + 0.5)) });
    if (this.flares.length > 12) this.flares.shift();
  }

  /** Current hectometre reading, as on the wall plates. */
  hectometre(): string {
    return (HM0 + this.cam / 1000).toFixed(1).replace('.', ',');
  }

  render(i: TunnelInput): void {
    const dt = i.dt;
    this.time += dt;
    const target = CRUISE * (i.travelSpeed / 0.4);
    this.speed += (target - this.speed) * (1 - Math.exp(-dt * 0.8));
    this.cam = this.wrap(this.cam + this.speed * dt);

    this.hA.setRGB(...(i.cols[1] ?? [0.5, 0.4, 0.9]));
    this.hB.setRGB(...(i.cols[2] ?? [0.9, 0.6, 0.3]));
    // Chord colours are fairly dark; normalise them so fixtures read as light sources.
    for (const c of [this.hA, this.hB]) {
      const m = Math.max(c.r, c.g, c.b, 0.05);
      c.multiplyScalar(1 / m);
    }

    this.updateCamera(dt);
    this.updateFixtures(i);
    this.updateCeilLights(i);
    this.updateTraffic(dt);
    this.hemi.color.copy(this.hA).lerp(this.hB, 0.5).multiplyScalar(0.6).addScalar(0.25);
    this.hemi.intensity = 0.18 + i.pad * 0.25;
    this.bloom.strength = 0.75 + i.kick * 0.35 + i.energy * 0.2;
    this.composer.render(dt);
  }

  dispose(): void {
    this.renderer.dispose();
    this.composer.dispose();
  }

  // ---------- path ----------
  private wrap(d: number): number {
    return ((d % this.L) + this.L) % this.L;
  }

  private frameAt(d: number, o: Frame): Frame {
    const f = this.wrap(d) / this.STEP;
    const i = Math.floor(f) % this.N;
    const k = f - Math.floor(f);
    o.p.lerpVectors(this.P[i]!, this.P[i + 1]!, k);
    o.t.lerpVectors(this.T[i]!, this.T[i + 1]!, k).normalize();
    o.s.lerpVectors(this.S[i]!, this.S[i + 1]!, k).normalize();
    o.u.lerpVectors(this.U[i]!, this.U[i + 1]!, k).normalize();
    return o;
  }

  /** A big loop with slow S-bends and gentle dips, sampled every ~2 m. */
  private buildPath(): void {
    const UP = new THREE.Vector3(0, 1, 0);
    const ctrl: THREE.Vector3[] = [];
    for (let i = 0; i < 160; i++) {
      const t = (i / 160) * Math.PI * 2;
      const r = 900 + 70 * Math.sin(5 * t) + 32 * Math.sin(11 * t + 1.3);
      ctrl.push(new THREE.Vector3(Math.cos(t) * r, 3.5 * Math.sin(3 * t) + 1.5 * Math.sin(8 * t), Math.sin(t) * r));
    }
    const curve = new THREE.CatmullRomCurve3(ctrl, true, 'centripetal');
    curve.arcLengthDivisions = 6000;
    this.L = curve.getLength();
    this.N = Math.round(this.L / 2);
    this.STEP = this.L / this.N;
    for (let i = 0; i <= this.N; i++) {
      const u = (i % this.N) / this.N;
      const p = curve.getPointAt(u);
      const t = curve.getTangentAt(u);
      const s = new THREE.Vector3().crossVectors(t, UP).normalize();
      this.P.push(p);
      this.T.push(t);
      this.S.push(s);
      this.U.push(new THREE.Vector3().crossVectors(s, t).normalize());
    }
  }

  /** Sweep a 2D cross-section along the path. uv is in metres (across, along). */
  private sweep(profile: [number, number][], material: THREE.Material): THREE.Mesh {
    const { N, P, S, U, STEP } = this;
    const M = profile.length;
    const cum = [0];
    for (let j = 1; j < M; j++) cum.push(cum[j - 1]! + Math.hypot(profile[j]![0] - profile[j - 1]![0], profile[j]![1] - profile[j - 1]![1]));
    const pos = new Float32Array((N + 1) * M * 3);
    const uv = new Float32Array((N + 1) * M * 2);
    for (let i = 0; i <= N; i++) {
      for (let j = 0; j < M; j++) {
        const [x, y] = profile[j]!;
        const k = i * M + j;
        pos[k * 3] = P[i]!.x + S[i]!.x * x + U[i]!.x * y;
        pos[k * 3 + 1] = P[i]!.y + S[i]!.y * x + U[i]!.y * y;
        pos[k * 3 + 2] = P[i]!.z + S[i]!.z * x + U[i]!.z * y;
        uv[k * 2] = cum[j]!;
        uv[k * 2 + 1] = i * STEP;
      }
    }
    const idx = new Uint32Array(N * (M - 1) * 6);
    let n = 0;
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < M - 1; j++) {
        const a = i * M + j;
        const b = (i + 1) * M + j;
        idx.set([a, b, a + 1, b, b + 1, a + 1], n);
        n += 6;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, material);
    m.frustumCulled = false;
    this.scene.add(m);
    return m;
  }

  // ---------- textures ----------
  private canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, repeat = true): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    draw(c.getContext('2d')!, w, h);
    const t = new THREE.CanvasTexture(c);
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    return t;
  }

  private static noise(g: CanvasRenderingContext2D, w: number, h: number, base: string, amt: number, n: number): void {
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < n; i++) {
      const c = Math.random() > 0.5 ? 255 : 0;
      g.fillStyle = `rgba(${c},${c},${c},${Math.random() * amt})`;
      g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
  }

  private buildShell(): void {
    // Asphalt: the texture spans the road width, with darker wheel tracks per lane.
    const asphalt = this.canvasTex(1024, 512, (g, w, h) => {
      Tunnel.noise(g, w, h, '#2b2c2e', 0.09, 60000);
      for (const lane of [-5.35, -1.85, 1.85, 5.35]) {
        for (const off of [-0.8, 0.8]) {
          const x = ((lane + off + ROAD_W / 2) / ROAD_W) * w;
          const gr = g.createLinearGradient(x - 22, 0, x + 22, 0);
          gr.addColorStop(0, 'rgba(0,0,0,0)');
          gr.addColorStop(0.5, 'rgba(8,8,10,0.45)');
          gr.addColorStop(1, 'rgba(0,0,0,0)');
          g.fillStyle = gr;
          g.fillRect(x - 22, 0, 44, h);
        }
      }
      for (let i = 0; i < 18; i++) {
        g.strokeStyle = 'rgba(15,15,16,0.5)';
        g.lineWidth = rnd(1, 3);
        g.beginPath();
        let x = rnd(0, w);
        let y = rnd(0, h);
        g.moveTo(x, y);
        for (let k = 0; k < 6; k++) g.lineTo((x += rnd(-30, 30)), (y += rnd(-20, 20)));
        g.stroke();
      }
    });
    asphalt.repeat.set(1 / ROAD_W, 1 / 20);
    // Wall tiles, 0.3 m: 13 rows up the wall, grime near the road, a blue band at ~1.4 m.
    const tiles = this.canvasTex(1040, 320, (g, w, h) => {
      for (let r = 0; r < 13; r++) {
        for (let c = 0; c < 4; c++) {
          const l = 196 + rnd(-8, 8);
          g.fillStyle = `rgb(${l},${l + 3},${l})`;
          g.fillRect(r * 80, c * 80, 80, 80);
        }
      }
      g.fillStyle = '#6d716f';
      for (let r = 0; r <= 13; r++) g.fillRect(r * 80 - 2, 0, 4, h);
      for (let c = 0; c <= 4; c++) g.fillRect(0, c * 80 - 2, w, 4);
      const d = g.createLinearGradient(0, 0, 360, 0);
      d.addColorStop(0, 'rgba(30,26,20,0.75)');
      d.addColorStop(1, 'rgba(30,26,20,0)');
      g.fillStyle = d;
      g.fillRect(0, 0, 360, h);
      g.fillStyle = 'rgba(40,90,150,0.85)';
      g.fillRect(4 * 80, 0, 80, h);
    });
    tiles.repeat.set(1 / 3.9, 1 / 1.2);
    const concrete = this.canvasTex(256, 256, (g, w, h) => Tunnel.noise(g, w, h, '#4a4c4c', 0.12, 9000));
    concrete.repeat.set(0.5, 0.5);
    const paint = this.canvasTex(256, 256, (g, w, h) => Tunnel.noise(g, w, h, '#1c1e20', 0.08, 6000));
    paint.repeat.set(1 / 3, 1 / 3);
    const dash = this.canvasTex(8, 96, (g, w, h) => {
      g.fillStyle = '#fff';
      g.fillRect(0, 0, w, h / 4);
    });
    dash.repeat.set(1, 1 / 12); // 3 m line, 9 m gap

    const ds = THREE.DoubleSide;
    const road = new THREE.MeshStandardMaterial({ map: asphalt, roughness: 0.62, side: ds });
    const tile = new THREE.MeshStandardMaterial({ map: tiles, roughness: 0.32, side: ds });
    const conc = new THREE.MeshStandardMaterial({ map: concrete, roughness: 0.85, side: ds });
    const dark = new THREE.MeshStandardMaterial({ map: paint, roughness: 0.9, side: ds });
    this.sweep([[-ROAD_W / 2, 0], [ROAD_W / 2, 0]], road);
    for (const sg of [-1, 1]) {
      this.sweep([[(sg * ROAD_W) / 2, 0], [(sg * ROAD_W) / 2, LEDGE_Y]], conc);
      this.sweep([[(sg * ROAD_W) / 2, LEDGE_Y], [sg * WALL_X, LEDGE_Y]], conc);
      this.sweep([[sg * WALL_X, LEDGE_Y], [sg * WALL_X, TILE_TOP]], tile);
      this.sweep([[sg * WALL_X, TILE_TOP], [sg * WALL_X, CEIL]], dark);
    }
    this.sweep([[-WALL_X, CEIL], [WALL_X, CEIL]], dark);

    const mark = { color: 0xe8e8e2, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -2, side: ds };
    const solid = new THREE.MeshStandardMaterial(mark);
    const dashed = new THREE.MeshStandardMaterial({ ...mark, map: dash, alphaTest: 0.5 });
    const line = (x0: number, x1: number, m: THREE.Material) => this.sweep([[x0, 0.012], [x1, 0.012]], m);
    line(-0.28, -0.13, solid);
    line(0.13, 0.28, solid);
    line(-3.68, -3.53, dashed);
    line(3.53, 3.68, dashed);
    line(-7.15, -6.95, solid);
    line(6.95, 7.15, solid);
  }

  // ---------- props ----------
  private place(d: number, x: number, y: number, out: THREE.Matrix4): THREE.Matrix4 {
    const f = this.frameAt(d, this.tmpF);
    const v = f.p.clone().addScaledVector(f.s, x).addScaledVector(f.u, y);
    out.makeBasis(f.s, f.u, f.t);
    const q = new THREE.Quaternion().setFromRotationMatrix(out);
    return out.compose(v, q, new THREE.Vector3(1, 1, 1));
  }

  private instanced(geo: THREE.BufferGeometry, mat: THREE.Material, items: [number, number, number][]): THREE.InstancedMesh {
    const im = new THREE.InstancedMesh(geo, mat, items.length);
    const m = new THREE.Matrix4();
    items.forEach(([d, x, y], i) => im.setMatrixAt(i, this.place(d, x, y, m)));
    im.frustumCulled = false;
    this.scene.add(im);
    return im;
  }

  private buildProps(): void {
    // Ceiling light rows over the lane lines, every 4 m.
    this.fixN = Math.floor(this.L / FIX_SP);
    const fix: [number, number, number][] = [];
    for (let k = 0; k < this.fixN; k++) for (const x of [-3.6, 3.6]) fix.push([k * FIX_SP, x, CEIL - 0.06]);
    this.fixtures = this.instanced(new THREE.BoxGeometry(0.22, 0.05, 2.4), new THREE.MeshBasicMaterial({ color: 0xffffff }), fix);
    this.fixtures.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(fix.length * 3).fill(0.6), 3);
    this.instanced(
      new THREE.BoxGeometry(0.42, 0.12, 2.7),
      new THREE.MeshStandardMaterial({ color: 0x3a3d40, roughness: 0.5, metalness: 0.6 }),
      fix.map(([d, x]) => [d, x, CEIL - 0.02]),
    );

    // Jet fans every 180 m.
    const fans: [number, number, number][] = [];
    for (let d = 60; d < this.L; d += 180) for (const x of [-6.2, 6.2]) fans.push([d, x, CEIL - 0.85]);
    const fan = new THREE.CylinderGeometry(0.6, 0.6, 4.2, 20, 1, true).rotateX(Math.PI / 2);
    this.instanced(fan, new THREE.MeshStandardMaterial({ color: 0x8c9296, roughness: 0.35, metalness: 0.85, side: THREE.DoubleSide }), fans);
    this.instanced(new THREE.CylinderGeometry(0.18, 0.18, 0.8, 12).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x222426, roughness: 0.6 }), fans);

    // Emergency exits every 250 m on both walls.
    const signs: [number, number, number][] = [];
    const doors: [number, number, number][] = [];
    for (let d = 120; d < this.L; d += 250) {
      for (const sg of [-1, 1]) {
        signs.push([d, sg * (WALL_X - 0.04), 2.75]);
        doors.push([d, sg * (WALL_X - 0.02), LEDGE_Y + 1.1]);
      }
    }
    this.instanced(new THREE.BoxGeometry(0.06, 0.32, 1.1), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 2.2, 0.8) }), signs);
    this.instanced(new THREE.BoxGeometry(0.05, 2.2, 1.4), new THREE.MeshStandardMaterial({ color: 0x1f6b45, roughness: 0.6 }), doors);

    // Hectometre plates every 100 m on the right wall.
    const plate = new THREE.PlaneGeometry(0.8, 0.4);
    const m = new THREE.Matrix4();
    for (let d = 0; d < this.L - 50; d += 100) {
      const label = (HM0 + d / 1000).toFixed(1).replace('.', ',');
      const tex = this.canvasTex(
        160,
        80,
        (g, w, h) => {
          g.fillStyle = '#1f7a4d';
          g.fillRect(0, 0, w, h);
          g.strokeStyle = '#fff';
          g.lineWidth = 4;
          g.strokeRect(5, 5, w - 10, h - 10);
          g.fillStyle = '#fff';
          g.font = '600 44px "Arial Narrow", "Roboto Condensed", sans-serif';
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.fillText(label, w / 2, h / 2 + 2);
        },
        false,
      );
      const mesh = new THREE.Mesh(plate, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4, emissive: 0xffffff, emissiveIntensity: 0.35, emissiveMap: tex }));
      mesh.applyMatrix4(this.place(d, WALL_X - 0.03, 2.1, m));
      mesh.rotateY(-Math.PI / 2);
      this.scene.add(mesh);
    }
  }

  private buildLights(): void {
    this.hemi = new THREE.HemisphereLight(0x9aa6b0, 0x141210, 0.22);
    this.scene.add(this.hemi);
    for (let i = 0; i < CEIL_LIGHTS; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 0, 2);
      this.scene.add(l);
      this.ceilLights.push(l);
    }
    for (let i = 0; i < 2; i++) {
      const l = new THREE.PointLight(0xfff2dd, 0, 0, 2);
      this.scene.add(l);
      this.oncomingLights.push(l);
    }
    this.headBeam = new THREE.SpotLight(0xfff4e6, 170, 90, 0.42, 0.65, 1.6);
    this.scene.add(this.headBeam, this.headBeam.target);
  }

  // ---------- traffic ----------
  private buildTraffic(): void {
    const glow = this.canvasTex(
      64,
      64,
      (g, w, h) => {
        const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
        r.addColorStop(0, 'rgba(255,255,255,1)');
        r.addColorStop(0.2, 'rgba(255,255,255,0.55)');
        r.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = r;
        g.fillRect(0, 0, w, h);
      },
      false,
    );
    const geo = {
      body: new RoundedBoxGeometry(1.84, 0.72, 4.5, 3, 0.26),
      cabin: new RoundedBoxGeometry(1.58, 0.62, 2.35, 3, 0.24),
      suvBody: new RoundedBoxGeometry(1.92, 0.95, 4.7, 3, 0.28),
      suvCabin: new RoundedBoxGeometry(1.7, 0.7, 2.9, 3, 0.22),
      cab: new RoundedBoxGeometry(2.45, 2.6, 2.2, 2, 0.25),
      box: new THREE.BoxGeometry(2.5, 3.0, 7.6),
      shield: new THREE.BoxGeometry(2.2, 0.9, 0.05),
      wheel: new THREE.CylinderGeometry(0.34, 0.34, 0.24, 18).rotateZ(Math.PI / 2),
      lamp: new THREE.BoxGeometry(0.34, 0.11, 0.05),
      glow: new THREE.PlaneGeometry(1, 1),
    };
    const glass = new THREE.MeshStandardMaterial({ color: 0x07090b, roughness: 0.08, metalness: 0.9 });
    const tyre = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
    const cargo = new THREE.MeshStandardMaterial({ color: 0xd9d9d4, roughness: 0.6 });
    const head = new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 4.8, 4.2) });
    const tail = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.12, 0.06) });
    const additive = { map: glow, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false };
    const glowW = new THREE.MeshBasicMaterial({ ...additive, color: new THREE.Color(1.6, 1.5, 1.3) });
    const glowR = new THREE.MeshBasicMaterial({ ...additive, color: new THREE.Color(1.4, 0.05, 0.02) });
    const PAINT = [0xb8bcc0, 0x1a1c1f, 0x2b3f63, 0x7a1c1c, 0xe4e4e0, 0x50565c, 0x1d4a3a, 0x8b6d3c];

    const makeCar = (kind: 'car' | 'suv' | 'truck'): THREE.Group => {
      const g = new THREE.Group();
      const paint = new THREE.MeshStandardMaterial({ color: PAINT[Math.floor(Math.random() * PAINT.length)], roughness: 0.32, metalness: 0.55 });
      const add = (geom: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
        const m = new THREE.Mesh(geom, mat);
        m.position.set(x, y, z);
        g.add(m);
        return m;
      };
      let front = 2.26;
      let back = -2.26;
      let lampY = 0.62;
      let lampX = 0.68;
      if (kind === 'truck') {
        front = 4.95;
        back = -5.0;
        lampY = 0.85;
        lampX = 0.95;
        add(geo.cab, paint, 0, 1.75, 3.8);
        add(geo.shield, glass, 0, 2.4, 4.92);
        add(geo.box, cargo, 0, 2.1, -1.2);
        for (const z of [3.6, -1.5, -3.6]) for (const x of [-1.05, 1.05]) add(geo.wheel, tyre, x, 0.48, z).scale.set(1.5, 1.4, 1.4);
      } else {
        const suv = kind === 'suv';
        add(suv ? geo.suvBody : geo.body, paint, 0, suv ? 0.78 : 0.62, 0);
        add(suv ? geo.suvCabin : geo.cabin, glass, 0, suv ? 1.52 : 1.2, -0.25);
        const roof = add(suv ? geo.suvCabin : geo.cabin, paint, 0, suv ? 1.82 : 1.47, -0.25);
        roof.scale.set(1.01, 0.25, 0.9);
        for (const z of [1.4, -1.4]) for (const x of [-0.84, 0.84]) add(geo.wheel, tyre, x, 0.34, z);
        if (suv) {
          front = 2.36;
          back = -2.36;
          lampY = 0.85;
        }
      }
      for (const sx of [-1, 1]) {
        add(geo.lamp, head, sx * lampX, lampY, front + 0.01);
        add(geo.glow, glowW, sx * lampX, lampY, front + 0.06).scale.setScalar(1.5);
        add(geo.lamp, tail, sx * lampX, lampY, back - 0.01);
        const tg = add(geo.glow, glowR, sx * lampX, lampY, back - 0.06);
        tg.scale.setScalar(0.9);
        tg.rotation.y = Math.PI;
      }
      g.matrixAutoUpdate = false;
      this.scene.add(g);
      return g;
    };
    const pick = (): 'car' | 'suv' | 'truck' => {
      const r = Math.random();
      return r < 0.12 ? 'truck' : r < 0.4 ? 'suv' : 'car';
    };
    const car = (mode: Car['mode'], rel: number, v: number, lane: number, kind: 'car' | 'suv' | 'truck'): Car => ({
      mode,
      rel,
      base: rel,
      phase: Math.random() * 6,
      v,
      lane,
      g: makeCar(kind),
    });
    // Our carriageway: a loose convoy in our lane, faster cars overtaking on the left.
    for (const [rel, kind] of [[34, 'car'], [92, 'suv'], [165, 'truck'], [260, 'car']] as const) this.cars.push(car('convoy', rel, 0, CAM_LANE, kind));
    for (let i = 0; i < 6; i++) this.cars.push(car('over', rnd(-60, 400), rnd(5, 11), 1.85, Math.random() < 0.1 ? 'suv' : 'car'));
    // Oncoming carriageway; trucks keep to the slow lane.
    for (let i = 0; i < 16; i++) {
      const lane = Math.random() < 0.5 ? -1.85 : -5.35;
      this.cars.push(car('oncoming', rnd(-20, 480), rnd(22, 33), lane, lane === -5.35 ? pick() : Math.random() < 0.3 ? 'suv' : 'car'));
    }
  }

  private readonly cm = new THREE.Matrix4();
  private readonly cq = new THREE.Quaternion();
  private readonly cp = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly side = new THREE.Vector3();
  private readonly one = new THREE.Vector3(1, 1, 1);

  private placeCar(c: Car, s: number, forward: boolean): void {
    const f = this.frameAt(s, this.carF);
    this.dir.copy(f.t).multiplyScalar(forward ? 1 : -1);
    this.side.crossVectors(f.u, this.dir).normalize();
    this.cm.makeBasis(this.side, f.u, this.dir);
    this.cq.setFromRotationMatrix(this.cm);
    this.cp.copy(f.p).addScaledVector(f.s, c.lane);
    c.g.matrix.compose(this.cp, this.cq, this.one);
    c.g.matrixWorldNeedsUpdate = true;
  }

  private updateTraffic(dt: number): void {
    // Traffic speeds scale with ours, so the convoy keeps pace at any Speed setting.
    const k = this.speed / CRUISE;
    const near: Car[] = [];
    for (const c of this.cars) {
      if (c.mode === 'convoy') {
        this.placeCar(c, this.cam + c.base + Math.sin(this.time * 0.21 + c.phase) * 6, true);
      } else if (c.mode === 'over') {
        c.rel += c.v * k * dt;
        if (c.rel > 470) {
          c.rel = -70 - rnd(0, 160);
          c.v = rnd(5, 11);
        }
        this.placeCar(c, this.cam + c.rel, true);
      } else {
        c.rel -= (c.v + CRUISE) * k * dt;
        if (c.rel < -40) {
          c.rel = 480 + rnd(0, 200);
          c.v = rnd(22, 33);
        }
        this.placeCar(c, this.cam + c.rel, false);
        if (c.rel > 4 && c.rel < 140) near.push(c);
      }
    }
    near.sort((a, b) => a.rel - b.rel);
    this.oncomingLights.forEach((l, i) => {
      const c = near[i];
      if (!c) {
        l.intensity = 0;
        return;
      }
      const f = this.frameAt(this.cam + c.rel - 3.5, this.tmpF);
      l.position.copy(f.p).addScaledVector(f.s, c.lane).addScaledVector(f.u, 0.7);
      l.intensity = 55 * THREE.MathUtils.smoothstep(140 - c.rel, 0, 40);
    });
  }

  // ---------- camera and music lights ----------
  private updateCamera(dt: number): void {
    const f = this.frameAt(this.cam, this.camF);
    const sway = Math.sin(this.time * 0.37) * 0.12;
    this.camera.position.copy(f.p).addScaledVector(f.s, CAM_LANE + sway).addScaledVector(f.u, 1.22 + Math.sin(this.time * 7.1) * 0.006);
    const l = this.frameAt(this.cam + 28, this.lookF);
    const look = l.p.clone().addScaledVector(l.s, CAM_LANE - 0.6 + sway).addScaledVector(l.u, 0.95);
    if (this.first) {
      this.lookSm.copy(look);
      this.first = false;
    } else this.lookSm.lerp(look, 1 - Math.exp(-dt * 4));
    this.camera.up.copy(f.u);
    this.camera.lookAt(this.lookSm);
    this.headBeam.position.copy(this.camera.position).addScaledVector(f.u, -0.6);
    const t = this.frameAt(this.cam + 32, this.lookF);
    this.headBeam.target.position.copy(t.p).addScaledVector(t.s, CAM_LANE - 0.4);
  }

  /** Colour of the light at distance d: chord colours drifting along the tunnel, a chase pulse riding the beat. */
  private lightColor(d: number, i: TunnelInput, out: THREE.Color): THREE.Color {
    const rel = d - this.cam;
    const w = 0.5 + 0.5 * Math.sin(d * 0.04 - this.time * 0.5);
    this.lc.copy(this.hA).lerp(this.hB, w);
    const drive = i.playing ? 1 : 0.25;
    const chase = Math.pow(0.5 + 0.5 * Math.cos((rel / 16 - i.beats) * Math.PI * 2), 10);
    const lvl = 0.55 + 0.5 * i.kick + 2.4 * chase * (0.3 + i.kick) * drive + 0.5 * i.snare + 0.25 * i.hat + 0.3 * i.bass;
    return out.copy(this.lc).multiplyScalar(lvl * 1.3);
  }

  private updateFixtures(i: TunnelInput): void {
    const col = this.fixtures.instanceColor!.array as Float32Array;
    const n = this.fixN;
    const k0 = Math.floor((this.cam - 40) / FIX_SP);
    const k1 = Math.floor((this.cam + 460) / FIX_SP);
    for (let f = this.flares.length - 1; f >= 0; f--) if (this.time - this.flares[f]!.born > this.flares[f]!.life) this.flares.splice(f, 1);
    for (let k = k0; k <= k1; k++) {
      const kk = ((k % n) + n) % n;
      const d = k * FIX_SP;
      this.lightColor(d, i, this.fc);
      for (let r = 0; r < 2; r++) {
        let R = this.fc.r;
        let G = this.fc.g;
        let B = this.fc.b;
        for (const fl of this.flares) {
          if (fl.row !== r) continue;
          const dd = d - fl.d;
          if (dd * dd > 400) continue;
          const age = (this.time - fl.born) / fl.life;
          const a = Math.exp(-(dd * dd) / 60) * (1 - age) * Math.min(1, age * 20) * (2 + fl.vel * 4);
          R += fl.color.r * a;
          G += fl.color.g * a;
          B += fl.color.b * a;
        }
        const o = (kk * 2 + r) * 3;
        col[o] = R;
        col[o + 1] = G;
        col[o + 2] = B;
      }
    }
    // Rows just behind the camera fall back to a neutral level, so no stale colour waits a lap later.
    for (let k = k0 - 6; k < k0; k++) {
      const kk = ((k % n) + n) % n;
      col.fill(0.6, kk * 6, kk * 6 + 6);
    }
    this.fixtures.instanceColor!.needsUpdate = true;
  }

  private updateCeilLights(i: TunnelInput): void {
    const base = Math.floor(this.cam / LROW) * LROW - LROW;
    const frac = (this.cam % LROW) / LROW;
    this.ceilLights.forEach((l, j) => {
      const d = base + j * LROW;
      const f = this.frameAt(d, this.tmpF);
      l.position.copy(f.p).addScaledVector(f.u, CEIL - 0.5);
      this.lightColor(d, i, this.fc);
      const m = Math.max(this.fc.r, this.fc.g, this.fc.b, 0.001);
      l.color.setRGB(this.fc.r / m, this.fc.g / m, this.fc.b / m);
      const edge = j === 0 ? 1 - frac : j === CEIL_LIGHTS - 1 ? frac : 1;
      l.intensity = 45 * Math.min(m, 4) * edge;
    });
  }
}
