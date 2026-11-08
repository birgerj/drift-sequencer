import { describe, expect, it } from 'vitest';
import { decodeShare, encodeShare, SHARE_PREFIX } from '../src/state/share';
import { createProject, TEMPLATES } from '../src/state/templates';
import { LOCAL_PORTS } from '../src/io/local/ports';
import type { ProjectState, TrackState } from '../src/state/project';

/** What the receiver must get back exactly: everything but ids, MIDI routing and device hints. */
function music(p: ProjectState) {
  const ids = p.tracks.map((t) => t.id);
  const ref = (v: unknown): unknown =>
    typeof v === 'string' && ids.includes(v)
      ? `@${ids.indexOf(v)}`
      : Array.isArray(v)
        ? v.map(ref)
        : v && typeof v === 'object'
          ? Object.fromEntries(Object.entries(v).filter(([k, x]) => k !== 'id' && x !== undefined).map(([k, x]) => [k, ref(x)]))
          : v;
  return {
    name: p.name,
    bpm: p.bpm,
    swing: p.swing,
    stepsPerBar: p.stepsPerBar,
    key: p.key,
    progression: p.progression,
    harmonyEvolve: p.harmonyEvolve,
    tracks: p.tracks.map((t) => {
      const { id: _i, deviceId: _d, output: _o, instrumentId: _n, slideCc: _s, prefer: _p, ...rest } = t;
      return { ...(ref(rest) as object), channel: t.output.channel };
    }),
  };
}

describe('share links', () => {
  it.each(TEMPLATES.map((t) => t.id))('round-trips the %s template in a short link', async (id) => {
    const project = createProject(id);
    const link = await encodeShare(project);
    expect(link.startsWith(SHARE_PREFIX)).toBe(true);
    expect(link.length).toBeLessThan(900);
    const shared = await decodeShare(link);
    expect(shared.changedTemplates).toBe(false);
    expect(music(shared.project)).toEqual(music(project));
    expect(shared.project.id).not.toBe(project.id);
  });

  it('keeps edits, knobs and removed settings', async () => {
    const project = createProject('techno');
    const t0 = project.tracks[1]!;
    const edited: TrackState = {
      ...t0,
      name: 'My bass',
      humanize: undefined,
      octave: -1,
      userPattern: { lengthSteps: 16, events: [{ step: 0, length: 1, velocity: 100, pitch: { kind: 'degree', degree: 0 }, probability: 0.5 } as never] },
      panel: { values: { '74': 90, '71': 30 } },
      modulations: [{ id: 'x', enabled: true, cc: 74, label: 'Cutoff', shape: 'sine', periodBars: 8, min: 20, max: 100 }],
    };
    const p: ProjectState = { ...project, bpm: 131, swing: 0.1, tracks: [project.tracks[0]!, edited, ...project.tracks.slice(2)] };
    const shared = await decodeShare(await encodeShare(p));
    expect(music(shared.project)).toEqual(music(p));
    expect(shared.project.tracks[1]!.modulations[0]!.id).toBeTruthy();
  });

  it('round-trips a project unlike any template', async () => {
    const base = createProject('ambient');
    const p: ProjectState = {
      ...base,
      name: 'Odd',
      tracks: base.tracks.map((t, i) => ({ ...t, name: `T${i}`, color: '#123456', mutationIntervalBars: 3 + i, register: { baseOctave: i, low: 30, high: 90 } })),
    };
    const shared = await decodeShare(await encodeShare(p));
    expect(music(shared.project)).toEqual(music(p));
  });

  it('keeps built-in synths and hands hardware parts to the receiver', async () => {
    const project = createProject('deep-house');
    const tracks = project.tracks.map((t, i) =>
      i === 0
        ? { ...t, output: { portName: 'TR-8S', channel: 10 }, instrumentId: 'roland-tr-8s' }
        : { ...t, deviceId: 'dev-1', output: { portName: LOCAL_PORTS.juno, channel: 1 } },
    );
    const shared = await decodeShare(await encodeShare({ ...project, tracks }));
    const [hw, ...local] = shared.project.tracks;
    expect(shared.hardware[hw!.id]).toBe('roland-tr-8s');
    expect(hw!.prefer?.[0]).toBe('roland-tr-8s');
    expect(hw!.deviceId).toBeUndefined();
    for (const t of local) {
      expect(t.output.portName).toBe(LOCAL_PORTS.juno);
      expect(t.instrumentId).toBe('drift-synth-juno');
      expect(t.deviceId).toBeUndefined();
      expect(shared.hardware[t.id]).toBeUndefined();
    }
  });

  it('points call-and-response answers at the new track ids', async () => {
    const project = createProject('conversation');
    const i = project.tracks.findIndex((t) => t.phrase?.answer);
    expect(i).toBeGreaterThanOrEqual(0);
    const from = project.tracks.findIndex((t) => t.id === project.tracks[i]!.phrase!.answer!.from);
    const shared = await decodeShare(await encodeShare(project));
    expect(shared.project.tracks[i]!.phrase!.answer!.from).toBe(shared.project.tracks[from]!.id);
  });

  it('carries the visual', async () => {
    const shared = await decodeShare(await encodeShare(createProject('acid'), { scene: 'sorter', speed: 0.6, tod: 'night', notes: true }));
    expect(shared.visuals).toEqual({ scene: 'sorter', speed: 0.6, tod: 'night', notes: true });
  });

  it('rejects other links', async () => {
    await expect(decodeShare('#visuals')).rejects.toThrow();
  });
});
