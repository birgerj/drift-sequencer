import { describe, expect, it } from 'vitest';
import { Sequencer } from '../src/core/engine/sequencer';
import { cycleDrumCell, drumCell, resizePattern, toChordDegrees, toggleMotifNote } from '../src/core/pattern/edit';
import type { Pattern } from '../src/core/pattern/pattern';
import { RecordingOutput, StaticPortResolver } from '../src/io/midi/output';
import { createProject } from '../src/state/templates';

const empty: Pattern = { lengthSteps: 16, events: [] };

describe('pattern editing', () => {
  it('cycles drum cells off → hit → chance → off', () => {
    let p = cycleDrumCell(empty, 4, 36, 100);
    expect(drumCell(p, 4, 36)).toBe('hit');
    p = cycleDrumCell(p, 4, 36, 100);
    expect(drumCell(p, 4, 36)).toBe('chance');
    expect(p.events[0]!.probability).toBe(0.5);
    p = cycleDrumCell(p, 4, 36, 100);
    expect(drumCell(p, 4, 36)).toBe('off');
    expect(p.events).toHaveLength(0);
  });

  it('adds, moves and removes monophonic motif notes without overlaps', () => {
    let p = toggleMotifNote(empty, 0, 2, 90);
    p = { ...p, events: p.events.map((e) => ({ ...e, length: 8 })) };
    p = toggleMotifNote(p, 4, 0, 90); // shortens the first note to 4 steps
    expect(p.events.map((e) => [e.step, e.length])).toEqual([
      [0, 4],
      [4, 1],
    ]);
    p = toggleMotifNote(p, 4, 3, 90); // move to another degree
    expect(p.events[1]!.pitch).toEqual({ kind: 'degree', degree: 3 });
    p = toggleMotifNote(p, 4, 3, 90); // same degree again removes it
    expect(p.events).toHaveLength(1);
  });

  it('repeats content when a pattern gets longer', () => {
    const p = resizePattern(cycleDrumCell(empty, 0, 36, 100), 32);
    expect(p.events.map((e) => e.step)).toEqual([0, 16]);
    expect(resizePattern(p, 16).events.map((e) => e.step)).toEqual([0]);
  });

  it('plays a user pattern and keeps it when knobs move', () => {
    const project = createProject('techno');
    const drums = project.tracks.find((t) => t.generator.type === 'drums')!;
    const userPattern = cycleDrumCell(empty, 3, 36, 100);
    const seq = new Sequencer(project, new StaticPortResolver([new RecordingOutput('TR-8S')]));
    const next = {
      ...project,
      tracks: project.tracks.map((t) => (t.id === drums.id ? { ...t, userPattern, frozen: true } : t)),
    };
    seq.update(next);
    expect(seq.track(drums.id)!.pattern).toBe(userPattern);

    const tweaked = {
      ...next,
      tracks: next.tracks.map((t) =>
        t.id === drums.id ? { ...t, generator: { ...t.generator, params: { ...t.generator.params, mutation: 0.9 } } as typeof t.generator } : t,
      ),
    };
    seq.update(tweaked);
    expect(seq.track(drums.id)!.pattern).toBe(userPattern);
  });
});


describe('key-relative lines in the editor', () => {
  it('shows key degrees as chord degrees, fitted notes on chord tones', () => {
    const p = {
      lengthSteps: 32,
      events: [
        { step: 0, length: 1, velocity: 90, pitch: { kind: 'keyDegree' as const, degree: 4, nearest: true } },
        { step: 16, length: 1, velocity: 90, pitch: { kind: 'keyDegree' as const, degree: 4, fit: 'tone' as const } },
        { step: 20, length: 1, velocity: 90, pitch: { kind: 'keyDegree' as const, degree: 5, fit: 'root' as const } },
      ],
    };
    // Bar 0 on the I chord, bar 1 on IV (degree 3).
    const out = toChordDegrees(p, (step) => (step < 16 ? 0 : 3));
    expect(out.events.map((e) => e.pitch)).toEqual([
      { kind: 'degree', degree: 4, nearest: true },
      { kind: 'degree', degree: 2 }, // 4 − 3 = 1 → nearest chord tone, ties go up
      { kind: 'degree', degree: 0 }, // 5 − 3 = 2 → root
    ]);
    const plain = { lengthSteps: 16, events: [] };
    expect(toChordDegrees(plain, () => 0)).toBe(plain);
  });
});
