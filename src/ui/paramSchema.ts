import type { TrackType } from '../core/generators/types';

export type Control =
  | { kind: 'range'; key: string; label: string; min: number; max: number; step: number; format: (v: number) => string }
  | { kind: 'toggle'; key: string; label: string; description: string }
  | { kind: 'choice'; key: string; label: string; options: { value: string | number; label: string }[] };

const pct = (v: number) => `${Math.round(v * 100)}%`;
const int = (v: number) => String(Math.round(v));
const steps = (v: number) => `${v} steps`;

const length: Control = {
  kind: 'choice',
  key: 'lengthSteps',
  label: 'Length',
  options: [
    { value: 16, label: '1 bar' },
    { value: 32, label: '2 bars' },
    { value: 64, label: '4 bars' },
  ],
};
const mutation: Control = { kind: 'range', key: 'mutation', label: 'Mutation', min: 0, max: 1, step: 0.01, format: pct };
const velocity: Control = { kind: 'range', key: 'velocity', label: 'Velocity', min: 1, max: 127, step: 1, format: int };
const velVar: Control = { kind: 'range', key: 'velocityVariation', label: 'Velocity variation', min: 0, max: 1, step: 0.01, format: pct };

/** Controls per track type. The first three show on the performance lanes. */
export const PARAM_SCHEMA: Record<TrackType, Control[]> = {
  motif: [
    { kind: 'range', key: 'density', label: 'Density', min: 0, max: 1, step: 0.01, format: pct },
    mutation,
    { kind: 'range', key: 'rangeDegrees', label: 'Range', min: 2, max: 14, step: 1, format: (v) => `${v} degrees` },
    { kind: 'range', key: 'maxLeap', label: 'Max leap', min: 1, max: 7, step: 1, format: steps },
    { kind: 'range', key: 'chordToneBias', label: 'Chord-tone pull', min: 0, max: 1, step: 0.01, format: pct },
    { kind: 'toggle', key: 'rhythmLock', label: 'Rhythm lock', description: 'Keep the rhythm, mutate pitches only' },
    length,
    velocity,
    velVar,
  ],
  bass: [
    { kind: 'range', key: 'density', label: 'Density', min: 0, max: 1, step: 0.01, format: pct },
    mutation,
    { kind: 'range', key: 'octaveJumpChance', label: 'Octave jumps', min: 0, max: 1, step: 0.01, format: pct },
    { kind: 'range', key: 'fifthChance', label: 'Fifths', min: 0, max: 1, step: 0.01, format: pct },
    { kind: 'toggle', key: 'offbeat', label: 'Offbeat', description: 'House-style offbeat eighths' },
    length,
    velocity,
    velVar,
  ],
  arp: [
    {
      kind: 'choice',
      key: 'direction',
      label: 'Direction',
      options: [
        { value: 'up', label: 'Up' },
        { value: 'down', label: 'Down' },
        { value: 'upDown', label: 'Up-down' },
        { value: 'random', label: 'Random' },
      ],
    },
    { kind: 'range', key: 'octaves', label: 'Octaves', min: 1, max: 4, step: 1, format: int },
    { kind: 'range', key: 'restChance', label: 'Rests', min: 0, max: 0.9, step: 0.01, format: pct },
    {
      kind: 'choice',
      key: 'rate',
      label: 'Rate',
      options: [
        { value: 1, label: '1/16' },
        { value: 2, label: '1/8' },
        { value: 4, label: '1/4' },
      ],
    },
    { kind: 'range', key: 'gate', label: 'Gate', min: 0.1, max: 1, step: 0.01, format: pct },
    mutation,
    length,
    velocity,
    velVar,
  ],
  chords: [
    {
      kind: 'choice',
      key: 'style',
      label: 'Style',
      options: [
        { value: 'sustain', label: 'Sustain' },
        { value: 'pulse', label: 'Pulse' },
      ],
    },
    { kind: 'range', key: 'pulses', label: 'Pulses per bar', min: 1, max: 8, step: 1, format: int },
    { kind: 'range', key: 'gate', label: 'Gate', min: 0.1, max: 1, step: 0.01, format: pct },
    mutation,
    velocity,
    velVar,
  ],
  drone: [
    {
      kind: 'choice',
      key: 'follow',
      label: 'Follows',
      options: [
        { value: 'key', label: 'Key root' },
        { value: 'chord', label: 'Chord root' },
      ],
    },
    velocity,
    length,
  ],
  drums: [mutation, velVar],
};

export const TRACK_TYPES: { type: TrackType; label: string; description: string }[] = [
  { type: 'motif', label: 'Motif', description: 'Short theme that slowly mutates' },
  { type: 'arp', label: 'Arpeggio', description: 'Breaks up the current chord' },
  { type: 'bass', label: 'Bass', description: 'Root, fifth and octave' },
  { type: 'chords', label: 'Chords', description: 'Voice-led chords of the progression' },
  { type: 'drone', label: 'Drone', description: 'Long notes on the root' },
  { type: 'drums', label: 'Drums', description: 'Euclidean voices + step chance' },
];

export function typeLabel(type: TrackType): string {
  return TRACK_TYPES.find((t) => t.type === type)?.label ?? type;
}
