/**
 * Full-screen fragment shaders, demoscene style. All share the same uniforms:
 *   uTime    seconds          uRes    pixels
 *   uKick    0..1 envelope    uSnare  0..1    uHat 0..1
 *   uEnergy  0..1 smoothed note density
 *   uBeat    0..1 phase within the beat      uBar  bar count (float)
 *   uCol0..2 chord colours (rgb)             uSpeed travel speed
 * Per musical role (from the track type):
 *   uBass / uLead / uPad          note envelopes 0..1 (bass+acid, motif+arp, chords+drone)
 *   uBassPitch / uLeadPitch       last note, 0 (low) .. 1 (high)
 *   uModBass / uModLead / uModPad LFO or panel knob of that role, 0..1 (0.5 when idle)
 */
export const VERTEX = `#version 300 es
in vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }
`;

const HEADER = `#version 300 es
precision highp float;
uniform float uTime, uKick, uSnare, uHat, uEnergy, uBeat, uBar, uSpeed;
uniform float uBass, uLead, uPad, uBassPitch, uLeadPitch, uModBass, uModLead, uModPad;
uniform vec2 uRes;
uniform vec3 uCol0, uCol1, uCol2;
out vec4 outColor;

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 6; i++) { v += a * noise(p); p = r * p * 2.03; a *= 0.5; }
  return v;
}
vec3 tonemap(vec3 c) { return c / (1.0 + c); }
`;

/** Flying low over an endless ridged landscape; the sky takes the chord colours. */
export const FLYOVER = HEADER + `
float ridge(vec2 p) {
  float v = 0.0, a = 0.55;
  mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 5; i++) { float n = 1.0 - abs(noise(p) * 2.0 - 1.0); v += a * n * n; p = r * p * 2.1; a *= 0.5; }
  return v;
}
float height(vec2 p) {
  // The landscape slowly changes character every few bars.
  float morph = 0.5 + 0.5 * sin(uBar * 0.05);
  float amp = 0.7 + uModBass * 0.8;
  return (mix(fbm(p * 0.35) * 2.2, ridge(p * 0.3) * 2.6, morph) - 0.3) * amp;
}
void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  float z = uTime * uSpeed;
  vec3 ro = vec3(sin(z * 0.07) * 3.0, 0.0, z);
  ro.y = height(ro.xz) + 1.1 + 0.3 * sin(z * 0.11);
  vec3 ta = ro + vec3(sin(z * 0.07 + 0.6) * 1.5, -0.25, 3.0);
  vec3 ww = normalize(ta - ro), uu = normalize(cross(vec3(0, 1, 0), ww)), vv = cross(ww, uu);
  float roll = 0.08 * sin(z * 0.05);
  vec3 rd = normalize(uv.x * (uu * cos(roll) + vv * sin(roll)) + uv.y * vv + 1.4 * ww);

  vec3 sun = normalize(vec3(0.3, 0.25, 1.0));
  vec3 sky = mix(uCol1 * 0.6, uCol0 * 0.15, clamp(rd.y * 2.5 + 0.3, 0.0, 1.0));
  sky += uCol2 * pow(max(dot(rd, sun), 0.0), mix(40.0, 10.0, uPad)) * (1.2 + uKick);

  float t = 0.1, h = 0.0;
  bool hit = false;
  for (int i = 0; i < 110; i++) {
    vec3 p = ro + rd * t;
    h = p.y - height(p.xz);
    if (h < 0.002 * t) { hit = true; break; }
    t += h * 0.45;
    if (t > 60.0) break;
  }
  vec3 col = sky;
  if (hit) {
    vec3 p = ro + rd * t;
    vec2 e = vec2(0.02, 0.0);
    vec3 n = normalize(vec3(height(p.xz - e.xy) - height(p.xz + e.xy), 2.0 * e.x, height(p.xz - e.yx) - height(p.xz + e.yx)));
    float dif = clamp(dot(n, sun), 0.0, 1.0);
    vec3 ground = mix(uCol0 * 0.25, uCol1 * 0.5, smoothstep(0.2, 1.6, p.y));
    col = ground * (0.25 + dif);
    // Glowing contour lines that pulse with the kick.
    float lines = abs(fract(p.y * 4.0 - uTime * 0.2) - 0.5);
    col += uCol2 * smoothstep(0.06, 0.0, lines) * (0.15 + uKick * 1.4 + uLead * 0.8);
    col += uCol1 * uBass * 0.25 * smoothstep(1.2, 0.0, p.y);
    // A grid on the ground flashes on the snare.
    vec2 g = abs(fract(p.xz * 0.5) - 0.5);
    col += uCol1 * smoothstep(0.03, 0.0, min(g.x, g.y)) * uSnare * 0.9;
    col = mix(col, sky, 1.0 - exp(-mix(0.001, 0.006, uModPad) * t * t));
  }
  col += uCol2 * uKick * 0.08;
  col = tonemap(col * 1.6);
  col *= 1.0 - 0.35 * dot(uv, uv);
  outColor = vec4(pow(col, vec3(0.85)), 1.0);
}
`;

/** Classic demo tunnel; rings race towards you on every beat. */
export const TUNNEL = HEADER + `
void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  float a = atan(uv.y, uv.x);
  float r = length(uv);
  float z = uTime * uSpeed * 0.6 + 0.35 / max(r, 0.02);
  float twist = a + (0.1 + uModLead * 0.6) * sin(uTime * 0.3) + 0.6 / max(r, 0.05) * 0.1 * sin(uBar * 0.2);
  vec2 tuv = vec2(twist * 3.0 / 3.14159, z);
  float tex = fbm(tuv * vec2(2.0, 1.0));
  float bands = smoothstep(0.45, 0.5, abs(fract(z * 0.5 - uBeat * 0.5) - 0.5));
  vec3 col = mix(uCol0 * 0.4, uCol1, tex * tex) * (0.2 + 0.8 * tex);
  col += uCol2 * bands * (0.3 + uKick * 2.0);
  col += uCol1 * smoothstep(0.02, 0.0, abs(fract(twist * 4.0 / 3.14159) - 0.5) - 0.47) * uHat;
  col *= smoothstep(0.0, 0.25, r) * (1.0 + uSnare * 0.6 + uBass * 0.5);
  col += uCol2 * uKick * 0.25 * exp(-r * 4.0);
  outColor = vec4(pow(tonemap(col * 1.6), vec3(1.15)), 1.0);
}
`;

/** Kaleidoscope of plasma; slices and colours follow the chords. */
export const KALEIDO = HEADER + `
void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  float seg = 6.0 + 2.0 * floor(mod(uBar / 8.0, 3.0));
  float a = atan(uv.y, uv.x) + uTime * (0.02 + uModPad * 0.1);
  float r = length(uv) * (1.0 - uKick * 0.12 - uBass * 0.06);
  a = mod(a, 6.28318 / seg);
  a = abs(a - 3.14159 / seg);
  vec2 p = vec2(cos(a), sin(a)) * r * 3.0;
  float t = uTime * (0.2 + uEnergy * 0.5);
  float v = fbm(p + vec2(t, -t * 0.7)) + 0.5 * sin(p.x * 3.0 + t * 2.0) * sin(p.y * 2.0 - t);
  vec3 col = mix(uCol0 * 0.35, uCol1, smoothstep(0.3, 0.8, v));
  col = mix(col, uCol2, smoothstep(0.75, 0.95, v + uKick * 0.2));
  col *= 0.6 + 0.6 * smoothstep(1.2, 0.0, r);
  col += uCol2 * uSnare * 0.25;
  outColor = vec4(pow(tonemap(col * 1.6), vec3(1.15)), 1.0);
}
`;


/** Night drive down an avenue between towers; windows light up with the lead. */
export const CITY = HEADER + `
float sdBox(vec3 p, vec3 b) { vec3 q = abs(p) - b; return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0); }
vec4 city(vec3 p) {
  float d = p.y;
  vec4 info = vec4(d, 0.0, 0.0, 0.0);
  float side = p.x < 0.0 ? -1.0 : 1.0;
  vec3 q = vec3(abs(p.x), p.y, p.z);
  for (int row = 0; row < 2; row++) {
    float fr = float(row);
    float len = 4.0 + fr * 2.0;
    float cz = floor(q.z / len);
    vec3 r = q;
    r.z = mod(q.z, len) - len * 0.5;
    vec2 id = vec2(cz + fr * 37.0, side + fr * 3.0);
    float h = (1.5 + pow(hash(id), 2.0) * 9.0) * (1.0 + fr * 0.8) * (0.85 + uModBass * 0.3);
    float bw = 1.2 + hash(id + 7.0) * 0.8;
    float off = 4.0 + fr * 6.0;
    float b = sdBox(r - vec3(off + bw, h, 0.0), vec3(bw, h, len * 0.5 - 0.35));
    if (b < info.x) info = vec4(b, id, h * 2.0);
  }
  return info;
}
void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  float z = uTime * uSpeed * 2.0;
  vec3 ro = vec3(sin(z * 0.05) * 0.8, 1.1 + uModBass * 1.6 + uBass * 0.15, z);
  vec3 ww = normalize(vec3(sin(z * 0.05 + 0.4) * 0.15, 0.03 + uModLead * 0.08, 1.0));
  vec3 uu = normalize(cross(vec3(0, 1, 0), ww)), vv = cross(ww, uu);
  vec3 rd = normalize(uv.x * uu + uv.y * vv + 1.3 * ww);

  vec3 sky = mix(uCol0 * 0.25, uCol1 * 0.08, clamp(rd.y * 3.0, 0.0, 1.0));
  sky += vec3(1.0) * step(0.997, hash(floor(rd.xy * 300.0))) * smoothstep(0.05, 0.3, rd.y) * 0.6;
  float t = 0.05;
  vec4 hit = vec4(0.0);
  bool found = false;
  for (int i = 0; i < 120; i++) {
    vec3 p = ro + rd * t;
    hit = city(p);
    if (hit.x < 0.001 * t) { found = true; break; }
    t += hit.x * 0.8;
    if (t > 90.0) break;
  }
  vec3 fogCol = mix(uCol0 * 0.35, uCol1 * 0.3, 0.5 + 0.5 * uPad);
  vec3 col = sky;
  if (found) {
    vec3 p = ro + rd * t;
    vec2 e = vec2(0.002, 0.0);
    vec3 n = normalize(vec3(city(p + e.xyy).x - city(p - e.xyy).x, city(p + e.yxy).x - city(p - e.yxy).x, city(p + e.yyx).x - city(p - e.yyx).x));
    if (p.y < 0.01) {
      // Wet street: lane marks rush past, lights smear in the reflection.
      col = vec3(0.02, 0.02, 0.03);
      float lane = smoothstep(0.08, 0.0, abs(abs(p.x) - 0.05)) * step(0.5, fract(p.z * 0.25));
      col += vec3(0.6) * lane * 0.4;
      col += fogCol * 0.35 * (0.6 + uBass);
      col += uCol2 * smoothstep(3.5, 0.0, abs(abs(p.x) - 3.8)) * 0.15 * (1.0 + uKick * 2.0);
    } else {
      vec2 f = abs(n.x) > 0.5 ? p.zy : p.xy;
      vec2 w = f * vec2(2.2, 2.8);
      vec2 cell = floor(w);
      vec2 g = fract(w);
      float shape = step(0.2, g.x) * step(g.x, 0.8) * step(0.25, g.y) * step(g.y, 0.75);
      float on = step(0.62 - uLead * 0.4 - uEnergy * 0.15, hash(cell + hit.yz * 13.0));
      vec3 win = mix(uCol1, uCol2, hash(cell + 3.1)) * (0.6 + 1.6 * uLead * hash(cell + uBeat));
      col = vec3(0.025, 0.028, 0.04) * (0.5 + 0.5 * max(n.z, 0.0));
      col += win * shape * on;
      // Neon band along the roofline pulses with the kick.
      col += uCol2 * smoothstep(0.25, 0.0, abs(p.y - hit.w + 0.15)) * (0.4 + uKick * 2.2);
      col += uCol1 * smoothstep(0.05, 0.0, abs(fract(p.y * 0.5) - 0.5) - 0.45) * uSnare * 0.6;
    }
    col = mix(col, fogCol, 1.0 - exp(-mix(0.0004, 0.003, uModPad) * t * t));
  }
  col += uCol2 * uKick * 0.05;
  col = tonemap(col * 1.5);
  col *= 1.0 - 0.3 * dot(uv, uv);
  outColor = vec4(pow(col, vec3(0.9)), 1.0);
}
`;

/** Gliding over a night ocean towards the moon; the bass drives the swell. */
export const OCEAN = HEADER + `
float waves(vec2 p) {
  float amp = 0.15 + uModBass * 0.5 + uBass * 0.25;
  float h = 0.0;
  float a = 1.0;
  vec2 dir = vec2(1.0, 0.3);
  for (int i = 0; i < 5; i++) {
    h += a * sin(dot(p, dir) * (0.6 + float(i) * 0.5) + uTime * (1.0 + float(i) * 0.3));
    dir = mat2(0.8, -0.6, 0.6, 0.8) * dir * 1.4;
    a *= 0.5;
  }
  return h * amp + fbm(p * 0.8 + uTime * 0.1) * 0.3 * amp;
}
void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  float z = uTime * uSpeed * 1.5;
  vec3 ro = vec3(0.0, 1.4 + uModBass * 0.6, z);
  vec3 rd = normalize(vec3(uv.x, uv.y - 0.12, 1.3));
  vec3 moonDir = normalize(vec3(0.0, 0.18 + uModLead * 0.1, 1.0));
  float moon = smoothstep(0.9993 - uPad * 0.0008, 0.9997, dot(rd, moonDir));
  vec3 sky = mix(uCol0 * 0.2, uCol1 * 0.05, clamp(rd.y * 3.0, 0.0, 1.0));
  sky += uCol2 * pow(max(dot(rd, moonDir), 0.0), 60.0) * (0.6 + uPad);
  sky += vec3(1.0, 0.97, 0.9) * moon * 2.0;
  sky += vec3(0.8) * step(0.998, hash(floor(rd.xy * 400.0))) * smoothstep(0.02, 0.2, rd.y);
  vec3 col = sky;
  if (rd.y < 0.0) {
    float t = 0.0;
    for (int i = 0; i < 80; i++) {
      vec3 p = ro + rd * t;
      float h = p.y - waves(p.xz);
      if (h < 0.01) break;
      t += max(0.05, h * 0.6);
      if (t > 80.0) break;
    }
    vec3 p = ro + rd * t;
    vec2 e = vec2(0.05, 0.0);
    vec3 n = normalize(vec3(waves(p.xz - e.xy) - waves(p.xz + e.xy), 2.0 * e.x, waves(p.xz - e.yx) - waves(p.xz + e.yx)));
    vec3 refl = reflect(rd, n);
    float fres = pow(1.0 - max(dot(-rd, n), 0.0), 4.0);
    vec3 sea = uCol0 * 0.08;
    vec3 rsky = mix(uCol0 * 0.2, uCol1 * 0.05, clamp(refl.y * 3.0, 0.0, 1.0)) + uCol2 * pow(max(dot(refl, moonDir), 0.0), 40.0) * (1.5 + uLead * 3.0);
    col = mix(sea, rsky, 0.2 + 0.8 * fres);
    // Glitter on the moon path follows the lead line.
    col += vec3(1.0) * step(0.985 - uLead * 0.02, hash(floor(p.xz * 6.0) + floor(uTime * 8.0))) * pow(max(dot(refl, moonDir), 0.0), 8.0) * (0.5 + uHat);
    col = mix(col, uCol0 * 0.15, 1.0 - exp(-0.0008 * t * t));
  }
  col += uCol2 * uKick * 0.04;
  outColor = vec4(pow(tonemap(col * 1.6), vec3(0.9)), 1.0);
}
`;

/** Hyperspace: star streaks through a nebula; the lead stretches the streaks. */
export const WARP = HEADER + `
void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  float t = uTime * uSpeed * (0.25 + uKick * 0.25);
  vec3 col = vec3(0.0);
  // Nebula behind the stars, drifting with the pad LFO.
  float neb = fbm(uv * 2.0 + vec2(uTime * 0.02, uModPad * 2.0));
  col += mix(uCol0, uCol1, neb) * pow(neb, 2.5) * (0.4 + uPad * 0.8);
  float streak = 0.02 + uLead * 0.12 + uEnergy * 0.05;
  for (int i = 0; i < 6; i++) {
    float depth = fract(float(i) / 6.0 + t);
    float scale = mix(18.0, 0.6, depth);
    float fade = smoothstep(0.0, 0.3, depth) * smoothstep(1.0, 0.85, depth);
    vec2 p = uv * scale + float(i) * 17.3;
    vec2 id = floor(p);
    vec2 f = fract(p) - 0.5;
    float h = hash(id);
    vec2 off = vec2(hash(id + 1.3), hash(id + 2.7)) - 0.5;
    vec2 d = f - off * 0.7;
    // Stretch towards the centre: radial streaks.
    vec2 dir = normalize(uv + 1e-4);
    float along = dot(d, dir), across = dot(d, vec2(-dir.y, dir.x));
    float s = exp(-across * across * 2500.0) * exp(-along * along / (streak * streak * 40.0 + 0.0004));
    vec3 starCol = mix(vec3(1.0), uCol2, step(0.7, h));
    col += starCol * s * fade * step(0.6, h) * (1.0 + uHat);
  }
  col += uCol2 * uKick * 0.12 * exp(-length(uv) * 3.0);
  col += uCol1 * uBass * 0.08;
  outColor = vec4(pow(tonemap(col * 1.6), vec3(0.9)), 1.0);
}
`;

/** Retro sun, neon grid and mountains; the classic outrun horizon. */
export const SYNTHWAVE = HEADER + `
void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  float horizon = -0.02;
  vec3 col = mix(uCol0 * 0.25, uCol1 * 0.15, smoothstep(horizon, 0.6, uv.y));
  // Sun with stripes that slide with the lead LFO.
  vec2 sp = uv - vec2(0.0, 0.18);
  float sr = 0.28 + uPad * 0.04 + uKick * 0.015;
  float sun = smoothstep(sr, sr - 0.005, length(sp));
  float stripes = step(0.5, fract((sp.y + uModLead * 0.2 + uTime * 0.02) * 14.0)) + step(0.0, sp.y);
  col = mix(col, mix(uCol2, uCol1, smoothstep(-0.25, 0.25, sp.y)) * 1.6, sun * clamp(stripes, 0.0, 1.0));
  col += uCol2 * 0.25 * exp(-length(sp) * 3.0);
  // Mountains.
  float m = horizon + (fbm(vec2(uv.x * 3.0 + 10.0, 1.0)) - 0.35) * (0.25 + uModBass * 0.3);
  float m2 = horizon + (fbm(vec2(uv.x * 6.0 - 4.0, 2.0)) - 0.45) * 0.15;
  if (uv.y < m) col = mix(uCol0 * 0.08, uCol1 * 0.3, smoothstep(m - 0.15, m, uv.y));
  if (uv.y < m2) col = uCol0 * 0.05 + uCol2 * smoothstep(0.004, 0.0, abs(uv.y - m2 + 0.002)) * 0.6;
  // Grid floor.
  if (uv.y < horizon) {
    float depth = 0.3 / (horizon - uv.y);
    vec2 g = vec2(uv.x * depth, depth + uTime * uSpeed * 2.0);
    vec2 gl = abs(fract(g) - 0.5);
    float line = smoothstep(0.03 * depth, 0.0, min(gl.x, gl.y) - 0.005);
    vec3 floorCol = uCol0 * 0.04;
    floorCol += uCol2 * line * (0.4 + uKick * 1.8 + uBass * 0.6) * exp(-depth * 0.05);
    floorCol += uCol1 * uSnare * 0.15 * exp(-depth * 0.3);
    col = floorCol;
  }
  col += uCol2 * uKick * 0.03;
  col *= 1.0 - 0.25 * dot(uv, uv);
  outColor = vec4(pow(tonemap(col * 1.7), vec3(0.9)), 1.0);
}
`;

export const SCENES = [
  { id: 'flyover', name: 'Flyover', source: FLYOVER },
  { id: 'city', name: 'City', source: CITY },
  { id: 'ocean', name: 'Ocean', source: OCEAN },
  { id: 'synthwave', name: 'Synthwave', source: SYNTHWAVE },
  { id: 'warp', name: 'Warp', source: WARP },
  { id: 'tunnel', name: 'Tunnel', source: TUNNEL },
  { id: 'kaleido', name: 'Kaleido', source: KALEIDO },
  { id: 'pulse', name: 'Pulse', source: null },
] as const;
