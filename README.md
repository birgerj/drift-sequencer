# Drift

A generative MIDI sequencer that runs entirely in the browser. Drift plays
evolving patterns — lead, bass, chords, arps, drones and drums — on your
hardware over USB MIDI, always in the same key and on the same chord, so you
can keep your hands on the synths.

- **No backend.** A static single-page app; projects are stored in the
  browser (IndexedDB) and can be exported/imported as `.json`.
- **Web MIDI.** Works in Chrome, Edge and Firefox (not Safari/iOS). Every
  port of a multi-port USB MIDI interface appears as its own output with 16
  channels, and each track picks a port + channel.
- **Tight timing.** A lookahead scheduler hands Web MIDI exact timestamps,
  so JavaScript timer jitter never reaches the music. Drift can send MIDI
  clock + start/stop to e.g. a Roland TR-8S.

## Run it

**Open the app:** [birgerj.github.io/drift-sequencer](https://birgerj.github.io/drift-sequencer/)
— use Chrome or Edge and connect your synths over USB MIDI.

**Install it:** on the live site, use *Install app* in the top bar (or the
install icon in Chrome's address bar). The installed app opens in its own
window and starts without internet.

**Offline, no install needed:** download [`docs/index.html`](docs/index.html) and
open it in Chrome or Edge (double-click). The whole app — code, styles and
icon — is inside that one file. Projects are saved in the browser.

**Publishing:** every push to `main` runs the tests, builds the app and
publishes it to GitHub Pages (`.github/workflows/publish.yml`). One-time
setup: Settings → Pages → Source: *GitHub Actions*.

## Develop

```sh
npm install
npm run dev               # http://localhost:5173 with hot reload
npm test                  # unit tests
npm run build:standalone  # rebuild docs/index.html — commit it with your change
```

## Architecture

```
src/
  core/                  pure TypeScript, no DOM — testable and Worker-ready
    theory/              Note, Scale/modes, Chord + voice leading, Harmony
    random/              seeded Rng (reproducible patterns and mutations)
    pattern/             chord-relative Pattern + resolver to MIDI notes
    generators/          one PatternGenerator per track type + registry
    engine/              LookaheadScheduler, TrackRuntime, Sequencer, LFOs
    instruments/         instrument definitions (CC/NRPN maps, drum notes)
    events.ts            typed event emitter (engine → UI)
  io/midi/               Web MIDI wrapper behind a MidiOutputPort interface
  state/                 ProjectState schema, templates, storage + migrations
  ui/                    view layer; talks only to the Sequencer API + events
```

**Harmony is the single source of truth.** Patterns never store MIDI notes
for melodic tracks. They store pitch *relative to the harmony* — a scale
degree from the current chord root, a chord tone, or "the whole chord" — and
the resolver turns that into notes at play time. A motif therefore keeps its
shape while following the progression, and all tracks always agree on key and
chord.

**Track types**

| Type     | What it plays                                                  |
| -------- | -------------------------------------------------------------- |
| `motif`  | Random-walk melody; strong beats pulled to chord tones; mutates |
| `arp`    | Chord tones up/down/up-down/random over N octaves               |
| `bass`   | Root on the downbeat, roots/fifths/octave jumps, offbeat option |
| `chords` | Voice-led chords, sustained or euclidean pulses                 |
| `drone`  | Long root note (key or chord)                                   |
| `drums`  | Euclidean voices with per-step probability (TR-8S note map)     |

**Evolution.** Every track mutates every N bars: a fraction of its notes
change, the rest stays, so music evolves without losing identity. Freeze a
track to stop it; every variation is kept in its history.

**Modulation.** Tracks can carry software LFOs that send MIDI CC (e.g. filter
cutoff). Instrument definitions map parameter names to CC numbers.

**State & storage.** `ProjectState` is one serialisable object with a
`schemaVersion`; `storage.ts` migrates older files on load. The UI never
mutates engine internals: it produces a new `ProjectState` and calls
`sequencer.update()`.

## Instrument data

`src/core/instruments/data/` is generated from
[midi.guide](https://midi.guide) by Pencil Research (CC BY-SA 4.0). Users
import more devices from the Instruments page in the app; to bundle one as a
built-in, run `node scripts/import-midi-guide.ts path/to/Device.csv`.

## UI

Preact, touch-first: every control is at least 44 px, sliders have large
thumbs, there is no hover-only behaviour, and the layout collapses to one
column on phones and tablets.

- **Perform** — all tracks with live pattern views, quick knobs, mute/solo,
  progression with the current chord, now playing, scale, evolution log.
- **Track editor** — track type, MIDI port/channel, instrument, generator
  knobs, drum voices, variations history, CC LFOs with a live waveform.
  Draw your own patterns: a step grid for drums (hit / 50% chance) and a
  note grid for motifs in scale degrees, so drawn melodies still follow the
  chords. Edited patterns are saved with the project.
- **Harmony** — key, mode and chord progression. Generate progressions in a
  style (pop, house, techno, ambient, cinematic, jazzy), vary one chord, or
  let the progression evolve by itself every few loops.
- **Step conditions & ratchets** — Elektron-style trig conditions (1:2, 3:4…)
  and 2–4× ratchets per step, drawn in the editor or added by the drum
  generator.
- **Call and response** — tracks take turns phrase by phrase; a responder
  can answer with the caller's phrase echoed, inverted, a third up, a fourth
  down or reversed. Try the *Conversation* template.
- **Projects** — templates, saved projects, JSON import/export.
- **Instruments** — browse and import midi.guide definitions straight from
  GitHub, or import CSV files.

**Timing in the background.** Browsers throttle timers in hidden tabs, so
the scheduler's clock runs in a Web Worker and the lookahead grows while the
page is hidden. (The engine stays on the main thread: Web MIDI isn't
available in workers.)

## Roadmap

- Knob panel that sends CCs from instrument definitions
- More templates and progression generators
- External clock sync (follow the TR-8S)
- PWA for offline use
