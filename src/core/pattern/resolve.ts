import { voiceLead } from '../theory/chord';
import type { HarmonicMoment } from '../theory/harmony';
import { midiOf, pitchClassOf, type MidiNote } from '../theory/note';
import type { PitchSpec, Register } from './pattern';

/** Per-track memory the resolver needs, e.g. the last chord voicing. */
export interface ResolveState {
  lastVoicing?: MidiNote[];
  /** Last note played by a `nearest` degree, for smooth melodic motion. */
  lastMelodic?: MidiNote;
}

/** Turn a relative pitch into concrete MIDI notes for the current harmony. */
export function resolvePitch(
  spec: PitchSpec,
  moment: HarmonicMoment,
  register: Register,
  state: ResolveState,
): MidiNote[] {
  const { scale, chord } = moment;
  switch (spec.kind) {
    case 'fixed':
      return [spec.note];
    case 'degree': {
      const written = fold(scale.degreeToMidi(chord.degree + spec.degree, register.baseOctave) + (spec.octave ?? 0) * 12, register);
      if (!spec.nearest) return [written];
      const note = nearestOctave(written, state.lastMelodic, register);
      state.lastMelodic = note;
      return [note];
    }
    case 'keyDegree':
      return [fold(scale.degreeToMidi(spec.degree, register.baseOctave), register)];
    case 'chordTone': {
      const tones = chord.tones;
      const idx = ((spec.index % tones.length) + tones.length) % tones.length;
      const wraps = Math.floor(spec.index / tones.length);
      const rootNote = midiOf(chord.root, register.baseOctave);
      let note = rootNote;
      while (pitchClassOf(note) !== tones[idx]) note++;
      return [fold(note + (spec.octave + wraps) * 12, register)];
    }
    case 'chord': {
      const voicing = voiceLead(chord, state.lastVoicing, register.low, register.high);
      state.lastVoicing = voicing;
      return voicing;
    }
  }
}

/**
 * Pick the octave of `written` that is closest to the previous note while
 * staying near the written octave, so chord changes and register folding
 * don't throw the line around by an octave.
 */
export function nearestOctave(written: MidiNote, last: MidiNote | undefined, register: Register): MidiNote {
  if (last === undefined) return written;
  let best = written;
  let bestCost = Infinity;
  for (const shift of [-12, 0, 12]) {
    const n = written + shift;
    if (n < register.low || n > register.high) continue;
    const cost = Math.abs(n - last) + 0.6 * Math.abs(shift);
    if (cost < bestCost) {
      bestCost = cost;
      best = n;
    }
  }
  return best;
}

/** Move a note by octaves until it lies within the register. */
export function fold(note: MidiNote, register: Register): MidiNote {
  let n = note;
  while (n < register.low) n += 12;
  while (n > register.high) n -= 12;
  // A register narrower than an octave may leave n below low; accept that.
  return n;
}
