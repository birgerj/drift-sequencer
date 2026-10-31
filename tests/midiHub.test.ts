import { describe, expect, it } from 'vitest';
import { LOCAL_PORTS, isLocalPort } from '../src/io/local/localSynths';
import { MidiHub } from '../src/io/midi/midiHub';
import { guessPorts } from '../src/state/rack';

describe('MidiHub', () => {
  it('always offers the built-in Drift Synth ports, even without Web MIDI', async () => {
    const hub = new MidiHub();
    await hub.connect(); // no Web MIDI in node: must not throw
    const names = hub.all().map((p) => p.name);
    expect(names).toEqual(expect.arrayContaining(Object.values(LOCAL_PORTS)));
    expect(hub.byName(LOCAL_PORTS.bass)?.name).toBe(LOCAL_PORTS.bass);
    expect(hub.byName('TB-03')).toBeUndefined();
  });

  it('never auto-assigns a built-in synth in the setup guess (chosen by hand)', () => {
    const guess = guessPorts(Object.values(LOCAL_PORTS));
    expect(Object.values(guess).some((p) => p && isLocalPort(p))).toBe(false);
  });
});
