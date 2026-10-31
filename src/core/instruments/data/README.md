# Instrument data

Files in this folder are generated from [midi.guide](https://midi.guide)
([github.com/pencilresearch/midi](https://github.com/pencilresearch/midi)) by
Pencil Research, licensed under
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Changes to
these data files are shared under the same license.

Regenerate or add a device:

```sh
node scripts/import-midi-guide.mjs path/to/midi/Roland/TR-8S.csv
```

The `drift-synth-*.json` files describe Drift's own built-in Web Audio
instruments (the "Drift Synth" ports) and are not from midi.guide.
