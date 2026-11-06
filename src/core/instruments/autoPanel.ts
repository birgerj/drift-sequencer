import { widgetParams, type InstrumentDefinition, type InstrumentParam, type PanelModule, type PanelWidget } from './instrument';

/**
 * A panel for any instrument, built from its CC list: the same kinds of
 * controls the built-in synths have by hand. Stepped values become
 * switches, cutoff + resonance a filter pad, A/D/S/R an envelope graph,
 * levels faders, the rest knobs. Pure, so it runs at display time and
 * already-imported definitions get it too.
 */
export function withAutoPanel(def: InstrumentDefinition): InstrumentDefinition {
  if (def.panel?.length) return def;
  const params = def.params.map(enrichParam);
  return { ...def, params, panel: mergeSmallGroups(autoPanel(params)) };
}

/**
 * Big synths show one group (section) at a time. Sections with only a few
 * controls share a tab ("Amp · Arp · Noise") so the tab row stays short.
 */
function mergeSmallGroups(modules: PanelModule[], small = 8, max = 16): PanelModule[] {
  const count = new Map<string, number>();
  for (const m of modules) count.set(m.group ?? '', (count.get(m.group ?? '') ?? 0) + m.widgets.reduce((n, w) => n + widgetParams(w).length, 0));
  const rename = new Map<string, string>();
  let bin: string[] = [];
  let size = 0;
  const flush = () => {
    if (bin.length > 1) for (const g of bin) rename.set(g, bin.join(' · '));
    bin = [];
    size = 0;
  };
  for (const [g, n] of count) {
    if (n >= small) continue;
    if (size + n > max) flush();
    bin.push(g);
    size += n;
  }
  flush();
  return modules.map((m) => (m.group && rename.has(m.group) ? { ...m, group: rename.get(m.group)! } : m));
}

/** Plain 7-bit CCs, without the channel-mode messages (120–127). */
function panelParam(p: InstrumentParam): boolean {
  return p.msg.type === 'cc' && p.msg.lsb === undefined && p.msg.cc < 120;
}

// ---------------------------------------------------------------- choices

/**
 * Value bands from a midi.guide usage text: "0~42: saw, 43~85: pulse,
 * 86~127: triangle", "0-63: Off; 64-127: On" or "0: Off, 1: On".
 * Undefined unless it reads as 2–12 ascending bands with short labels.
 */
export function parseUsageChoices(usage: string | undefined, min = 0, max = 127): InstrumentParam['choices'] {
  if (!usage) return undefined;
  const re = /(-?\d+)\s*(?:(?:~|–|-|to)\s*(-?\d+))?\s*[:=]\s*([^;,\n]+)/g;
  const found: { lo: number; hi: number; label: string }[] = [];
  for (const m of usage.matchAll(re)) {
    const lo = Number(m[1]);
    const hi = m[2] !== undefined ? Number(m[2]) : lo;
    const label = m[3]!.trim().replace(/\.$/, '');
    if (!label || label.length > 16 || hi < lo) return undefined;
    found.push({ lo, hi, label });
  }
  if (found.length < 2 || found.length > 12) return undefined;
  for (let i = 1; i < found.length; i++) if (found[i]!.lo <= found[i - 1]!.hi) return undefined;
  if (found[0]!.lo > min + 1 || found.at(-1)!.hi < Math.min(max, found.at(-1)!.lo)) return undefined;
  // Each band runs up to just below the next one; the last one to the top.
  return found.map((f, i) => ({ upTo: i < found.length - 1 ? found[i + 1]!.lo - 1 : max, label: cap(f.label) }));
}

const ON_OFF = /(\bon\b|on\/off|\bswitch\b|\bstatus\b|\benable\b)$/i;

/** A copy (the panel sets short labels on it), with choices read from its usage text. */
function enrichParam(param: InstrumentParam): InstrumentParam {
  const p = { ...param };
  if (!panelParam(p) || p.choices) return p;
  const choices =
    parseUsageChoices(p.usage, p.min, p.max) ??
    (ON_OFF.test(p.name.trim()) && p.max - p.min > 1
      ? [
          { upTo: Math.floor((p.min + p.max) / 2), label: 'Off' },
          { upTo: p.max, label: 'On' },
        ]
      : undefined);
  if (choices) p.choices = choices;
  return p;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ---------------------------------------------------------------- roles

const is = {
  cutoff: (n: string) => /cutoff|\bcut\b|\bfreq(uency)?\b/i.test(n) && !/env|lfo|key|vel|rate|time/i.test(n),
  resonance: (n: string) => /\bres(onance|o)?\b|\bemph(asis)?\b|\bq\b/i.test(n),
  attack: (n: string) => /attack|\batk\b|\batt\b/i.test(n),
  decay: (n: string) => /decay|\bdec\b|\bdcy\b/i.test(n),
  sustain: (n: string) => /sustain|\bsus\b/i.test(n) && !/pedal/i.test(n),
  release: (n: string) => /release|\brel\b/i.test(n),
  level: (n: string) => /\b(vol|volume|level|lvl|gain)\b/i.test(n) && !/accent|lfo|env|mod|velocity/i.test(n),
  rate: (n: string) => /\brate\b|\bspeed\b|\bfreq(uency)?\b/i.test(n),
  delay: (n: string) => /\bdelay\b|\bfade\b/i.test(n) && !/time|feedback|level|send|wet|mix/i.test(n),
};

/** Effect groups keep their own level instead of joining a voice mixer. */
const FX = /^(delay|reverb|rev|fx|chorus|echo|master|send)/i;

// ---------------------------------------------------------------- grouping

interface Group {
  section: string;
  /** Shared first word of the names ("ENV1", "BD"), stripped from labels. */
  prefix?: string;
  params: InstrumentParam[];
}

const SECTION_ORDER = ['main', 'filter', 'vcf', 'envelope', 'env', 'osc', 'oscillator', 'vco', 'mixer', 'amp', 'vca', 'lfo', 'mod', 'effects', 'fx', 'arp', 'macro'];

function sectionName(p: InstrumentParam): string {
  return !p.section || /^all/i.test(p.section) ? 'Main' : p.section;
}

function firstWord(name: string): string | undefined {
  const m = /^(\S+)\s+\S/.exec(name.trim());
  return m?.[1];
}

/** Split a section on a shared first word when several params use one. */
function groupsOf(params: InstrumentParam[]): Group[] {
  const bySection = new Map<string, InstrumentParam[]>();
  for (const p of params) bySection.set(sectionName(p), [...(bySection.get(sectionName(p)) ?? []), p]);

  const groups: Group[] = [];
  for (const [section, list] of bySection) {
    const byWord = new Map<string, InstrumentParam[]>();
    for (const p of list) {
      const w = firstWord(p.name)?.toLowerCase();
      if (w) byWord.set(w, [...(byWord.get(w) ?? []), p]);
    }
    const prefixes = [...byWord.entries()].filter(([, ps]) => ps.length >= 2);
    const covered = prefixes.reduce((n, [, ps]) => n + ps.length, 0);
    if (prefixes.length >= 2 && covered >= list.length * 0.6) {
      const rest = list.filter((p) => !prefixes.some(([, ps]) => ps.includes(p)));
      for (const [, ps] of prefixes) groups.push({ section, prefix: firstWord(ps[0]!.name), params: ps });
      if (rest.length) groups.push({ section, params: rest });
    } else {
      groups.push({ section, params: list });
    }
  }
  const rank = (s: string) => {
    const i = SECTION_ORDER.findIndex((x) => s.toLowerCase().startsWith(x));
    return i < 0 ? SECTION_ORDER.length : i;
  };
  return groups.map((g, i) => ({ g, i })).sort((a, b) => rank(a.g.section) - rank(b.g.section) || a.i - b.i).map((x) => x.g);
}

// ---------------------------------------------------------------- labels

const ABBREV: [RegExp, string][] = [
  [/\b(filter )?cutoff frequency\b/gi, 'Cutoff'],
  [/\benvelope\b/gi, 'Env'],
  [/\bmodulation\b/gi, 'Mod'],
  [/\bfrequency\b/gi, 'Freq'],
  [/\bresonance\b/gi, 'Res'],
  [/\bfeedback\b/gi, 'Fdbk'],
  [/\boscillator\b/gi, 'Osc'],
  [/\bkeytrack(ing)?\b|\bkey follow\b/gi, 'Key'],
  [/\bamount\b/gi, 'Amt'],
  [/\bvelocity\b/gi, 'Vel'],
];

function shortLabel(p: InstrumentParam, prefix: string | undefined, section: string): string | undefined {
  let s = p.name.trim();
  for (const word of [prefix, section]) {
    if (word && s.toLowerCase().startsWith(word.toLowerCase() + ' ') && s.length > word.length + 2) s = s.slice(word.length + 1);
  }
  if (s.length > 10) for (const [re, to] of ABBREV) s = s.replace(re, to);
  if (s.length > 10) s = s.replace(/\s+(level|time)$/i, '');
  s = cap(s.trim());
  return s && s !== p.name ? s : undefined;
}

// ---------------------------------------------------------------- widgets

function autoPanel(all: InstrumentParam[]): PanelModule[] {
  const params = all.filter(panelParam);
  const groups = groupsOf(params);
  for (const g of groups) {
    for (const p of g.params) {
      const s = shortLabel(p, g.prefix, g.section);
      if (s && !p.short) p.short = s;
    }
  }

  // Sibling groups of plain knobs (drum voices, oscillators, LFOs) become
  // channel strips in one module: far more compact than a module each.
  const levelOf = (g: Group) => g.params.filter((p) => !p.choices && is.level(p.name));
  const plain = (g: Group) =>
    !!g.prefix &&
    !FX.test(g.prefix) &&
    g.params.length <= 6 &&
    levelOf(g).length <= 1 &&
    moduleFor('', '', g.params).widgets.every((w) => w.kind === 'knobs' || w.kind === 'sliders');
  const stripSections = new Set(
    [...new Set(groups.map((g) => g.section))].filter((sec) => groups.filter((g) => g.section === sec && plain(g)).length >= 3),
  );

  const modules: PanelModule[] = [];
  const done = new Set<string>();
  for (const g of groups) {
    if (stripSections.has(g.section) && plain(g)) {
      if (done.has(g.section)) continue;
      done.add(g.section);
      const strips = groups
        .filter((x) => x.section === g.section && plain(x))
        .map((x) => {
          const level = levelOf(x)[0];
          const strip: { title: string; params: string[]; level?: string } = {
            title: x.prefix!,
            params: x.params.filter((p) => p !== level).map((p) => p.id),
          };
          if (level) strip.level = level.id;
          return strip;
        });
      modules.push({ title: g.section === 'Main' ? 'Channels' : g.section, group: g.section, wide: true, widgets: [{ kind: 'strips', strips }] });
      continue;
    }
    // "ENV1", "Delay"; a bare code like "F1" keeps its section: "Filter F1".
    const stem = g.prefix?.replace(/\d+$/, '') ?? '';
    const title = !g.prefix ? g.section : g.section !== 'Main' && stem.length < 3 ? `${g.section} ${g.prefix}` : g.prefix;
    modules.push(moduleFor(title, g.section, g.params));
  }
  return modules;
}

function moduleFor(title: string, group: string, list: InstrumentParam[]): PanelModule {
  const widgets: PanelWidget[] = [];
  const used = new Set<InstrumentParam>();
  const take = (p: InstrumentParam | undefined) => (p && !used.has(p) ? (used.add(p), p.id) : undefined);
  const find = (test: (n: string) => boolean) => list.find((p) => !used.has(p) && !p.choices && test(p.name));

  for (const p of list) if (p.choices && p.choices.length <= 6) widgets.push({ kind: 'switch', param: take(p)! });

  const cutoff = find(is.cutoff);
  const res = cutoff && find(is.resonance);
  let pad = false;
  if (cutoff && res) {
    widgets.push({ kind: 'xy', x: take(cutoff)!, y: take(res)! });
    pad = true;
  }

  const env = { a: find(is.attack), d: find(is.decay), s: find(is.sustain), r: find(is.release) };
  const envCount = [env.a, env.d, env.s, env.r].filter(Boolean).length;
  if (envCount >= 2 && (env.a || env.d)) {
    widgets.push({ kind: 'adsr', attack: take(env.a), decay: take(env.d), sustain: take(env.s), release: take(env.r), sustainLevel: env.s ? undefined : 0.7 });
  }

  const rate = /lfo/i.test(title) ? find(is.rate) : undefined;
  if (rate) widgets.push({ kind: 'lfo', rate: rate.id, delay: find(is.delay)?.id });

  const levels = list.filter((p) => !used.has(p) && !p.choices && is.level(p.name));
  if (levels.length >= 3) widgets.push({ kind: 'faders', params: levels.map((p) => take(p)!) });

  const knobs = list.filter((p) => !used.has(p) && !(levels.length < 3 && levels.includes(p)));
  if (knobs.length) widgets.push({ kind: 'knobs', params: knobs.map((p) => take(p)!) });
  if (levels.length && levels.length < 3) widgets.push({ kind: 'sliders', params: levels.map((p) => take(p)!) });

  return { title, group, wide: pad || knobs.length > 6, widgets };
}
