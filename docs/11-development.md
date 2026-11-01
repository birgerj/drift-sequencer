# Development

[← Keyboard shortcuts](10-shortcuts.md) · [Manual](README.md)

## Run, test and build

```sh
npm install
npm run dev               # http://localhost:5173 with hot reload
npm test                  # unit tests
npm run typecheck
npm run build:standalone  # rebuild standalone/index.html — commit it with your change
```

`standalone/` holds the single-file build: the whole app inlined in
`index.html`, plus the PWA files (manifest, icons and service worker). It
runs by double-clicking it (`file://`) or from any static host.

**Publishing:** every push to `main` runs the tests, builds the app and
publishes `standalone/` to GitHub Pages (`.github/workflows/publish.yml`).
One-time setup: Settings → Pages → Source: *GitHub Actions*.

## Architecture

```
src/
  core/                  pure TypeScript, no DOM — testable and Worker-ready
    theory/              Note, Scale/modes, Chord + voice leading, Harmony
    random/              seeded Rng (reproducible patterns and mutations)
    pattern/             harmony-relative Pattern + resolver to MIDI notes
    generators/          one PatternGenerator per track type + registry
    engine/              LookaheadScheduler, TrackRuntime, Sequencer, LFOs, interplay
    ensemble/            MusicVAE trio → Drift patterns, latent-space math
    instruments/         instrument definitions (CC/NRPN maps, drum notes)
    events.ts            typed event emitter (engine → UI)
  io/midi/               Web MIDI wrapper behind a MidiOutputPort interface
  io/local/              the built-in Drift Synth (Tone.js)
  io/ensemble/           MusicVAE in a Web Worker
  state/                 ProjectState schema, templates, storage + migrations
  ui/                    view layer; talks only to the Sequencer API + events
  visuals/               the visuals window (WebGL 2)
```

**Harmony is the single source of truth.** Patterns never store MIDI notes
for melodic tracks. They store pitch *relative to the harmony*: a scale
degree from the current chord root or the key, a chord tone, or "the whole
chord". The resolver turns that into notes at play time. A motif therefore
keeps its shape while following the progression, and all tracks always
agree on key and chord.

**Timing.** A lookahead scheduler hands Web MIDI exact timestamps, so
JavaScript timer jitter never reaches the music. Browsers throttle timers
in hidden tabs, so the scheduler's clock runs in a Web Worker and the
lookahead grows while the page is hidden. The engine stays on the main
thread, because Web MIDI isn't available in workers. A guard stops
playback if far too many MIDI messages are sent.

**Evolution.** Every track mutates every N bars: a fraction of its notes
change, the rest stays. Freeze a track to stop it; recent variations are
kept in its history.

**Interplay.** *Listens to* and the kick awareness are applied at play
time: every track first plans its notes for a step, then listeners react
to what the others planned.

**Ensemble.** MusicVAE (`trio_4bar`) runs in a Web Worker created from an
inline Blob, so it also works in the single-file build. TensorFlow.js and
Magenta load from jsDelivr, and the checkpoint from Google's bucket, only
when the user asks. Several candidates are decoded and scored
(`scoreTrio`, with optional density taste); the best is converted to
key-relative patterns (`trioToPatterns`, with a chord-fit setting). The
AI page is `src/ui/views/AiView.tsx`; the controller is
`src/ui/ensemble.ts`. Linked tracks are `external` and take queued patterns
at 4-bar phrase starts.

**State and storage.** `ProjectState` is one serialisable object with a
`schemaVersion`; `storage.ts` migrates older files on load. The UI never
mutates engine internals: it produces a new `ProjectState` and calls
`sequencer.update()`.

## UI

Preact, touch-first: every control is at least 44 px, sliders have large
thumbs, nothing depends on hover, and the layout collapses to one column
on phones and tablets. Themes plug in through a token contract and
optional UI slots (`src/ui/theme/`).

## Instrument data

`src/core/instruments/data/` is generated from
[midi.guide](https://midi.guide) by Pencil Research (CC BY-SA 4.0). Users
import more devices from the Devices page in the app. To bundle one as a
built-in, run `node scripts/import-midi-guide.ts path/to/Device.csv`.
