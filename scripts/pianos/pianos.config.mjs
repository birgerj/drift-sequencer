// Source selection for Drift Synth Piano's downloadable sample packs.
// `node scripts/pianos/build-pianos.mjs <sources-dir>` turns these into
// trimmed mono FLAC files and piano.json manifests under public/pianos/.
//
// <sources-dir> holds shallow clones of these sfzinstruments repositories
// (github.com/sfzinstruments/<name>); the builder only needs the files it
// names, so `git clone --filter=blob:none` works:
//   SalamanderGrandPiano        Yamaha C5            (CC BY 3.0)
//   SplendidGrandPiano          Steinway, by Akai    (public domain)
//   BengtNilsson.HeadroomPiano  Yamaha C3            (CC BY 4.0)
//   GregSullivan.E-Pianos       Wurlitzer EP200      (CC BY 3.0)
//
// Each pack has two velocity layers, soft and hard. A layer is a list of
// zones; `regions` reads them from an sfz file, `every3` builds them for
// sample sets recorded every three semitones.

/** Zones for a set recorded every 3 semitones: each sample covers its note ±1. */
const every3 = (from, to, file) => {
  const zones = [];
  for (let key = from; key <= to; key += 3) zones.push({ lo: key === from ? 21 : key - 1, hi: key + 3 > to ? 108 : key + 1, key, file: file(key) });
  return zones;
};

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
/** MIDI note → "A0"-style name with C4 = 60. */
const sci = (n) => `${NAMES[n % 12]}${Math.floor(n / 12) - 1}`;

export const PIANOS = [
  {
    id: 'grand',
    name: 'Concert Grand',
    description: 'Yamaha C5 grand (Salamander Grand Piano)',
    source: 'Salamander Grand Piano by Alexander Holm, sfz by sfzinstruments (github.com/sfzinstruments/SalamanderGrandPiano)',
    license: 'CC BY 3.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/3.0/',
    layers: [
      { hivel: 84, zones: every3(21, 108, (k) => `SalamanderGrandPiano/Samples/${sci(k)}v7.flac`) },
      { hivel: 127, zones: every3(21, 108, (k) => `SalamanderGrandPiano/Samples/${sci(k)}v13.flac`) },
    ],
  },
  {
    id: 'steinway',
    name: 'Steinway',
    description: 'Steinway grand, warm and round (Splendid Grand Piano)',
    source: 'Splendid Grand Piano, Akai samples, sfz by sfzinstruments (github.com/sfzinstruments/SplendidGrandPiano)',
    license: 'Public domain',
    licenseUrl: 'https://github.com/sfzinstruments/SplendidGrandPiano',
    layers: [
      { hivel: 84, regions: { sfz: 'SplendidGrandPiano/Data/MP.txt', dir: 'SplendidGrandPiano/Samples', ext: 'flac' } },
      { hivel: 127, regions: { sfz: 'SplendidGrandPiano/Data/FF.txt', dir: 'SplendidGrandPiano/Samples', ext: 'flac' } },
    ],
  },
  {
    id: 'studio',
    name: 'Studio Grand',
    description: 'Yamaha C3 grand, close mics, bright (Headroom Piano)',
    source: 'Headroom Piano by Bengt Nilsson, sfz by sfzinstruments (github.com/sfzinstruments/BengtNilsson.HeadroomPiano)',
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    layers: [
      { hivel: 84, zones: every3(21, 102, (k) => `BengtNilsson.HeadroomPiano/Samples/HEADROOM PIANO LEVEL2 CLOSE ${k}.flac`) },
      { hivel: 127, zones: every3(21, 102, (k) => `BengtNilsson.HeadroomPiano/Samples/HEADROOM PIANO LEVEL4 CLOSE ${k}.flac`) },
    ],
  },
  {
    id: 'wurli',
    name: 'Wurlitzer',
    description: 'Wurlitzer EP200 electric piano',
    source: 'Greg Sullivan E-Pianos, sfz by sfzinstruments (github.com/sfzinstruments/GregSullivan.E-Pianos)',
    license: 'CC BY 3.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/3.0/',
    layers: [
      { hivel: 84, regions: { sfz: 'GregSullivan.E-Pianos/Wurlitzer EP200/Wurlitzer EP200.sfz', dir: 'GregSullivan.E-Pianos/Wurlitzer EP200/Samples', ext: 'flac', lovel: 38 } },
      { hivel: 127, regions: { sfz: 'GregSullivan.E-Pianos/Wurlitzer EP200/Wurlitzer EP200.sfz', dir: 'GregSullivan.E-Pianos/Wurlitzer EP200/Samples', ext: 'flac', lovel: 90 } },
    ],
  },
];
