# The performance screen

[← Getting started](01-getting-started.md) · [Manual](README.md) · Next: [Tracks →](03-tracks.md)

This is the screen you play from. Open it any time with **Overview** in the
left bar, or press `O`.

![The performance screen while playing](images/performance.png)

## The left bar

The left bar is always there, on every screen.

- **Project name**: opens [Projects](09-projects.md). Next to it is the
  position, shown as bar and beat (`005.3`).
- **Play / Stop** (`Space`).
- **BPM**: − and + change the tempo (20–300). The keys `,` and `.` change
  it by 1, or by 5 with Shift.
- **Key**: the key and mode, plus the chord playing now. Click it to open
  [Harmony](04-harmony.md).
- **Connect MIDI**: shown until MIDI is connected.
- **Track list**: every track with its type and device. On the right you
  see the notes it plays right now, or its number: press `1`–`9` to jump
  to that track. Muted tracks are dimmed. **+ Add track** adds a new
  Motif track and opens it.
- **Clock out**: which device receives MIDI clock and start/stop, or *Off*.
- **Overview**, **Harmony**, **Projects**, **Devices**: the main screens.
- **Visuals** opens the visuals window (see below). **Shortcuts** shows
  the [keyboard shortcuts](10-shortcuts.md).

## Progression

The strip at the top shows the chord progression: each chord with its
roman numeral and length in bars. The chord playing now lights up. Click a
chord to edit the progression in [Harmony](04-harmony.md).

**Next mutation** counts down to the next bar where a track changes.

## Lanes

Every track has a lane:

- **Name**: opens the [track editor](03-tracks.md). Next to it is the
  track type, and below it the device and channel. The port turns into a
  warning when it isn't connected.
- **Badges** show non-default settings: pattern length and speed (for
  example *64 steps · ×1*), a call-and-response role, or which tracks it
  listens to (*↔ Lead*). See [Playing together](05-playing-together.md).
- **Octave**: − and + shift the whole track by octaves.
- **M**, **S**: mute and solo.
- **Dice**: a new pattern. **Sliders**: open the track editor.
- **Pattern view**: the pattern with a moving playhead. Melodic notes are
  drawn by pitch; drum lanes show one row per voice.
- **Quick knobs**: the first three settings of the track type, such as
  *Density* and *Mutation*.

A lane dims while its call-and-response phrase is resting.

## The right column

- **Now playing**: the notes each track plays at this moment.
- **Scale**: a 12-note keyboard. Light keys are in the scale; coloured
  keys are sounding now.
- **Ensemble**: the AI trio. See [The AI ensemble](06-ensemble.md).
- **Evolution**: the last changes, by bar: *pattern mutated*, *back to the
  theme*, *next ensemble phrase* and so on.

## Visuals

**Visuals** in the left bar opens a separate window with full-screen
graphics that react to the music: kick, snare and hats, bass and lead
energy, and the colour of the chord. Put it on a second screen or a
projector.

- Scenes: Flyover, City, Ocean, Synthwave, Warp, Tunnel, Kaleido and
  Pulse. Press `1`–`8` to switch.
- **Speed** (`[` `]`), **Notes** (`N`), **Strobe** (`S`) and **Auto**
  (`A`, a new scene every 32 bars).
- **Fullscreen** (`F`).

The controls hide after a few seconds. Visuals need WebGL 2; without it
only *Pulse* works.

Next: [Tracks →](03-tracks.md)
