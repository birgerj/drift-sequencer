import { CHANNEL, type VisualTrack, type VisualsMessage } from './protocol';
import { SCENES, VERTEX } from './shaders';

type SceneId = (typeof SCENES)[number]['id'];

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  life: number;
  decay: number;
  color: string;
  kind: 'note' | 'spark' | 'ring';
}

type Role = 'bass' | 'lead' | 'pad';

/** A note that happens inside the Flyover or City world (see EVENTS in shaders.ts). */
interface WorldEvent {
  x: number;
  /** Pitch 0..1; scenes use it for height. */
  y: number;
  z: number;
  born: number;
  life: number;
  kind: 0 | 1 | 2;
  vel: number;
  side: number;
  color: [number, number, number];
}
const MAX_EV = 24;
const EV_CAP = [8, 4, 4];
/** Scenes that show notes as things in the world instead of particles. */
const WORLD_SCENES = new Set<string>(['flyover', 'city', 'coast']);

type TimeOfDay = 'dusk' | 'night' | 'cycle';
const TOD_ORDER: TimeOfDay[] = ['dusk', 'night', 'cycle'];
const TOD_LABEL: Record<TimeOfDay, string> = { dusk: 'Dusk', night: 'Night', cycle: 'Dusk ↔ Night' };
/** Coast's shoreline, matching coastX in the shader. */
const coastX = (z: number) => 2.5 * Math.sin(z * 0.045) + 1.2 * Math.sin(z * 0.13 + 1.0);

const colorCache = new Map<string, [number, number, number]>();
let colorCtx: CanvasRenderingContext2D | null | undefined;
/** Any CSS colour as rgb 0..1. */
function rgbOf(css: string): [number, number, number] {
  const hit = colorCache.get(css);
  if (hit) return hit;
  colorCtx ??= document.createElement('canvas').getContext('2d');
  let out: [number, number, number] = [0.6, 0.8, 1];
  if (colorCtx) {
    colorCtx.fillStyle = '#99ccff';
    colorCtx.fillStyle = css;
    const v = String(colorCtx.fillStyle);
    if (v.startsWith('#') && v.length === 7) {
      out = [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16) / 255) as [number, number, number];
    } else {
      const m = v.match(/[\d.]+/g);
      if (m && m.length >= 3) out = [Number(m[0]) / 255, Number(m[1]) / 255, Number(m[2]) / 255];
    }
  }
  colorCache.set(css, out);
  return out;
}

/** What a track drives in the visuals is decided by its type. */
function roleOf(type: string): Role | undefined {
  if (type === 'bass' || type === 'acid') return 'bass';
  if (type === 'motif' || type === 'arp') return 'lead';
  if (type === 'chords' || type === 'drone') return 'pad';
  return undefined;
}

const DRUM = {
  kick: [35, 36],
  snare: [37, 38, 39, 40, 41, 43, 45, 47, 48, 50],
  hat: [42, 44, 46, 49, 51, 57, 59],
};

function hsl(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}

/** Runs in the visuals window: listens to Drift and draws. */
export function startVisuals(root: HTMLElement): void {
  document.title = 'Drift · Visuals';
  root.innerHTML = '';
  root.className = 'visuals-root';

  const gl3 = document.createElement('canvas');
  const overlay = document.createElement('canvas');
  gl3.className = 'vis-canvas';
  overlay.className = 'vis-canvas';
  const hud = document.createElement('div');
  hud.className = 'vis-hud';
  const status = document.createElement('div');
  status.className = 'vis-status';
  status.textContent = 'Waiting for Drift… open Visuals from the Drift window.';
  root.append(gl3, overlay, status, hud);

  // ---------- state from Drift ----------
  let tracks = new Map<string, VisualTrack>();
  let bpm = 120;
  let playing = false;
  let stepsPerBar = 16;
  const queue: VisualsMessage[] = [];
  let lastStep = { step: 0, at: 0 };
  let bar = 0;

  let kick = 0;
  let snare = 0;
  let hat = 0;
  let energy = 0;
  const env: Record<Role, number> = { bass: 0, lead: 0, pad: 0 };
  const pitch: Record<Role, number> = { bass: 0.3, lead: 0.6, pad: 0.5 };
  const modTarget: Record<Role, number> = { bass: 0.5, lead: 0.5, pad: 0.5 };
  const mod: Record<Role, number> = { bass: 0.5, lead: 0.5, pad: 0.5 };
  let padHoldUntil = 0;
  let target: [number, number, number][] = [hsl(200, 0.7, 0.35), hsl(280, 0.7, 0.5), hsl(30, 0.9, 0.6)];
  let cols: [number, number, number][] = target.map((c) => [...c] as [number, number, number]);
  const particles: Particle[] = [];
  const world: WorldEvent[] = [];
  const evA = new Float32Array(MAX_EV * 4);
  const evB = new Float32Array(MAX_EV * 4);
  const evC = new Float32Array(MAX_EV * 3);
  const rings = new Float32Array(16);
  let leadCol: [number, number, number] = [1, 0.9, 0.7];

  const settings = load();
  let scene: SceneId = settings.scene;
  let showNotes = settings.notes;
  let strobe = settings.strobe;
  let auto = settings.auto;
  let speed = settings.speed;
  let tod: TimeOfDay = TOD_ORDER.includes(settings.tod) ? settings.tod : 'dusk';
  /** 0 dusk .. 1 night, eased so switching fades over a few seconds. */
  let todValue = tod === 'night' ? 1 : 0;
  let lastAutoBar = 0;

  const receive = (msg: VisualsMessage) => {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'state') {
      tracks = new Map(msg.tracks.map((t) => [t.id, t]));
      bpm = msg.bpm;
      playing = msg.playing;
      stepsPerBar = msg.stepsPerBar;
      if (msg.chordPcs.length) setChord(msg.chordPcs);
      status.textContent = playing ? '' : 'Connected · press Play in Drift';
      status.hidden = playing;
    } else if (msg.t === 'note' || msg.t === 'step' || msg.t === 'chord' || msg.t === 'lfo') {
      queue.push(msg);
    } else if (msg.t === 'cc') {
      const role = roleOf(tracks.get(msg.track)?.type ?? '');
      if (role) modTarget[role] = msg.value / 127;
    }
  };

  window.addEventListener('message', (e) => receive(e.data as VisualsMessage));
  let channel: BroadcastChannel | undefined;
  try {
    channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = (e) => receive(e.data as VisualsMessage);
  } catch {
    channel = undefined;
  }
  const hello: VisualsMessage = { t: 'hello' };
  window.opener?.postMessage(hello, '*');
  channel?.postMessage(hello);
  window.addEventListener('pagehide', () => {
    const bye: VisualsMessage = { t: 'bye' };
    window.opener?.postMessage(bye, '*');
    channel?.postMessage(bye);
  });

  function setChord(pcs: number[]) {
    const [r = 9, t = r + 3, f = r + 7] = pcs;
    target = [hsl((r % 12) * 30, 0.75, 0.32), hsl((t % 12) * 30 + 15, 0.7, 0.5), hsl((f % 12) * 30 + 30, 0.95, 0.62)];
  }

  const localTime = (epoch: number) => epoch - performance.timeOrigin;

  function trigger(msg: VisualsMessage, now: number) {
    if (msg.t === 'step') {
      lastStep = { step: msg.step, at: localTime(msg.at) };
      bar = msg.bar;
      return;
    }
    if (msg.t === 'chord') {
      setChord(msg.pcs);
      return;
    }
    if (msg.t === 'lfo') {
      const role = roleOf(tracks.get(msg.track)?.type ?? '');
      if (role) modTarget[role] = msg.value / 127;
      return;
    }
    if (msg.t !== 'note') return;
    const track = tracks.get(msg.track);
    if (!track || track.silent) return;
    const v = msg.vel / 127;
    const W = overlay.width;
    const H = overlay.height;
    if (track.type === 'drums') {
      for (const n of msg.notes) {
        if (DRUM.kick.includes(n)) {
          kick = Math.max(kick, 0.6 + v * 0.4);
          if (showNotes && !WORLD_SCENES.has(scene)) particles.push({ x: W / 2, y: H / 2, vx: 0, vy: 0, r: H * 0.05, life: 1, decay: 1.8, color: track.color, kind: 'ring' });
        } else if (DRUM.snare.includes(n)) {
          snare = Math.max(snare, 0.5 + v * 0.5);
        } else if (DRUM.hat.includes(n)) {
          hat = Math.max(hat, 0.4 + v * 0.6);
          if (showNotes && !WORLD_SCENES.has(scene)) {
            for (let i = 0; i < 3; i++) {
              particles.push({ x: Math.random() * W, y: Math.random() * H, vx: 0, vy: 0, r: 1.5 + Math.random() * 2.5, life: 1, decay: 5, color: '#ffffff', kind: 'spark' });
            }
          }
        }
      }
      return;
    }
    energy = Math.min(1, energy + 0.06 + v * 0.05);
    const role = roleOf(track.type);
    if (role) {
      env[role] = Math.max(env[role], 0.5 + v * 0.5);
      const top = Math.max(...msg.notes);
      pitch[role] = Math.max(0, Math.min(1, (top - 24) / 72));
      if (role === 'pad') padHoldUntil = Math.max(padHoldUntil, now + msg.dur);
    }
    if (!showNotes) return;
    if (WORLD_SCENES.has(scene)) {
      spawnWorld(track, role, msg.notes, v, msg.dur, now);
      return;
    }
    const ids = [...tracks.values()].filter((t) => t.type !== 'drums').map((t) => t.id);
    const lane = Math.max(0, ids.indexOf(track.id));
    const laneX = (W * (lane + 0.5)) / Math.max(1, ids.length);
    for (const n of msg.notes.slice(0, 4)) {
      const y = H * (1 - Math.max(0, Math.min(1, (n - 24) / 72)));
      const life = Math.min(4, Math.max(0.4, msg.dur / 1000));
      particles.push({
        x: laneX + (Math.random() - 0.5) * W * 0.25,
        y,
        vx: (Math.random() - 0.5) * 30,
        vy: -20 - Math.random() * 30,
        r: H * (0.008 + v * 0.02) * (track.type === 'chords' || track.type === 'drone' ? 2.2 : 1),
        life: 1,
        decay: 1 / (life + 0.3),
        color: track.color,
        kind: 'note',
      });
    }
    void now;
  }

  /** Place a note somewhere ahead of the camera, in the current scene's world. */
  function spawnWorld(track: VisualTrack, role: Role | undefined, notes: number[], vel: number, durMs: number, now: number) {
    const kind: 0 | 1 | 2 = role === 'bass' ? 1 : role === 'pad' ? 2 : 0;
    const pn = Math.max(0, Math.min(1, (Math.max(...notes) - 24) / 72));
    const dur = durMs / 1000;
    const r = Math.random;
    let x: number, z: number, life: number;
    let side = r() < 0.5 ? -1 : 1;
    if (kind === 0) leadCol = rgbOf(track.color);
    if (scene === 'coast') {
      const cz = travel * 1.5;
      if (kind === 0) {
        z = cz + 14 + r() * 26;
        x = coastX(z) - 7 - r() * 16;
        life = 2.6;
      } else if (kind === 1) {
        z = cz + 9 + r() * 12;
        x = 0;
        life = 2.8;
      } else {
        z = cz + 18 + r() * 22;
        x = coastX(z) - 4 - r() * 14;
        life = Math.min(9, dur + 2.5);
      }
      side = 0;
    } else if (scene === 'city') {
      const cz = travel * 2;
      if (kind === 0) {
        z = (Math.floor((cz + 10 + r() * 16) / 4) + 0.5) * 4;
        x = side * 3.98;
        life = Math.min(4, Math.max(0.7, dur + 0.5));
      } else if (kind === 1) {
        x = -1.3;
        z = cz + 38 + r() * 10;
        life = 7;
      } else {
        x = side * 12;
        z = cz + 18 + r() * 20;
        life = Math.min(9, dur + 2.5);
      }
    } else {
      const d = kind === 0 ? 6 + r() * 8 : kind === 1 ? 9 + r() * 6 : 10 + r() * 10;
      z = travel + d;
      const path = Math.sin(z * 0.07) * 3;
      x = path + (kind === 0 ? (pn - 0.5) * 7 + (r() - 0.5) * 2 : (r() - 0.5) * (kind === 1 ? 5 : 9));
      life = kind === 0 ? 2.8 : kind === 1 ? 3 : Math.min(8, dur + 2.5);
      side = 0;
    }
    const same = world.filter((e) => e.kind === kind);
    if (same.length >= EV_CAP[kind]!) world.splice(world.indexOf(same[0]!), 1);
    if (world.length >= MAX_EV) world.shift();
    world.push({ x, y: pn, z, born: now, life, kind, vel, side, color: rgbOf(track.color) });
  }

  function uploadWorld(p: WebGLProgram, now: number) {
    if (!gl) return;
    for (let i = world.length - 1; i >= 0; i--) if ((now - world[i]!.born) / 1000 > world[i]!.life) world.splice(i, 1);
    rings.fill(0);
    let ri = 0;
    world.forEach((e, i) => {
      const age = (now - e.born) / 1000;
      evA.set([e.x, e.y, e.z, age], i * 4);
      evB.set([e.kind, e.life, e.vel, e.side], i * 4);
      evC.set(e.color, i * 3);
      if (e.kind === 1 && ri < 4) {
        const fade = Math.min(1, age / 0.08) * (1 - Math.max(0, (age - e.life * 0.3) / (e.life * 0.7)));
        rings.set([e.x, e.z, age, (0.5 + e.vel * 0.5) * fade], ri++ * 4);
      }
    });
    gl.uniform4fv(uni(p, 'uEvA'), evA);
    gl.uniform4fv(uni(p, 'uEvB'), evB);
    gl.uniform3fv(uni(p, 'uEvC'), evC);
    gl.uniform1i(uni(p, 'uEvN'), world.length);
    gl.uniform4fv(uni(p, 'uRing'), rings);
  }

  // ---------- WebGL scenes ----------
  const uniforms = new Map<WebGLProgram, Map<string, WebGLUniformLocation | null>>();
  function uni(p: WebGLProgram, name: string): WebGLUniformLocation | null {
    let m = uniforms.get(p);
    if (!m) uniforms.set(p, (m = new Map()));
    if (!m.has(name)) m.set(name, gl!.getUniformLocation(p, name));
    return m.get(name)!;
  }
  const gl = gl3.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' });
  const programs = new Map<SceneId, WebGLProgram>();
  if (gl) {
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  } else {
    status.textContent = 'WebGL 2 is not available in this browser; showing Pulse only.';
    scene = 'pulse';
  }

  function program(id: SceneId): WebGLProgram | undefined {
    if (!gl) return undefined;
    const cached = programs.get(id);
    if (cached) return cached;
    const def = SCENES.find((x) => x.id === id);
    if (!def?.source) return undefined;
    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(sh));
      return sh;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, compile(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, def.source));
    gl.bindAttribLocation(p, 0, 'p');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      console.error(gl.getProgramInfoLog(p));
      return undefined;
    }
    programs.set(id, p);
    return p;
  }

  // Render the shader at a lower resolution when the GPU can't keep up.
  let scale = 0.6;
  let frames = 0;
  let fpsAt = performance.now();
  // Size the page to what is actually visible. On iOS Safari the window extends under the
  // (floating) toolbar, so a bottom-anchored bar ends up behind it or off screen.
  function fitViewport() {
    const vv = window.visualViewport;
    if (vv) {
      root.style.top = `${vv.offsetTop}px`;
      root.style.left = `${vv.offsetLeft}px`;
      root.style.width = `${vv.width}px`;
      root.style.height = `${vv.height}px`;
      root.style.minHeight = '0';
      root.style.right = 'auto';
      root.style.bottom = 'auto';
    }
  }
  function viewW() {
    return root.clientWidth || innerWidth;
  }
  function viewH() {
    return root.clientHeight || innerHeight;
  }
  function resize() {
    fitViewport();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.floor(viewW() * dpr * scale));
    const h = Math.max(1, Math.floor(viewH() * dpr * scale));
    if (gl3.width !== w || gl3.height !== h) {
      gl3.width = w;
      gl3.height = h;
    }
    const ow = Math.floor(viewW() * Math.min(1.5, dpr));
    const oh = Math.floor(viewH() * Math.min(1.5, dpr));
    if (overlay.width !== ow || overlay.height !== oh) {
      overlay.width = ow;
      overlay.height = oh;
    }
  }
  window.addEventListener('resize', resize);
  window.visualViewport?.addEventListener('resize', resize);
  window.visualViewport?.addEventListener('scroll', fitViewport);
  resize();

  const ctx = overlay.getContext('2d')!;
  const start = performance.now();
  let last = start;
  /** Scene clock and distance, both scaled by the Speed setting. */
  let sceneTime = 0;
  let travel = 0;
  let travelSpeed = 0.4;

  function frame(now: number) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;

    // Fire events whose time has come (they arrive ~100 ms early).
    queue.sort((a, b) => ('at' in a ? a.at : 0) - ('at' in b ? b.at : 0));
    while (queue.length) {
      const m = queue[0]!;
      const at = 'at' in m ? localTime(m.at) : 0;
      if (at > now + 4) break;
      queue.shift();
      if (now - at < 1000) trigger(m, now);
    }
    if (queue.length > 4000) queue.splice(0, queue.length - 2000);

    kick *= Math.exp(-dt * 7);
    snare *= Math.exp(-dt * 6);
    hat *= Math.exp(-dt * 10);
    energy *= Math.exp(-dt * 0.8);
    env.bass *= Math.exp(-dt * 5);
    env.lead *= Math.exp(-dt * 4);
    env.pad = now < padHoldUntil ? Math.max(env.pad * Math.exp(-dt * 0.3), 0.55) : env.pad * Math.exp(-dt * 1.2);
    for (const r of ['bass', 'lead', 'pad'] as Role[]) mod[r] += (modTarget[r] - mod[r]) * (1 - Math.exp(-dt * 6));
    const k = 1 - Math.exp(-dt * 1.5);
    cols = cols.map((c, i) => c.map((x, j) => x + (target[i]![j]! - x) * k) as [number, number, number]);

    const stepMs = 60000 / bpm / 4;
    const beat = playing ? (((lastStep.step % 4) + Math.min(1, (now - lastStep.at) / stepMs)) / 4) % 1 : 0;
    // Smooth position within the bar; drifts slowly while stopped so trees still move.
    const barPhase = playing
      ? ((lastStep.step % stepsPerBar) + Math.min(1, (now - lastStep.at) / stepMs)) / stepsPerBar
      : (sceneTime * 0.12) % 1;
    const barF = bar + (playing ? ((lastStep.step % stepsPerBar) + 1) / stepsPerBar : 0);

    if (auto && playing && bar - lastAutoBar >= 32) {
      lastAutoBar = bar;
      const list = SCENES.filter((x) => x.source).map((x) => x.id);
      setScene(list[(list.indexOf(scene as (typeof list)[number]) + 1) % list.length]!);
    }

    // Speed eases towards its target, and distance is integrated, so the
    // camera never jerks when the music gets busier.
    const targetSpeed = (playing ? 1 : 0.3) * (bpm / 120) * (1 + energy * 0.25) * speed;
    travelSpeed += (targetSpeed - travelSpeed) * (1 - Math.exp(-dt * 0.8));
    travel += dt * travelSpeed;
    sceneTime += dt * (0.35 + 0.65 * speed);
    // Cycle: dusk to night and back in about three minutes.
    const todTarget = tod === 'night' ? 1 : tod === 'dusk' ? 0 : 0.5 - 0.5 * Math.cos((now / 1000) * ((2 * Math.PI) / 180));
    todValue += (todTarget - todValue) * (1 - Math.exp(-dt * 0.8));

    resize();
    const p = program(scene);
    if (gl && p) {
      gl.viewport(0, 0, gl3.width, gl3.height);
      gl.useProgram(p);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      const u = (name: string) => uni(p, name);
      gl.uniform1f(u('uTime'), sceneTime);
      gl.uniform2f(u('uRes'), gl3.width, gl3.height);
      gl.uniform1f(u('uKick'), kick);
      gl.uniform1f(u('uSnare'), snare);
      gl.uniform1f(u('uHat'), hat);
      gl.uniform1f(u('uEnergy'), energy);
      gl.uniform1f(u('uBeat'), beat);
      gl.uniform1f(u('uBar'), barF);
      gl.uniform1f(u('uTravel'), travel);
      gl.uniform1f(u('uBass'), env.bass);
      gl.uniform1f(u('uLead'), env.lead);
      gl.uniform1f(u('uPad'), env.pad);
      gl.uniform1f(u('uBassPitch'), pitch.bass);
      gl.uniform1f(u('uLeadPitch'), pitch.lead);
      gl.uniform1f(u('uModBass'), mod.bass);
      gl.uniform1f(u('uModLead'), mod.lead);
      gl.uniform1f(u('uModPad'), mod.pad);
      gl.uniform3fv(u('uCol0'), cols[0]!);
      gl.uniform3fv(u('uCol1'), cols[1]!);
      gl.uniform3fv(u('uCol2'), cols[2]!);
      gl.uniform1f(u('uBarPhase'), barPhase);
      if (WORLD_SCENES.has(scene)) uploadWorld(p, now);
      gl.uniform1f(u('uTod'), todValue);
      gl.uniform3fv(u('uLeadCol'), leadCol);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl3.hidden = false;
    } else {
      gl3.hidden = true;
    }

    // Overlay: notes, sparks, kick rings, strobe.
    const W = overlay.width;
    const H = overlay.height;
    ctx.globalCompositeOperation = 'source-over';
    if (scene === 'pulse') {
      ctx.fillStyle = `rgba(4, 5, 8, ${Math.min(1, dt * 6)})`;
      ctx.fillRect(0, 0, W, H);
    } else {
      ctx.clearRect(0, 0, W, H);
    }
    ctx.globalCompositeOperation = 'lighter';
    if (scene === 'pulse') {
      const [r, g, b] = cols[2]!.map((x) => Math.round(x * 255));
      ctx.fillStyle = `rgba(${r},${g},${b},${kick * 0.18})`;
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = `rgba(255,255,255,${snare * 0.12})`;
      ctx.fillRect(0, H * 0.45, W, H * 0.1);
    }
    for (let i = particles.length - 1; i >= 0; i--) {
      const q = particles[i]!;
      q.life -= dt * q.decay;
      if (q.life <= 0) {
        particles.splice(i, 1);
        continue;
      }
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      ctx.globalAlpha = Math.max(0, q.life);
      if (q.kind === 'ring') {
        ctx.strokeStyle = q.color;
        ctx.lineWidth = H * 0.006 * q.life;
        ctx.beginPath();
        ctx.arc(q.x, q.y, q.r + (1 - q.life) * H * 0.6, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        const r = q.kind === 'note' ? q.r * (0.6 + 0.4 * q.life) : q.r;
        const grad = ctx.createRadialGradient(q.x, q.y, 0, q.x, q.y, r * 2.5);
        grad.addColorStop(0, q.color);
        grad.addColorStop(1, 'transparent');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(q.x, q.y, r * 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    if (particles.length > 1500) particles.splice(0, particles.length - 1500);
    if (strobe && kick > 0.85) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = `rgba(255,255,255,${(kick - 0.85) * 2.5})`;
      ctx.fillRect(0, 0, W, H);
    }

    frames++;
    if (now - fpsAt > 1500) {
      const fps = (frames * 1000) / (now - fpsAt);
      if (fps < 45 && scale > 0.3) scale = Math.max(0.3, scale - 0.1);
      else if (fps > 58 && scale < 1) scale = Math.min(1, scale + 0.05);
      frames = 0;
      fpsAt = now;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // ---------- HUD ----------
  function button(label: string, title: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.title = title;
    b.onclick = onClick;
    return b;
  }
  const sceneButtons = SCENES.map((x, i) => {
    const b = button(x.name, `Scene ${i + 1}`, () => setScene(x.id));
    b.dataset.scene = x.id;
    return b;
  });
  const notesBtn = button('Notes', 'Show notes: particles, or things happening in the Flyover and City worlds (N)', () => {
    showNotes = !showNotes;
    sync();
  });
  const strobeBtn = button('Strobe', 'White flash on strong kicks (S)', () => {
    strobe = !strobe;
    sync();
  });
  const autoBtn = button('Auto', 'Next scene every 32 bars (A)', () => {
    auto = !auto;
    lastAutoBar = bar;
    sync();
  });
  const todBtn = button('', 'Time of day in Flyover, City and Coast (T)', () => {
    tod = TOD_ORDER[(TOD_ORDER.indexOf(tod) + 1) % TOD_ORDER.length]!;
    sync();
  });
  const fullBtn = button('Fullscreen', 'Fullscreen (F)', () => toggleFullscreen());
  // On phones (and in the installed app) there is no window chrome to close the visuals with.
  const closeBtn = button('Close', 'Close visuals (Esc)', () => closeVisuals());
  closeBtn.className = 'vis-close';
  closeBtn.setAttribute('aria-label', 'Close visuals');
  const speedWrap = document.createElement('label');
  speedWrap.className = 'vis-speed';
  speedWrap.title = 'Speed ( [ and ] )';
  const speedText = document.createElement('span');
  const speedInput = document.createElement('input');
  speedInput.type = 'range';
  speedInput.min = '0.05';
  speedInput.max = '1.5';
  speedInput.step = '0.05';
  speedInput.value = String(speed);
  speedInput.oninput = () => setSpeed(Number(speedInput.value));
  speedWrap.append(speedText, speedInput);
  const scenesRow = document.createElement('div');
  scenesRow.className = 'vis-row';
  scenesRow.append(...sceneButtons);
  const optionsRow = document.createElement('div');
  optionsRow.className = 'vis-row';
  optionsRow.append(notesBtn, strobeBtn, autoBtn, todBtn, fullBtn);
  hud.append(scenesRow, spacer(), speedWrap, spacer(), optionsRow);
  root.append(closeBtn);
  function setSpeed(v: number) {
    speed = Math.max(0.05, Math.min(1.5, Math.round(v * 100) / 100));
    speedInput.value = String(speed);
    sync();
  }

  function spacer() {
    const s = document.createElement('span');
    s.className = 'vis-sep';
    return s;
  }
  function setScene(id: SceneId) {
    scene = gl || id === 'pulse' ? id : 'pulse';
    particles.length = 0;
    world.length = 0;
    sync();
  }
  function sync() {
    for (const b of sceneButtons) b.setAttribute('aria-pressed', String(b.dataset.scene === scene));
    notesBtn.setAttribute('aria-pressed', String(showNotes));
    strobeBtn.setAttribute('aria-pressed', String(strobe));
    autoBtn.setAttribute('aria-pressed', String(auto));
    speedText.textContent = `Speed ${Math.round(speed * 100)}%`;
    todBtn.textContent = TOD_LABEL[tod];
    todBtn.hidden = !WORLD_SCENES.has(scene);
    save({ scene, notes: showNotes, strobe, auto, speed, tod });
  }
  sync();

  function closeVisuals() {
    if (document.fullscreenElement) void document.exitFullscreen();
    // Works when Drift opened this window; browsers ignore it otherwise.
    window.close();
    // Still here (opened by hand, or a tab the browser won't close): go back to Drift.
    setTimeout(() => {
      if (window.closed) return;
      // Back only when that leads to Drift; otherwise load Drift in this tab.
      const fromDrift = document.referrer.split('#')[0] === location.href.split('#')[0];
      if (fromDrift && history.length > 1) history.back();
      else location.replace(location.origin + location.pathname + location.search);
    }, 150);
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.();
  }

  let idle: ReturnType<typeof setTimeout> | undefined;
  const wake = () => {
    root.classList.remove('idle');
    clearTimeout(idle);
    idle = setTimeout(() => root.classList.add('idle'), 2500);
  };
  window.addEventListener('pointermove', wake);
  // Touch screens have no hover: a tap brings the controls back.
  window.addEventListener('pointerdown', wake);
  wake();

  window.addEventListener('keydown', (e) => {
    const n = Number(e.key);
    if (n >= 1 && n <= SCENES.length) setScene(SCENES[n - 1]!.id);
    else if (e.key === 'f' || e.key === 'F') toggleFullscreen();
    else if (e.key === 'n' || e.key === 'N') notesBtn.click();
    else if (e.key === 's' || e.key === 'S') strobeBtn.click();
    else if (e.key === 'a' || e.key === 'A') autoBtn.click();
    else if (e.key === 't' || e.key === 'T') todBtn.click();
    else if (e.key === '[') setSpeed(speed - 0.05);
    else if (e.key === ']') setSpeed(speed + 0.05);
    else if (e.key === 'Escape' && !document.fullscreenElement) closeVisuals();
    else return;
    wake();
  });
}

interface Settings {
  scene: SceneId;
  notes: boolean;
  strobe: boolean;
  auto: boolean;
  /** 0.05 (very slow) .. 1.5; scales travel and scene animation. */
  speed: number;
  /** Time of day in Flyover, City and Coast. */
  tod: TimeOfDay;
}

function load(): Settings {
  const fallback: Settings = { scene: 'flyover', notes: true, strobe: false, auto: false, speed: 0.4, tod: 'dusk' };
  try {
    const s = { ...fallback, ...(JSON.parse(localStorage.getItem('drift.visuals') ?? '{}') as Partial<Settings>) };
    // Coast replaced Ocean.
    if ((s.scene as string) === 'ocean') s.scene = 'coast';
    if (!SCENES.some((x) => x.id === s.scene)) s.scene = fallback.scene;
    return s;
  } catch {
    return fallback;
  }
}

function save(s: Settings): void {
  try {
    localStorage.setItem('drift.visuals', JSON.stringify(s));
  } catch {
    /* private mode */
  }
}
