import { voiceLead } from '../theory/chord';
import type { HarmonicMoment } from '../theory/harmony';
import { midiOf, pitchClassOf, type MidiNote } from '../theory/note';
import type { PitchSpec, Register } from './pattern';

/** Per-track memory the resolver needs, e.g. the last chord voicing. */
export interface ResolveState {
  lastVoicing?: MidiNote[];
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
    case 'degree':
      return [fold(scale.degreeToMidi(chord.degree + spec.degree, register.baseOctave), register)];
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

/** Move a note by octaves until it lies within the register. */
export function fold(note: MidiNote, register: Register): MidiNote {
  let n = note;
  while (n < register.low) n += 12;
  while (n > register.high) n -= 12;
  // A register narrower than an octave may leave n below low; accept that.
  return n;
}
