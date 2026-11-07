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

**Sampled drum kits** live in `public/kits/<id>/` (FLAC hits plus a
`kit.json` manifest) and are fetched on demand, so they stay out of
`index.html`. The build copies them to `standalone/kits/` (not committed;
CI publishes them). A `file://` copy downloads them from the published
site instead. To change a kit, edit `scripts/kits/kits.config.mjs` and run
`node scripts/kits/build-kits.mjs <sources-dir>` (needs ffmpeg; the config
lists the source repositories). That also bumps
`src/io/local/kitsVersion.json`, so browsers drop their cached copies.

**Piano packs** work the same way: `public/pianos/<id>/` (FLAC zones plus a
`piano.json` manifest of velocity layers and key zones), copied to
`standalone/pianos/` by the build. Edit `scripts/pianos/pianos.config.mjs`
and run `node scripts/pianos/build-pianos.mjs <sources-dir>`; with `--list`
it prints only the source files it needs, so blobless clones
(`git clone --filter=blob:none`) plus a checkout of those files are enough.
It bumps `src/io/local/pianosVersion.json`. Downloads for both go through
`src/io/local/sampleCache.ts`.

## Architecture

```
src/
  core/                  pure TypeScript, no DOM — testable and Worker-ready
    theory/              Note, Scale/modes, Chord + voice leading, Harmony
    random/              seeded Rng (reproducible patterns and mutations)
    pattern/             harmony-relative Pattern + resolver to MIDI notes
    generators/          one PatternGenerator per track type + registry
    engine/              LookaheadScheduler, TrackRuntime, Sequencer, LFOs, interplay
    instruments/         instrument definitions (CC/NRPN maps, drum notes)
    events.ts            typed event emitter (engine → UI)
  io/midi/               Web MIDI wrapper behind a MidiOutputPort interface
  io/local/              the built-in Drift Synth (Tone.js; the Juno and Mono are AudioWorklets; sampled kits and piano)
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

**Drift Synth Juno.** Six voices in one AudioWorkletNode
(`src/io/local/juno/junoProcessor.js`, plain JavaScript, written from
scratch). It is imported as text (`?raw`) and loaded from a Blob URL, or
from a `data:` URL on the native context when the file is opened from disk,
so it works in the single-file build. Notes are posted with their
AudioContext time and start on that exact frame. The CC map and its
real-unit values live in `junoParams.ts`; tests run the worklet source
directly in Node.

**Drift Synth Mono** works the same way (`src/io/local/mono/`). Both share
the loader in `src/io/local/workletSynth.ts`: a new worklet synth needs a
processor file, a params file (CC → real units, defaults) and an
instrument definition. Presets live in the definition (`presets`: name and
knob values by param id; knobs left out go to their default).

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
