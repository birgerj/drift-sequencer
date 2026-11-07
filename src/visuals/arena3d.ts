// Pulse (three.js): a stadium-sized hall with a dance party. Thousands of stylised dancers,
// moving heads on hanging trusses, lasers, strobes, smoke, LED screens, pyro and a DJ on stage.
// The show follows Drift's beat and chord colours; scene controls switch the parts on and off.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import type { RGB, Scene3D, SceneControl, SceneInput } from './scene3d';

type LightMode = 'auto' | 'sweep' | 'fan' | 'ballyhoo';
type CamMode = 'fly' | 'arena' | 'stage' | 'dj';
type Motion = Exclude<LightMode, 'auto'>;

interface ArenaSettings {
  beams: boolean;
  lasers: boolean;
  strobes: boolean;
  smoke: boolean;
  screens: boolean;
  pyro: boolean;
  lights: LightMode;
  camera: CamMode;
}
const DEFAULTS: ArenaSettings = { beams: true, lasers: true, strobes: true, smoke: true, screens: true, pyro: true, lights: 'auto', camera: 'fly' };
const STORE = 'drift.visuals.pulse';

interface Head {
  p: THREE.Vector3;
  u: number;
  row: number;
  stage: boolean;
  back: boolean;
  i: number;
  hit: THREE.Vector3;
  L: number;
  I: number;
  c: THREE.Color;
}
interface Person {
  x: number;
  y: number;
  z: number;
  yaw: number;
  s: number;
  up: number;
  en: number;
}
interface NoteHit {
  color: THREE.Color;
  pitch: number;
  vel: number;
  born: number;
  life: number;
}
interface Flame {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  fired: number;
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
/** Colour from hex without sRGB conversion: the scene is lit and shaded in display values. */
const raw = (hex: number) => new THREE.Color().setRGB(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255, THREE.LinearSRGBColorSpace);
const css = (c: THREE.Color) => `rgb(${Math.round(Math.min(1, c.r) * 255)},${Math.round(Math.min(1, c.g) * 255)},${Math.round(Math.min(1, c.b) * 255)})`;

// Hall in metres: x across, y up, z from the stage (-z) to the back (+z).
const HX = 84;
const HZ = 112;
const HY = 46;
const TY = 27;
const STEPS = 12;
const CROSS_Z = [-76, -50, -24, 2, 28, 54];
const NP = 24;
const AUTO: Motion[] = ['sweep', 'fan', 'ballyhoo', 'sweep', 'fan', 'ballyhoo'];
const ZAX = V3(0, 0, 1);
const FOG = 0x07060d;
// Physically based light units: π restores the brightness the show was designed with.
const PI = Math.PI;

export class Arena implements Scene3D {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(56, 16 / 9, 0.3, 700);
  private set: ArenaSettings;
  private small: boolean;

  private U = {
    uTime: { value: 0 },
    uBeat: { value: 0 },
    uKick: { value: 0 },
    uStrobe: { value: 0 },
    uEnergy: { value: 1 },
    uPools: { value: Array.from({ length: NP }, () => new THREE.Vector4(0, -100, 0, 1)) },
    uPoolCol: { value: Array.from({ length: NP }, () => new THREE.Vector3()) },
    uWash: { value: new THREE.Color(0.4, 0.1, 0.5) },
    uFogCol: { value: raw(FOG) },
    uFogD: { value: 0.0065 },
  };

  private heads: Head[] = [];
  private beams!: THREE.InstancedMesh;
  private beamCol!: THREE.InstancedBufferAttribute;
  private glows!: THREE.Points;
  private glowCol!: THREE.BufferAttribute;
  private poolHeads: number[] = [];
  private lasers: THREE.Mesh[] = [];
  private laserMat!: THREE.MeshBasicMaterial;
  private strobeMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
  private smoke: THREE.Mesh[] = [];
  private flames: Flame[] = [];
  private flameLight!: THREE.PointLight;
  private confetti!: THREE.Points;
  private confPos!: Float32Array;
  private confVel!: Float32Array;
  private confCol!: THREE.BufferAttribute;
  private confAt = -1e9;

  private wall!: { cv: HTMLCanvasElement; ctx: CanvasRenderingContext2D; tex: THREE.CanvasTexture; mat: THREE.ShaderMaterial };
  private side!: { cv: HTMLCanvasElement; ctx: CanvasRenderingContext2D; tex: THREE.CanvasTexture; mats: THREE.ShaderMaterial[] };
  private wash!: THREE.PointLight;
  private back!: THREE.PointLight;
  private sideL: THREE.PointLight[] = [];
  private stageEdge = new THREE.MeshBasicMaterial({ color: 0xffffff });
  private boothStrip = new THREE.MeshBasicMaterial({ color: 0xffffff });

  private flyPos!: THREE.CatmullRomCurve3;
  private flyLook!: THREE.CatmullRomCurve3;
  private camU = 0;
  private look = V3();
  private lookSm = V3();
  private camSm = V3();
  private camFirst = true;

  private time = 0;
  private frame = 0;
  private lastBar = -1;
  private dropAt = -1e9;
  private notes: NoteHit[] = [];
  private palA = new THREE.Color();
  private palB = new THREE.Color();
  private readonly M4 = new THREE.Matrix4();
  private readonly Q = new THREE.Quaternion();
  private readonly S = V3();
  private readonly D = V3();
  private readonly tc = new THREE.Color();
  private readonly white = new THREE.Color(1, 1, 1);
  private readonly laserGreen = new THREE.Color(0.2, 1, 0.4);

  constructor() {
    this.set = loadSettings();
    this.small = Math.min(innerWidth, innerHeight) < 700;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'vis-canvas';
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.scene.background = raw(0x020204);
    this.scene.fog = new THREE.FogExp2(raw(FOG), 0.0065);
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 1.05, 0.55, 0.5);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.buildHall();
    this.buildStage();
    this.buildScreens();
    this.buildTrusses();
    this.buildCrowd();
    this.buildHeads();
    this.buildEffects();
    this.buildLights();
    this.buildCamera();
    this.apply();
  }

  // ---------- Scene3D ----------

  resize(w: number, h: number, ratio: number): void {
    const r = Math.max(0.3, Math.min(ratio, this.small ? 1.5 : 1.25));
    if (this.renderer.getPixelRatio() !== r) {
      this.renderer.setPixelRatio(r);
      this.composer.setPixelRatio(r);
    }
    const size = this.renderer.getSize(new THREE.Vector2());
    if (size.x !== w || size.y !== h) {
      this.renderer.setSize(w, h, false);
      this.composer.setSize(w, h);
      this.bloom.resolution.set(w / 2, h / 2);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
  }

  /** A melodic note: a stage light swings to it in the track's colour and the LED wall shows a column at its pitch. */
  note(color: RGB, pitch: number, vel: number, durS: number): void {
    this.notes.push({ color: new THREE.Color(...color), pitch, vel, born: this.time, life: Math.min(2.5, Math.max(0.5, durS + 0.4)) });
    if (this.notes.length > 10) this.notes.shift();
  }

  controls(): SceneControl[] {
    const s = this.set;
    return [
      { kind: 'toggle', id: 'beams', label: 'Moving heads', title: 'Light beams from the trusses', value: s.beams },
      { kind: 'toggle', id: 'lasers', label: 'Lasers', title: 'Laser fan from the stage', value: s.lasers },
      { kind: 'toggle', id: 'strobes', label: 'Strobes', title: 'Strobe bursts at the end of each 16-bar phrase', value: s.strobes },
      { kind: 'toggle', id: 'smoke', label: 'Smoke', title: 'Haze and smoke over the crowd', value: s.smoke },
      { kind: 'toggle', id: 'screens', label: 'Screens', title: 'LED wall and side screens', value: s.screens },
      { kind: 'toggle', id: 'pyro', label: 'Pyro', title: 'Flame jets on the drop', value: s.pyro },
      {
        kind: 'choice', id: 'lights', label: 'Lights', title: 'How the moving heads move', value: s.lights,
        options: [
          { value: 'auto', label: 'Auto' },
          { value: 'sweep', label: 'Sweep' },
          { value: 'fan', label: 'Fan' },
          { value: 'ballyhoo', label: 'Ballyhoo' },
        ],
      },
      {
        kind: 'choice', id: 'camera', label: 'Camera', title: 'Camera position', value: s.camera,
        options: [
          { value: 'fly', label: 'Fly-through' },
          { value: 'arena', label: 'Overview' },
          { value: 'stage', label: 'From stage' },
          { value: 'dj', label: 'Behind DJ' },
        ],
      },
      { kind: 'action', id: 'confetti', label: 'Confetti', title: 'Fire the confetti cannons' },
      { kind: 'action', id: 'drop', label: 'Drop', title: 'Flash, pyro and confetti now' },
    ];
  }

  setControl(id: string, value: boolean | string): void {
    if (id === 'confetti') return this.fireConfetti();
    if (id === 'drop') return this.drop();
    if (id === 'lights' && typeof value === 'string') this.set.lights = value as LightMode;
    else if (id === 'camera' && typeof value === 'string') {
      this.set.camera = value as CamMode;
      this.camFirst = true;
    } else if (id in this.set && typeof value === 'boolean') (this.set as unknown as Record<string, boolean>)[id] = value;
    saveSettings(this.set);
    this.apply();
  }

  render(i: SceneInput): void {
    const dt = i.dt;
    this.time += dt;
    this.frame++;
    const t = this.time;
    const s = this.set;
    const beat = i.beats;
    const bar = Math.floor(beat / 4);
    const phase = ((beat % 1) + 1) % 1;
    const phrase = ((bar % 16) + 16) % 16;
    // Kick from Drift; a soft built-in pulse while stopped keeps the room breathing.
    const kick = i.playing ? i.kick : 0.25 * Math.exp(-phase * 4);
    const motion: Motion = s.lights === 'auto' ? AUTO[((Math.floor(bar / 8) % AUTO.length) + AUTO.length) % AUTO.length]! : s.lights;
    const strobing = s.strobes && i.playing && phrase === 15;

    // A new 16-bar phrase with some energy is a drop.
    if (bar !== this.lastBar) {
      if (i.playing && phrase === 0 && this.lastBar >= 0 && i.energy > 0.25) this.drop(true);
      else if (s.pyro && i.playing && phrase === 8 && i.energy > 0.45) this.firePyro([1, 6]);
      this.lastBar = bar;
    }
    const sinceDrop = t - this.dropAt;
    const drop = sinceDrop < 0.6 ? 1 - sinceDrop / 0.6 : 0;
    const energy = i.playing ? 0.55 + 0.75 * Math.min(1, i.energy * 1.4) + (strobing ? 0.3 : 0) : 0.18;
    let strobe = strobing ? (((beat * 4) % 1) < 0.12 ? 0.7 : 0) : s.strobes ? drop * 0.8 : drop * 0.25;

    // Chord colours, normalised so fixtures read as light sources.
    this.palA.setRGB(...(i.cols[1] ?? [0.5, 0.4, 0.9]));
    this.palB.setRGB(...(i.cols[2] ?? [0.9, 0.6, 0.3]));
    for (const c of [this.palA, this.palB]) c.multiplyScalar(1 / Math.max(c.r, c.g, c.b, 0.05));

    const U = this.U;
    U.uTime.value = t;
    U.uBeat.value = beat;
    U.uKick.value = kick;
    U.uStrobe.value = strobe;
    U.uEnergy.value = energy;
    U.uWash.value.copy(this.palA).lerp(this.palB, 0.35).multiplyScalar(0.35 + 0.6 * kick + i.pad * 0.15);
    this.wash.color.copy(this.palA);
    this.wash.intensity = (1.0 + 1.4 * kick + strobe * 4) * PI;
    this.back.color.copy(this.palB);
    this.back.intensity = (1.2 + kick) * PI;
    for (const l of this.sideL) {
      l.color.copy(this.palA);
      l.intensity = s.screens ? (0.4 + 0.5 * kick) * PI : 0;
    }
    this.strobeMat.color.setScalar(strobe * 3);
    this.stageEdge.color.copy(Math.floor(beat) % 2 ? this.palB : this.palA).multiplyScalar(1.2 + kick);
    this.boothStrip.color.copy(this.palB).multiplyScalar(1.5);

    this.updateHeads(motion, t, beat, kick, phrase, drop, strobing, i.playing);
    this.updateLasers(t, phase, kick, i.hat);
    this.updateFlames(t);
    this.updateConfetti(dt);
    for (const m of this.smoke) {
      m.quaternion.copy(this.camera.quaternion);
      m.position.x += (m.userData.v as number) * dt;
      if (Math.abs(m.position.x) > 66) m.userData.v = -(m.userData.v as number);
    }
    if (s.screens && this.frame % 2 === 0) {
      this.drawWall(t, beat, bar, kick, motion, strobing, drop);
      this.drawSide(beat, kick, energy);
    }
    for (let k = this.notes.length - 1; k >= 0; k--) if (t - this.notes[k]!.born > this.notes[k]!.life) this.notes.splice(k, 1);

    this.updateCamera(dt, i.travelSpeed);
    this.bloom.strength = 0.95 + kick * 0.25 + drop * 0.4;
    this.composer.render(dt);
  }

  dispose(): void {
    this.renderer.dispose();
  }

  // ---------- show ----------

  private drop(auto = false): void {
    this.dropAt = this.time;
    if (this.set.pyro) this.firePyro();
    if (!auto) this.fireConfetti();
  }

  private firePyro(only?: number[]): void {
    this.flames.forEach((f, k) => {
      if (!only || only.includes(k)) f.fired = this.time + (only ? 0 : Math.abs(k - 3.5) * 0.06);
    });
  }

  private fireConfetti(): void {
    this.confAt = this.time;
    const n = this.confPos.length / 3;
    const cols = [this.palA, this.palB, this.white];
    for (let k = 0; k < n; k++) {
      const left = k % 2 === 0;
      this.confPos.set([left ? -30 : 30, 3.2, -88], k * 3);
      const sp = rnd(16, 30);
      const yaw = (left ? 0.35 : -0.35) + rnd(-0.45, 0.45);
      const pitch = rnd(0.55, 1.15);
      this.confVel.set([Math.sin(yaw) * Math.cos(pitch) * sp, Math.sin(pitch) * sp, Math.cos(yaw) * Math.cos(pitch) * sp], k * 3);
      const c = cols[k % 3]!;
      const b = rnd(0.5, 1);
      this.confCol.setXYZ(k, c.r * b, c.g * b, c.b * b);
    }
    this.confCol.needsUpdate = true;
    this.confetti.visible = true;
  }

  /** Where a moving head points: theta from straight down, phi around (0 = +x, π/2 = towards the back). */
  private aim(h: Head, m: Motion, t: number, beat: number, strobing: boolean): THREE.Vector3 {
    let th: number;
    let ph: number;
    if (h.stage) {
      const sp = m === 'fan' ? 0.9 : 0.6;
      th = (h.back ? 1.05 : 0.98) + 0.22 * Math.sin(t * (m === 'ballyhoo' ? 1.6 : 0.6) + h.u * 2 + (h.back ? 1.5 : 0));
      ph = PI / 2 + h.u * sp + Math.sin(t * 0.45 + (h.back ? 2 : 0)) * 0.35;
    } else if (strobing) {
      th = 0.06;
      ph = h.i;
    } else if (m === 'sweep') {
      th = 0.55 + 0.25 * Math.sin(t * 0.6 + h.row * 0.8);
      ph = PI / 2 + Math.sin(t * 0.42 + h.u * 1.6 + h.row * 0.3) * 1.25;
    } else if (m === 'fan') {
      const open = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin((beat * PI) / 8));
      th = 0.12 + Math.abs(h.u) * open;
      ph = (h.u < 0 ? PI : 0) + Math.sin(t * 0.3 + h.row) * 0.25;
    } else {
      th = 0.45 + 0.38 * Math.sin(t * 1.25 + h.i * 1.7);
      ph = t * 1.05 + h.i * 0.9;
    }
    return this.D.set(Math.sin(th) * Math.cos(ph), -Math.cos(th), Math.sin(th) * Math.sin(ph)).normalize();
  }

  private updateHeads(m: Motion, t: number, beat: number, kick: number, phrase: number, drop: number, strobing: boolean, playing: boolean): void {
    const on = this.set.beams;
    this.beams.visible = on;
    this.glows.visible = on;
    const bc = this.beamCol.array as Float32Array;
    const gc = this.glowCol.array as Float32Array;
    const build = playing && phrase >= 12 && phrase < 15;
    const stageHeads = this.heads.filter((h) => h.stage && !h.back);
    for (const h of this.heads) {
      const d = this.aim(h, m, t, beat, strobing);
      let I: number;
      if (strobing) I = ((beat * 4) % 1) < 0.14 ? 1.8 : 0.15;
      else if (m === 'fan') I = (h.i + Math.floor(beat * 2)) % 4 === 0 ? 1.2 : 0.35 + 0.3 * kick;
      else if (m === 'ballyhoo') I = 0.7 + 0.4 * kick;
      else I = 0.55 + 0.5 * kick;
      if (h.stage) I *= 1.15;
      if (build) I *= 0.6 + 0.4 * Math.abs(Math.sin(beat * PI * (phrase - 10)));
      if (!playing) I *= 0.6;
      I += drop * 1.2;
      const c = strobing ? this.tc.copy(this.white) : this.tc.copy((h.i + (h.stage ? 1 : 0)) % 2 ? this.palB : this.palA);
      // Notes take over a front-stage light for their duration.
      for (const n of this.notes) {
        const target = stageHeads[Math.min(stageHeads.length - 1, Math.round(n.pitch * (stageHeads.length - 1)))];
        if (target === h) {
          const f = 1 - (t - n.born) / n.life;
          c.lerp(n.color, Math.min(1, f * 1.5));
          I += n.vel * f * 1.4;
          d.lerp(this.S.set(h.u * 0.3, -0.45, 1).normalize(), f * 0.6).normalize();
        }
      }
      const L = d.y < -0.02 ? Math.min((h.p.y - 1.4) / -d.y, 130) : 130;
      this.Q.setFromUnitVectors(ZAX, d);
      this.M4.compose(h.p, this.Q, this.S.set(L, L, L));
      this.beams.setMatrixAt(h.i, this.M4);
      bc.set([c.r, c.g, c.b, I], h.i * 4);
      gc.set([c.r * I * 1.4, c.g * I * 1.4, c.b * I * 1.4], h.i * 3);
      h.hit.copy(h.p).addScaledVector(d, L);
      h.L = L;
      h.I = on ? I : 0;
      h.c.copy(c);
    }
    this.beams.instanceMatrix.needsUpdate = true;
    this.beamCol.needsUpdate = true;
    this.glowCol.needsUpdate = true;
    const scale = this.heads.length / NP;
    this.poolHeads.forEach((idx, k) => {
      const h = this.heads[idx]!;
      this.U.uPools.value[k]!.set(h.hit.x, h.hit.y, h.hit.z, 1.2 + h.L * 0.085);
      const g = h.hit.y < 3 ? h.I * scale * 0.55 : 0;
      this.U.uPoolCol.value[k]!.set(h.c.r * g, h.c.g * g, h.c.b * g);
    });
  }

  private updateLasers(t: number, phase: number, kick: number, hat: number): void {
    const on = this.set.lasers;
    this.lasers.forEach((l, k) => {
      l.visible = on;
      if (!on) return;
      const u = (k - 6.5) / 6.5;
      l.rotation.set(-0.03 - 0.05 * Math.sin(t * 0.9 + k * 0.3) - (phase < 0.1 ? 0.02 : 0), u * 0.75 + Math.sin(t * 0.7) * 0.35 * (1 - Math.abs(u)), 0);
    });
    this.laserMat.color.copy(this.palA).lerp(this.laserGreen, 0.6).multiplyScalar(0.9 + kick * 0.8 + hat * 0.4);
  }

  private updateFlames(t: number): void {
    let heat = 0;
    for (const f of this.flames) {
      const age = t - f.fired;
      const live = age >= 0 && age < 1.1;
      f.mesh.visible = live;
      if (!live) continue;
      const h = Math.min(1, age / 0.12) * (1 - Math.max(0, (age - 0.5) / 0.6));
      f.mat.uniforms.uAge!.value = age;
      f.mesh.scale.set(1, 1 + h * 9, 1);
      heat += h;
    }
    this.flameLight.intensity = heat * 3 * PI;
  }

  private updateConfetti(dt: number): void {
    if (!this.confetti.visible) return;
    const age = this.time - this.confAt;
    if (age > 14) {
      this.confetti.visible = false;
      return;
    }
    const p = this.confPos;
    const v = this.confVel;
    const drag = Math.exp(-dt * 1.6);
    for (let k = 0; k < p.length; k += 3) {
      v[k] = v[k]! * drag + Math.sin(this.time * 2 + k) * dt * 0.6;
      v[k + 1] = Math.max(v[k + 1]! * drag - 9.8 * dt, -1.6 - (k % 7) * 0.12);
      v[k + 2] = v[k + 2]! * drag;
      p[k] = p[k]! + v[k]! * dt;
      p[k + 1] = Math.max(0.05, p[k + 1]! + v[k + 1]! * dt);
      p[k + 2] = p[k + 2]! + v[k + 2]! * dt;
    }
    (this.confetti.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.confetti.material as THREE.PointsMaterial).opacity = Math.min(1, (14 - age) / 3);
  }

  private apply(): void {
    for (const m of this.smoke) m.visible = this.set.smoke;
    this.U.uFogD.value = this.set.smoke ? 0.0065 : 0.0045;
    (this.scene.fog as THREE.FogExp2).density = this.U.uFogD.value;
    const g = this.set.screens ? 1 : 0;
    this.wall.mat.uniforms.gain!.value = 1.9 * g;
    for (const m of this.side.mats) m.uniforms.gain!.value = 1.6 * g;
  }

  private updateCamera(dt: number, travelSpeed: number): void {
    const cam = this.camera;
    const t = this.time;
    const pos = V3();
    switch (this.set.camera) {
      case 'fly': {
        this.camU = (this.camU + (dt * Math.max(0.05, travelSpeed / 0.4)) / 90) % 1;
        pos.copy(this.flyPos.getPointAt(this.camU));
        this.look.copy(this.flyLook.getPointAt(this.camU));
        break;
      }
      case 'arena': {
        const a = t * 0.04;
        pos.set(Math.sin(a) * 34, 36, 104 + Math.cos(a) * 4);
        this.look.set(Math.sin(a) * 8, 4, -40);
        break;
      }
      case 'stage': {
        const a = Math.sin(t * 0.12);
        pos.set(a * 14, 8.5, -93.5);
        this.look.set(a * -18, 1, 10);
        break;
      }
      case 'dj': {
        const a = Math.sin(t * 0.1);
        pos.set(0.9 + a * 0.6, 4.7, -99.6);
        this.look.set(a * 10, 2.5, -30);
        break;
      }
    }
    pos.x += Math.sin(t * 1.7) * 0.06;
    pos.y += Math.sin(t * 2.3) * 0.05;
    const k = this.camFirst ? 1 : 1 - Math.exp(-dt * 2.5);
    this.camSm.lerp(pos, k);
    this.lookSm.lerp(this.look, k);
    this.camFirst = false;
    cam.position.copy(this.camSm);
    cam.lookAt(this.lookSm);
  }

  // ---------- LED content ----------

  private drawWall(t: number, beat: number, bar: number, kick: number, m: Motion, strobing: boolean, drop: number): void {
    const { ctx, cv } = this.wall;
    const W = cv.width;
    const H = cv.height;
    const a = css(this.palA);
    const b = css(this.palB);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    if (strobing) {
      for (let k = 0; k < 6; k++) {
        ctx.fillStyle = k % 2 ? a : b;
        ctx.globalAlpha = 0.35;
        ctx.fillRect((k * W) / 6 + 2, 0, W / 6 - 4, H);
      }
      ctx.globalAlpha = 1;
      if ((beat * 4) % 1 < 0.14) {
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, W, H);
      }
    } else if (m === 'fan') {
      for (let k = 0; k < 32; k++) {
        const v = Math.abs(Math.sin(k * 0.61 + t * 2.4)) * (0.45 + 0.55 * kick) * (0.6 + 0.4 * Math.sin(k * 0.2 + beat));
        const h = v * H;
        ctx.fillStyle = k % 2 ? a : b;
        ctx.fillRect(k * 6 + 1, (H - h) / 2, 4, h);
      }
    } else if (m === 'ballyhoo') {
      ctx.lineWidth = 3;
      for (let k = -8; k < 16; k++) {
        const x = ((k * 14 + t * 40) % (W + 60)) - 30;
        ctx.strokeStyle = k % 2 ? a : b;
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x - 30, H);
        ctx.stroke();
      }
    } else {
      for (let k = 0; k < 7; k++) {
        const r = ((beat * 0.5 + k / 7) % 1) * W * 0.62;
        ctx.strokeStyle = k % 2 ? a : b;
        ctx.lineWidth = 2 + kick * 4;
        ctx.globalAlpha = Math.max(0, 1 - r / (W * 0.62));
        ctx.beginPath();
        ctx.arc(W / 2, H / 2, r, 0, PI * 2);
        ctx.stroke();
      }
    }
    // Notes: a column of light at their pitch, in the track's colour.
    for (const n of this.notes) {
      const f = Math.max(0, 1 - (t - n.born) / n.life);
      ctx.globalAlpha = f * (0.5 + n.vel * 0.5);
      ctx.fillStyle = css(n.color);
      const x = 8 + n.pitch * (W - 16);
      ctx.fillRect(x - 3, H * (1 - f) * 0.5, 6, H * f);
    }
    if (bar % 4 === 0 || drop > 0) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#fff';
      ctx.font = '600 34px "Barlow Condensed", "Arial Narrow", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('DRIFT', W / 2, H / 2 + 1);
    }
    ctx.globalAlpha = 1;
    this.wall.tex.needsUpdate = true;
  }

  /** Side screens show a stylised stage camera: the DJ and the front rows. */
  private drawSide(beat: number, kick: number, energy: number): void {
    const { ctx, cv } = this.side;
    const W = cv.width;
    const H = cv.height;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, css(this.palA));
    g.addColorStop(1, '#000');
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 0.35 + 0.5 * kick;
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H * 0.8);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#000';
    const nod = Math.abs(Math.sin(PI * beat)) * 3;
    ctx.beginPath();
    ctx.arc(W / 2, H * 0.38 + nod, 6, 0, PI * 2);
    ctx.fill();
    ctx.fillRect(W / 2 - 9, H * 0.46 + nod, 18, 20);
    ctx.fillRect(W / 2 - 30, H * 0.62, 60, 12);
    ctx.fillStyle = css(this.palB);
    ctx.fillRect(W / 2 - 30, H * 0.62, 60, 1.5);
    ctx.fillStyle = '#000';
    for (let k = 0; k < 26; k++) {
      const x = k * 4.6 + ((k * 37) % 5);
      const y = H - 6 - Math.abs(Math.sin(PI * beat + k * 0.7)) * 4 * energy;
      ctx.beginPath();
      ctx.arc(x, y, 3.4, 0, PI * 2);
      ctx.fill();
      ctx.fillRect(x - 4, y + 2, 8, 10);
      if (k % 4 === 1) {
        ctx.fillRect(x - 4, y - 14 + Math.sin(beat * 3 + k) * 2, 1.5, 12);
        ctx.fillRect(x + 3, y - 14, 1.5, 12);
      }
    }
    this.side.tex.needsUpdate = true;
  }

  // ---------- building ----------

  private common(): string {
    return /* glsl */ `
uniform float uTime, uBeat, uKick, uStrobe, uEnergy, uFogD;
uniform vec4 uPools[${NP}];
uniform vec3 uPoolCol[${NP}];
uniform vec3 uWash, uFogCol;
vec3 poolLight(vec3 wp) {
  vec3 a = vec3(0.0);
  for (int i = 0; i < ${NP}; i++) { vec4 p = uPools[i]; vec2 d = wp.xz - p.xz; a += uPoolCol[i] * exp(-dot(d, d) / (p.w * p.w)); }
  return a;
}
vec3 applyFog(vec3 c, vec3 wp) { float d = length(wp - cameraPosition); return mix(c, uFogCol, 1.0 - exp(-uFogD * uFogD * d * d)); }
float h3(vec3 p) { p = fract(p * 0.3183 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float n3(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1, 0, 0)), f.x), mix(h3(i + vec3(0, 1, 0)), h3(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(h3(i + vec3(0, 0, 1)), h3(i + vec3(1, 0, 1)), f.x), mix(h3(i + vec3(0, 1, 1)), h3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
`;
  }

  private shared<T extends Record<string, THREE.IUniform>>(extra?: T): Record<string, THREE.IUniform> {
    return Object.assign({}, this.U, extra ?? {});
  }

  private box(w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    this.scene.add(m);
    return m;
  }

  private mats = {
    dark: new THREE.MeshStandardMaterial({ color: raw(0x17161c), roughness: 0.92, metalness: 0 }),
    black: new THREE.MeshStandardMaterial({ color: raw(0x08080a), roughness: 0.7 }),
    metal: new THREE.MeshStandardMaterial({ color: raw(0x8f8f9a), roughness: 0.38, metalness: 0.25 }),
  };

  private buildHall(): void {
    const { dark, black, metal } = this.mats;
    const floorMat = new THREE.ShaderMaterial({
      uniforms: this.shared(),
      vertexShader: `varying vec3 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: this.common() + `varying vec3 vW; void main() {
        float g = n3(vW * vec3(0.7, 0.0, 0.7)) * 0.4 + 0.6;
        vec3 c = vec3(0.012, 0.012, 0.016) * g + poolLight(vW) * 0.32 * g;
        float st = clamp(1.0 - (vW.z + 100.0) / 60.0, 0.0, 1.0); c += uWash * st * st * 0.25;
        gl_FragColor = vec4(applyFog(c, vW), 1.0); }`,
    });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(HX * 2, HZ * 2), floorMat);
    floor.rotation.x = -PI / 2;
    this.scene.add(floor);
    this.box(HX * 2, HY, 1, 0, HY / 2, -HZ, dark);
    this.box(HX * 2, HY, 1, 0, HY / 2, HZ, dark);
    this.box(1, HY, HZ * 2, -HX, HY / 2, 0, dark);
    this.box(1, HY, HZ * 2, HX, HY / 2, 0, dark);
    this.box(HX * 2, 1, HZ * 2, 0, HY, 0, black);
    for (let z = -HZ + 8; z < HZ; z += 14) {
      this.box(HX * 2, 2.6, 1.2, 0, HY - 1.8, z, dark);
      this.box(2, HY, 2, -HX + 1, HY / 2, z, dark);
      this.box(2, HY, 2, HX - 1, HY / 2, z, dark);
    }
    const exit = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.1, 1.4, 0.45) });
    for (const z of [-70, -20, 30, 80]) {
      this.box(1.6, 0.6, 0.1, -HX + 0.6, 12.5, z, exit).rotation.y = PI / 2;
      this.box(1.6, 0.6, 0.1, HX - 0.6, 12.5, z, exit).rotation.y = PI / 2;
    }
    for (const x of [-50, 50]) this.box(1.6, 0.6, 0.1, x, 4, HZ - 0.6, exit);
    // Tribunes along both sides.
    for (const s of [-1, 1]) for (let k = 0; k < STEPS; k++) this.box(1.6, (k + 1) * 0.8, 176, s * (64 + 0.8 + k * 1.6), (k + 1) * 0.4, -6, dark);
    this.box(2, 1.1, 176, -63.4, 0.55, -6, metal);
    this.box(2, 1.1, 176, 63.4, 0.55, -6, metal);
  }

  private buildStage(): void {
    const { black, dark, metal } = this.mats;
    this.box(92, 2.5, 22, 0, 1.25, -99, black);
    this.box(92, 0.25, 0.1, 0, 2.35, -87.95, this.stageEdge);
    this.box(82, 1.1, 0.5, 0, 0.55, -84.5, metal);
    this.box(5, 1.15, 1.5, 0, 3.08, -95.4, black);
    this.box(5, 0.12, 0.05, 0, 3.5, -94.62, this.boothStrip);
    this.box(0.5, 0.02, 0.35, 0.9, 3.7, -95.8, new THREE.MeshBasicMaterial({ color: new THREE.Color(0.7, 0.8, 1.6) })).rotation.x = -0.5;
    for (const s of [-1, 1]) {
      for (let k = 0; k < 12; k++) this.box(1.6, 1.0, 1.4, s * 51, 27 - k * 1.04, -88, black).rotation.x = -k * 0.022;
      for (let k = 0; k < 10; k++) this.box(1.4, 0.95, 1.3, s * 62, 25 - k * 1.0, -80, black);
      this.box(6, 2.4, 1.6, s * 30, 1.2, -87.2, black);
    }
    // Front-of-house tower in the crowd.
    this.box(10, 2.6, 7, 0, 1.3, 36, black);
    this.box(11, 0.3, 8, 0, 5.2, 36, dark);
    for (const x of [-4, 4]) for (const z of [33, 39]) this.box(0.15, 2.6, 0.15, x, 3.9, z, metal);
    const foh = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 0.35, 0.6) });
    this.box(3, 0.4, 0.05, -2, 3.0, 32.48, foh);
    this.box(3, 0.4, 0.05, 2, 3.0, 32.48, foh);
  }

  private ledMaterial(tex: THREE.Texture, cw: number, ch: number, gain: number): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      uniforms: this.shared({ map: { value: tex }, res: { value: new THREE.Vector2(cw, ch) }, gain: { value: gain } }),
      vertexShader: `varying vec2 vUv; varying vec3 vW; void main() { vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: this.common() + `uniform sampler2D map; uniform vec2 res; uniform float gain; varying vec2 vUv; varying vec3 vW;
        void main() {
          vec2 g = vUv * res; vec2 f = fract(g);
          float m = smoothstep(0.0, 0.18, f.x) * smoothstep(1.0, 0.82, f.x) * smoothstep(0.0, 0.18, f.y) * smoothstep(1.0, 0.82, f.y);
          m = mix(m, 0.75, clamp(fwidth(g.x) * 1.6, 0.0, 1.0));
          vec3 c = texture2D(map, (floor(g) + 0.5) / res).rgb * gain * (0.3 + 0.7 * m) + vec3(0.006);
          gl_FragColor = vec4(applyFog(c, vW), 1.0); }`,
    });
  }

  private canvasTex(cw: number, ch: number) {
    const cv = document.createElement('canvas');
    cv.width = cw;
    cv.height = ch;
    const tex = new THREE.CanvasTexture(cv);
    tex.minFilter = THREE.NearestFilter;
    tex.magFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    return { cv, ctx: cv.getContext('2d')!, tex };
  }

  private buildScreens(): void {
    const w = this.canvasTex(192, 56);
    const wallMat = this.ledMaterial(w.tex, 192, 56, 1.9);
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(92, 27), wallMat);
    wall.position.set(0, 17, -109.8);
    this.scene.add(wall);
    this.wall = { ...w, mat: wallMat };
    const s = this.canvasTex(112, 63);
    const mats: THREE.ShaderMaterial[] = [];
    for (const sx of [-1, 1]) {
      for (const z of [-46, 14]) {
        const mat = this.ledMaterial(s.tex, 112, 63, 1.6);
        const m = new THREE.Mesh(new THREE.PlaneGeometry(32, 18), mat);
        m.position.set(sx * (HX - 0.7), 24, z);
        m.rotation.y = (-sx * PI) / 2;
        this.scene.add(m);
        mats.push(mat);
      }
    }
    this.side = { ...s, mats };
  }

  private buildTrusses(): void {
    const mats: THREE.Matrix4[] = [];
    const member = (p: THREE.Vector3, q: THREE.Vector3, t: number) => {
      const d = q.clone().sub(p);
      const len = d.length();
      d.normalize();
      mats.push(new THREE.Matrix4().compose(p.clone().add(q).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(ZAX, d), V3(t, t, len)));
    };
    const truss = (a: THREE.Vector3, b: THREE.Vector3, w = 0.6) => {
      const dir = b.clone().sub(a);
      const len = dir.length();
      dir.normalize();
      const up = Math.abs(dir.y) > 0.9 ? V3(1, 0, 0) : V3(0, 1, 0);
      const s1 = V3().crossVectors(dir, up).normalize();
      const s2 = V3().crossVectors(s1, dir).normalize();
      const h = w / 2;
      const c = ([[h, h], [h, -h], [-h, -h], [-h, h]] as const).map(([i, j]) => s1.clone().multiplyScalar(i).add(s2.clone().multiplyScalar(j)));
      for (const o of c) member(a.clone().add(o), b.clone().add(o), 0.07);
      const n = Math.max(1, Math.round(len / (w * 1.3)));
      for (let k = 0; k < n; k++) {
        const p0 = a.clone().lerp(b, k / n);
        const p1 = a.clone().lerp(b, (k + 1) / n);
        for (let f = 0; f < 4; f++) {
          const o1 = c[f]!;
          const o2 = c[(f + 1) % 4]!;
          member(p0.clone().add(k % 2 ? o1 : o2), p1.clone().add(k % 2 ? o2 : o1), 0.04);
        }
      }
    };
    for (const z of CROSS_Z) {
      truss(V3(-60, TY, z), V3(60, TY, z));
      for (const x of [-48, -16, 16, 48]) member(V3(x, TY + 0.3, z), V3(x, HY - 3, z), 0.05);
    }
    for (const x of [-40, 40]) truss(V3(x, TY + 0.62, -84), V3(x, TY + 0.62, 62));
    truss(V3(-47, 32, -89), V3(47, 32, -89));
    truss(V3(-47, 32, -106), V3(47, 32, -106));
    for (const x of [-47, 47]) {
      truss(V3(x, 32, -106), V3(x, 32, -89));
      truss(V3(x, 2.5, -89), V3(x, 31.7, -89));
      truss(V3(x, 2.5, -106), V3(x, 31.7, -106));
    }
    truss(V3(-45, 29.5, -97.5), V3(45, 29.5, -97.5));
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), this.mats.metal, mats.length);
    mats.forEach((m, k) => mesh.setMatrixAt(k, m));
    this.scene.add(mesh);
  }

  /** One low-poly person; aPart tags legs, torso, head and the two arms so the shader can animate them. */
  private personGeometry(): THREE.BufferGeometry {
    const tag = (g: THREE.BufferGeometry, part: number) => {
      g.setAttribute('aPart', new THREE.BufferAttribute(new Float32Array(g.attributes.position!.count).fill(part), 1));
      return g;
    };
    const bx = (w: number, h: number, d: number, x: number, y: number, z: number, p: number) => tag(new THREE.BoxGeometry(w, h, d).translate(x, y, z), p);
    const parts = [
      bx(0.34, 0.86, 0.22, 0, 0.43, 0, 0),
      bx(0.44, 0.62, 0.26, 0, 1.17, 0, 1),
      tag(new THREE.SphereGeometry(0.12, 8, 6).translate(0, 1.67, 0), 2),
      bx(0.1, 0.6, 0.1, -0.28, 1.17, 0, 3),
      bx(0.1, 0.6, 0.1, 0.28, 1.17, 0, 4),
    ];
    const P: number[] = [];
    const N: number[] = [];
    const A: number[] = [];
    const I: number[] = [];
    let o = 0;
    for (const g of parts) {
      P.push(...(g.attributes.position!.array as Float32Array));
      N.push(...(g.attributes.normal!.array as Float32Array));
      A.push(...(g.attributes.aPart!.array as Float32Array));
      for (const i of g.index!.array) I.push(i + o);
      o += g.attributes.position!.count;
    }
    const m = new THREE.BufferGeometry();
    m.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    m.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    m.setAttribute('aPart', new THREE.Float32BufferAttribute(A, 1));
    m.setIndex(I);
    return m;
  }

  private buildCrowd(): void {
    const mat = new THREE.ShaderMaterial({
      uniforms: this.shared(),
      vertexShader: this.common() + `
        attribute float aPart; attribute vec4 aData;
        varying vec3 vN; varying vec3 vW; varying vec3 vCloth;
        mat3 rz(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }
        void main() {
          vec3 p = position, n = normal;
          float bt = uBeat + aData.x * 0.18;
          float en = aData.w * uEnergy;
          float hop = pow(abs(sin(3.14159 * bt)), 3.0) * 0.12 * en;
          if (aPart > 2.5) {
            float side = aPart > 3.5 ? 1.0 : -1.0;
            vec3 sh = vec3(0.24 * side, 1.46, 0.0);
            float pump = sin(3.14159 * bt + aData.x * 6.0) * 0.28 * en;
            float down = 0.12 + 0.14 * sin(3.14159 * bt + aData.x * 9.0);
            float a = side * mix(down, 2.7 + pump, aData.y * clamp(uEnergy * 1.5, 0.0, 1.0));
            p = rz(a) * (p - sh) + sh; n = rz(a) * n;
          }
          if (aPart > 0.5) { float sw = sin(3.14159 * bt * 0.5 + aData.x * 6.2832) * 0.09 * en; vec3 hip = vec3(0.0, 0.86, 0.0); p = rz(sw) * (p - hip) + hip; n = rz(sw) * n; }
          p.y += hop;
          vec4 w = modelMatrix * instanceMatrix * vec4(p, 1.0);
          vW = w.xyz; vN = normalize(mat3(modelMatrix * instanceMatrix) * n);
          float hue = aData.z;
          vec3 cloth = mix(vec3(0.05, 0.05, 0.06), vec3(0.14, 0.13, 0.16), fract(hue * 7.0));
          if (hue > 0.86) cloth = vec3(0.55, 0.55, 0.58);
          else if (hue > 0.72) cloth = 0.5 * vec3(0.4 + 0.5 * sin(hue * 40.0), 0.3 + 0.3 * sin(hue * 23.0), 0.4 + 0.4 * cos(hue * 31.0));
          if (aPart > 1.5 && aPart < 2.5) cloth = mix(vec3(0.32, 0.2, 0.14), vec3(0.12, 0.08, 0.06), fract(hue * 13.0));
          if (aPart < 0.5) cloth = vec3(0.04, 0.045, 0.06);
          vCloth = cloth;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: this.common() + `
        varying vec3 vN; varying vec3 vW; varying vec3 vCloth;
        void main() {
          vec3 n = normalize(vN); vec3 V = normalize(cameraPosition - vW);
          vec3 pl = poolLight(vW);
          float top = 0.3 + 0.7 * max(n.y, 0.0);
          float near = clamp(1.0 - (vW.z + 86.0) / 170.0, 0.0, 1.0);
          vec3 c = vCloth * (0.09 + pl * top * 1.9);
          float st = max(dot(n, normalize(vec3(0.0, 0.3, -1.0))), 0.0);
          c += vCloth * uWash * st * (0.4 + 2.2 * near * near);
          float rim = pow(1.0 - max(dot(n, V), 0.0), 3.0);
          c += (uWash * near * 0.35 + pl * 0.35) * rim;
          c += vCloth * uStrobe * 3.0 * top;
          gl_FragColor = vec4(applyFog(c, vW), 1.0);
        }`,
    });
    const base = this.personGeometry();
    const make = (list: Person[]) => {
      const geo = base.clone();
      const data = new Float32Array(list.length * 4);
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      const q = new THREE.Quaternion();
      const e = new THREE.Euler();
      list.forEach((p, k) => {
        q.setFromEuler(e.set(0, p.yaw, 0));
        mesh.setMatrixAt(k, new THREE.Matrix4().compose(V3(p.x, p.y, p.z), q, V3(p.s, p.s * rnd(0.94, 1.06), p.s)));
        data.set([Math.random(), p.up, Math.random(), p.en], k * 4);
      });
      geo.setAttribute('aData', new THREE.InstancedBufferAttribute(data, 4));
      mesh.frustumCulled = false;
      this.scene.add(mesh);
    };
    const floor: Person[] = [];
    const sp = this.small ? 1.15 : 0.92;
    for (let z = -83.5; z < 74; z += sp) {
      for (let x = -60; x < 60; x += sp) {
        const px = x + rnd(-0.35, 0.35) * sp;
        const pz = z + rnd(-0.35, 0.35) * sp;
        if (Math.abs(px) < 7 && pz > 31 && pz < 41) continue;
        const near = 1 - (pz + 84) / 158;
        if (Math.random() > 0.5 + 0.5 * near) continue;
        if (Math.abs(px) > 54 && Math.random() < 0.5) continue;
        floor.push({ x: px, y: 0, z: pz, yaw: PI + rnd(-0.5, 0.5), s: rnd(0.9, 1.08), up: Math.random() < 0.12 + 0.38 * near * near ? 1 : 0, en: rnd(0.6, 1.25) });
      }
    }
    make(floor);
    const trib: Person[] = [];
    for (const s of [-1, 1]) {
      for (let k = 0; k < STEPS; k++) {
        for (let z = -88; z < 78; z += this.small ? 1.0 : 0.75) {
          if (Math.random() < 0.18) continue;
          const x = s * (64 + 0.8 + k * 1.6) + rnd(-0.2, 0.2);
          trib.push({ x, y: (k + 1) * 0.8, z: z + rnd(-0.2, 0.2), yaw: Math.atan2(-x * 0.6, -70 - z), s: rnd(0.9, 1.05), up: Math.random() < 0.07 ? 1 : 0, en: rnd(0.25, 0.6) });
        }
      }
    }
    make(trib);
    make([{ x: 0, y: 2.5, z: -96.6, yaw: 0, s: 1.03, up: 0, en: 0.55 }]); // the DJ
  }

  private buildHeads(): void {
    const add = (p: THREE.Vector3, u: number, row: number, stage: boolean, back: boolean) =>
      this.heads.push({ p, u, row, stage, back, i: this.heads.length, hit: V3(), L: 1, I: 0, c: new THREE.Color() });
    CROSS_Z.forEach((z, r) => {
      for (let x = -55; x <= 55; x += 10) add(V3(x, TY - 0.9, z), x / 55, r, false, false);
    });
    for (let x = -42; x <= 42; x += 7) add(V3(x, 31.1, -89), x / 42, -1, true, false);
    for (let x = -40; x <= 40; x += 10) add(V3(x, 28.6, -97.5), x / 40, -2, true, true);
    const NH = this.heads.length;
    this.poolHeads = Array.from({ length: NP }, (_, k) => Math.floor(((k + 0.5) * NH) / NP));

    const cone = new THREE.CylinderGeometry(0.075, 0.004, 1, 22, 1, true);
    cone.translate(0, 0.5, 0);
    cone.rotateX(PI / 2);
    this.beamCol = new THREE.InstancedBufferAttribute(new Float32Array(NH * 4), 4);
    cone.setAttribute('aCol', this.beamCol);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.shared(),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      vertexShader: `attribute vec4 aCol; varying vec4 vCol; varying float vZ; varying vec3 vW; varying vec3 vN;
        void main() { vCol = aCol; vZ = position.z; vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0); vW = w.xyz;
          vN = normalize(mat3(modelMatrix * instanceMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: this.common() + `varying vec4 vCol; varying float vZ; varying vec3 vW; varying vec3 vN;
        void main() {
          vec3 V = normalize(cameraPosition - vW); float e = pow(abs(dot(normalize(vN), V)), 2.2);
          float fade = pow(1.0 - vZ, 1.1) * smoothstep(0.0, 0.02, vZ);
          float hz = 0.45 + 0.55 * n3(vW * 0.16 + vec3(0.0, uTime * 0.3, uTime * 0.12));
          float d = length(vW - cameraPosition); float fogf = exp(-uFogD * uFogD * d * d * 0.5);
          float a = vCol.a * e * fade * hz * 0.34 * fogf;
          gl_FragColor = vec4(vCol.rgb * a, 1.0); }`,
    });
    this.beams = new THREE.InstancedMesh(cone, mat, NH);
    this.beams.frustumCulled = false;
    this.scene.add(this.beams);

    const fix = new THREE.InstancedMesh(new THREE.BoxGeometry(0.55, 0.7, 0.55), this.mats.black, NH);
    this.heads.forEach((h) => fix.setMatrixAt(h.i, new THREE.Matrix4().makeTranslation(h.p.x, h.p.y + 0.35, h.p.z)));
    this.scene.add(fix);

    const glowGeo = new THREE.BufferGeometry();
    const gp = new Float32Array(NH * 3);
    this.heads.forEach((h) => gp.set([h.p.x, h.p.y - 0.1, h.p.z], h.i * 3));
    glowGeo.setAttribute('position', new THREE.BufferAttribute(gp, 3));
    this.glowCol = new THREE.BufferAttribute(new Float32Array(NH * 3), 3);
    glowGeo.setAttribute('color', this.glowCol);
    this.glows = new THREE.Points(glowGeo, new THREE.PointsMaterial({ size: 2.4, map: glowTexture(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    this.scene.add(this.glows);
  }

  private buildEffects(): void {
    // Strobe bars on the stage truss and two crowd trusses.
    for (let x = -40; x <= 40; x += 10) this.box(1.6, 0.35, 0.3, x, 31.2, -88.6, this.strobeMat);
    for (const z of [-50, 2]) for (let x = -50; x <= 50; x += 20) this.box(1.6, 0.35, 0.3, x, TY - 0.55, z + 0.6, this.strobeMat);

    // Lasers fanning out from the stage.
    const lg = new THREE.BoxGeometry(0.08, 0.08, 1);
    lg.translate(0, 0, 0.5);
    this.laserMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 1.6, 0.5), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    for (let k = 0; k < 14; k++) {
      const m = new THREE.Mesh(lg, this.laserMat);
      m.position.set((k - 6.5) * 1.6, 4.0, -94);
      m.scale.set(1, 1, 190);
      this.scene.add(m);
      this.lasers.push(m);
    }

    // Smoke billboards, denser by the stage.
    const vs = `varying vec2 vUv; varying vec3 vW; void main() { vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
    const fs = this.common() + `uniform float uSeed, uOp; varying vec2 vUv; varying vec3 vW;
      void main() {
        vec2 c = vUv - 0.5; float m = smoothstep(0.5, 0.05, length(c));
        vec3 q = vec3(vUv * 2.6, uSeed) + vec3(uTime * 0.035, -uTime * 0.02, uTime * 0.03);
        float n = n3(q) * 0.55 + n3(q * 2.1) * 0.3 + n3(q * 4.3) * 0.15;
        float a = m * smoothstep(0.25, 0.85, n) * uOp;
        float near = clamp(1.0 - (vW.z + 100.0) / 90.0, 0.0, 1.0);
        vec3 lit = poolLight(vW) * 0.75 + uWash * (0.12 + 0.9 * near) + vec3(0.025, 0.025, 0.035) + vec3(uStrobe * 1.5);
        gl_FragColor = vec4(lit, a); }`;
    const SM = this.small ? 26 : 40;
    for (let k = 0; k < SM; k++) {
      const nearStage = k < SM * 0.3;
      const s = nearStage ? rnd(22, 36) : rnd(26, 46);
      const mat = new THREE.ShaderMaterial({ uniforms: this.shared({ uSeed: { value: rnd(0, 50) }, uOp: { value: nearStage ? 0.34 : 0.2 } }), vertexShader: vs, fragmentShader: fs, transparent: true, depthWrite: false });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(s, s * 0.55), mat);
      m.position.set(nearStage ? rnd(-40, 40) : rnd(-62, 62), nearStage ? rnd(3, 8) : rnd(4, 16), nearStage ? rnd(-92, -70) : rnd(-70, 90));
      m.userData.v = rnd(-0.25, 0.25);
      this.scene.add(m);
      this.smoke.push(m);
    }

    // Pyro: flame jets along the stage front.
    const fg = new THREE.CylinderGeometry(0.25, 0.7, 1, 14, 1, true);
    fg.translate(0, 0.5, 0);
    const ffs = `uniform float uTime, uAge; varying vec2 vUv; varying vec3 vP;
      float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5); }
      float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
      void main() {
        float y = vUv.y;
        float fl = n(vec2(vUv.x * 6.0, y * 5.0 - uTime * 9.0)) * 0.6 + n(vec2(vUv.x * 13.0, y * 11.0 - uTime * 15.0)) * 0.4;
        float a = smoothstep(1.0, 0.15, y + fl * 0.45) * (1.0 - smoothstep(0.7, 1.1, uAge));
        vec3 c = mix(vec3(2.6, 1.6, 0.6), vec3(1.6, 0.35, 0.05), smoothstep(0.1, 0.7, y + fl * 0.2));
        gl_FragColor = vec4(c * a, 1.0); }`;
    [-40, -28, -16, -6, 6, 16, 28, 40].forEach((x) => {
      const mat = new THREE.ShaderMaterial({
        uniforms: { uTime: this.U.uTime, uAge: { value: 9 } },
        vertexShader: `varying vec2 vUv; varying vec3 vP; void main() { vUv = uv; vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: ffs,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(fg, mat);
      mesh.position.set(x, 2.5, -88.6);
      mesh.visible = false;
      this.scene.add(mesh);
      this.box(0.8, 0.5, 0.8, x, 2.75, -88.6, this.mats.black);
      this.flames.push({ mesh, mat, fired: -1e9 });
    });
    this.flameLight = new THREE.PointLight(raw(0xff8a2a), 0, 120, 1);
    this.flameLight.position.set(0, 9, -84);
    this.scene.add(this.flameLight);

    // Confetti, fired from two cannons at the stage.
    const n = this.small ? 1500 : 3000;
    this.confPos = new Float32Array(n * 3);
    this.confVel = new Float32Array(n * 3);
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.BufferAttribute(this.confPos, 3));
    this.confCol = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
    cg.setAttribute('color', this.confCol);
    this.confetti = new THREE.Points(cg, new THREE.PointsMaterial({ size: 0.22, vertexColors: true, transparent: true, depthWrite: false }));
    this.confetti.frustumCulled = false;
    this.confetti.visible = false;
    this.scene.add(this.confetti);
  }

  private buildLights(): void {
    this.scene.add(new THREE.AmbientLight(raw(0x2a2838), 0.55 * PI));
    this.wash = new THREE.PointLight(0xffffff, 2, 220, 1);
    this.wash.position.set(0, 20, -80);
    this.back = new THREE.PointLight(0xffffff, 2, 60, 1);
    this.back.position.set(0, 16, -104);
    this.scene.add(this.wash, this.back);
    for (const s of [-1, 1]) {
      for (const z of [-46, 14]) {
        const l = new THREE.PointLight(0xffffff, 0.8, 60, 1);
        l.position.set(s * (HX - 8), 24, z);
        this.scene.add(l);
        this.sideL.push(l);
      }
    }
  }

  private buildCamera(): void {
    this.flyPos = new THREE.CatmullRomCurve3(
      [V3(0, 22, 96), V3(-44, 13, 58), V3(-34, 6.5, 4), V3(-14, 4.6, -52), V3(8, 9, -79), V3(36, 16, -56), V3(50, 10, 4), V3(24, 7.5, 52)],
      true, 'catmullrom', 0.5,
    );
    this.flyLook = new THREE.CatmullRomCurve3(
      [V3(0, 12, -100), V3(-4, 8, -92), V3(-6, 7, -100), V3(0, 7, -100), V3(-30, 4, -40), V3(0, 9, -100), V3(-10, 7, -90), V3(0, 10, -100)],
      true, 'catmullrom', 0.5,
    );
  }
}

function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.2, 'rgba(255,255,255,0.6)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function loadSettings(): ArenaSettings {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(STORE) ?? '{}') as Partial<ArenaSettings>) };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveSettings(s: ArenaSettings): void {
  try {
    localStorage.setItem(STORE, JSON.stringify(s));
  } catch {
    /* private mode */
  }
}
