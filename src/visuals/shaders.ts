/**
 * Full-screen fragment shaders, demoscene style. All share the same uniforms:
 *   uTime    seconds          uRes    pixels
 *   uKick    0..1 envelope    uSnare  0..1    uHat 0..1
 *   uEnergy  0..1 smoothed note density
 *   uBeat    0..1 phase within the beat      uBar  bar count (float)
 *   uCol0..2 chord colours (rgb)             uSpeed travel speed
 */
export const VERTEX = `#version 300 es
in vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }
`;

const HEADER = `#version 300 es
precision highp float;
uniform float uTime, uKick, uSnare, uHat, uEnergy, uBeat, uBar, uSpeed;
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
  return mix(fbm(p * 0.35) * 2.2, ridge(p * 0.3) * 2.6, morph) - 0.3;
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
  sky += uCol2 * pow(max(dot(rd, sun), 0.0), 24.0) * (1.2 + uKick);

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
    col += uCol2 * smoothstep(0.06, 0.0, lines) * (0.15 + uKick * 1.4 + uEnergy * 0.4);
    // A grid on the ground flashes on the snare.
    vec2 g = abs(fract(p.xz * 0.5) - 0.5);
    col += uCol1 * smoothstep(0.03, 0.0, min(g.x, g.y)) * uSnare * 0.9;
    col = mix(col, sky, 1.0 - exp(-0.0025 * t * t));
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
  float twist = a + 0.25 * sin(uTime * 0.3) + 0.6 / max(r, 0.05) * 0.1 * sin(uBar * 0.2);
  vec2 tuv = vec2(twist * 3.0 / 3.14159, z);
  float tex = fbm(tuv * vec2(2.0, 1.0));
  float bands = smoothstep(0.45, 0.5, abs(fract(z * 0.5 - uBeat * 0.5) - 0.5));
  vec3 col = mix(uCol0 * 0.4, uCol1, tex * tex) * (0.2 + 0.8 * tex);
  col += uCol2 * bands * (0.3 + uKick * 2.0);
  col += uCol1 * smoothstep(0.02, 0.0, abs(fract(twist * 4.0 / 3.14159) - 0.5) - 0.47) * uHat;
  col *= smoothstep(0.0, 0.25, r) * (1.0 + uSnare * 0.6);
  col += uCol2 * uKick * 0.25 * exp(-r * 4.0);
  outColor = vec4(pow(tonemap(col * 1.6), vec3(1.15)), 1.0);
}
`;

/** Kaleidoscope of plasma; slices and colours follow the chords. */
export const KALEIDO = HEADER + `
void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  float seg = 6.0 + 2.0 * floor(mod(uBar / 8.0, 3.0));
  float a = atan(uv.y, uv.x) + uTime * 0.05;
  float r = length(uv) * (1.0 - uKick * 0.12);
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

export const SCENES = [
  { id: 'flyover', name: 'Flyover', source: FLYOVER },
  { id: 'tunnel', name: 'Tunnel', source: TUNNEL },
  { id: 'kaleido', name: 'Kaleido', source: KALEIDO },
  { id: 'pulse', name: 'Pulse', source: null },
] as const;
