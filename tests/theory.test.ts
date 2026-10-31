import { describe, expect, it } from 'vitest';
import { Chord, voiceLead } from '../src/core/theory/chord';
import { Harmony } from '../src/core/theory/harmony';
import { noteName, parsePitchClass } from '../src/core/theory/note';
import { Scale } from '../src/core/theory/scale';

const aMinor = new Scale(parsePitchClass('A'), 'aeolian');

describe('Scale', () => {
  it('maps degrees to MIDI, wrapping octaves', () => {
    expect(noteName(aMinor.degreeToMidi(0, 3))).toBe('A3');
    expect(noteName(aMinor.degreeToMidi(2, 3))).toBe('C4');
    expect(noteName(aMinor.degreeToMidi(7, 3))).toBe('A4');
    expect(noteName(aMinor.degreeToMidi(-1, 3))).toBe('G3');
  });

  it('round-trips degrees', () => {
    for (let d = -10; d <= 10; d++) expect(aMinor.midiToDegree(aMinor.degreeToMidi(d, 3), 3)).toBe(d);
  });

  it('quantizes out-of-scale notes', () => {
    const fSharp4 = 66;
    expect(aMinor.contains(fSharp4)).toBe(false);
    expect(aMinor.contains(aMinor.quantize(fSharp4))).toBe(true);
  });
});

describe('Chord', () => {
  it('builds diatonic chords and names them', () => {
    expect(Chord.fromDegree(aMinor, 0, 3).symbol()).toBe('Am');
    expect(Chord.fromDegree(aMinor, 0, 4).symbol()).toBe('Am7');
    expect(Chord.fromDegree(aMinor, 5, 4).symbol()).toBe('Fmaj7');
    expect(Chord.fromDegree(aMinor, 6, 3).symbol()).toBe('G');
    expect(Chord.fromDegree(aMinor, 1, 3).symbol()).toBe('Bdim');
    expect(Chord.fromDegree(aMinor, 0, 3).roman()).toBe('i');
    expect(Chord.fromDegree(aMinor, 5, 3).roman()).toBe('VI');
  });

  it('voice-leads with small movement', () => {
    const am = Chord.fromDegree(aMinor, 0, 3);
    const f = Chord.fromDegree(aMinor, 5, 3);
    const first = voiceLead(am, undefined, 52, 76);
    const second = voiceLead(f, first, 52, 76);
    const moved = second.reduce((s, n, i) => s + Math.abs(n - first[i]!), 0);
    expect(moved).toBeLessThanOrEqual(3);
    for (const n of second) expect(f.contains(n)).toBe(true);
  });
});

describe('Harmony', () => {
  const harmony = new Harmony(aMinor, [
    { degree: 0, bars: 2 },
    { degree: 5, bars: 1 },
    { degree: 6, bars: 1 },
  ]);

  it('finds the chord at a bar and loops', () => {
    expect(harmony.lengthBars).toBe(4);
    expect(harmony.at(0).chord.symbol()).toBe('Am');
    expect(harmony.at(1).chord.symbol()).toBe('Am');
    expect(harmony.at(1).barInChord).toBe(1);
    expect(harmony.at(2).chord.symbol()).toBe('F');
    expect(harmony.at(7).chord.symbol()).toBe('G');
  });
});
