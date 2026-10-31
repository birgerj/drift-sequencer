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
  let target: [number, number, number][] = [hsl(200, 0.7, 0.35), hsl(280, 0.7, 0.5), hsl(30, 0.9, 0.6)];
  let cols: [number, number, number][] = target.map((c) => [...c] as [number, number, number]);
  const particles: Particle[] = [];

  const settings = load();
  let scene: SceneId = settings.scene;
  let showNotes = settings.notes;
  let strobe = settings.strobe;
  let auto = settings.auto;
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
    } else if (msg.t === 'note' || msg.t === 'step' || msg.t === 'chord') {
      queue.push(msg);
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
          if (showNotes) particles.push({ x: W / 2, y: H / 2, vx: 0, vy: 0, r: H * 0.05, life: 1, decay: 1.8, color: track.color, kind: 'ring' });
        } else if (DRUM.snare.includes(n)) {
          snare = Math.max(snare, 0.5 + v * 0.5);
        } else if (DRUM.hat.includes(n)) {
          hat = Math.max(hat, 0.4 + v * 0.6);
          if (showNotes) {
            for (let i = 0; i < 3; i++) {
              particles.push({ x: Math.random() * W, y: Math.random() * H, vx: 0, vy: 0, r: 1.5 + Math.random() * 2.5, life: 1, decay: 5, color: '#ffffff', kind: 'spark' });
            }
          }
        }
      }
      return;
    }
    energy = Math.min(1, energy + 0.06 + v * 0.05);
    if (!showNotes) return;
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

  // ---------- WebGL scenes ----------
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
  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.floor(innerWidth * dpr * scale));
    const h = Math.max(1, Math.floor(innerHeight * dpr * scale));
    if (gl3.width !== w || gl3.height !== h) {
      gl3.width = w;
      gl3.height = h;
    }
    const ow = Math.floor(innerWidth * Math.min(1.5, dpr));
    const oh = Math.floor(innerHeight * Math.min(1.5, dpr));
    if (overlay.width !== ow || overlay.height !== oh) {
      overlay.width = ow;
      overlay.height = oh;
    }
  }
  window.addEventListener('resize', resize);
  resize();

  const ctx = overlay.getContext('2d')!;
  const start = performance.now();
  let last = start;

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
    const k = 1 - Math.exp(-dt * 1.5);
    cols = cols.map((c, i) => c.map((x, j) => x + (target[i]![j]! - x) * k) as [number, number, number]);

    const stepMs = 60000 / bpm / 4;
    const beat = playing ? (((lastStep.step % 4) + Math.min(1, (now - lastStep.at) / stepMs)) / 4) % 1 : 0;
    const barF = bar + (playing ? ((lastStep.step % stepsPerBar) + 1) / stepsPerBar : 0);

    if (auto && playing && bar - lastAutoBar >= 32) {
      lastAutoBar = bar;
      const list = SCENES.filter((x) => x.source).map((x) => x.id);
      setScene(list[(list.indexOf(scene as (typeof list)[number]) + 1) % list.length]!);
    }

    resize();
    const p = program(scene);
    if (gl && p) {
      gl.viewport(0, 0, gl3.width, gl3.height);
      gl.useProgram(p);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      const u = (name: string) => gl.getUniformLocation(p, name);
      gl.uniform1f(u('uTime'), (now - start) / 1000);
      gl.uniform2f(u('uRes'), gl3.width, gl3.height);
      gl.uniform1f(u('uKick'), kick);
      gl.uniform1f(u('uSnare'), snare);
      gl.uniform1f(u('uHat'), hat);
      gl.uniform1f(u('uEnergy'), energy);
      gl.uniform1f(u('uBeat'), beat);
      gl.uniform1f(u('uBar'), barF);
      gl.uniform1f(u('uSpeed'), (playing ? 1.2 : 0.4) * (bpm / 120) * (1 + energy * 0.6));
      gl.uniform3fv(u('uCol0'), cols[0]!);
      gl.uniform3fv(u('uCol1'), cols[1]!);
      gl.uniform3fv(u('uCol2'), cols[2]!);
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
  const notesBtn = button('Notes', 'Note particles (N)', () => {
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
  const fullBtn = button('Fullscreen', 'Fullscreen (F)', () => toggleFullscreen());
  hud.append(...sceneButtons, spacer(), notesBtn, strobeBtn, autoBtn, fullBtn);

  function spacer() {
    const s = document.createElement('span');
    s.className = 'vis-sep';
    return s;
  }
  function setScene(id: SceneId) {
    scene = gl || id === 'pulse' ? id : 'pulse';
    particles.length = 0;
    sync();
  }
  function sync() {
    for (const b of sceneButtons) b.setAttribute('aria-pressed', String(b.dataset.scene === scene));
    notesBtn.setAttribute('aria-pressed', String(showNotes));
    strobeBtn.setAttribute('aria-pressed', String(strobe));
    autoBtn.setAttribute('aria-pressed', String(auto));
    save({ scene, notes: showNotes, strobe, auto });
  }
  sync();

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
  wake();

  window.addEventListener('keydown', (e) => {
    const n = Number(e.key);
    if (n >= 1 && n <= SCENES.length) setScene(SCENES[n - 1]!.id);
    else if (e.key === 'f' || e.key === 'F') toggleFullscreen();
    else if (e.key === 'n' || e.key === 'N') notesBtn.click();
    else if (e.key === 's' || e.key === 'S') strobeBtn.click();
    else if (e.key === 'a' || e.key === 'A') autoBtn.click();
    else return;
    wake();
  });
}

interface Settings {
  scene: SceneId;
  notes: boolean;
  strobe: boolean;
  auto: boolean;
}

function load(): Settings {
  const fallback: Settings = { scene: 'flyover', notes: true, strobe: false, auto: false };
  try {
    return { ...fallback, ...(JSON.parse(localStorage.getItem('drift.visuals') ?? '{}') as Partial<Settings>) };
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
