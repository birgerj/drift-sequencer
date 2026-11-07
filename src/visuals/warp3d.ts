// Hyperspace journey (three.js): cruise through a star system past a planet and
// its moons, comets and ships, then jump to the next system at the end of every
// 16-bar phrase.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import type { RGB, Scene3D, SceneInput } from './scene3d';

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const SUN = new THREE.Vector3(1, 0.28, 0.45).normalize();
const NS = 3000;
const DEPTH = 5000;
const START_Z = -2600;
const PHRASE = 64; // beats: 16 bars of 4/4

// ---------- value noise for planet textures ----------
const perm = new Uint8Array(512);
for (let i = 0; i < 256; i++) perm[i] = i;
for (let i = 255; i > 0; i--) {
  const j = Math.floor(Math.random() * (i + 1));
  [perm[i], perm[j]] = [perm[j]!, perm[i]!];
}
for (let i = 0; i < 256; i++) perm[i + 256] = perm[i]!;
const hsh = (i: number, j: number, k: number) => perm[perm[perm[i & 255]! + (j & 255)]! + (k & 255)]! / 255;
function noise3(x: number, y: number, z: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  let fx = x - ix;
  let fy = y - iy;
  let fz = z - iz;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  fz = fz * fz * (3 - 2 * fz);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  return l(
    l(l(hsh(ix, iy, iz), hsh(ix + 1, iy, iz), fx), l(hsh(ix, iy + 1, iz), hsh(ix + 1, iy + 1, iz), fx), fy),
    l(l(hsh(ix, iy, iz + 1), hsh(ix + 1, iy, iz + 1), fx), l(hsh(ix, iy + 1, iz + 1), hsh(ix + 1, iy + 1, iz + 1), fx), fy),
    fz,
  );
}
function fbm(x: number, y: number, z: number, o = 5): number {
  let s = 0;
  let a = 0.5;
  for (let i = 0; i < o; i++) {
    s += a * noise3(x, y, z);
    x = x * 2.03 + 1.7;
    y = y * 2.03 + 9.2;
    z = z * 2.03 + 3.1;
    a *= 0.5;
  }
  return s / (1 - Math.pow(0.5, o));
}
type C4 = [number, number, number, number?];
const mixc = (a: number[], b: number[], t: number): RGB => {
  const k = Math.max(0, Math.min(1, t));
  return [a[0]! + (b[0]! - a[0]!) * k, a[1]! + (b[1]! - a[1]!) * k, a[2]! + (b[2]! - a[2]!) * k];
};
function palette(stops: RGB[], t: number): RGB {
  t = ((t % 1) + 1) % 1;
  const n = stops.length;
  const f = t * n;
  const i = Math.floor(f);
  return mixc(stops[i % n]!, stops[(i + 1) % n]!, f - i);
}
const scale = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];

/** Equirectangular texture sampled on the unit sphere, so there is no seam. */
function sphereTex(w: number, h: number, fn: (x: number, y: number, z: number, lat: number) => C4 | RGB): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  const img = g.createImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    const lat = (0.5 - (y + 0.5) / h) * Math.PI;
    const cl = Math.cos(lat);
    const sl = Math.sin(lat);
    for (let x = 0; x < w; x++) {
      const lon = ((x + 0.5) / w) * Math.PI * 2;
      const v = fn(cl * Math.cos(lon), sl, cl * Math.sin(lon), lat);
      const k = (y * w + x) * 4;
      d[k] = v[0];
      d[k + 1] = v[1];
      d[k + 2] = v[2];
      d[k + 3] = v[3] ?? 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

const TEX = {
  saturn: () =>
    sphereTex(512, 256, (x, y, z, lat) => {
      const t = lat / Math.PI + 0.5 + (fbm(x * 3, y * 3, z * 3, 4) - 0.5) * 0.04;
      const c = palette([[226, 205, 160], [200, 170, 118], [235, 218, 182], [184, 150, 100], [214, 190, 140]], t * 5.5);
      return scale(c, 0.9 + 0.2 * fbm(x * 12, y * 40, z * 12, 3));
    }),
  earth: () =>
    sphereTex(512, 256, (x, y, z, lat) => {
      const n = fbm(x * 2.2, y * 2.2, z * 2.2, 6);
      if (Math.abs(lat) > 1.22 + (n - 0.5) * 0.4) return [235, 240, 245];
      if (n > 0.53) return mixc([70, 110, 52], [150, 128, 88], (n - 0.53) * 6);
      return mixc([10, 34, 92], [32, 92, 150], (n - 0.3) * 4);
    }),
  clouds: () =>
    sphereTex(512, 256, (x, y, z) => {
      const n = fbm(x * 3.5 + 7, y * 6 + 7, z * 3.5 + 7, 5);
      return [255, 255, 255, Math.max(0, Math.min(255, (n - 0.5) * 900))];
    }),
  rust: () =>
    sphereTex(512, 256, (x, y, z) => {
      const n = fbm(x * 3, y * 3, z * 3, 6);
      const m = fbm(x * 9 + 3, y * 9, z * 9, 3);
      return mixc(mixc([120, 48, 28], [196, 98, 54], n * 1.4 - 0.2), [70, 36, 30], (m - 0.55) * 3);
    }),
  violet: () =>
    sphereTex(512, 256, (x, y, z, lat) => {
      const t = lat / Math.PI + 0.5 + (fbm(x * 2.5, y * 2.5, z * 2.5, 5) - 0.5) * 0.09;
      let c = palette([[88, 64, 140], [60, 120, 150], [140, 110, 180], [40, 70, 110]], t * 4);
      const sd = Math.sqrt((x - 0.75) ** 2 + (y + 0.3) ** 2 * 3 + (z - 0.55) ** 2);
      if (sd < 0.22) c = mixc(c, [230, 200, 240], (0.22 - sd) * 7);
      return c;
    }),
  moon: (tint: RGB) =>
    sphereTex(256, 128, (x, y, z) => {
      const n = fbm(x * 4, y * 4, z * 4, 6);
      const cr = fbm(x * 14 + 5, y * 14, z * 14, 2);
      return scale(tint, (0.55 + 0.6 * n) * (cr > 0.68 ? 0.7 : 1));
    }),
};

interface System {
  name: string;
  at: [number, number];
  build(g: THREE.Group): void;
}
interface Comet {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  hist: THREE.Vector3[];
  life: number;
  tail: THREE.Points;
  head: THREE.Sprite;
}
interface Ship {
  g: THREE.Group;
  engines: THREE.Sprite[];
  navs: THREE.Sprite[];
  base: THREE.Color;
  phase: number;
  v: number;
  cross: number;
}
interface Meteor {
  line: THREE.Line;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  max: number;
}

const TAIL_N = 90;

export class Warp implements Scene3D {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.5, 30000);
  private dotTex: THREE.CanvasTexture;
  private skyMat!: THREE.ShaderMaterial;
  private flash!: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;

  private sx = new Float32Array(NS);
  private sy = new Float32Array(NS);
  private sz = new Float32Array(NS);
  private sb = new Float32Array(NS);
  private lineGeo = new THREE.BufferGeometry();
  private dotGeo = new THREE.BufferGeometry();
  private dotMat!: THREE.PointsMaterial;

  private systems: System[];
  private system: THREE.Group | undefined;
  private phrase = -1;
  private comets: Comet[] = [];
  private ships: Ship[] = [];
  private meteors: Meteor[] = [];
  private hullMat: THREE.MeshStandardMaterial;
  private darkMat = new THREE.MeshStandardMaterial({ color: 0x24272d, metalness: 0.6, roughness: 0.5 });
  private glassMat = new THREE.MeshStandardMaterial({ color: 0x0a1420, metalness: 0.9, roughness: 0.05, emissive: 0x0c2a48, emissiveIntensity: 0.6 });

  private time = 0;
  private cruise = 60;
  private shipTimer = 2;
  private cometTimer = 4;
  private lastSnare = 0;
  private name = '';
  private readonly sunView = new THREE.Vector3();
  private readonly cA = new THREE.Color();
  private readonly cB = new THREE.Color();

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'vis-canvas';
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.scene.background = new THREE.Color(0x000002);
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 1.0, 0.6, 0.72);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.dotTex = Warp.makeDotTex();
    this.hullMat = new THREE.MeshStandardMaterial({ map: Warp.makeHullTex(), metalness: 0.7, roughness: 0.4 });
    this.buildSky();
    this.buildStars();
    this.systems = this.defineSystems();
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

  /** A melodic note becomes a shooting star in the track's colour; higher notes streak higher up. */
  note(color: RGB, pitch: number, vel: number, durS: number): void {
    if (this.meteors.length > 14) return;
    this.spawnMeteor(new THREE.Color(...color).multiplyScalar(2.2 + vel * 2), pitch, Math.min(1.2, 0.4 + durS * 0.3));
  }

  caption(): string {
    return this.name;
  }

  render(i: SceneInput): void {
    const dt = i.dt;
    this.time += dt;
    // A jump closes every 16-bar phrase: build-up over the last 2 bars, drop-out over the first bar and a half.
    const pb = ((i.beats % PHRASE) + PHRASE) % PHRASE;
    const w = pb >= 56 ? THREE.MathUtils.smoothstep(pb, 56, 63.5) : pb < 6 ? 1 - THREE.MathUtils.smoothstep(pb, 0.5, 6) : 0;
    const phrase = Math.floor(i.beats / PHRASE);
    if (phrase !== this.phrase) {
      this.phrase = phrase;
      this.enterSystem(phrase);
    }
    const flash = w > 0.5 ? Math.exp(-Math.min(pb, PHRASE - pb) * 3) * (pb > 32 ? 0.9 : 0.6) : 0;
    this.cruise += (60 * (i.travelSpeed / 0.4) - this.cruise) * (1 - Math.exp(-dt * 0.8));
    const speed = this.cruise + w * w * 4200;

    this.updateStars(dt, speed, w, i);
    this.updateSystem(dt, w);

    // Ships and comets only in normal space; a snare now and then drops a shooting star.
    if (w < 0.1) {
      this.shipTimer -= dt;
      if (this.shipTimer < 0 && this.ships.length < 4) {
        this.spawnShip();
        this.shipTimer = rnd(4, 9);
      }
      this.cometTimer -= dt;
      if (this.cometTimer < 0 && this.comets.length < 2) {
        this.spawnComet();
        this.cometTimer = rnd(10, 18);
      }
      if (Math.random() < dt * 0.2) this.spawnMeteor(new THREE.Color(3, 3, 3.4), Math.random(), rnd(0.4, 0.8));
      if (i.snare > 0.6 && this.time - this.lastSnare > 0.3) {
        this.lastSnare = this.time;
        if (Math.random() < 0.35) this.spawnMeteor(new THREE.Color(3, 3, 3.4), Math.random(), rnd(0.4, 0.8));
      }
    }
    if (w > 0.3) this.clearTraffic();
    this.updateShips(dt, speed, i.kick + i.bass * 0.5);
    this.updateComets(dt, speed);
    this.updateMeteors(dt);

    // Camera: slow drift, wider and shakier in hyperspace.
    this.camera.fov = 60 + w * 32;
    this.camera.updateProjectionMatrix();
    const t = this.time;
    this.camera.rotation.set(
      Math.sin(t * 0.13) * 0.03 + (Math.random() - 0.5) * w * 0.006,
      Math.sin(t * 0.09) * 0.05 + (Math.random() - 0.5) * w * 0.006,
      Math.sin(t * 0.07) * 0.04 + w * 0.15 * Math.sin(t * 0.6),
    );
    // Nebula takes the chord colours.
    this.cA.setRGB(...(i.cols[0] ?? [0.1, 0.2, 0.6]));
    this.cB.setRGB(...(i.cols[1] ?? [0.6, 0.15, 0.5]));
    (this.skyMat.uniforms.uA!.value as THREE.Color).lerp(this.cA, 1 - Math.exp(-dt * 1.5));
    (this.skyMat.uniforms.uB!.value as THREE.Color).lerp(this.cB, 1 - Math.exp(-dt * 1.5));
    this.skyMat.uniforms.uT!.value = t;
    this.skyMat.uniforms.uGlow!.value = i.snare * 0.08 + i.pad * 0.15 + w * 0.5;
    this.flash.material.uniforms.uA!.value = flash;
    this.flash.visible = flash > 0.002;
    this.bloom.strength = 0.9 + i.kick * 0.4 + w * 0.6;
    this.composer.render(dt);
  }

  dispose(): void {
    this.renderer.dispose();
    this.composer.dispose();
  }

  // ---------- sky, stars, flash ----------
  private static makeDotTex(): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const r = g.createRadialGradient(32, 32, 0, 32, 32, 30);
    r.addColorStop(0, 'rgba(255,255,255,1)');
    r.addColorStop(0.25, 'rgba(255,255,255,0.6)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  }

  private static makeHullTex(): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d')!;
    g.fillStyle = '#8a9099';
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 60; i++) {
      const l = 120 + Math.random() * 40;
      g.fillStyle = `rgb(${l},${l + 4},${l + 10})`;
      g.fillRect(rnd(0, 256), rnd(0, 256), rnd(10, 60), rnd(8, 40));
    }
    g.strokeStyle = 'rgba(30,32,38,0.6)';
    g.lineWidth = 1.5;
    for (let i = 0; i <= 256; i += 32) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i, 256);
      g.moveTo(0, i);
      g.lineTo(256, i);
      g.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  private additive(color: THREE.Color): THREE.SpriteMaterial {
    return new THREE.SpriteMaterial({ map: this.dotTex, color, blending: THREE.AdditiveBlending, depthWrite: false });
  }

  private buildSky(): void {
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: { uA: { value: new THREE.Color(0.1, 0.2, 0.6) }, uB: { value: new THREE.Color(0.6, 0.15, 0.5) }, uT: { value: 0 }, uGlow: { value: 0 } },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform vec3 uA, uB; uniform float uT, uGlow; varying vec3 vDir;
        float h(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
        float n(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(h(i), h(i + vec3(1,0,0)), f.x), mix(h(i + vec3(0,1,0)), h(i + vec3(1,1,0)), f.x), f.y),
                     mix(mix(h(i + vec3(0,0,1)), h(i + vec3(1,0,1)), f.x), mix(h(i + vec3(0,1,1)), h(i + vec3(1,1,1)), f.x), f.y), f.z); }
        float fbm(vec3 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 6; i++) { s += a * n(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; } return s; }
        void main(){
          vec3 d = normalize(vDir);
          float f = fbm(d * 2.2 + vec3(0.0, 0.0, uT * 0.004));
          float g = fbm(d * 4.5 - vec3(uT * 0.002));
          float band = exp(-pow(d.y + 0.15 * sin(d.x * 2.0), 2.0) * 12.0);
          float neb = smoothstep(0.42, 0.9, f) * (0.35 + band);
          vec3 col = mix(uA, uB, smoothstep(0.3, 0.7, g)) * neb * (0.3 + uGlow);
          col += vec3(0.6, 0.65, 0.8) * band * 0.012 * (0.5 + f);
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.scene.add(new THREE.Mesh(new THREE.SphereGeometry(20000, 48, 24), this.skyMat));

    // Distant stars, denser along a galactic band.
    const n = 9000;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const lon = Math.random() * Math.PI * 2;
      const lat = Math.random() < 0.45 ? (Math.random() - 0.5) * 0.35 : Math.asin(Math.random() * 2 - 1);
      pos.set([Math.cos(lat) * Math.cos(lon) * 18000, Math.sin(lat) * 18000, Math.cos(lat) * Math.sin(lon) * 18000], i * 3);
      const b = Math.pow(Math.random(), 3) * 1.6 + 0.2;
      const t = Math.random();
      const c: RGB = t < 0.15 ? [1, 0.75, 0.55] : t < 0.4 ? [0.7, 0.8, 1] : [1, 1, 1];
      col.set(scale(c, b), i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.scene.add(
      new THREE.Points(g, new THREE.PointsMaterial({ size: 2.2, sizeAttenuation: false, map: this.dotTex, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })),
    );
    const sun = new THREE.Sprite(this.additive(new THREE.Color(6, 5, 3.6)));
    sun.position.copy(SUN).multiplyScalar(16000);
    sun.scale.setScalar(1400);
    this.scene.add(sun);
    const light = new THREE.DirectionalLight(0xfff1dd, 2.6);
    light.position.copy(SUN);
    this.scene.add(light, new THREE.AmbientLight(0x6070a0, 0.05));

    // White flash when entering and leaving hyperspace.
    this.flash = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        uniforms: { uA: { value: 0 } },
        transparent: true,
        depthTest: false,
        depthWrite: false,
        vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }',
        fragmentShader: 'uniform float uA; void main(){ gl_FragColor = vec4(0.92, 0.95, 1.0, uA); }',
      }),
    );
    this.flash.frustumCulled = false;
    this.flash.renderOrder = 999;
    this.scene.add(this.flash);
  }

  private spawnStar(i: number, z: number): void {
    const r = 40 + Math.pow(Math.random(), 0.6) * 1400;
    const a = Math.random() * Math.PI * 2;
    this.sx[i] = Math.cos(a) * r;
    this.sy[i] = Math.sin(a) * r;
    this.sz[i] = z;
    this.sb[i] = 0.3 + Math.random() * 1.2;
  }

  /** Nearby stars: dots at cruise speed, streaks in hyperspace. */
  private buildStars(): void {
    for (let i = 0; i < NS; i++) this.spawnStar(i, -Math.random() * DEPTH);
    this.lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NS * 6), 3));
    this.lineGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(NS * 6), 3));
    const streaks = new THREE.LineSegments(this.lineGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    streaks.frustumCulled = false;
    this.dotGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NS * 3), 3));
    this.dotGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(NS * 3), 3));
    this.dotMat = new THREE.PointsMaterial({ size: 3, sizeAttenuation: false, map: this.dotTex, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const dots = new THREE.Points(this.dotGeo, this.dotMat);
    dots.frustumCulled = false;
    this.scene.add(streaks, dots);
  }

  private updateStars(dt: number, speed: number, w: number, i: SceneInput): void {
    const lp = this.lineGeo.attributes.position!.array as Float32Array;
    const lc = this.lineGeo.attributes.color!.array as Float32Array;
    const dp = this.dotGeo.attributes.position!.array as Float32Array;
    const dc = this.dotGeo.attributes.color!.array as Float32Array;
    const len = 0.2 + w * w * 340;
    const pulse = 1 + i.kick * 0.8 + i.hat * 0.3;
    const dw = 1 - 0.75 * w;
    const { sx, sy, sz, sb } = this;
    for (let k = 0; k < NS; k++) {
      sz[k]! += speed * dt;
      if (sz[k]! > 20) this.spawnStar(k, sz[k]! - DEPTH - 20);
      const bb = sb[k]! * Math.min(1, ((sz[k]! + DEPTH) / DEPTH) * 1.4) * pulse;
      const r = bb * (1 - 0.4 * w);
      const g = bb * (1 - 0.15 * w);
      const b = bb * (1 + 0.6 * w);
      const x = sx[k]!;
      const y = sy[k]!;
      const z = sz[k]!;
      lp[k * 6] = x;
      lp[k * 6 + 1] = y;
      lp[k * 6 + 2] = z;
      lp[k * 6 + 3] = x;
      lp[k * 6 + 4] = y;
      lp[k * 6 + 5] = z - len;
      lc[k * 6] = r * 1.6;
      lc[k * 6 + 1] = g * 1.6;
      lc[k * 6 + 2] = b * 1.6;
      dp[k * 3] = x;
      dp[k * 3 + 1] = y;
      dp[k * 3 + 2] = z;
      dc[k * 3] = r * dw;
      dc[k * 3 + 1] = g * dw;
      dc[k * 3 + 2] = b * dw;
    }
    this.lineGeo.attributes.position!.needsUpdate = true;
    this.lineGeo.attributes.color!.needsUpdate = true;
    this.dotGeo.attributes.position!.needsUpdate = true;
    this.dotGeo.attributes.color!.needsUpdate = true;
    this.dotMat.size = 2.4 + i.kick * 1.4;
  }

  // ---------- star systems ----------
  private atmosphere(r: number, color: number, strength: number): THREE.Mesh {
    return new THREE.Mesh(
      new THREE.SphereGeometry(r * 1.05, 64, 32),
      new THREE.ShaderMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        uniforms: { uColor: { value: new THREE.Color(color) }, uSun: { value: new THREE.Vector3() }, uK: { value: strength } },
        vertexShader:
          'varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
        fragmentShader: `uniform vec3 uColor, uSun; uniform float uK; varying vec3 vN; varying vec3 vV;
          void main(){ float f = pow(1.0 - max(dot(vN, vV), 0.0), 2.5); float l = smoothstep(-0.3, 0.6, dot(vN, uSun)); gl_FragColor = vec4(uColor * f * l * uK, 1.0); }`,
      }),
    );
  }

  private moon(r: number, orbit: number, speed: number, tint: RGB, tilt = 0.2): THREE.Group {
    const pivot = new THREE.Group();
    pivot.rotation.z = tilt;
    pivot.rotation.y = Math.random() * 6;
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 48, 24), new THREE.MeshStandardMaterial({ map: TEX.moon(tint), roughness: 1 }));
    m.position.x = orbit;
    pivot.add(m);
    pivot.userData.speed = speed;
    return pivot;
  }

  private static ringTexture(): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 1024;
    c.height = 4;
    const g = c.getContext('2d')!;
    for (let x = 0; x < 1024; x++) {
      const r = x / 1024;
      const n = noise3(r * 80, 0.5, 0.5) * 0.6 + noise3(r * 300, 2, 2) * 0.4;
      let a = 0.25 + 0.7 * n;
      if (r > 0.56 && r < 0.6) a *= 0.08; // Cassini division
      if (r < 0.04 || r > 0.97) a *= 0.2;
      const l = 180 + 60 * n;
      g.fillStyle = `rgba(${l},${l * 0.92},${l * 0.78},${a})`;
      g.fillRect(x, 0, 1, 4);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  private static rings(inner: number, outer: number, opacity = 1): THREE.Mesh {
    const geo = new THREE.RingGeometry(inner, outer, 160, 1);
    const p = geo.attributes.position!;
    const uv = geo.attributes.uv!;
    for (let i = 0; i < p.count; i++) uv.setXY(i, (Math.hypot(p.getX(i), p.getY(i)) - inner) / (outer - inner), 0.5);
    geo.rotateX(-Math.PI / 2);
    return new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ map: Warp.ringTexture(), transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false, color: new THREE.Color(0.85, 0.85, 0.85) }),
    );
  }

  private planet(r: number, map: THREE.Texture, rough = 0.9): THREE.Mesh {
    return new THREE.Mesh(new THREE.SphereGeometry(r, 96, 48), new THREE.MeshStandardMaterial({ map, roughness: rough }));
  }

  private defineSystems(): System[] {
    return [
      {
        name: 'Saturnus',
        at: [-520, 140],
        build: (g) => {
          const R = 260;
          const p = this.planet(R, TEX.saturn());
          const tilt = new THREE.Group();
          tilt.rotation.set(0.42, 0, -0.18);
          tilt.add(p, Warp.rings(R * 1.24, R * 2.3));
          g.add(tilt, this.atmosphere(R, 0xe8d2a0, 0.6), this.moon(22, R * 3.1, 0.05, [170, 160, 140]), this.moon(34, R * 3.9, 0.03, [190, 150, 110], -0.1));
          g.userData.spin = p;
        },
      },
      {
        name: 'Thalassa',
        at: [480, -170],
        build: (g) => {
          const R = 220;
          const p = this.planet(R, TEX.earth(), 0.7);
          const cl = new THREE.Mesh(new THREE.SphereGeometry(R * 1.012, 96, 48), new THREE.MeshStandardMaterial({ map: TEX.clouds(), transparent: true, depthWrite: false, roughness: 1 }));
          p.rotation.z = cl.rotation.z = 0.35;
          g.add(p, cl, this.atmosphere(R, 0x5aa0ff, 1.8), this.moon(56, R * 2.6, 0.04, [160, 158, 155], 0.1));
          g.userData.spin = p;
          g.userData.spin2 = cl;
        },
      },
      {
        name: 'Rubra',
        at: [-430, -110],
        build: (g) => {
          const R = 180;
          const p = this.planet(R, TEX.rust(), 1);
          g.add(p, this.atmosphere(R, 0xff9a6a, 0.7), this.moon(14, R * 2.0, 0.12, [140, 120, 105], 0.3), this.moon(10, R * 3.0, 0.08, [120, 110, 100], -0.2));
          g.userData.spin = p;
        },
      },
      {
        name: 'Ianthe',
        at: [540, 190],
        build: (g) => {
          const R = 300;
          const p = this.planet(R, TEX.violet(), 0.85);
          const tilt = new THREE.Group();
          tilt.rotation.set(-0.3, 0, 0.5);
          tilt.add(p, Warp.rings(R * 1.5, R * 1.9, 0.35));
          g.add(
            tilt,
            this.atmosphere(R, 0x9a8cff, 1.2),
            this.moon(26, R * 2.4, 0.06, [200, 205, 215]),
            this.moon(18, R * 3.0, 0.045, [180, 170, 160], 0.4),
            this.moon(40, R * 3.8, 0.025, [150, 160, 170], -0.25),
          );
          g.userData.spin = p;
        },
      },
    ];
  }

  private enterSystem(i: number): void {
    if (this.system) {
      this.scene.remove(this.system);
      this.system.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        const mat = m.material as THREE.MeshStandardMaterial | undefined;
        mat?.map?.dispose();
        mat?.dispose?.();
      });
    }
    const s = this.systems[((i % this.systems.length) + this.systems.length) % this.systems.length]!;
    const g = new THREE.Group();
    s.build(g);
    g.position.set(s.at[0], s.at[1], START_Z);
    g.rotation.y = rnd(-0.4, 0.4);
    this.scene.add(g);
    this.system = g;
    this.name = s.name;
  }

  private updateSystem(dt: number, w: number): void {
    const g = this.system;
    if (!g) return;
    g.visible = w < 0.35;
    g.position.z += this.cruise * dt * 0.9;
    for (const c of g.children) if (c.userData.speed) c.rotation.y += (c.userData.speed as number) * dt;
    (g.userData.spin as THREE.Object3D | undefined)?.rotateY(dt * 0.02);
    (g.userData.spin2 as THREE.Object3D | undefined)?.rotateY(dt * 0.026);
    this.sunView.copy(SUN).transformDirection(this.camera.matrixWorldInverse);
    g.traverse((o) => {
      const u = ((o as THREE.Mesh).material as THREE.ShaderMaterial | undefined)?.uniforms;
      if (u?.uSun) (u.uSun.value as THREE.Vector3).copy(this.sunView);
    });
  }

  // ---------- comets ----------
  private spawnComet(): void {
    const side = Math.random() < 0.5 ? -1 : 1;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TAIL_N * 6), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(TAIL_N * 6), 3));
    const tail = new THREE.Points(geo, new THREE.PointsMaterial({ size: 26, map: this.dotTex, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    tail.frustumCulled = false;
    const head = new THREE.Sprite(this.additive(new THREE.Color(3, 3.4, 4)));
    head.scale.setScalar(40);
    this.scene.add(tail, head);
    this.comets.push({
      pos: new THREE.Vector3(side * rnd(1400, 1800), rnd(-300, 500), rnd(-2200, -1300)),
      vel: new THREE.Vector3(-side * rnd(140, 220), rnd(-40, 20), rnd(-30, 60)),
      hist: [],
      life: 0,
      tail,
      head,
    });
  }

  private updateComets(dt: number, speed: number): void {
    for (let k = this.comets.length - 1; k >= 0; k--) {
      const c = this.comets[k]!;
      c.life += dt;
      c.pos.addScaledVector(c.vel, dt);
      c.pos.z += speed * dt;
      for (const h of c.hist) h.z += speed * dt;
      c.hist.unshift(c.pos.clone());
      if (c.hist.length > TAIL_N) c.hist.pop();
      c.head.position.copy(c.pos);
      const p = c.tail.geometry.attributes.position!.array as Float32Array;
      const col = c.tail.geometry.attributes.color!.array as Float32Array;
      for (let i = 0; i < TAIL_N; i++) {
        const h = c.hist[Math.min(i, c.hist.length - 1)]!;
        const f = 1 - i / TAIL_N;
        // Dust tail follows the path; ion tail points straight away from the sun.
        p.set([h.x + rnd(-3, 3) * i * 0.1, h.y + rnd(-3, 3) * i * 0.1, h.z], i * 6);
        p.set([c.pos.x - SUN.x * i * 9, c.pos.y - SUN.y * i * 9, c.pos.z - SUN.z * i * 9], i * 6 + 3);
        col.set([1.4 * f * f, 1.2 * f * f, 0.9 * f * f, 0.4 * f, 0.8 * f, 1.6 * f], i * 6);
      }
      c.tail.geometry.attributes.position!.needsUpdate = true;
      c.tail.geometry.attributes.color!.needsUpdate = true;
      if (c.life > 30 || c.pos.z > 200) this.removeComet(k);
    }
  }

  private removeComet(k: number): void {
    const c = this.comets[k]!;
    this.scene.remove(c.tail, c.head);
    c.tail.geometry.dispose();
    this.comets.splice(k, 1);
  }

  // ---------- ships ----------
  private makeShip(kind: 'fighter' | 'freighter'): Ship {
    const g = new THREE.Group();
    const engines: THREE.Sprite[] = [];
    const navs: THREE.Sprite[] = [];
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      g.add(m);
      return m;
    };
    const glow = (color: THREE.Color, s: number, x: number, y: number, z: number, list: THREE.Sprite[]) => {
      const sp = new THREE.Sprite(this.additive(color));
      sp.scale.setScalar(s);
      sp.position.set(x, y, z);
      g.add(sp);
      list.push(sp);
    };
    const base = Math.random() < 0.5 ? new THREE.Color(3.2, 1.6, 0.5) : new THREE.Color(0.8, 1.8, 4);
    if (kind === 'freighter') {
      add(new THREE.BoxGeometry(8, 6, 46), this.hullMat, 0, 0, 0);
      add(new THREE.BoxGeometry(14, 2, 10), this.darkMat, 0, -3.5, 8);
      for (let i = 0; i < 5; i++) add(new THREE.BoxGeometry(10, 7, 6), i % 2 ? this.darkMat : this.hullMat, 0, 0.5, -16 + i * 7);
      add(new THREE.BoxGeometry(5, 3, 6), this.glassMat, 0, 4, -20);
      for (const x of [-2.5, 2.5]) {
        for (const y of [-1.5, 1.5]) {
          add(new THREE.CylinderGeometry(1.4, 1.8, 3, 14).rotateX(Math.PI / 2), this.darkMat, x, y, 24);
          glow(base.clone(), 9, x, y, 26, engines);
        }
      }
      for (let i = 0; i < 6; i++) glow(new THREE.Color(3, 2.6, 1.2), 2.5, i % 2 ? 4.2 : -4.2, 3.2, -20 + i * 8, navs);
    } else {
      add(new THREE.CylinderGeometry(0.5, 1.7, 10, 12).rotateX(-Math.PI / 2), this.hullMat, 0, 0, 0);
      add(new THREE.SphereGeometry(0.9, 16, 12), this.glassMat, 0, 0.8, -1.6).scale.set(1, 0.6, 1.8);
      add(new THREE.BoxGeometry(10, 0.25, 3.2), this.hullMat, 0, -0.2, 2);
      add(new THREE.BoxGeometry(0.25, 2.4, 2.2), this.darkMat, 0, 1.3, 3.8);
      for (const x of [-2.4, 2.4]) {
        add(new THREE.CylinderGeometry(0.7, 0.85, 2.6, 12).rotateX(Math.PI / 2), this.darkMat, x, 0, 4);
        glow(base.clone(), 4.5, x, 0, 5.4, engines);
      }
      glow(new THREE.Color(4, 0.2, 0.15), 1.6, -5, -0.2, 2, navs);
      glow(new THREE.Color(0.2, 4, 0.6), 1.6, 5, -0.2, 2, navs);
    }
    this.scene.add(g);
    return { g, engines, navs, base, phase: Math.random() * 10, v: 0, cross: 0 };
  }

  private spawnShip(): void {
    const r = Math.random();
    let s: Ship;
    if (r < 0.45) {
      // Overtakes us from behind, close by.
      s = this.makeShip('fighter');
      s.g.position.set((Math.random() < 0.5 ? -1 : 1) * rnd(12, 40), rnd(-18, 18), 60);
      s.v = rnd(70, 140);
    } else if (r < 0.8) {
      // Oncoming.
      s = this.makeShip('fighter');
      s.g.position.set(rnd(-120, 120), rnd(-60, 60), -2400);
      s.v = -rnd(120, 220);
      s.g.rotation.y = Math.PI;
    } else {
      // Big freighter drifting across.
      s = this.makeShip('freighter');
      const side = Math.random() < 0.5 ? -1 : 1;
      s.g.position.set(side * 700, rnd(-120, 120), rnd(-900, -600));
      s.g.scale.setScalar(3);
      s.g.rotation.y = (side * Math.PI) / 2;
      s.cross = -side * 35;
    }
    s.g.rotation.z = rnd(-0.15, 0.15);
    this.ships.push(s);
  }

  private updateShips(dt: number, speed: number, drive: number): void {
    const t = this.time;
    for (let k = this.ships.length - 1; k >= 0; k--) {
      const s = this.ships[k]!;
      s.g.position.z += (speed - s.v) * dt * (s.cross ? 0.4 : 1);
      s.g.position.x += s.cross * dt;
      s.g.rotation.z += Math.sin(t * 0.7 + s.phase) * 0.0015;
      for (const e of s.engines) e.material.color.copy(s.base).multiplyScalar(0.8 + 0.5 * Math.min(1.2, drive) + 0.1 * Math.sin(t * 40 + s.phase));
      s.navs.forEach((n, i) => (n.visible = (t * 1.2 + s.phase + i * 0.17) % 1 < 0.18));
      const p = s.g.position;
      if (p.z > 300 || p.z < -4000 || Math.abs(p.x) > 1600) {
        this.scene.remove(s.g);
        this.ships.splice(k, 1);
      }
    }
  }

  private clearTraffic(): void {
    for (const s of this.ships) this.scene.remove(s.g);
    this.ships.length = 0;
    for (let k = this.comets.length - 1; k >= 0; k--) this.removeComet(k);
  }

  // ---------- shooting stars ----------
  private spawnMeteor(color: THREE.Color, height: number, life: number): void {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array([color.r, color.g, color.b, 0, 0, 0]), 3));
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    line.frustumCulled = false;
    const d = rnd(1200, 2600);
    const a = rnd(-0.9, 0.9);
    const b = -0.1 + height * 0.65;
    const pos = new THREE.Vector3(Math.sin(a) * d, Math.sin(b) * d, -Math.cos(a) * d);
    const ang = rnd(0, Math.PI * 2);
    const vel = new THREE.Vector3(Math.cos(ang), Math.sin(ang) * 0.6 - 0.4, 0).normalize().multiplyScalar(rnd(1500, 2600));
    this.scene.add(line);
    this.meteors.push({ line, pos, vel, life: 0, max: life });
  }

  private updateMeteors(dt: number): void {
    for (let k = this.meteors.length - 1; k >= 0; k--) {
      const m = this.meteors[k]!;
      m.life += dt;
      m.pos.addScaledVector(m.vel, dt);
      const p = m.line.geometry.attributes.position!.array as Float32Array;
      p.set([m.pos.x, m.pos.y, m.pos.z, m.pos.x - m.vel.x * 0.09, m.pos.y - m.vel.y * 0.09, m.pos.z - m.vel.z * 0.09]);
      m.line.geometry.attributes.position!.needsUpdate = true;
      (m.line.material as THREE.LineBasicMaterial).opacity = Math.sin(Math.PI * Math.min(1, m.life / m.max));
      if (m.life > m.max) {
        this.scene.remove(m.line);
        m.line.geometry.dispose();
        this.meteors.splice(k, 1);
      }
    }
  }
}
