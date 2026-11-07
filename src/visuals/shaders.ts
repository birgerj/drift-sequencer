/**
 * Full-screen fragment shaders, demoscene style. All share the same uniforms:
 *   uTime    seconds          uRes    pixels
 *   uKick    0..1 envelope    uSnare  0..1    uHat 0..1
 *   uEnergy  0..1 smoothed note density
 *   uBeat    0..1 phase within the beat      uBar  bar count (float)
 *   uCol0..2 chord colours (rgb)             uTravel distance travelled (integrated, so it never jumps)
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
uniform float uTime, uKick, uSnare, uHat, uEnergy, uBeat, uBar, uTravel;
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

/**
 * World events: notes that happen *in* the Flyover and City scenes instead of as dots on top.
 * Each event has a world position, an age and a track colour (see VisualsApp, spawnWorld).
 *   uEvA[i] = (x, y, z, age s)   y is the note pitch 0..1 where a scene needs a height
 *   uEvB[i] = (kind, life s, velocity 0..1, side -1/1)   kind 0 lead, 1 bass, 2 pad
 *   uEvC[i] = track colour (rgb)
 *   uBarPhase 0..1 smooth position within the bar (trees sway on it)
 */
const EVENTS = `
#define MAXEV 24
uniform vec4 uEvA[MAXEV];
uniform vec4 uEvB[MAXEV];
uniform vec3 uEvC[MAXEV];
uniform int uEvN;
uniform float uBarPhase;
float gFog = 0.0;
// Fade in quickly, fade out over the last part of the event's life.
float evFade(vec4 a, vec4 b, float tail) {
  return smoothstep(0.0, 0.08, a.w) * (1.0 - smoothstep(b.y - tail, b.y, a.w));
}
// Glow of a point light seen along a ray; hidden behind anything nearer than tmax, dimmed by fog.
vec3 pointGlow(vec3 ro, vec3 rd, float tmax, vec3 P, vec3 col, float size) {
  vec3 v = P - ro;
  float tp = dot(v, rd);
  if (tp < 0.0 || tp > tmax) return vec3(0.0);
  float d2 = max(dot(v, v) - tp * tp, 0.0);
  float s2 = size * size;
  return col * (exp(-d2 / s2) + 0.12 * s2 / (d2 + s2)) * exp(-gFog * tp * tp);
}
`;

/** Flying low over forests, lakes and snowy ridges. Trees sway on the bar; notes light up the land. */
export const FLYOVER = HEADER + EVENTS + `
uniform vec4 uRing[4];
const vec3 SUN = vec3(0.2795, 0.2329, 0.9315);
const float CELL = 1.1;
const float TREE_FAR = 24.0;
const float RING_SPEED = 2.6;
float gMorph, gAmp, gWater, gSnow;

float ridge(vec2 p) {
  float v = 0.0, a = 0.55;
  mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 5; i++) { float n = 1.0 - abs(noise(p) * 2.0 - 1.0); v += a * n * n; p = r * p * 2.1; a *= 0.5; }
  return v;
}
float height(vec2 p) {
  return (mix(fbm(p * 0.35) * 2.2, ridge(p * 0.3) * 2.6, gMorph) - 0.3) * gAmp;
}
// Wind: the forest sways twice per bar in a wave across the land; kicks are gusts,
// and bass shock waves push the trees outward as they pass.
vec2 sway(vec2 c) {
  float ph = 6.28318 * uBarPhase * 2.0 - dot(c, vec2(0.25, 0.12));
  float amp = 0.12 + 0.35 * uKick + 0.08 * uEnergy + 0.1 * uModPad;
  vec2 s = vec2(0.85, 0.35) * sin(ph) * amp;
  for (int i = 0; i < 4; i++) {
    vec4 r = uRing[i];
    if (r.w <= 0.0) continue;
    vec2 d = c - r.xy;
    float dist = length(d) + 1e-3;
    float front = r.z * RING_SPEED;
    s += d / dist * r.w * exp(-(dist - front) * (dist - front) * 2.5) * 0.9;
  }
  return s;
}
float forestAt(vec2 c) { return noise(c * 0.17 + 7.0); }
// Conifer in the cell under p, standing on ground height gh. c and th describe the tree.
float treeAt(vec3 p, float gh, out vec2 c, out float th) {
  vec2 id = floor(p.xz / CELL);
  c = (id + 0.3 + 0.4 * vec2(hash(id), hash(id + 17.1))) * CELL;
  th = 0.0;
  float forest = forestAt(c) + 0.3 * hash(id + 3.7);
  if (forest < 0.58 || gh < gWater + 0.05 || gh > gSnow - 0.2) return 1e3;
  th = (0.32 + 0.26 * hash(id + 9.1)) * (0.75 + 0.4 * forest);
  vec3 q = p - vec3(c.x, gh, c.y);
  float k = clamp(q.y / th, 0.0, 1.0);
  q.xz -= sway(c) * k * k * th;
  float r = th * 0.3 * (1.0 - k) * (0.72 + 0.28 * fract(k * 3.0 + 0.15));
  float cone = (length(q.xz) - r) * 0.55;
  return max(cone, max(q.y - th, -q.y - 0.5));
}
vec3 skyCol(vec3 rd) {
  vec3 s = mix(uCol1 * 0.6, uCol0 * 0.15, clamp(rd.y * 2.5 + 0.3, 0.0, 1.0));
  float sd = max(dot(rd, SUN), 0.0);
  s += uCol2 * pow(sd, mix(40.0, 10.0, uPad)) * (1.2 + uKick);
  if (rd.y > 0.0) {
    // Clouds drift by overhead; the snare lights them up like distant lightning.
    vec2 cp = rd.xz * (6.0 / (rd.y + 0.05)) + vec2(uTime * 0.3, uTravel);
    float cl = smoothstep(0.45, 0.8, fbm(cp * 0.07));
    vec3 cc = mix(uCol0 * 0.3 + 0.04, uCol2 * 0.8 + 0.1, pow(sd, 3.0)) + vec3(0.75, 0.8, 1.0) * uSnare * 0.8;
    s = mix(s, cc, cl * smoothstep(0.0, 0.25, rd.y) * 0.8);
  }
  return s;
}
// Note effects on the ground. trees > 0 when shading a tree (lead notes light trees up).
vec3 groundFx(vec2 xz, float trees) {
  vec3 c = vec3(0.0);
  for (int i = 0; i < MAXEV; i++) {
    if (i >= uEvN) break;
    vec4 a = uEvA[i], b = uEvB[i];
    vec3 ec = uEvC[i];
    float d = length(xz - a.xz);
    if (b.x < 0.5) {
      float f = evFade(a, b, b.y * 0.6);
      c += ec * smoothstep(0.08, 0.0, abs(d - a.w * 1.4)) * f * 1.2 * (1.0 - trees);
      c += ec * exp(-d * d * 5.0) * f * (0.25 + 2.2 * trees);
    } else if (b.x < 1.5) {
      float f = evFade(a, b, b.y * 0.7);
      c += ec * smoothstep(0.22, 0.0, abs(d - a.w * RING_SPEED)) * f * (0.6 + b.z);
    } else {
      float f = evFade(a, b, 1.5);
      float rr = 0.6 + 2.6 * smoothstep(0.0, 2.0, a.w);
      c += ec * smoothstep(rr, rr * 0.25, d) * f * 0.15 * (1.0 + trees);
    }
  }
  return c;
}

void main() {
  gMorph = 0.5 + 0.5 * sin(uBar * 0.05);
  gAmp = 0.7 + uModBass * 0.8;
  // Ridged land sits higher, so lakes and snow follow the landscape's character.
  gWater = mix(0.45, 0.32, gMorph) * gAmp;
  gSnow = mix(1.35, 1.8, gMorph) * gAmp;
  gFog = mix(0.001, 0.006, uModPad);
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  float z = uTravel;
  vec3 ro = vec3(sin(z * 0.07) * 3.0, 0.0, z);
  float g0 = height(ro.xz), g1 = height(ro.xz + vec2(0.0, 2.0)), g2 = height(ro.xz + vec2(0.0, 4.0));
  ro.y = max(max(g0, (g0 + g1 + g2) / 3.0), gWater) + 1.2 + 0.2 * sin(z * 0.11);
  vec3 ta = ro + vec3(sin(z * 0.07 + 0.6) * 1.5, -0.25, 3.0);
  vec3 ww = normalize(ta - ro), uu = normalize(cross(vec3(0, 1, 0), ww)), vv = cross(ww, uu);
  float roll = 0.08 * sin(z * 0.05);
  vec3 rd = normalize(uv.x * (uu * cos(roll) + vv * sin(roll)) + uv.y * vv + 1.4 * ww);

  vec3 sky = skyCol(rd);
  // 0 sky, 1 ground, 2 water, 3 tree
  int mat = 0;
  float t = 0.1, tgh = 0.0, tth = 0.0;
  vec2 tc = vec2(0.0);
  for (int i = 0; i < 160; i++) {
    vec3 p = ro + rd * t;
    float gh = height(p.xz);
    float h = p.y - max(gh, gWater);
    if (h < 0.002 * t) { mat = gh > gWater ? 1 : 2; break; }
    float st = h * 0.45;
    if (t < TREE_FAR && h < 0.95 && gh > gWater) {
      vec2 c; float th;
      float d = treeAt(p, gh, c, th);
      if (d < 0.002 * t) { mat = 3; tc = c; tth = th; tgh = gh; break; }
      st = min(st, min(max(d, 0.015), 0.3));
    }
    t += st;
    if (t > 60.0) break;
  }

  // Lanterns rise from where lead notes land.
  vec3 lp[MAXEV];
  for (int i = 0; i < MAXEV; i++) {
    lp[i] = vec3(0.0);
    if (i >= uEvN || uEvB[i].x > 0.5) continue;
    vec4 a = uEvA[i];
    float gh = max(height(a.xz), gWater);
    lp[i] = vec3(a.x + sin(a.w * 2.0 + float(i)) * 0.15, gh + 0.5 + a.w * 0.6 + a.y * 0.5, a.z);
  }

  vec3 col = sky;
  vec3 light = vec3(1.0, 0.93, 0.82) * 0.6 + uCol2 * 0.5;
  vec3 amb = mix(uCol0, uCol1, 0.5) * 0.25 + 0.03;
  // Soft fill from behind the camera, so slopes facing us aren't black.
  const vec3 FILL = vec3(-0.371, 0.557, -0.743);
  vec3 fillCol = mix(uCol1, vec3(0.8, 0.85, 1.0), 0.5) * 0.3;
  vec3 p = ro + rd * t;
  if (mat == 3) {
    vec2 e = vec2(0.01, 0.0), dc; float dth;
    vec3 n = normalize(vec3(
      treeAt(p + e.xyy, tgh, dc, dth) - treeAt(p - e.xyy, tgh, dc, dth),
      treeAt(p + e.yxy, tgh, dc, dth) - treeAt(p - e.yxy, tgh, dc, dth),
      treeAt(p + e.yyx, tgh, dc, dth) - treeAt(p - e.yyx, tgh, dc, dth)));
    float k = clamp((p.y - tgh) / tth, 0.0, 1.0);
    vec3 alb = mix(vec3(0.02, 0.06, 0.035), vec3(0.06, 0.15, 0.07), k);
    alb = mix(alb, uCol0 * 0.25, 0.2) * (0.75 + 0.5 * hash(tc));
    col = alb * (amb * 2.0 + light * clamp(dot(n, SUN) + 0.35, 0.0, 1.3) + fillCol * max(dot(n, FILL), 0.0) * 2.0);
    // Rim light from the sun behind the trees.
    col += light * 0.12 * pow(1.0 - max(dot(n, -rd), 0.0), 3.0);
    col += groundFx(tc, 1.0) * (0.4 + 0.6 * k);
    // Hi-hats make the needles glint.
    col += vec3(1.0) * step(0.96, hash(floor(p.xz * 22.0 + p.y * 9.0) + floor(uTime * 12.0))) * uHat * 0.5;
  } else if (mat == 1) {
    vec2 e = vec2(0.02, 0.0);
    vec3 n = normalize(vec3(height(p.xz - e.xy) - height(p.xz + e.xy), 2.0 * e.x, height(p.xz - e.yx) - height(p.xz + e.yx)));
    float slope = 1.0 - n.y;
    float grain = noise(p.xz * 6.0);
    vec3 grass = mix(vec3(0.05, 0.11, 0.05), vec3(0.12, 0.15, 0.06), grain);
    grass = mix(grass, uCol0 * 0.35 + vec3(0.02, 0.05, 0.02), 0.3);
    vec3 rock = vec3(0.13, 0.12, 0.11) * (0.7 + 0.6 * noise(p.xz * 3.0 + p.y));
    vec3 snow = mix(vec3(0.8, 0.84, 0.92), uCol1 + 0.5, 0.15);
    vec3 alb = mix(grass, rock, smoothstep(0.25, 0.5, slope + grain * 0.15));
    alb = mix(alb, snow, smoothstep(gSnow - 0.1, gSnow + 0.1, p.y + grain * 0.15) * smoothstep(0.6, 0.35, slope));
    // Forest floor, and forests beyond tree range, read as darker patches.
    alb *= mix(1.0, 0.55, smoothstep(0.42, 0.62, forestAt(p.xz)) * step(gWater + 0.05, p.y) * step(p.y, gSnow - 0.2));
    alb = mix(vec3(0.17, 0.15, 0.1), alb, smoothstep(gWater, gWater + 0.06, p.y));
    col = alb * (amb * 1.6 + light * clamp(dot(n, SUN) + 0.2, 0.0, 1.2) + fillCol * max(dot(n, FILL), 0.0) * 2.0);
    col += groundFx(p.xz, 0.0);
  } else if (mat == 2) {
    // Lakes: wind ripples, plus rings where notes land.
    vec2 w = p.xz;
    vec3 n = vec3(0.0, 1.0, 0.0);
    n.xz += 0.03 * vec2(sin(w.x * 3.0 + uTime * 1.5 + sin(w.y * 2.0)), sin(w.y * 3.4 - uTime * 1.2));
    for (int i = 0; i < MAXEV; i++) {
      if (i >= uEvN || uEvB[i].x > 1.5) continue;
      vec4 a = uEvA[i];
      vec2 dv = w - a.xz;
      float d = length(dv) + 1e-3;
      float front = a.w * (uEvB[i].x < 0.5 ? 1.4 : RING_SPEED);
      n.xz += dv / d * sin((d - front) * 14.0) * exp(-(d - front) * (d - front) * 4.0) * 0.18 * evFade(a, uEvB[i], uEvB[i].y * 0.6);
    }
    n = normalize(n);
    vec3 rr = reflect(rd, n);
    float fres = 0.04 + 0.96 * pow(1.0 - max(dot(-rd, n), 0.0), 5.0);
    col = mix(vec3(0.01, 0.02, 0.03) + uCol0 * 0.05, skyCol(rr), fres);
    for (int i = 0; i < MAXEV; i++) {
      if (i >= uEvN || uEvB[i].x > 0.5) continue;
      col += pointGlow(p, rr, 40.0, lp[i], uEvC[i] * 2.0, 0.12) * evFade(uEvA[i], uEvB[i], uEvB[i].y * 0.4) * 0.6;
    }
    col += groundFx(p.xz, 0.0) * 0.5;
  }
  if (mat > 0) col = mix(col, sky, 1.0 - exp(-gFog * t * t));
  float tmax = mat > 0 ? t : 1e3;
  for (int i = 0; i < MAXEV; i++) {
    if (i >= uEvN || uEvB[i].x > 0.5) continue;
    col += pointGlow(ro, rd, tmax, lp[i], uEvC[i] * 2.5 + 0.3, 0.05 + 0.04 * uEvB[i].z) * evFade(uEvA[i], uEvB[i], uEvB[i].y * 0.4);
  }
  col += uCol2 * uKick * 0.05;
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
  float z = uTravel * 0.6 + 0.35 / max(r, 0.02);
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


/**
 * Night drive down an avenue with street lamps and traffic. Lead notes switch on neon signs on
 * the facades, bass notes send cars down the oncoming lane, pads sweep searchlights over the sky.
 */
export const CITY = HEADER + EVENTS + `
float sdBox(vec3 p, vec3 b) { vec3 q = abs(p) - b; return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0); }
// x: distance, yz: building id, w: roof height (or -1 for a lamp post).
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
  // Lamp posts with a short arm over the street.
  vec3 l = vec3(q.x - 3.55, p.y, mod(p.z, 6.0) - 3.0);
  float post = max(length(l.xz) - 0.035, p.y - 2.5);
  post = min(post, sdBox(l - vec3(-0.13, 2.5, 0.0), vec3(0.15, 0.02, 0.025)));
  if (post < info.x) info = vec4(post, 0.0, 0.0, -1.0);
  return info;
}
// Where a lead note's neon sign hangs: on the street-side facade, below the roof.
vec3 signPos(vec4 a, vec4 b) {
  vec2 id = vec2(floor(a.z / 4.0), b.w);
  float top = 2.0 * (1.5 + pow(hash(id), 2.0) * 9.0) * (0.85 + uModBass * 0.3);
  float y = top > 3.4 ? mix(1.6, top - 1.0, a.y) : top * 0.55;
  return vec3(b.w * 3.98, y, a.z);
}
float carZ(vec4 a) { return a.z - a.w * 9.0; }
vec3 searchBeam(vec3 ro, vec3 rd, float tmax, vec4 a, vec4 b, vec3 ec, float idx) {
  float ang = a.w * 0.7 + idx * 1.7;
  vec3 B = vec3(a.x, 0.0, a.z);
  vec3 D = normalize(vec3(-b.w * 0.25 + sin(ang) * 0.45, 1.0, cos(ang * 0.8) * 0.4));
  vec3 w0 = ro - B;
  float bb = dot(rd, D), d = dot(rd, w0), e = dot(D, w0);
  float den = max(1.0 - bb * bb, 1e-4);
  float tr = (bb * e - d) / den;
  float sb = (e - bb * d) / den;
  if (tr < 0.0 || tr > tmax || sb < 0.0) return vec3(0.0);
  float dist = length(ro + rd * tr - B - D * sb);
  float w = 0.25 + sb * 0.05;
  return ec * exp(-dist * dist / (w * w)) * exp(-sb * 0.04) * 0.5 * exp(-gFog * 0.2 * tr * tr);
}
vec3 lampCol() { return vec3(1.0, 0.72, 0.42) * (0.8 + uKick * 0.6); }
// Every light in the street, seen along a ray. blur > 1 softens them (wet reflections).
vec3 cityLights(vec3 ro, vec3 rd, float tmax, float blur) {
  vec3 c = vec3(0.0);
  float z0 = floor(ro.z / 6.0) * 6.0 + 3.0;
  vec3 lc = lampCol();
  for (int k = -1; k < 9; k++) {
    float z = z0 + float(k) * 6.0;
    c += pointGlow(ro, rd, tmax, vec3(3.3, 2.44, z), lc, 0.09 * blur);
    c += pointGlow(ro, rd, tmax, vec3(-3.3, 2.44, z), lc, 0.09 * blur);
  }
  // Ambient traffic: tail lights pulling away on the right, head lights coming on the left.
  for (int k = 0; k < 7; k++) {
    float off = uTime * 2.5;
    float cell = floor((ro.z - off) / 11.0) + float(k);
    if (hash(vec2(cell, 1.0)) > 0.45) {
      float z = cell * 11.0 + off + hash(vec2(cell, 2.0)) * 4.0;
      vec3 tl = vec3(1.0, 0.06, 0.03) * (1.0 + uSnare);
      c += pointGlow(ro, rd, tmax, vec3(1.0, 0.42, z), tl, 0.06 * blur);
      c += pointGlow(ro, rd, tmax, vec3(1.6, 0.42, z), tl, 0.06 * blur);
    }
    float off2 = -uTime * 7.0;
    float cell2 = floor((ro.z - off2) / 17.0) + float(k);
    if (hash(vec2(cell2, 5.0)) > 0.6) {
      float z = cell2 * 17.0 + off2;
      vec3 hl = vec3(1.0, 0.95, 0.85) * 1.3;
      c += pointGlow(ro, rd, tmax, vec3(-1.0, 0.45, z), hl, 0.07 * blur);
      c += pointGlow(ro, rd, tmax, vec3(-1.6, 0.45, z), hl, 0.07 * blur);
    }
  }
  for (int i = 0; i < MAXEV; i++) {
    if (i >= uEvN) break;
    vec4 a = uEvA[i], b = uEvB[i];
    vec3 ec = uEvC[i];
    if (b.x < 0.5) {
      c += pointGlow(ro, rd, tmax, signPos(a, b) - vec3(b.w * 0.2, 0.0, 0.0), ec, 0.7 * blur) * evFade(a, b, 0.4) * 0.35;
    } else if (b.x < 1.5) {
      float z = carZ(a);
      float f = evFade(a, b, 0.5);
      vec3 hl = vec3(1.0, 0.97, 0.9) * (1.6 + b.z);
      c += pointGlow(ro, rd, tmax, vec3(-1.0, 0.45, z), hl, 0.08 * blur) * f;
      c += pointGlow(ro, rd, tmax, vec3(-1.6, 0.45, z), hl, 0.08 * blur) * f;
      c += pointGlow(ro, rd, tmax, vec3(-1.3, 0.12, z + 0.8), ec * 1.5, 0.5 * blur) * f;
    } else if (blur < 1.5) {
      c += searchBeam(ro, rd, tmax, a, b, ec, float(i)) * evFade(a, b, 1.2);
    }
  }
  return c;
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  gFog = mix(0.0004, 0.003, uModPad);
  float z = uTravel * 2.0;
  vec3 ro = vec3(sin(z * 0.05) * 0.8, 1.1 + uModBass * 1.6 + uBass * 0.15, z);
  vec3 ww = normalize(vec3(sin(z * 0.05 + 0.4) * 0.15, 0.03 + uModLead * 0.08, 1.0));
  vec3 uu = normalize(cross(vec3(0, 1, 0), ww)), vv = cross(ww, uu);
  vec3 rd = normalize(uv.x * uu + uv.y * vv + 1.3 * ww);

  vec3 sky = mix(uCol0 * 0.25, uCol1 * 0.08, clamp(rd.y * 3.0, 0.0, 1.0));
  sky += uCol1 * 0.15 * exp(-max(rd.y, 0.0) * 12.0);
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
  vec3 lc = lampCol();
  if (found) {
    vec3 p = ro + rd * t;
    vec2 e = vec2(0.002, 0.0);
    vec3 n = normalize(vec3(city(p + e.xyy).x - city(p - e.xyy).x, city(p + e.yxy).x - city(p - e.yxy).x, city(p + e.yyx).x - city(p - e.yyx).x));
    float lampZ = mod(p.z, 6.0) - 3.0;
    if (hit.w < 0.0) {
      col = vec3(0.03, 0.03, 0.035) + lc * 0.25 * smoothstep(1.8, 2.5, p.y);
    } else if (p.y < 0.01) {
      float ax = abs(p.x);
      // Road, kerb and pavement; the asphalt is wet and mirrors the lights.
      col = vec3(0.02, 0.02, 0.03);
      if (ax > 3.4) col = vec3(0.05, 0.05, 0.055) * (0.8 + 0.4 * step(0.06, fract(p.z * 1.5)) * step(0.06, fract(ax * 1.5)));
      col += vec3(0.6) * smoothstep(0.08, 0.0, abs(ax - 0.05)) * step(0.5, fract(p.z * 0.25)) * 0.4;
      col += vec3(0.5) * smoothstep(0.05, 0.0, abs(ax - 3.4)) * 0.3;
      col += fogCol * 0.3 * (0.6 + uBass);
      col += lc * 0.4 * exp(-((ax - 3.3) * (ax - 3.3) + lampZ * lampZ) * 0.35);
      for (int i = 0; i < MAXEV; i++) {
        if (i >= uEvN || uEvB[i].x < 0.5 || uEvB[i].x > 1.5) continue;
        float cz = carZ(uEvA[i]);
        float f = evFade(uEvA[i], uEvB[i], 0.5);
        col += vec3(0.9, 0.88, 0.8) * 0.5 * f * exp(-(p.x + 1.3) * (p.x + 1.3) * 1.5 - (p.z - cz + 3.5) * (p.z - cz + 3.5) * 0.12);
        col += uEvC[i] * f * exp(-((p.x + 1.3) * (p.x + 1.3) + (p.z - cz) * (p.z - cz)) * 1.2);
      }
      if (ax < 3.4) {
        vec3 wn = normalize(vec3(noise(p.xz * 8.0) - 0.5, 6.0, noise(p.xz * 8.0 + 3.0) - 0.5));
        col += cityLights(p + vec3(0.0, 0.01, 0.0), reflect(rd, wn), 60.0, 3.0) * 0.45;
      }
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
      col += uCol2 * smoothstep(0.25, 0.0, abs(p.y - hit.w + 0.15)) * (0.4 + uKick * 2.2);
      col += uCol1 * smoothstep(0.05, 0.0, abs(fract(p.y * 0.5) - 0.5) - 0.45) * uSnare * 0.6;
      bool street = abs(n.x) > 0.5 && abs(abs(p.x) - 4.0) < 0.03;
      if (street) {
        // Lamp light washes the lower floors.
        col += lc * 0.3 * exp(-(p.y - 2.2) * (p.y - 2.2) * 0.35 - lampZ * lampZ * 0.25);
        float side = p.x < 0.0 ? -1.0 : 1.0;
        for (int i = 0; i < MAXEV; i++) {
          if (i >= uEvN || uEvB[i].x > 0.5 || uEvB[i].w != side) continue;
          vec4 a = uEvA[i], b = uEvB[i];
          vec3 sp = signPos(a, b);
          vec2 l = vec2(p.z - sp.z, p.y - sp.y);
          vec2 hs = vec2(1.25, 0.32 + 0.18 * b.z);
          vec2 ad = abs(l) - hs;
          float box = max(ad.x, ad.y);
          // Neon tube frame, block letters, and the glow it throws on the wall.
          float tube = smoothstep(0.035, 0.0, abs(box + 0.03));
          vec2 gl = floor((l + hs) * vec2(6.0, 8.0));
          float glyph = step(0.5, hash(gl + float(i) * 7.3 + floor(a.z))) * step(box, -0.08) * step(0.5, fract((l.x + hs.x) * 3.0 + 0.25));
          float flick = a.w < 0.3 ? step(0.45, hash(vec2(floor(a.w * 40.0), float(i)))) : 1.0;
          float fade = evFade(a, b, 0.4) * flick;
          col = mix(col, col * 0.3, step(box, 0.0) * fade);
          col += uEvC[i] * (tube * 3.0 + glyph * 1.8 + 0.5 * exp(-max(box, 0.0) * 4.0)) * fade;
        }
      }
    }
    col = mix(col, fogCol, 1.0 - exp(-gFog * t * t));
  }
  col += cityLights(ro, rd, found ? t : 1e3, 1.0);
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
  float z = uTravel * 1.5;
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
  float t = uTravel * 0.3;
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
    vec2 g = vec2(uv.x * depth, depth + uTravel * 2.0);
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
