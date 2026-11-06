import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  composePrompt,
  composeTool,
  keepParts,
  parseComposition,
  sectionBars,
  sectionPatterns,
  type ComposeContext,
  type Composition,
} from '../src/core/ensemble/composition';
import { TR8S_NOTES } from '../src/core/generators/drumGenerator';
import { callTool } from '../src/io/ensemble/claudeApi';
import { Scale } from '../src/core/theory/scale';

const A_MINOR = new Scale(9, 'aeolian');
// i – VI – III – VII, one bar each
const PROGRESSION = [
  { degree: 0, bars: 1 },
  { degree: 5, bars: 1 },
  { degree: 2, bars: 1 },
  { degree: 6, bars: 1 },
];

const ctx = (patch: Partial<ComposeContext> = {}): ComposeContext => ({
  scale: A_MINOR,
  progression: PROGRESSION,
  stepsPerBar: 16,
  bpm: 122,
  parts: { melody: true, bass: true, pads: true, drums: true },
  drumVoices: ['BD', 'SD', 'CH', 'OH'],
  sectionLength: 8,
  ...patch,
});

describe('section length', () => {
  it('uses whole passes of the progression', () => {
    expect(sectionBars(PROGRESSION, 4)).toBe(4);
    expect(sectionBars(PROGRESSION, 8)).toBe(8);
    expect(sectionBars(PROGRESSION, 16)).toBe(16);
    expect(sectionBars([{ degree: 0, bars: 3 }], 8)).toBe(9);
    expect(sectionBars([{ degree: 0, bars: 6 }], 16)).toBe(12);
    expect(sectionBars([{ degree: 0, bars: 1 }])).toBe(4);
    expect(sectionBars([{ degree: 0, bars: 20 }], 4)).toBe(20);
  });
});

describe('prompt', () => {
  it('names the key, the chords per bar and the parts', () => {
    const text = composePrompt(ctx({ style: 'dark techno' }));
    expect(text).toContain('A aeolian');
    expect(text).toContain('0=A, 1=B, 2=C');
    expect(text).toContain('8 bars = 128 steps');
    expect(text).toMatch(/bar 1 .*: Am/);
    expect(text).toMatch(/bar 2 .*: F/);
    expect(text).toMatch(/bar 5 .*: Am/); // the progression repeats inside a section
    expect(text).toContain('BD, SD, CH, OH');
    expect(text).toContain('dark techno');
  });

  it('asks to leave parts without a track empty and to keep parts when continuing', () => {
    const previous: Composition = { title: 'P', form: ['A'], bars: 8, stepsPerBar: 16, sections: [{ name: 'A', melody: [], bass: [], pads: [], drums: [] }] };
    const text = composePrompt(ctx({ parts: { melody: true, bass: true, pads: false, drums: false }, previous, keep: ['bass'] }));
    expect(text).toContain('Leave empty: pads, drums');
    expect(text).toContain('Keep these parts exactly as they are: bass');
    expect(text).toContain('"title":"P"');
  });

  it('limits drum voices in the tool schema', () => {
    const tool = composeTool(['BD', 'SD']) as unknown as { input_schema: { properties: { sections: { items: { properties: { drums: { items: { properties: { voice: { enum: string[] } } } } } } } } } };
    expect(tool.input_schema.properties.sections.items.properties.drums.items.properties.voice.enum).toEqual(['BD', 'SD']);
  });
});

describe('parsing the answer', () => {
  const answer = {
    title: 'Night Drive',
    form: ['A', 'A2', 'B', 'A', 'Z'],
    sections: [
      {
        name: 'A',
        melody: [
          { step: 0, len: 2, degree: 4, vel: 100 },
          { step: 0, len: 1, degree: 2, vel: 90 }, // same step: dropped
          { step: 130, len: 2, degree: 4, vel: 100 }, // past the end: dropped
          { step: 126, len: 9, degree: 99, vel: 300 }, // clamped
        ],
        bass: [{ step: 0, len: 4, degree: 0, vel: 110 }],
        pads: [{ step: 0, len: 32, vel: 70 }],
        drums: [
          { voice: 'BD', vel: 115, steps: [0, 4, 8, 12, 8, 200] },
          { voice: 'COWBELL', vel: 90, steps: [3] },
        ],
      },
      { name: 'A2', melody: [{ step: 2, len: 2, degree: 5, vel: 96 }], bass: [], pads: [], drums: [] },
      { name: 'B', melody: [], bass: [], pads: [], drums: [] }, // nothing playable
      { name: 'A', melody: [{ step: 4, len: 1, degree: 1, vel: 80 }], bass: [], pads: [], drums: [] }, // duplicate name
    ],
  };

  it('keeps what can play and clamps the rest', () => {
    const c = parseComposition(answer, ctx());
    expect(c.title).toBe('Night Drive');
    expect(c.bars).toBe(8);
    expect(c.sections.map((s) => s.name)).toEqual(['A', 'A2']);
    expect(c.form).toEqual(['A', 'A2', 'A']);
    const a = c.sections[0]!;
    expect(a.melody).toEqual([
      { step: 0, len: 2, degree: 4, vel: 100 },
      { step: 126, len: 2, degree: 21, vel: 127 },
    ]);
    expect(a.drums).toEqual([{ voice: 'BD', vel: 115, steps: [0, 4, 8, 12] }]);
    expect(a.pads).toEqual([{ step: 0, len: 32, vel: 70 }]);
  });

  it('drops parts without a track and fails on nothing', () => {
    const c = parseComposition(answer, ctx({ parts: { melody: true, bass: false, pads: false, drums: false } }));
    expect(c.sections[0]!.bass).toEqual([]);
    expect(c.sections[0]!.drums).toEqual([]);
    expect(() => parseComposition({ sections: [] }, ctx())).toThrow();
    expect(() => parseComposition('nonsense', ctx())).toThrow();
  });

  it('copies kept parts from the piece before', () => {
    const before = parseComposition(answer, ctx());
    const next = parseComposition(
      { title: 'Next', form: ['A'], sections: [{ name: 'A', melody: [{ step: 0, len: 1, degree: 0, vel: 90 }], bass: [], pads: [], drums: [] }] },
      ctx(),
    );
    const kept = keepParts(next, before, ['drums', 'bass']);
    expect(kept.sections[0]!.melody).toEqual(next.sections[0]!.melody);
    expect(kept.sections[0]!.drums).toEqual(before.sections[0]!.drums);
    expect(kept.sections[0]!.bass).toEqual(before.sections[0]!.bass);
  });
});

describe('patterns', () => {
  const c: Composition = {
    title: 'T',
    form: ['A'],
    bars: 4,
    stepsPerBar: 16,
    sections: [
      {
        name: 'A',
        melody: [
          { step: 0, len: 2, degree: 4, vel: 100 },
          { step: 3, len: 1, degree: 5, vel: 80 },
        ],
        bass: [{ step: 16, len: 4, degree: -2, vel: 110 }],
        pads: [{ step: 0, len: 16, vel: 70 }],
        drums: [{ voice: 'SD', vel: 100, steps: [4, 12] }],
      },
    ],
  };

  it('turns a section into key-relative lines, chord hits and drum notes', () => {
    const p = sectionPatterns(c, 'A');
    expect(p.melody.lengthSteps).toBe(64);
    expect(p.melody.events[0]).toEqual({ step: 0, length: 2, velocity: 100, pitch: { kind: 'keyDegree', degree: 4 } });
    expect(p.bass.events[0]!.pitch).toEqual({ kind: 'keyDegree', degree: -2 });
    expect(p.pads.events).toEqual([{ step: 0, length: 16, velocity: 70, pitch: { kind: 'chord' } }]);
    expect(p.drums.events.map((e) => [e.step, e.pitch])).toEqual([
      [4, { kind: 'fixed', note: TR8S_NOTES.SD }],
      [12, { kind: 'fixed', note: TR8S_NOTES.SD }],
    ]);
  });

  it('uses the drum track’s own notes and fits strong steps on request', () => {
    const p = sectionPatterns(c, 'A', { drumNotes: { SD: 40 }, fit: 'bar' });
    expect(p.drums.events[0]!.pitch).toEqual({ kind: 'fixed', note: 40 });
    expect(p.melody.events[0]!.pitch).toEqual({ kind: 'keyDegree', degree: 4, fit: 'tone' });
    expect(p.melody.events[1]!.pitch).toEqual({ kind: 'keyDegree', degree: 5 });
    expect(p.bass.events[0]!.pitch).toEqual({ kind: 'keyDegree', degree: -2, fit: 'root' });
  });
});

describe('Claude API call', () => {
  afterEach(() => vi.unstubAllGlobals());
  const req = { apiKey: 'sk-test', model: 'claude-sonnet-5-5', system: 's', user: 'u', tool: { name: 'write_music', description: 'd', input_schema: {} } };

  it('sends the key and browser header, offers the tool and returns its input', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'write_music', input: { ok: 1 } }] })));
    vi.stubGlobal('fetch', fetch);
    await expect(callTool(req)).resolves.toEqual({ ok: 1 });
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-test');
    expect(headers['anthropic-dangerous-direct-browser-access']).toBe('true');
    const body = JSON.parse(init.body as string);
    expect(body.tool_choice).toBeUndefined();
    expect(body.tools[0].name).toBe('write_music');
    expect(body.messages[0].content).toContain('calling the write_music tool');
  });

  it('accepts the JSON as text when Claude doesn’t call the tool', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Here it is:\n```json\n{"title":"X"}\n```' }] }))),
    );
    await expect(callTool(req)).resolves.toEqual({ title: 'X' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Sorry.' }] }))));
    await expect(callTool(req)).rejects.toThrow('didn’t send any music');
  });

  it('explains a refused key and a cut-off answer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: 'invalid x-api-key' } }), { status: 401 })));
    await expect(callTool(req)).rejects.toThrow('API key was refused');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ stop_reason: 'max_tokens', content: [{ type: 'tool_use', name: 'write_music', input: {} }] }))),
    );
    await expect(callTool(req)).rejects.toThrow('cut off');
  });
});
