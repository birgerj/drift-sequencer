// The robot floor of the Sorter hall: sort robots that carry parcels from
// pickup stations at the end of some chutes to rows of open cardboard bins,
// then wait on parking spots; flow projectors over the chute ends (the pickup
// roller tables and the roll cages) and over the manual sort table; and the
// details around them (bin code boards, parking marks, bollards, blue crates,
// cable reels).
//
// By day it is a clean production floor: projectors only throw their working
// beam at the parcel or cage they mark. By night the hall throws a secret party:
// the projectors become a laser show and parked robots dance on the beat.
import * as THREE from 'three';

import { Fleet, FLOOR, sorterFloor, type Bot, type FleetEvent } from './robotFleet';

/** What the floor needs from the Sorter scene to build itself. */
export interface FloorKit {
  put(obj: THREE.Object3D, only?: 'day' | 'night'): void;
  box(key: string, mat: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number, col?: number, ry?: number): void;
  std(color: number, rough?: number, metal?: number, day?: number): THREE.MeshStandardMaterial;
  inkify(m: THREE.Mesh, angle?: number): void;
  person(x: number, z: number, ry: number): void;
  sign(text: string, color: string, x: number, y: number, z: number, ry: number, icon: (g: CanvasRenderingContext2D) => void): void;
  dayOnly: THREE.Object3D[];
  nightOnly: THREE.Object3D[];
  only: 'day' | 'night' | undefined;
}

export interface FloorHandlers {
  /** Station s has a parcel ready. */
  waiting(s: number): boolean;
  event(e: FleetEvent): void;
}

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
export const cellX = (i: number) => FLOOR.x0 + i * FLOOR.cs;
export const cellZ = (j: number) => FLOOR.z0 + j * FLOOR.cs;
const UP = new THREE.Vector3(0, 1, 0);
const WHITE = new THREE.Color(1, 1, 1);
const PROJ_Y = 6.4;
const BEAMS = 4;
const TOP_Y = 1.42;

function tex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (g) draw(g);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function codeTex(code: string): THREE.CanvasTexture {
  return tex(96, 64, (g) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 96, 64);
    g.strokeStyle = '#1d1d1f';
    g.lineWidth = 4;
    g.strokeRect(2, 2, 92, 60);
    g.fillStyle = '#1d1d1f';
    g.font = '700 32px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(code, 48, 34);
  });
}

/** Robot side panel: a fleet number and a warning triangle, no names. */
function numberTex(n: number): THREE.CanvasTexture {
  return tex(128, 64, (g) => {
    g.fillStyle = '#1b1c20';
    g.fillRect(0, 0, 128, 64);
    g.fillStyle = '#ffffff';
    g.font = '600 18px system-ui, sans-serif';
    g.fillText(String(n).slice(0, 2), 10, 26);
    g.font = '700 40px system-ui, sans-serif';
    g.fillText(String(n).slice(2), 34, 54);
    g.fillStyle = '#f2c200';
    g.beginPath();
    g.moveTo(102, 12);
    g.lineTo(118, 40);
    g.lineTo(86, 40);
    g.closePath();
    g.fill();
    g.fillStyle = '#1b1c20';
    g.fillRect(101, 21, 2, 11);
    g.fillRect(101, 34, 2, 3);
  });
}

const glowTex = () =>
  tex(128, 128, (g) => {
    const r = g.createRadialGradient(64, 64, 8, 64, 64, 64);
    r.addColorStop(0, 'rgba(255,255,255,1)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, 128, 128);
  });

interface RobotView {
  g: THREE.Group;
  top: THREE.Group;
  glow: THREE.MeshBasicMaterial;
  num: number;
  yaw: number;
  yawFrom: number;
  yawTo: number;
  beat: number;
  /** Party spin, by night on a parking spot. */
  spin: number;
}

interface Projector {
  pos: THREE.Vector3;
  /** Where its working beam points when it marks something. */
  target: THREE.Vector3 | null;
  flash: number;
  col: THREE.Color;
}

export interface BinView {
  code: string;
  x: number;
  z: number;
  n: number;
}

export class RobotFloor {
  readonly fleet: Fleet;
  readonly bins: BinView[] = [];
  readonly stations: { x: number; z: number; projector: number }[] = [];
  private robots: RobotView[] = [];
  private projectors: Projector[] = [];
  private cageProjector = new Map<number, number>();
  private tableProjectors: number[] = [];
  private beams!: THREE.InstancedMesh;
  private beamMat!: THREE.MeshBasicMaterial;
  private spots!: THREE.InstancedMesh;
  private fills!: THREE.InstancedMesh;
  private gridMat!: THREE.MeshBasicMaterial;
  private parkMat!: THREE.MeshBasicMaterial;
  private dayShown: boolean | null = null;
  private boardMats: THREE.MeshBasicMaterial[] = [];
  private readonly o = new THREE.Object3D();
  private readonly p = new THREE.Vector3();
  private readonly q = new THREE.Vector3();
  private readonly c = new THREE.Color();

  constructor(
    private kit: FloorKit,
    stationXs: number[],
    /** Roll cages at chute ends that get a projector: chute index → cage centre. */
    cages: Map<number, THREE.Vector3>,
    private handlers: FloorHandlers,
  ) {
    const cols = stationXs.map((x) => Math.round((x - FLOOR.x0) / FLOOR.cs));
    const layout = sorterFloor(cols);
    this.fleet = new Fleet(layout.grid, layout.parks, layout.stations, layout.bins, 14);
    this.buildFloor(layout.parks);
    this.buildStations(cols);
    this.buildBins();
    this.buildRobots();
    this.buildProjectors(cages);
    this.buildTable();
    this.buildDetails();
  }

  /** x of the pickup cell of each station, for the chutes to end at. */
  static stationX(x: number): number {
    return cellX(Math.round((x - FLOOR.x0) / FLOOR.cs));
  }

  // ---------- per beat / per frame ----------

  beat(b: number): void {
    const drop = b % 4 === 1 || b % 4 === 3;
    for (const e of this.fleet.step(b, (s) => this.handlers.waiting(s), drop)) {
      if (e.t === 'load') this.flash(this.stations[e.station]!.projector, null);
      if (e.t === 'dropped') {
        const bin = this.bins[e.bin]!;
        bin.n = bin.n >= 9 ? 1 : bin.n + 1;
        this.writeFill(e.bin);
      }
      this.handlers.event(e);
    }
  }

  /** Top of robot k (where a parcel rides), and its heading. */
  robotTop(k: number, out: THREE.Vector3): number {
    const r = this.robots[k]!;
    out.set(r.g.position.x, TOP_Y + 0.08, r.g.position.z);
    return r.g.rotation.y;
  }

  /** Slot n of the parcel queue on station s. */
  tableSlot(s: number, n: number, out: THREE.Vector3): void {
    const st = this.stations[s]!;
    out.set(st.x, 1.06, st.z - 0.75 - n * 0.55);
  }

  binPos(b: number, out: THREE.Vector3): void {
    const bin = this.bins[b]!;
    out.set(bin.x, 0.3 + Math.min(bin.n, 8) * 0.07, bin.z);
  }

  robotNumber(k: number): number {
    return this.robots[k]!.num;
  }

  /** A parcel landed in a roll cage: its projector marks it. */
  flashCage(chute: number, col: THREE.Color): void {
    const k = this.cageProjector.get(chute);
    if (k !== undefined) this.flash(k, col);
  }

  private flash(k: number, col: THREE.Color | null): void {
    const pr = this.projectors[k]!;
    pr.flash = 1;
    if (col) pr.col.copy(col);
  }

  update(dt: number, bt: number, s: { kick: number; snare: number; hat: number; day: number; dayShown: boolean; cols: THREE.Color[]; pad: THREE.Color | null; bar: number }): void {
    if (s.dayShown !== this.dayShown) {
      this.dayShown = s.dayShown;
      this.beamMat.blending = s.dayShown ? THREE.NormalBlending : THREE.AdditiveBlending;
      this.beamMat.needsUpdate = true;
    }
    this.gridMat.color.setHex(0x3a3d44).lerp(this.c.setHex(0xc8ccd2), s.day);
    this.parkMat.color.setHex(0x8a6e00).lerp(this.c.setHex(0xf2c200), s.day);
    // Code boards are paper, not lights: dim by night.
    this.c.setRGB(0.22, 0.22, 0.25).lerp(WHITE, s.day);
    for (const m of this.boardMats) m.color.copy(this.c);
    this.updateRobots(dt, bt, s);
    this.updateProjectors(dt, bt, s);
  }

  private updateRobots(dt: number, bt: number, s: { kick: number; dayShown: boolean; cols: THREE.Color[] }): void {
    const ph = bt - Math.floor(bt);
    for (const b of this.fleet.bots) {
      const r = this.robots[b.k]!;
      const moving = b.i !== b.fi || b.j !== b.fj;
      const tx = cellX(b.i);
      const tz = cellZ(b.j);
      let x = tx;
      let z = tz;
      const beat = Math.floor(bt);
      if (beat !== r.beat) {
        r.beat = beat;
        r.yawFrom = r.yawTo;
      }
      if (moving) {
        const fx = cellX(b.fi);
        const fz = cellZ(b.fj);
        const want = Math.atan2(tx - fx, tz - fz);
        let d = want - r.yawFrom;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        // Turn on the spot first, then drive the cell, all within the beat.
        const turn = Math.abs(d) > 0.1 ? 0.35 : 0;
        const tf = turn ? Math.min(1, ph / turn) : 1;
        r.yaw = r.yawFrom + d * ease(tf);
        r.yawTo = r.yawFrom + d;
        const mf = ease(turn ? Math.max(0, (ph - turn) / (1 - turn)) : ph);
        x = fx + (tx - fx) * mf;
        z = fz + (tz - fz) * mf;
      } else r.yaw = r.yawTo;
      // Secret party: parked robots spin a quarter turn on every beat by night.
      const party = !s.dayShown && b.state === 'idle' && !b.path.length;
      r.spin = party ? (Math.floor(bt) + b.k) * (Math.PI / 2) + ease(ph) * (Math.PI / 2) : r.spin * Math.exp(-dt * 6);
      if (!party) r.spin %= Math.PI * 2;
      r.g.position.set(x, 0, z);
      r.g.rotation.y = r.yaw + (party ? r.spin : 0);
      r.top.position.y = TOP_Y + (party ? 0.06 * s.kick : 0);
      r.glow.color.copy(s.cols[b.k % s.cols.length]!).multiplyScalar(0.4 + s.kick * (party ? 1.2 : 0.7));
    }
  }

  private updateProjectors(dt: number, bt: number, s: { hat: number; kick: number; dayShown: boolean; cols: THREE.Color[]; pad: THREE.Color | null; bar: number }): void {
    const fig = Math.floor(s.bar) % 4;
    const o = this.o;
    this.projectors.forEach((pr, k) => {
      pr.flash = Math.max(0, pr.flash - dt * 1.4);
      const target = pr.target;
      const col = pr.col;
      const marking = !!target && pr.flash > 0.05;
      // Projected square.
      if (marking) {
        o.position.set(target!.x, target!.y + 0.02, target!.z);
        o.rotation.set(-Math.PI / 2, 0, 0);
        const sc = 0.7 + 0.4 * pr.flash;
        o.scale.set(sc, sc, 1);
      } else o.scale.set(0, 0, 0);
      o.updateMatrix();
      this.spots.setMatrixAt(k, o.matrix);
      this.spots.setColorAt(k, this.c.copy(col).multiplyScalar(s.dayShown ? 1 : 0.4 + pr.flash));
      // Beams: the working beam by day; a laser show by night.
      for (let n = 0; n < BEAMS; n++) {
        const idx = k * BEAMS + n;
        let end: THREE.Vector3 | null = null;
        if (n === 0 && marking && pr.flash > 0.3) end = this.p.copy(target!);
        else if (!s.dayShown && s.hat > 0.12) {
          const t = bt * Math.PI;
          let a: number;
          let r: number;
          if (fig === 0) {
            a = n * (Math.PI / 2) + t * 0.25;
            r = 2 + Math.sin(t) * 1.4;
          } else if (fig === 1) {
            a = (n - 1.5) * 0.35 + Math.sin(t * 0.5) * 1.2 + k;
            r = 4.5;
          } else if (fig === 2) {
            a = n * (Math.PI / 2);
            r = 1 + 3.5 * Math.abs(Math.sin(t * 0.5));
          } else {
            a = t + n * 0.2 + k;
            r = 3.2;
          }
          end = this.p.set(pr.pos.x + Math.cos(a) * r, 0.02, pr.pos.z + Math.sin(a) * r);
        }
        if (!end) {
          o.scale.set(0, 0, 0);
          o.updateMatrix();
          this.beams.setMatrixAt(idx, o.matrix);
          continue;
        }
        const len = pr.pos.distanceTo(end);
        o.position.lerpVectors(pr.pos, end, 0.5);
        this.q.subVectors(end, pr.pos).normalize();
        o.quaternion.setFromUnitVectors(UP, this.q);
        o.rotation.setFromQuaternion(o.quaternion);
        const w = s.dayShown ? 1.4 : 1;
        o.scale.set(w, len, w);
        o.updateMatrix();
        this.beams.setMatrixAt(idx, o.matrix);
        const lc = n === 0 && marking ? col : s.pad ?? s.cols[(Math.floor(s.bar) + k + n) % s.cols.length]!;
        this.beams.setColorAt(idx, this.c.copy(lc).multiplyScalar(s.dayShown ? 1 : 0.5 + s.hat * 0.8));
      }
    });
    this.beamMat.opacity = s.dayShown ? 0.85 : 0.9;
    this.beams.instanceMatrix.needsUpdate = true;
    if (this.beams.instanceColor) this.beams.instanceColor.needsUpdate = true;
    this.spots.instanceMatrix.needsUpdate = true;
    if (this.spots.instanceColor) this.spots.instanceColor.needsUpdate = true;
  }

  private writeFill(b: number): void {
    const bin = this.bins[b]!;
    const o = this.o;
    o.position.set(bin.x, 0.07 + bin.n * 0.035, bin.z);
    o.rotation.set(0, 0, 0);
    o.scale.set(1.08, 0.02 + bin.n * 0.07, 0.98);
    o.updateMatrix();
    this.fills.setMatrixAt(b, o.matrix);
    this.fills.instanceMatrix.needsUpdate = true;
  }

  // ---------- building ----------

  private buildFloor(parks: [number, number][]): void {
    const k = this.kit;
    const { ni, nj, cs } = FLOOR;
    const grid = tex(64, 64, (g) => {
      g.clearRect(0, 0, 64, 64);
      g.strokeStyle = '#ffffff';
      g.lineWidth = 2;
      g.strokeRect(0, 0, 64, 64);
    });
    grid.wrapS = grid.wrapT = THREE.RepeatWrapping;
    grid.repeat.set(ni, nj);
    this.gridMat = new THREE.MeshBasicMaterial({ map: grid, transparent: true, depthWrite: false });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(ni * cs, nj * cs), this.gridMat);
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(cellX(0) - cs / 2 + (ni * cs) / 2, 0.018, cellZ(0) - cs / 2 + (nj * cs) / 2);
    k.put(plane);
    // Parking spots: yellow outlines and a charging post.
    const mark = tex(64, 64, (g) => {
      g.clearRect(0, 0, 64, 64);
      g.strokeStyle = '#ffffff';
      g.lineWidth = 5;
      g.strokeRect(4, 4, 56, 56);
    });
    this.parkMat = new THREE.MeshBasicMaterial({ map: mark, transparent: true, depthWrite: false });
    const post = k.std(0x2a2c31, 0.6, 0.4, 0x50555e);
    const geo = new THREE.PlaneGeometry(1.35, 1.35);
    for (const [i, j] of parks) {
      const m = new THREE.Mesh(geo, this.parkMat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(cellX(i), 0.022, cellZ(j));
      k.put(m);
      k.box('charger', post, cellX(i) + (i === 0 ? -0.75 : 0.75), 0.45, cellZ(j), 0.14, 0.9, 0.3);
    }
  }

  private buildStations(cols: number[]): void {
    const k = this.kit;
    const alu = k.std(0x6b7078, 0.4, 0.7, 0xc3c8ce);
    const roller = k.std(0x9aa0a8, 0.35, 0.8, 0xe6e9ec);
    for (const i of cols) {
      const x = cellX(i);
      const z = cellZ(0) - 0.75;
      // A short roller table from the chute end to the pickup cell.
      k.box('stable', alu, x, 0.98, z - 0.7, 1.1, 0.08, 1.7);
      for (const sx of [-0.5, 0.5]) for (const sz of [-1.45, 0.05]) k.box('stable', alu, x + sx, 0.48, z + sz, 0.06, 0.96, 0.06);
      for (let n = 0; n < 8; n++) k.box('sroll', roller, x, 1.04, z - 1.45 + n * 0.21, 1.0, 0.06, 0.06);
      this.stations.push({ x, z: cellZ(0), projector: -1 });
    }
  }

  private buildBins(): void {
    const k = this.kit;
    const card = k.std(0x6f5a3f, 0.95, 0, 0xd9b07a);
    const inner = k.std(0x4c3e2c, 0.95, 0, 0xb8925f);
    const post = k.std(0x50545b, 0.6, 0.3, 0xdfe3e8);
    const letters = 'ABC';
    const rows = [...new Set(this.fleet.bins.map((b) => b.j))];
    const boardGeo = new THREE.PlaneGeometry(0.45, 0.3);
    this.fleet.bins.forEach((b, n) => {
      const x = cellX(b.i);
      const z = cellZ(b.j);
      k.box('bwall', card, x, 0.45, z + 0.58, 1.25, 0.9, 0.05);
      k.box('bwall', card, x, 0.45, z - 0.58, 1.25, 0.9, 0.05);
      k.box('bwall', card, x + 0.62, 0.45, z, 0.05, 0.9, 1.15);
      k.box('bwall', card, x - 0.62, 0.45, z, 0.05, 0.9, 1.15);
      k.box('bfloor', inner, x, 0.04, z, 1.2, 0.04, 1.1);
      const code = `${letters[rows.indexOf(b.j)] ?? 'D'}${10 + b.i}`;
      k.box('bpost', post, x + 0.55, 1.0, z + 0.6, 0.05, 2.0, 0.05);
      const bm = new THREE.MeshBasicMaterial({ map: codeTex(code) });
      this.boardMats.push(bm);
      for (const flip of [0, Math.PI]) {
        const board = new THREE.Mesh(boardGeo, bm);
        board.position.set(x + 0.55, 1.9, z + 0.6);
        board.rotation.y = flip;
        k.put(board);
      }
      this.bins.push({ code, x, z, n: 0 });
      void n;
    });
    this.fills = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), k.std(0x5b4a35, 0.95, 0, 0xc9a06c), this.bins.length);
    this.fills.frustumCulled = false;
    k.put(this.fills);
    this.bins.forEach((_, b) => this.writeFill(b));
  }

  private buildRobots(): void {
    const k = this.kit;
    const black = k.std(0x141519, 0.5, 0.3, 0x1b1c20);
    const blue = k.std(0x2450a8, 0.45, 0.3, 0x2c62c8);
    const rollerMat = k.std(0x2a2c31, 0.4, 0.6, 0x3a3d44);
    const glow = glowTex();
    const part = (g: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      g.add(m);
      k.inkify(m, 30);
      return m;
    };
    for (const b of this.fleet.bots) {
      const g = new THREE.Group();
      k.put(g, undefined);
      part(g, new THREE.BoxGeometry(0.85, 0.28, 0.95), blue, 0, 0.22, 0);
      part(g, new THREE.BoxGeometry(0.85, 0.12, 0.95), black, 0, 0.06, 0);
      const post = new THREE.BoxGeometry(0.07, 1.0, 0.07);
      for (const sx of [-0.4, 0.4]) for (const sz of [-0.43, 0.43]) part(g, post, black, sx, 0.85, sz);
      const side = new THREE.BoxGeometry(0.85, 0.55, 0.05);
      part(g, side, black, 0, 0.7, 0.45);
      part(g, side, black, 0, 0.7, -0.45);
      const top = new THREE.Group();
      top.position.y = TOP_Y;
      g.add(top);
      part(top, new THREE.BoxGeometry(0.9, 0.1, 1.0), black, 0, 0, 0);
      const roll = new THREE.CylinderGeometry(0.035, 0.035, 0.9, 8);
      for (let x = -0.35; x <= 0.36; x += 0.14) {
        const r = new THREE.Mesh(roll, rollerMat);
        r.position.set(x, 0.07, 0);
        r.rotation.x = Math.PI / 2;
        top.add(r);
      }
      const num = 1800 + ((b.k * 37 + 3) % 99);
      const plate = new THREE.MeshBasicMaterial({ map: numberTex(num) });
      for (const sz of [0.476, -0.476]) {
        const p = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.31), plate);
        p.position.set(0, 0.75, sz);
        if (sz < 0) p.rotation.y = Math.PI;
        g.add(p);
      }
      const gm = new THREE.MeshBasicMaterial({ map: glow, color: 0x3a7bff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
      const under = new THREE.Mesh(new THREE.PlaneGeometry(2, 2.1), gm);
      under.rotation.x = -Math.PI / 2;
      under.position.y = 0.03;
      g.add(under);
      k.nightOnly.push(under);
      const yaw = b.i === 0 ? Math.PI / 2 : -Math.PI / 2;
      this.robots.push({ g, top, glow: gm, num, yaw, yawFrom: yaw, yawTo: yaw, beat: -1, spin: 0 });
    }
  }

  private buildProjectors(cages: Map<number, THREE.Vector3>): void {
    const k = this.kit;
    const body = k.std(0x16171b, 0.5, 0.4, 0x26282e);
    const alu = k.std(0x5f646c, 0.4, 0.7, 0xc3c8ce);
    const grille = tex(128, 64, (g) => {
      g.fillStyle = '#1b1c20';
      g.fillRect(0, 0, 128, 64);
      g.strokeStyle = '#5a5e66';
      g.lineWidth = 3;
      g.strokeRect(14, 14, 36, 36);
      for (let r = 4; r < 18; r += 4) {
        g.beginPath();
        g.arc(32, 32, r, 0, 7);
        g.stroke();
      }
      g.fillStyle = '#2c62c8';
      g.fillRect(70, 22, 40, 20);
    });
    const face = new THREE.MeshBasicMaterial({ map: grille });
    const add = (x: number, z: number, target: THREE.Vector3 | null): number => {
      k.box('pbody', body, x, PROJ_Y + 0.3, z, 0.7, 0.7, 0.55);
      k.box('pbody', body, x, PROJ_Y - 0.25, z, 0.6, 0.45, 0.5);
      const f = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.35), face);
      f.position.set(x, PROJ_Y + 0.35, z + 0.28);
      k.put(f);
      this.projectors.push({ pos: v(x, PROJ_Y - 0.48, z), target, flash: 0, col: new THREE.Color(1, 1, 1) });
      return this.projectors.length - 1;
    };
    const frame = (x: number, z: number, w: number, d: number) => {
      for (const sx of [-w / 2, w / 2]) k.box('pframe', alu, x + sx, PROJ_Y + 0.9, z, 0.08, 0.08, d);
      for (const sz of [-d / 2, d / 2]) k.box('pframe', alu, x, PROJ_Y + 0.9, z + sz, w, 0.08, 0.08);
      for (const sx of [-w / 2, w / 2]) k.box('prod', alu, x + sx, (11 + PROJ_Y + 0.9) / 2, z, 0.05, 11 - PROJ_Y - 0.9, 0.05);
    };
    // Over the pickup stations.
    const xs = this.stations.map((s) => s.x);
    frame((Math.min(...xs) + Math.max(...xs)) / 2, cellZ(0) - 1.1, Math.max(...xs) - Math.min(...xs) + 1.6, 1.4);
    for (const st of this.stations) st.projector = add(st.x, cellZ(0) - 1.1, v(st.x, TOP_Y + 0.1, cellZ(0)));
    // Over the roll cages at the other chute ends.
    for (const [chute, at] of cages) {
      k.box('prod', alu, at.x, (11 + PROJ_Y + 0.6) / 2, at.z, 0.06, 11 - PROJ_Y - 0.6, 0.06);
      this.cageProjector.set(chute, add(at.x, at.z, v(at.x, 1.7, at.z)));
    }
    // Two over the manual sort table.
    frame(TABLE.x, TABLE.z, 5, 2.4);
    for (const dx of [-1.2, 1.2]) this.tableProjectors.push(add(TABLE.x + dx, TABLE.z - 0.3, v(TABLE.x + dx, 1.08, TABLE.z + 0.2)));
    const n = this.projectors.length;
    this.beamMat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.beams = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.014, 0.014, 1, 6, 1, true), this.beamMat, n * BEAMS);
    this.beams.setColorAt(0, new THREE.Color(1, 1, 1));
    this.beams.frustumCulled = false;
    k.put(this.beams);
    this.spots = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.85, depthWrite: false }), n);
    this.spots.setColorAt(0, new THREE.Color(1, 1, 1));
    this.spots.frustumCulled = false;
    k.put(this.spots);
  }

  /** The table projectors mark envelopes on the table on alternate beats. */
  tableBeat(b: number, cols: THREE.Color[]): void {
    const k = this.tableProjectors[b % this.tableProjectors.length];
    if (k !== undefined) this.flash(k, cols[b % cols.length]!);
  }

  private buildTable(): void {
    const k = this.kit;
    const yellow = k.std(0xa88400, 0.6, 0.2, 0xf2c200);
    const { x, z } = TABLE;
    k.box('table', yellow, x, 0.95, z, 4.4, 0.12, 2.0);
    for (const sx of [-2.1, 2.1]) for (const sz of [-0.9, 0.9]) k.box('table', yellow, x + sx, 0.47, z + sz, 0.1, 0.95, 0.1);
    const stripe = tex(256, 16, (g) => {
      g.fillStyle = '#f2c200';
      g.fillRect(0, 0, 256, 16);
      g.fillStyle = '#1b1c20';
      for (let i = -16; i < 256; i += 24) {
        g.beginPath();
        g.moveTo(i, 0);
        g.lineTo(i + 12, 0);
        g.lineTo(i + 28, 16);
        g.lineTo(i + 16, 16);
        g.fill();
      }
    });
    const sm = new THREE.MeshBasicMaterial({ map: stripe });
    for (const sz of [1.01, -1.01]) {
      const st = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 0.12), sm);
      st.position.set(x, 1.07, z + sz);
      if (sz < 0) st.rotation.y = Math.PI;
      k.put(st);
    }
    const env = k.std(0x9b7d10, 0.5, 0, 0xf5c518);
    for (let i = 0; i < 16; i++) k.box('flyer', env, x - 1.7 + Math.random() * 3.4, 1.03 + Math.random() * 0.05, z - 0.7 + Math.random() * 1.4, 0.4, 0.04, 0.3, undefined, Math.random() * 3);
    // People work here by day only: the night is for the robots.
    const was = k.only;
    k.only = 'day';
    k.person(x, z + 1.7, Math.PI);
    k.person(x - 1.6, z - 1.5, 0.3);
    k.only = was;
    // Blue crates and bollards around the table.
    const crate = k.std(0x1f3f80, 0.6, 0.1, 0x2c62c8);
    for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) k.box('crate', crate, x + 3.6 + a * 0.95, 0.2 + b * 0.42, z + 1.5, 0.9, 0.4, 0.6);
    for (let b = 0; b < 3; b++) k.box('crate', crate, x + 3.6, 0.2 + b * 0.42, z + 2.2, 0.9, 0.4, 0.6);
    const bollard = k.std(0x8a6e00, 0.5, 0.3, 0xf2c200);
    for (const [bx, bz] of [[-2.8, -1.6], [2.8, -1.6], [-2.8, 1.6], [2.8, 1.6]] as const) k.box('bollard', bollard, x + bx, 0.5, z + bz, 0.2, 1.0, 0.2);
    k.only = 'day';
    k.sign('Manual sorting', '#e8960c', x, 8.8, z - 1.4, 0, (g) => {
      g.beginPath();
      g.arc(0, -8, 9, 0, 7);
      g.fill();
      g.fillRect(-14, 4, 28, 16);
    });
    k.only = was;
  }

  private buildDetails(): void {
    const k = this.kit;
    // Bollards and rails at the corners of the robot floor.
    const bollard = k.std(0x8a6e00, 0.5, 0.3, 0xf2c200);
    const xa = cellX(0) - 1.6;
    const xb = cellX(FLOOR.ni - 1) + 1.6;
    const za = cellZ(0) - 0.9;
    const zb = cellZ(FLOOR.nj - 1) + 1.2;
    for (const [x, z] of [[xa, za], [xb, za], [xa, zb], [xb, zb]] as const) k.box('bollard', bollard, x, 0.5, z, 0.2, 1.0, 0.2);
    for (const z of [za + 2, zb - 2]) {
      for (const x of [xa, xb]) {
        k.box('rail2', bollard, x, 1.0, z, 0.06, 0.06, 2.6);
        k.box('rail2', bollard, x, 0.5, z, 0.06, 0.06, 2.6);
      }
    }
    // Cable reels hanging from the roof.
    const dark = k.std(0x1d1e22, 0.6, 0.3, 0x2a2c31);
    const plug = k.std(0x8a6e00, 0.5, 0.2, 0xf2c200);
    for (const [x, z] of [[cellX(4), 13], [cellX(16), 12.6], [cellX(27), 13.4], [TABLE.x + 3, TABLE.z - 2]] as const) {
      const reel = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.06, 8, 20), dark);
      reel.position.set(x, 8.4, z);
      k.put(reel);
      k.inkify(reel, 50);
      k.box('reelrod', dark, x, 9.7, z, 0.04, 2.6, 0.04);
      k.box('plug', plug, x, 7.9, z + 0.2, 0.16, 0.2, 0.12);
    }
    const was = k.only;
    k.only = 'day';
    k.sign('Robot sorting', '#2fa58f', cellX(15.5), 8.8, cellZ(4.5), 0, (g) => {
      g.strokeRect(-16, -18, 32, 22);
      g.beginPath();
      g.arc(-9, 14, 5, 0, 7);
      g.arc(9, 14, 5, 0, 7);
      g.fill();
    });
    k.sign('Parking', '#2c62c8', cellX(0) - 0.4, 8.8, cellZ(5.5), Math.PI / 2, (g) => {
      g.font = '700 46px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('P', 0, 3);
    });
    k.only = was;
  }
}

/** Where the manual sort table stands. */
export const TABLE = { x: -15, z: 22 };

const ease = (x: number) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);

export type { Bot };
