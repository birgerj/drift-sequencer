# Getting started

[Manual](README.md) · Next: [The performance screen →](02-performance.md)

## What you need

- **A browser with Web MIDI** for hardware: Chrome or Edge on a computer.
  Safari and iOS have no Web MIDI; there you can still play the built-in
  *Drift Synth* sounds.
- **Synths or a drum machine** connected over USB MIDI (or a USB MIDI
  interface). Every port of a multi-port interface shows up as its own
  output with 16 channels.
- Nothing else: no account and no server. Projects are stored in your
  browser.

## Open Drift

| How | When to use it |
| --- | --- |
| [birgerj.github.io/drift-sequencer](https://birgerj.github.io/drift-sequencer/) | Quickest start. |
| **Install app** in the left bar (or the install icon in Chrome's address bar) | Drift in its own window. It starts without internet once installed and updates itself; when a new version is ready you'll see *A new version of Drift is ready* with a **Reload** button. |
| Open [index.html](https://birgerj.github.io/drift-sequencer/index.html), save it (Ctrl+S / Cmd+S, *Webpage, HTML only*) and double-click the saved file | Nothing to install: the whole app is in that one file. It plays offline; only the fonts of some themes need the internet. |

## Connect your synths

No synths at hand? Skip this: every track plays a built-in synth (*Lead*,
*Bass*, *Pad*, *Drums*, *Juno*, *Mono*, *Piano* or *Hum*), picked on its
**Output** tab. They play through your speakers, also in Safari and on
iPhone and iPad.

External synths and drum machines need Web MIDI: Chrome or Edge on a
computer or Android. Safari and browsers on iPhone and iPad don't have it.

1. Connect your synths over USB and switch them on.
2. Open **Devices** and click **Connect MIDI**; allow MIDI access. Next
   time Drift reconnects by itself.
3. Drift lists the connected ports that aren't set up yet. Click **Add
   all**: it guesses what each one plays (drum machine, bass, pad, lead),
   gives the drum machine channel 10 and MIDI clock, and picks its
   instrument definition where it knows it.
4. Check each device: its **Channel**, its **Instrument (CC map)** and
   **Used for** (Lead, Bass, Pad / chords, Drums). Templates send each part
   to the device used for it. See [Devices](08-devices.md).

Your devices are shared by every project and template, so switching
templates never loses your setup. One synth can play several parts: give
it several roles, or add it twice on different channels (multitimbral).

## Play

Press **Play** (or `Space`). The first time, Drift opens the *Deep house*
template: a lead, a bass line, a pad and drums in D dorian. After that it
reopens your last project. Things to try:

- Watch the lanes: every few bars a track mutates. The **Evolution** card
  on the right lists what changed.
- Click the dice on a lane for a new pattern, or **M** and **S** to mute
  and solo.
- Open **Projects** in the left bar and try another template, such as
  *Acid* or *Conversation*.
- Open **Harmony** and click **New progression**.

Next: [The performance screen →](02-performance.md)
