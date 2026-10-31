/** Raw MIDI 1.0 message builders. Channels are 1..16. */

function status(base: number, channel: number): number {
  if (channel < 1 || channel > 16) throw new Error(`MIDI channel out of range: ${channel}`);
  return base | (channel - 1);
}

const byte = (n: number) => Math.max(0, Math.min(127, Math.round(n)));

export const Midi = {
  noteOn: (channel: number, note: number, velocity: number) => [status(0x90, channel), byte(note), byte(velocity)],
  noteOff: (channel: number, note: number, velocity = 0) => [status(0x80, channel), byte(note), byte(velocity)],
  cc: (channel: number, controller: number, value: number) => [status(0xb0, channel), byte(controller), byte(value)],
  programChange: (channel: number, program: number) => [status(0xc0, channel), byte(program)],
  allNotesOff: (channel: number) => [status(0xb0, channel), 123, 0],
  clock: () => [0xf8],
  start: () => [0xfa],
  continue: () => [0xfb],
  stop: () => [0xfc],
} as const;
