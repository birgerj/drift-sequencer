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
float fbm3(vec2 p) {
  float v = 0.0, a = 0.5;
  mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 3; i++) { v += a * noise(p); p = r * p * 2.03; a *= 0.5; }
  return v;
}
// Filmic curve for the realistic scenes; expects linear colour, returns display colour.
vec3 aces(vec3 x) { x = clamp(x * (2.51 * x + 0.03) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); return pow(x, vec3(1.0 / 2.2)); }
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

/**
 * Flying low over forests, lakes and snowy ridges in golden-hour light (or moonlight: uTod).
 * Natural colours with sun shadows and haze; the chord only tints the sky a little.
 * Trees sway on the bar; notes light up the land (see EVENTS).
 */
export const FLYOVER = HEADER + EVENTS + `
uniform vec4 uRing[4];
uniform float uTod;
const float CELL = 1.1;
const float TREE_FAR = 24.0;
const float RING_SPEED = 2.6;
float gMorph, gAmp, gWater, gSnow;
vec3 gSun, gSunCol, gZen, gHor;

float ridge(vec2 p, int n) {
  float v = 0.0, a = 0.55;
  mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 5; i++) { if (i >= n) break; float k = 1.0 - abs(noise(p) * 2.0 - 1.0); v += a * k * k; p = r * p * 2.1; a *= 0.5; }
  return v;
}
float height(vec2 p) {
  return (mix(fbm(p * 0.35) * 2.2, ridge(p * 0.3, 5) * 2.6, gMorph) - 0.3) * gAmp;
}
// Cheaper version for shadow rays; the missing octaves average out to the bias.
float heightLo(vec2 p) {
  return (mix(fbm3(p * 0.35) * 2.2 + 0.12, ridge(p * 0.3, 3) * 2.6 + 0.09, gMorph) - 0.3) * gAmp;
}
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
vec3 skyBase(vec3 rd) {
  float y = max(rd.y, 0.0);
  float sd = max(dot(rd, gSun), 0.0);
  vec3 s = mix(gHor, gZen, pow(smoothstep(0.0, 0.7, y), 0.55));
  s += gSunCol * (pow(sd, 6.0) * 0.08 + pow(sd, 50.0) * 0.2);
  return s * mix(vec3(1.0), 0.75 + uCol1 * 0.8, 0.1);
}
vec3 skyCol(vec3 rd) {
  vec3 s = skyBase(rd);
  float sd = max(dot(rd, gSun), 0.0);
  s += mix(vec3(1.0, 0.6, 0.3) * 6.0, vec3(1.0) * 3.0, uTod) * smoothstep(0.99965, 0.99975, sd) * (1.0 + uKick);
  s += vec3(0.8) * step(0.9975, hash(floor(rd.xy * 400.0))) * smoothstep(0.03, 0.3, rd.y) * uTod;
  if (rd.y > 0.0) {
    // Clouds: dark bellies, sunlit edges; the snare flashes them like distant lightning.
    vec2 cp = rd.xz * (6.0 / (rd.y + 0.05)) + vec2(uTime * 0.3, uTravel);
    float dens = fbm(cp * 0.07);
    float cl = smoothstep(0.5, 0.85, dens);
    float lit = clamp((dens - fbm3(cp * 0.07 + gSun.xz * 0.6)) * 3.0 + 0.5, 0.0, 1.0);
    vec3 cc = mix(gZen * 0.6 + gHor * 0.25, gSunCol * 0.45 + gHor * 0.4, lit * (0.4 + 0.6 * pow(sd, 2.0)));
    cc += vec3(0.75, 0.8, 1.0) * uSnare * 0.8;
    s = mix(s, cc, cl * smoothstep(0.0, 0.25, rd.y) * 0.85);
  }
  return s;
}
// Soft shadow from the sun over the terrain.
float sunShadow(vec3 p) {
  float res = 1.0, t = 0.1;
  for (int i = 0; i < 16; i++) {
    vec3 q = p + gSun * t;
    float h = q.y - heightLo(q.xz);
    res = min(res, 8.0 * h / t);
    if (res < 0.0) break;
    t += clamp(h * 0.8, 0.15, 1.2);
  }
  return smoothstep(0.0, 1.0, res);
}
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
  gWater = mix(0.45, 0.32, gMorph) * gAmp;
  gSnow = mix(1.45, 2.0, gMorph) * gAmp;
  gFog = mix(0.0006, 0.004, uModPad);
  // Low golden sun from the front right, or a cool moon.
  gSun = normalize(mix(vec3(0.6, 0.1, 0.8), vec3(0.4, 0.35, 0.85), uTod));
  gSunCol = mix(vec3(1.0, 0.68, 0.4) * 3.2, vec3(0.55, 0.65, 0.95) * 0.45, uTod);
  gZen = mix(vec3(0.035, 0.11, 0.38), vec3(0.006, 0.012, 0.035), uTod);
  gHor = mix(vec3(0.75, 0.4, 0.18), vec3(0.05, 0.07, 0.12), uTod);
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  float z = uTravel;
  vec3 ro = vec3(sin(z * 0.07) * 3.0, 0.0, z);
  float g0 = height(ro.xz), g1 = height(ro.xz + vec2(0.0, 2.0)), g2 = height(ro.xz + vec2(0.0, 4.0));
  ro.y = max(max(g0, (g0 + g1 + g2) / 3.0), gWater) + 1.2 + 0.2 * sin(z * 0.11);
  vec3 ta = ro + vec3(sin(z * 0.07 + 0.6) * 1.5, -0.25, 3.0);
  vec3 ww = normalize(ta - ro), uu = normalize(cross(vec3(0, 1, 0), ww)), vv = cross(ww, uu);
  float roll = 0.08 * sin(z * 0.05);
  vec3 rd = normalize(uv.x * (uu * cos(roll) + vv * sin(roll)) + uv.y * vv + 1.4 * ww);

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

  vec3 lp[MAXEV];
  for (int i = 0; i < MAXEV; i++) {
    lp[i] = vec3(0.0);
    if (i >= uEvN || uEvB[i].x > 0.5) continue;
    vec4 a = uEvA[i];
    float gh = max(height(a.xz), gWater);
    lp[i] = vec3(a.x + sin(a.w * 2.0 + float(i)) * 0.15, gh + 0.5 + a.w * 0.6 + a.y * 0.5, a.z);
  }

  vec3 col = skyCol(rd);
  vec3 skyAmb = mix(gZen, gHor, 0.35) * 0.9;
  vec3 p = ro + rd * t;
  if (mat == 3) {
    vec2 e = vec2(0.01, 0.0), dc; float dth;
    vec3 n = normalize(vec3(
      treeAt(p + e.xyy, tgh, dc, dth) - treeAt(p - e.xyy, tgh, dc, dth),
      treeAt(p + e.yxy, tgh, dc, dth) - treeAt(p - e.yxy, tgh, dc, dth),
      treeAt(p + e.yyx, tgh, dc, dth) - treeAt(p - e.yyx, tgh, dc, dth)));
    float k = clamp((p.y - tgh) / tth, 0.0, 1.0);
    vec3 alb = mix(vec3(0.012, 0.03, 0.015), vec3(0.04, 0.085, 0.035), k) * (0.75 + 0.5 * hash(tc));
    float sh = sunShadow(p + vec3(0.0, 0.05, 0.0));
    float dif = clamp(dot(n, gSun) * 0.8 + 0.2, 0.0, 1.0);
    // Light through the needles when the sun is behind the tree.
    float trans = pow(max(dot(rd, gSun), 0.0), 4.0) * 0.6;
    col = alb * (gSunCol * (dif + trans) * sh + skyAmb * (0.4 + 0.6 * k));
    col += groundFx(tc, 1.0) * (0.4 + 0.6 * k);
    col += gSunCol * step(0.96, hash(floor(p.xz * 22.0 + p.y * 9.0) + floor(uTime * 12.0))) * uHat * 0.15;
  } else if (mat == 1) {
    vec2 e = vec2(0.02, 0.0);
    vec3 n = normalize(vec3(height(p.xz - e.xy) - height(p.xz + e.xy), 2.0 * e.x, height(p.xz - e.yx) - height(p.xz + e.yx)));
    float slope = 1.0 - n.y;
    float grain = noise(p.xz * 6.0);
    float patchy = fbm3(p.xz * 0.6);
    vec3 grass = mix(vec3(0.05, 0.13, 0.03), vec3(0.17, 0.21, 0.05), smoothstep(0.3, 0.7, patchy + grain * 0.2));
    vec3 dry = vec3(0.28, 0.22, 0.13);
    vec3 rock = vec3(0.22, 0.2, 0.18) * (0.7 + 0.5 * noise(p.xz * 3.0 + p.y));
    rock *= 0.8 + 0.25 * smoothstep(-0.3, 0.3, sin(p.y * 9.0 + noise(p.xz * 0.7) * 5.0));
    vec3 snow = vec3(0.62, 0.64, 0.68);
    vec3 alb = mix(grass, dry, smoothstep(0.15, 0.3, slope + grain * 0.1));
    alb = mix(alb, rock, smoothstep(0.28, 0.48, slope + grain * 0.15));
    float snowAmt = smoothstep(gSnow - 0.1, gSnow + 0.1, p.y + grain * 0.15) * smoothstep(0.65, 0.4, slope);
    alb = mix(alb, snow, snowAmt);
    alb *= mix(1.0, 0.45, smoothstep(0.42, 0.62, forestAt(p.xz)) * step(gWater + 0.05, p.y) * step(p.y, gSnow - 0.2));
    alb = mix(vec3(0.32, 0.28, 0.2), alb, smoothstep(gWater, gWater + 0.06, p.y));
    float sh = sunShadow(p + n * 0.02);
    float dif = clamp(dot(n, gSun), 0.0, 1.0);
    // Shaded snow and grass pick up the blue of the sky.
    vec3 amb = skyAmb * (0.45 + 0.55 * n.y) * (1.0 + snowAmt * 0.6);
    col = alb * (gSunCol * dif * sh + amb + gHor * 0.08 * clamp(-n.y + 0.5, 0.0, 1.0));
    col += groundFx(p.xz, 0.0);
  } else if (mat == 2) {
    vec2 w = p.xz;
    vec3 n = vec3(0.0, 1.0, 0.0);
    n.xz += 0.025 * vec2(sin(w.x * 3.0 + uTime * 1.5 + sin(w.y * 2.0)), sin(w.y * 3.4 - uTime * 1.2));
    n.xz += 0.02 * (vec2(noise(w * 6.0 + uTime), noise(w * 6.0 - uTime + 4.0)) - 0.5);
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
    float fres = 0.02 + 0.98 * pow(1.0 - max(dot(-rd, n), 0.0), 5.0);
    vec3 deep = vec3(0.01, 0.03, 0.035) * (1.0 - 0.8 * uTod);
    col = mix(deep * sunShadow(p + vec3(0.0, 0.02, 0.0)), skyCol(rr), fres);
    for (int i = 0; i < MAXEV; i++) {
      if (i >= uEvN || uEvB[i].x > 0.5) continue;
      col += pointGlow(p, rr, 40.0, lp[i], uEvC[i] * 2.0, 0.12) * evFade(uEvA[i], uEvB[i], uEvB[i].y * 0.4) * 0.6;
    }
    col += groundFx(p.xz, 0.0) * 0.5;
  }
  if (mat > 0) {
    // Aerial perspective: distance fades into the colour of the horizon.
    vec3 haze = skyBase(normalize(vec3(rd.x, 0.04, rd.z)));
    col = mix(col, haze, 1.0 - exp(-(0.008 * t + gFog * t * t)));
  }
  float tmax = mat > 0 ? t : 1e3;
  for (int i = 0; i < MAXEV; i++) {
    if (i >= uEvN || uEvB[i].x > 0.5) continue;
    col += pointGlow(ro, rd, tmax, lp[i], uEvC[i] * 2.5 + 0.3, 0.05 + 0.04 * uEvB[i].z) * evFade(uEvA[i], uEvB[i], uEvB[i].y * 0.4);
  }
  col += gSunCol * uKick * 0.02;
  col = aces(col * 0.95);
  col *= 1.0 - 0.25 * dot(uv, uv);
  outColor = vec4(col, 1.0);
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
uniform float uTod;
vec3 gZen, gHor;
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
vec3 citySky(vec3 rd) {
  float y = max(rd.y, 0.0);
  vec3 s = mix(gHor, gZen, pow(smoothstep(0.0, 0.5, y), 0.6));
  s += vec3(0.8) * step(0.997, hash(floor(rd.xy * 300.0))) * smoothstep(0.05, 0.3, rd.y) * uTod;
  return s * mix(vec3(1.0), 0.75 + uCol1 * 0.8, 0.12);
}
// What a facade mirrors: the dark street canyon, and the sky only when looking up.
vec3 canyonRefl(vec3 rr) {
  vec3 opp = vec3(0.012, 0.012, 0.016) + vec3(1.0, 0.75, 0.45) * 0.08 * step(0.85, hash(floor(rr.xy * vec2(40.0, 30.0))));
  return mix(opp, citySky(rr) * 0.6, smoothstep(0.25, 0.7, rr.y));
}
// Facade of a building: concrete, brick or glass, with lit and dark windows.
vec3 facade(vec3 p, vec3 n, vec3 rd, vec4 hit) {
  vec2 f = abs(n.x) > 0.5 ? p.zy : p.xy;
  float m = hash(hit.yz + 5.0);
  vec2 w, lo, hi;
  vec3 wall;
  if (m < 0.4) {
    w = f * vec2(2.2, 2.8); lo = vec2(0.18, 0.22); hi = vec2(0.82, 0.78);
    wall = vec3(0.3, 0.29, 0.27) * (0.85 + 0.15 * noise(f * 3.0));
    wall *= 1.0 - 0.25 * smoothstep(0.03, 0.0, abs(fract(f.y * 1.4) - 0.5) - 0.47);
  } else if (m < 0.72) {
    w = f * vec2(2.6, 2.6); lo = vec2(0.3, 0.25); hi = vec2(0.7, 0.8);
    vec2 b = f * vec2(8.0, 20.0);
    b.x += 0.5 * step(1.0, mod(floor(b.y), 2.0));
    float mortar = smoothstep(0.08, 0.0, min(fract(b.x), fract(b.y)));
    wall = mix(vec3(0.28, 0.1, 0.06), vec3(0.2, 0.08, 0.05), hash(floor(b))) ;
    wall = mix(wall, vec3(0.25, 0.24, 0.22), mortar * 0.7);
  } else {
    w = f * vec2(1.5, 2.8); lo = vec2(0.04, 0.06); hi = vec2(0.96, 0.94);
    vec3 rr = reflect(rd, n);
    wall = canyonRefl(rr) * (0.15 + 0.45 * pow(1.0 - max(dot(-rd, n), 0.0), 3.0)) + vec3(0.006, 0.01, 0.018);
  }
  vec2 cell = floor(w);
  vec2 g = fract(w);
  float win = step(lo.x, g.x) * step(g.x, hi.x) * step(lo.y, g.y) * step(g.y, hi.y);
  float h1 = hash(cell + hit.yz * 13.0), h2 = hash(cell + 3.1 + hit.yz);
  float lit = step(h1, mix(0.2, 0.36, uTod) + uLead * 0.2 + uEnergy * 0.05);
  vec3 lc = h2 < 0.55 ? vec3(1.0, 0.6, 0.3) : h2 < 0.85 ? vec3(1.0, 0.82, 0.6) : vec3(0.65, 0.78, 1.0);
  // Some rooms flicker blue with a TV.
  if (hash(cell + 9.7) > 0.97) lc = vec3(0.4, 0.55, 1.0) * (0.6 + 0.4 * noise(vec2(uTime * 6.0, h1 * 50.0)));
  float inside = (0.55 + 0.6 * g.y) * (0.8 + 0.4 * hash(cell + 1.7)) * (1.0 + 1.4 * uLead * hash(cell + uBeat));
  vec3 dark = canyonRefl(reflect(rd, n)) * 0.3 + vec3(0.004);
  vec3 glass = mix(dark, lc * 0.75 * inside, lit);
  vec3 amb = gZen * 1.4 + gHor * 0.25;
  return mix(m < 0.72 ? wall * amb : wall, glass, win);
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
  gFog = mix(0.0002, 0.0015, uModPad);
  // Blue hour, or deep night with the orange glow of the city on the horizon.
  gZen = mix(vec3(0.025, 0.06, 0.19), vec3(0.004, 0.007, 0.02), uTod);
  gHor = mix(vec3(0.32, 0.2, 0.2), vec3(0.09, 0.055, 0.035), uTod);
  float z = uTravel * 2.0;
  vec3 ro = vec3(sin(z * 0.05) * 0.8, 1.1 + uModBass * 1.6 + uBass * 0.15, z);
  vec3 ww = normalize(vec3(sin(z * 0.05 + 0.4) * 0.15, 0.03 + uModLead * 0.08, 1.0));
  vec3 uu = normalize(cross(vec3(0, 1, 0), ww)), vv = cross(ww, uu);
  vec3 rd = normalize(uv.x * uu + uv.y * vv + 1.3 * ww);

  vec3 sky = citySky(rd);
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
  vec3 fogCol = mix(gHor, gZen, 0.45) * (0.7 + 0.3 * uPad);
  vec3 col = sky;
  vec3 lc = lampCol();
  if (found) {
    vec3 p = ro + rd * t;
    vec2 e = vec2(0.002, 0.0);
    vec3 n = normalize(vec3(city(p + e.xyy).x - city(p - e.xyy).x, city(p + e.yxy).x - city(p - e.yxy).x, city(p + e.yyx).x - city(p - e.yyx).x));
    float lampZ = mod(p.z, 6.0) - 3.0;
    if (hit.w < 0.0) {
      col = vec3(0.03, 0.03, 0.035) + lc * 0.25 * smoothstep(1.8, 2.5, p.y);
    } else if (p.y < 0.02 + 0.002 * t) {
      float ax = abs(p.x);
      // Road, kerb and pavement; the asphalt is wet and mirrors the lights.
      vec3 amb = gZen * 1.2 + gHor * 0.3;
      vec3 alb = vec3(0.05, 0.05, 0.055) * (0.7 + 0.6 * noise(p.xz * 30.0));
      if (ax > 3.4) alb = vec3(0.16, 0.155, 0.15) * (0.7 + 0.3 * step(0.05, fract(p.z * 1.5)) * step(0.05, fract(ax * 1.5)));
      alb += vec3(0.25, 0.24, 0.2) * smoothstep(0.06, 0.0, abs(ax - 0.06)) * step(0.5, fract(p.z * 0.25));
      alb += vec3(0.2) * smoothstep(0.05, 0.0, abs(ax - 3.4));
      col = alb * amb * 1.5 + fogCol * 0.08 * uBass;
      col += lc * 0.4 * exp(-((ax - 3.3) * (ax - 3.3) + lampZ * lampZ) * 0.35);
      for (int i = 0; i < MAXEV; i++) {
        if (i >= uEvN || uEvB[i].x < 0.5 || uEvB[i].x > 1.5) continue;
        float cz = carZ(uEvA[i]);
        float f = evFade(uEvA[i], uEvB[i], 0.5);
        col += vec3(0.9, 0.88, 0.8) * 0.5 * f * exp(-(p.x + 1.3) * (p.x + 1.3) * 1.5 - (p.z - cz + 3.5) * (p.z - cz + 3.5) * 0.12);
        col += uEvC[i] * f * exp(-((p.x + 1.3) * (p.x + 1.3) + (p.z - cz) * (p.z - cz)) * 1.2);
      }
      if (ax < 3.4) {
        // Wet asphalt with puddles: rough reflections everywhere, sharp ones in the puddles.
        float puddle = smoothstep(0.55, 0.62, fbm3(p.xz * 0.5));
        vec3 wn = normalize(vec3(noise(p.xz * 8.0) - 0.5, mix(6.0, 60.0, puddle), noise(p.xz * 8.0 + 3.0) - 0.5));
        vec3 rr = reflect(rd, wn);
        float fres = 0.04 + 0.96 * pow(1.0 - max(rr.y, 0.0), 5.0);
        col *= 1.0 - 0.6 * puddle;
        col += citySky(rr) * smoothstep(0.15, 0.5, rr.y) * fres * 0.6 * puddle;
        col += cityLights(p + vec3(0.0, 0.01, 0.0), rr, 60.0, mix(3.0, 1.0, puddle)) * mix(0.4, 0.8, puddle);
      }
    } else {
      col = facade(p, n, rd, hit);
      // Neon on some rooftops, pulsing with the kick in the chord colour.
      col += uCol2 * smoothstep(0.2, 0.0, abs(p.y - hit.w + 0.15)) * (0.25 + uKick * 2.0) * step(0.6, hash(hit.yz + 11.0));
      col += uCol1 * smoothstep(0.05, 0.0, abs(fract(p.y * 0.5) - 0.5) - 0.45) * uSnare * 0.25;
      bool street = abs(n.x) > 0.5 && abs(abs(p.x) - 4.0) < 0.03;
      if (street) {
        // Lamp light washes the lower floors.
        col += lc * 0.06 * exp(-(p.y - 2.0) * (p.y - 2.0) * 1.2 - lampZ * lampZ * 0.5);
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
  col = aces(col * 1.0);
  col *= 1.0 - 0.25 * dot(uv, uv);
  outColor = vec4(col, 1.0);
}
`;

/**
 * Flying along a rocky coast: swell rolling in, cliffs with grass, a lighthouse, clouds and a
 * distant rain shower. uTod picks the time of day (0 dusk, 1 night).
 * Lead notes are boats lighting up at sea and tint the lighthouse; bass notes are waves crashing
 * against the cliffs; pads are sun (or moon) rays breaking through onto the water.
 */
export const COAST = HEADER + EVENTS + `
uniform float uTod;
uniform vec3 uLeadCol;
float gSwell;
vec3 gSun, gSunCol, gLH[2];

float coastX(float z) { return 2.5 * sin(z * 0.045) + 1.2 * sin(z * 0.13 + 1.0); }
float shoreX(float z) { return coastX(z) + 1.4 * noise(vec2(z * 0.3, 3.0)); }
// Cliffs on the right, boulders at their foot, the sea floor to the left.
float land(vec2 p) {
  float d = p.x - shoreX(p.y);
  if (d < -3.2) return -3.0;
  float top = 2.4 + 2.2 * noise(vec2(p.y * 0.05, 7.0)) + smoothstep(0.0, 8.0, d) * 1.5 * fbm3(p * 0.15);
  float cliff = smoothstep(-0.4, 0.9, d + 0.6 * (noise(p * 2.5) - 0.5));
  float h = mix(-1.2, top, cliff);
  h += (fbm3(p * vec2(1.2, 2.2)) - 0.5) * 0.7 * (1.0 - abs(cliff * 2.0 - 1.0));
  float rocks = max(0.0, noise(p * 1.7) - 0.5) * 3.2 * smoothstep(-3.2, -1.2, d) * smoothstep(0.6, -0.4, d);
  return max(h, -1.2 + rocks);
}
// Swell rolling in towards the cliffs: sharp crests, wide troughs.
float sea(vec2 p) {
  float h = 0.0, a = 1.0, f = 0.28;
  vec2 dir = normalize(vec2(1.0, 0.35));
  for (int i = 0; i < 4; i++) {
    float x = dot(p, dir) * f - uTime * (0.9 + f * 1.2) + noise(p * f * 0.5 + float(i) * 3.1) * 1.6;
    float s = 0.5 + 0.5 * sin(x);
    h += a * (pow(s, 2.2) - 0.35);
    dir = mat2(0.8, 0.6, -0.6, 0.8) * dir;
    f *= 1.9;
    a *= 0.42;
  }
  return h * gSwell + (noise(p * 3.0 + uTime * 0.5) - 0.5) * 0.04;
}
float tower(vec3 p) {
  float d = 1e3;
  for (int i = 0; i < 2; i++) {
    vec3 q = p - gLH[i];
    float r = mix(0.3, 0.19, clamp(q.y / 2.3, 0.0, 1.0));
    float body = max(length(q.xz) - r, max(-q.y - 1.0, q.y - 2.3));
    float room = max(length(q.xz) - 0.21, abs(q.y - 2.45) - 0.15);
    float cap = max((length(q.xz) - 0.27 * (1.0 - clamp((q.y - 2.6) / 0.3, 0.0, 1.0))) * 0.8, abs(q.y - 2.75) - 0.15);
    d = min(d, min(body, min(room, cap)));
  }
  return d;
}
vec3 skyBase(vec3 rd) {
  float y = max(rd.y, 0.0);
  vec3 dusk = mix(vec3(0.85, 0.42, 0.22), vec3(0.3, 0.25, 0.4), smoothstep(0.0, 0.2, y));
  dusk = mix(dusk, vec3(0.05, 0.08, 0.2), smoothstep(0.2, 0.7, y));
  vec3 night = mix(vec3(0.05, 0.07, 0.12), vec3(0.004, 0.008, 0.025), smoothstep(0.0, 0.5, y));
  vec3 s = mix(dusk, night, uTod);
  s = mix(s, s * (0.6 + uCol1 * 1.2), 0.3);
  float sd = max(dot(rd, gSun), 0.0);
  s += gSunCol * (pow(sd, 12.0) * 0.3 + pow(sd, 90.0) * 0.6) * (1.0 + 0.3 * uPad);
  return s;
}
// Angle of the rain shower out at sea.
float rainBand(vec3 rd) {
  float a = atan(rd.x, rd.z);
  return smoothstep(0.22, 0.0, abs(a + 0.75 + 0.15 * sin(uTime * 0.02)));
}
vec3 skyCol(vec3 rd) {
  vec3 s = skyBase(rd);
  float sd = max(dot(rd, gSun), 0.0);
  float disc = smoothstep(mix(0.99955, 0.99962, uTod), mix(0.9997, 0.99975, uTod), sd);
  s += mix(vec3(1.0, 0.45, 0.18) * 3.0, vec3(1.0, 0.97, 0.9) * 1.6, uTod) * disc * smoothstep(-0.01, 0.01, rd.y);
  s += vec3(0.9) * step(0.9975, hash(floor(rd.xy * 400.0))) * smoothstep(0.03, 0.25, rd.y) * uTod;
  if (rd.y > 0.0) {
    vec2 cp = rd.xz * (8.0 / (rd.y + 0.04)) + vec2(uTime * 0.25, uTravel * 1.5);
    float cl = smoothstep(0.42, 0.78, fbm(cp * 0.06));
    float edge = pow(sd, 4.0);
    vec3 cc = mix(vec3(0.16, 0.12, 0.17), vec3(0.03, 0.035, 0.05), uTod) + gSunCol * edge * 0.9;
    float storm = rainBand(rd);
    cc = mix(cc, cc * 0.5, storm) + vec3(0.8, 0.85, 1.0) * uSnare * storm * 1.5;
    s = mix(s, cc, cl * smoothstep(0.0, 0.2, rd.y) * 0.9);
  }
  return s;
}
// The lighthouse beam turns once per bar; the lead tints and brightens it.
vec3 beamCol() { return mix(vec3(1.0, 0.9, 0.7), uLeadCol, 0.6 * uLead) * (0.6 + 1.2 * uLead + 0.6 * uTod); }
vec3 lighthouseLight(vec3 ro, vec3 rd, float tmax) {
  vec3 c = vec3(0.0);
  float ang = uBarPhase * 6.28318;
  vec3 D = normalize(vec3(cos(ang), -0.03, sin(ang)));
  vec3 bc = beamCol();
  for (int i = 0; i < 2; i++) {
    vec3 L = gLH[i] + vec3(0.0, 2.45, 0.0);
    vec3 w0 = ro - L;
    float bb = dot(rd, D), d = dot(rd, w0), e = dot(D, w0);
    float den = max(1.0 - bb * bb, 1e-4);
    float tr = (bb * e - d) / den;
    float sb = (e - bb * d) / den;
    if (tr > 0.0 && tr < tmax) {
      float dist = length(ro + rd * tr - L - D * sb);
      float w = 0.12 + abs(sb) * 0.06;
      c += bc * exp(-dist * dist / (w * w)) * exp(-abs(sb) * 0.06) * 0.35 * exp(-gFog * 0.3 * tr * tr);
    }
    // The lamp flares when the beam swings towards us.
    float facing = pow(max(abs(dot(D, normalize(ro - L))), 0.0), 12.0);
    c += pointGlow(ro, rd, tmax + 0.3, L, bc * (0.6 + 4.0 * facing), 0.12 + 0.25 * facing);
  }
  return c;
}
// Note effects in the air: boat lights, crashing spray, rays of light.
vec3 noteLights(vec3 ro, vec3 rd, float tmax, float refl) {
  vec3 c = vec3(0.0);
  for (int i = 0; i < MAXEV; i++) {
    if (i >= uEvN) break;
    vec4 a = uEvA[i], b = uEvB[i];
    vec3 ec = uEvC[i];
    if (b.x < 0.5) {
      float f = evFade(a, b, b.y * 0.7);
      vec3 boat = vec3(a.x, 0.35 + 0.5 * a.y + 0.05 * sin(uTime * 1.3 + float(i)), a.z);
      c += pointGlow(ro, rd, tmax, boat, ec * 2.5 + 0.4, 0.09 + 0.06 * b.z + 0.1 * refl) * (0.25 + f);
      c += pointGlow(ro, rd, tmax, boat - vec3(0.25, 0.25, 0.0), vec3(1.0, 0.8, 0.5), 0.04 + 0.1 * refl) * 0.5;
    } else if (b.x < 1.5) {
      if (refl > 0.5) continue;
      float sx = shoreX(a.z) - 0.4;
      vec2 o = ro.xz - vec2(sx, a.z);
      float tp = -dot(o, rd.xz) / max(dot(rd.xz, rd.xz), 1e-5);
      if (tp < 0.0 || tp > tmax) continue;
      vec3 q = ro + rd * tp;
      float r = length(q.xz - vec2(sx, a.z));
      float age = a.w;
      float H = 3.2 * (0.6 + 0.6 * b.z) * smoothstep(0.0, 0.5, age);
      float fall = smoothstep(0.6, 2.4, age);
      float w = 0.35 + 0.18 * clamp(q.y, 0.0, 4.0) + fall * 0.9;
      float shape = exp(-r * r / (w * w)) * smoothstep(H, H * 0.3, q.y) * smoothstep(-0.3, 0.1, q.y);
      float tex = noise(vec2(r * 3.0 + q.y * 2.0, q.y * 3.0 - age * 4.0) + float(i));
      float dens = shape * (0.4 + 0.9 * tex) * (1.0 - fall * 0.85) * evFade(a, b, 0.8);
      c += (mix(vec3(0.9, 0.93, 1.0), ec, 0.25) * mix(1.0, 0.35, uTod) + gSunCol * 0.3) * dens * exp(-gFog * tp * tp);
    } else if (refl < 0.5) {
      vec3 B = vec3(a.x, 0.0, a.z);
      vec3 D = normalize(gSun * vec3(1.0, 0.0, 1.0) * 0.5 + vec3(0.0, 1.0, 0.0));
      vec3 w0 = ro - B;
      float bb = dot(rd, D), d = dot(rd, w0), e = dot(D, w0);
      float den = max(1.0 - bb * bb, 1e-4);
      float tr = (bb * e - d) / den;
      float sb = (e - bb * d) / den;
      if (tr < 0.0 || tr > tmax || sb < 0.0) continue;
      float dist = length(ro + rd * tr - B - D * sb);
      float w = 0.6 + sb * 0.12;
      float f = evFade(a, b, 1.5) * smoothstep(0.0, 1.0, a.w);
      c += mix(gSunCol, ec, 0.4) * exp(-dist * dist / (w * w)) * smoothstep(9.0, 2.0, sb) * f * 0.3;
    }
  }
  return c;
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  gSwell = 0.35 + 0.35 * uModBass + 0.12 * uKick;
  gSun = normalize(mix(vec3(-0.3, 0.015, 0.95), vec3(-0.3, 0.3, 0.9), uTod));
  gSunCol = mix(vec3(1.0, 0.55, 0.28) * 1.6, vec3(0.55, 0.65, 0.9) * 0.5, uTod);
  gFog = mix(0.0004, 0.003, uModPad);
  float z = uTravel * 1.5;
  vec3 ro = vec3(coastX(z) - 6.5, 1.5 + 0.25 * sin(z * 0.1) + uModBass * 0.4, z);
  vec3 ww = normalize(vec3(0.12 + 0.05 * sin(z * 0.03), -0.07, 1.0));
  vec3 uu = normalize(cross(vec3(0, 1, 0), ww)), vv = cross(ww, uu);
  vec3 rd = normalize(uv.x * uu + uv.y * vv + 1.35 * ww);
  for (int i = 0; i < 2; i++) {
    float lz = (floor(z / 45.0) + float(i) + 0.5) * 45.0;
    float lx = shoreX(lz) + 2.6;
    gLH[i] = vec3(lx, land(vec2(lx, lz)) - 0.05, lz);
  }

  // 0 sky, 1 land, 2 sea, 3 lighthouse
  int mat = 0;
  float t = 0.05;
  for (int i = 0; i < 130; i++) {
    vec3 p = ro + rd * t;
    float lh = land(p.xz), sh = sea(p.xz);
    float h = p.y - max(lh, sh);
    float dt = tower(p);
    if (dt < 0.002 * t) { mat = 3; break; }
    if (h < 0.002 * t) { mat = lh > sh ? 1 : 2; break; }
    t += max(min(h * 0.4, dt * 0.8), 0.01);
    if (t > 50.0) break;
  }
  bool far = false;
  if (mat == 0 && rd.y < 0.0) { t = -ro.y / rd.y; mat = 2; far = true; }

  vec3 haze = skyBase(normalize(vec3(rd.x, 0.02, rd.z)));
  vec3 col = skyCol(rd);
  vec3 p = ro + rd * t;
  vec3 amb = mix(vec3(0.25, 0.22, 0.3), vec3(0.04, 0.05, 0.09), uTod);
  if (mat == 1) {
    vec2 e = vec2(0.02, 0.0);
    vec3 n = normalize(vec3(land(p.xz - e.xy) - land(p.xz + e.xy), 2.0 * e.x, land(p.xz - e.yx) - land(p.xz + e.yx)));
    vec3 rock = vec3(0.15, 0.13, 0.12) * (0.6 + 0.7 * noise(p.xz * 4.0 + p.y * 3.0));
    // Layers in the rock, and darker wet stone near the water.
    rock *= 0.75 + 0.3 * smoothstep(-0.3, 0.3, sin(p.y * 7.0 + noise(p.xz * 0.8) * 4.0));
    // Grass on top ripples in the wind, twice per bar.
    float wind = 0.8 + 0.35 * sin(dot(p.xz, vec2(0.6, 0.3)) * 2.0 - uBarPhase * 12.566) * noise(p.xz * 1.5);
    vec3 grass = mix(vec3(0.05, 0.1, 0.04), vec3(0.11, 0.15, 0.06), noise(p.xz * 5.0)) * wind;
    vec3 alb = mix(rock, grass, smoothstep(0.65, 0.85, n.y) * smoothstep(0.8, 1.6, p.y));
    alb *= mix(0.45, 1.0, smoothstep(0.0, 0.6, p.y));
    col = alb * (amb * (0.5 + 0.5 * n.y) * 1.6 + gSunCol * clamp(dot(n, gSun) + 0.1, 0.0, 1.0));
    for (int i = 0; i < 2; i++) col += beamCol() * 0.15 * exp(-length(p - gLH[i] - vec3(0.0, 2.4, 0.0)) * 0.8);
  } else if (mat == 3) {
    vec3 q = p;
    float best = 1e3;
    for (int i = 0; i < 2; i++) { float dd = length(p.xz - gLH[i].xz); if (dd < best) { best = dd; q = p - gLH[i]; } }
    vec2 e = vec2(0.005, 0.0);
    vec3 n = normalize(vec3(tower(p + e.xyy) - tower(p - e.xyy), tower(p + e.yxy) - tower(p - e.yxy), tower(p + e.yyx) - tower(p - e.yyx)));
    vec3 alb = mix(vec3(0.75, 0.73, 0.7), vec3(0.6, 0.08, 0.06), step(0.5, fract(q.y * 1.4)));
    col = alb * (amb * 1.5 + gSunCol * clamp(dot(n, gSun) + 0.2, 0.0, 1.0));
    col = mix(col, beamCol() * 2.0, step(2.3, q.y) * step(q.y, 2.6));
  } else if (mat == 2) {
    float ex = 0.02 + t * 0.003;
    vec3 n = vec3(0.0, 1.0, 0.0);
    if (!far) {
      float s0 = sea(p.xz);
      n = normalize(vec3(s0 - sea(p.xz + vec2(ex, 0.0)), ex, s0 - sea(p.xz + vec2(0.0, ex))));
      n = normalize(mix(n, vec3(0.0, 1.0, 0.0), smoothstep(15.0, 50.0, t)));
    }
    vec3 rr = reflect(rd, n);
    rr.y = abs(rr.y);
    float fres = 0.02 + 0.98 * pow(1.0 - max(dot(-rd, n), 0.0), 5.0);
    vec3 deep = mix(vec3(0.006, 0.035, 0.05), vec3(0.002, 0.006, 0.014), uTod);
    float crest = far ? 0.0 : clamp(p.y / max(gSwell, 0.05) + 0.3, 0.0, 1.5);
    vec3 sss = vec3(0.05, 0.25, 0.22) * (1.0 - 0.75 * uTod) * crest * (0.3 + 0.7 * pow(max(dot(rd, gSun), 0.0), 2.0));
    col = mix(deep + sss * 0.5, skyCol(rr), fres);
    col += gSunCol * pow(max(dot(rr, gSun), 0.0), 300.0) * 6.0;
    // Foam: on crests, along the shore, and where waves crash.
    float foam = smoothstep(0.75, 1.1, crest + 0.3 * noise(p.xz * 4.0));
    float lh = land(p.xz);
    foam += smoothstep(-0.9, -0.1, lh) * (0.55 + 0.45 * sin(uTime * 1.6 + p.z * 0.7 + noise(p.xz * 2.0) * 4.0));
    for (int i = 0; i < MAXEV; i++) {
      if (i >= uEvN || uEvB[i].x < 0.5 || uEvB[i].x > 1.5) continue;
      float d = length(p.xz - vec2(shoreX(uEvA[i].z) - 0.4, uEvA[i].z));
      foam += smoothstep(1.0 + uEvA[i].w * 1.6, 0.0, d) * evFade(uEvA[i], uEvB[i], 1.2) * 1.2;
    }
    foam *= 0.4 + 0.6 * noise(p.xz * 7.0 + uTime * 0.3);
    col = mix(col, (amb * 1.5 + gSunCol * 0.6) * 0.9, clamp(foam, 0.0, 1.0) * (1.0 - smoothstep(20.0, 45.0, t)));
    for (int i = 0; i < MAXEV; i++) {
      if (i >= uEvN || uEvB[i].x < 1.5) continue;
      col += mix(gSunCol, uEvC[i], 0.4) * 0.25 * exp(-length(p.xz - uEvA[i].xz) * 0.6) * evFade(uEvA[i], uEvB[i], 1.5);
    }
    col += noteLights(p, rr, 40.0, 1.0) * 0.6;
    col += gSunCol * step(0.99, hash(floor(p.xz * 25.0) + floor(uTime * 8.0))) * pow(max(dot(rr, gSun), 0.0), 20.0) * uHat * (1.0 - smoothstep(10.0, 30.0, t));
  }
  if (mat > 0) {
    col = mix(col, haze, 1.0 - exp(-gFog * t * t));
    // The rain shower greys out the distance in its direction.
    float rain = rainBand(rd) * smoothstep(15.0, 40.0, t) * (0.6 + 0.4 * noise(vec2(atan(rd.x, rd.z) * 150.0, uTime * 6.0)));
    col = mix(col, haze * 0.6, rain * 0.6);
  }
  float tmax = mat > 0 ? t : 1e3;
  col += lighthouseLight(ro, rd, tmax);
  col += noteLights(ro, rd, tmax, 0.0);
  col += gSunCol * uKick * 0.03;
  col = tonemap(col * 1.6);
  col *= 1.0 - 0.3 * dot(uv, uv);
  outColor = vec4(pow(col, vec3(0.9)), 1.0);
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
  { id: 'coast', name: 'Coast', source: COAST },
  { id: 'synthwave', name: 'Synthwave', source: SYNTHWAVE },
  { id: 'warp', name: 'Warp', source: WARP },
  { id: 'tunnel', name: 'Tunnel', source: TUNNEL },
  { id: 'kaleido', name: 'Kaleido', source: KALEIDO },
  { id: 'pulse', name: 'Pulse', source: null },
] as const;
