// Source selection for Drift's downloadable sampled drum kits.
// `node scripts/kits/build-kits.mjs <sources-dir>` turns these into the
// trimmed mono FLAC files and kit.json manifests under public/kits/.
//
// <sources-dir> holds shallow clones of:
//   avl/     github.com/studiorack/avl-drumkits           (CC BY-SA 3.0)
//   swirly/  github.com/sfzinstruments/karoryfer.swirly-drums (CC0)
//   danigb/  github.com/danigb/samples                     (drum-machines/)
//
// Each piece lists velocity layers from soft to hard; a layer is one file or
// several files mixed (close mics). Gain and pan are applied at playback;
// kitGain evens out loudness between kits.

const avl = (name, layers = [1, 2, 3, 4, 5]) => layers.map((i) => [`avl/Samples/${name}-${i}.flac`]);
const sw = (folder, stem, vls, mics = ['']) => vls.map((v) => mics.map((m) => `swirly/Samples/${folder}/${stem}_vl${v}_rr1${m}.wav`));
const d808 = (f) => [[`danigb/audio/drum-machines/TR-808/${f}`]];
const linn = (f) => [[`danigb/audio/drum-machines/LM-2/${f}`]];

const AVL_CREDIT = {
  source: 'AVL Drumkits by Glen MacArthur (bandshed.net/avldrumkits)',
  license: 'CC BY-SA 3.0',
  licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/',
};

export const KITS = [
  {
    id: 'acoustic',
    name: 'Acoustic',
    description: 'Pearl kit with Sabian cymbals, five velocity layers',
    ...AVL_CREDIT,
    pieces: {
      kick: { layers: avl('36-Pearl22Kick'), gain: 1 },
      snare: { layers: avl('38-PearlSnare'), gain: 0.9 },
      snareAlt: { layers: avl('40-PearlSnareEdge'), gain: 0.85 },
      rim: { layers: avl('37-SideStick'), gain: 0.8 },
      clap: { layers: avl('39-HandClap'), gain: 0.8 },
      hatClosed: { layers: avl('42-SabianRockHatClosed'), gain: 0.55, pan: 0.3 },
      hatPedal: { layers: avl('44-SabianRockHatPedal'), gain: 0.5, pan: 0.3 },
      hatOpen: { layers: avl('46-SabianRockHatSemiOpen'), gain: 0.55, pan: 0.3 },
      tomHigh: { layers: avl('45-Pearl12Tom'), gain: 0.8, pan: 0.25 },
      tomMid: { layers: avl('47-Pearl13Tom2'), gain: 0.8, pan: -0.1 },
      tomLow: { layers: avl('41-Pearl16FloorTom'), gain: 0.85, pan: -0.35 },
      crash: { layers: avl('49-SabianAA16Crash'), gain: 0.6, pan: 0.35 },
      ride: { layers: avl('51-SabianAAX20Ride'), gain: 0.5, pan: -0.4 },
      rideBell: { layers: avl('53-SabianAAX20RideBell'), gain: 0.45, pan: -0.4 },
      tambourine: { layers: avl('54-Tambourine', [2, 4]), gain: 0.4, pan: 0.5 },
      cowbell: { layers: avl('56-Cowbell', [2, 4]), gain: 0.4, pan: -0.3 },
      shaker: { layers: avl('64-Maraca', [2, 4]), gain: 0.35, pan: 0.45 },
    },
  },
  {
    id: 'vintage',
    name: 'Vintage',
    description: 'Ludwig kit with a porkpie snare and Zildjian cymbals',
    ...AVL_CREDIT,
    pieces: {
      kick: { layers: avl('36-Ludwig26Kick'), gain: 1 },
      snare: { layers: avl('38-PorkpieSnare'), gain: 0.9 },
      snareAlt: { layers: avl('40-PorkpieSnareEdge'), gain: 0.85 },
      rim: { layers: avl('37-Sidestick2'), gain: 0.8 },
      clap: { layers: avl('39-HandClap'), gain: 0.8 },
      hatClosed: { layers: avl('42-SabianRockHatClosed'), gain: 0.5, pan: 0.3 },
      hatPedal: { layers: avl('44-SabianRockHatPedal'), gain: 0.5, pan: 0.3 },
      hatOpen: { layers: avl('46-SabianRockHatSemiOpen'), gain: 0.5, pan: 0.3 },
      tomHigh: { layers: avl('45-Ludwig14Tom'), gain: 0.8, pan: 0.2 },
      tomMid: { layers: avl('41-Ludwig16FloorTom'), gain: 0.85, pan: -0.15 },
      tomLow: { layers: avl('43-Ludwig18FloorTom'), gain: 0.85, pan: -0.35 },
      crash: { layers: avl('57-ZildjianK17Crash'), gain: 0.6, pan: 0.35 },
      ride: { layers: avl('51-ZildjianA24Ride'), gain: 0.5, pan: -0.4 },
      rideBell: { layers: avl('53-ZildjianA24RideBell'), gain: 0.45, pan: -0.4 },
      tambourine: { layers: avl('54-Tambourine', [2, 4]), gain: 0.4, pan: 0.5 },
      cowbell: { layers: avl('56-Cowbell', [2, 4]), gain: 0.4, pan: -0.3 },
      shaker: { layers: avl('64-Maraca', [2, 4]), gain: 0.35, pan: 0.45 },
    },
  },
  {
    id: 'jazz',
    name: 'Jazz brushes',
    kitGain: 1.5,
    description: 'Brushes kit; note 40 plays a brush sweep',
    source: 'Swirly Drums by Karoryfer Samples (karoryfer.com)',
    license: 'CC0 1.0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    pieces: {
      kick: { layers: sw('marching_kick', 'marching_kick', [4, 8, 12], ['_beater', '_reso']), gain: 0.8 },
      snare: { layers: sw('snare_main', 'snare_hit', [4, 8, 12], ['_top', '_btm']), gain: 0.8 },
      snareAlt: { layers: [1, 2, 3, 4].map((i) => [`swirly/Samples/snare_stir/stir_dl${i}_rr1.wav`]), gain: 0.45, maxSeconds: 2.5 },
      rim: { layers: sw('snare_edge', 'snare_edge', [5, 9], ['_top', '_btm']), gain: 0.7 },
      hatClosed: { layers: sw('hat_tight', 'hh_tight', [4, 8, 12]), gain: 0.45, pan: 0.3 },
      hatPedal: { layers: sw('hat_foot', 'hh_foot', [5, 9]), gain: 0.55, pan: 0.3 },
      hatOpen: { layers: sw('hat_open', 'hh_open', [5, 9]), gain: 0.45, pan: 0.3 },
      tomHigh: { layers: sw('tom_mhi', 'tom_mhi', [5, 9]), gain: 0.75, pan: 0.2 },
      tomMid: { layers: sw('tom_mlow', 'tom_mlow', [5, 9]), gain: 0.75, pan: -0.1 },
      tomLow: { layers: sw('tom_floor', 'tom_floor', [5, 9]), gain: 0.8, pan: -0.35 },
      crash: { layers: sw('crash', 'crash', [5, 9]), gain: 0.55, pan: 0.35 },
      ride: { layers: sw('ride', 'ride', [4, 8, 12]), gain: 0.6, pan: -0.35 },
      cowbell: { layers: sw('cowbell', 'cowbell', [5, 9]), gain: 0.4, pan: -0.3 },
    },
  },
  {
    id: 'deep-house',
    name: 'Deep house',
    description: 'TR-808 sampled hit by hit, with congas and maracas',
    source: 'Roland TR-808 sample set by Michael Fischer (Technopolis), via github.com/danigb/samples',
    license: 'Free sample set; free to use per the author’s notes',
    licenseUrl: 'https://github.com/danigb/samples',
    pieces: {
      kick: { layers: d808('kick/bd2575.ogg'), gain: 1 },
      snare: { layers: d808('snare/sd5050.ogg'), gain: 0.6 },
      snareAlt: { layers: d808('snare/sd2525.ogg'), gain: 0.6 },
      rim: { layers: d808('rimshot/rs.ogg'), gain: 0.5, pan: -0.2 },
      clap: { layers: d808('clap/cp.ogg'), gain: 0.75 },
      hatClosed: { layers: d808('hihat-close/ch.ogg'), gain: 0.45, pan: 0.3 },
      hatPedal: { layers: d808('hihat-close/ch.ogg'), gain: 0.35, pan: 0.3 },
      hatOpen: { layers: d808('hihat-open/oh25.ogg'), gain: 0.45, pan: 0.3 },
      tomHigh: { layers: d808('tom-hi/ht50.ogg'), gain: 0.6, pan: 0.3 },
      tomMid: { layers: d808('mid-tom/mt50.ogg'), gain: 0.6 },
      tomLow: { layers: d808('tom-low/lt50.ogg'), gain: 0.6, pan: -0.3 },
      crash: { layers: d808('cymbal/cy5050.ogg'), gain: 0.4, pan: 0.3 },
      ride: { layers: d808('cymbal/cy7525.ogg'), gain: 0.3, pan: -0.3 },
      cowbell: { layers: d808('cowbell/cb.ogg'), gain: 0.35, pan: -0.3 },
      shaker: { layers: d808('maraca/ma.ogg'), gain: 0.3, pan: 0.5 },
      clave: { layers: d808('clave/cl.ogg'), gain: 0.35, pan: 0.2 },
      congaLow: { layers: d808('conga-low/lc50.ogg'), gain: 0.45, pan: -0.4 },
      congaHigh: { layers: d808('conga-hi/hc50.ogg'), gain: 0.4, pan: 0.4 },
    },
  },
  {
    id: 'linn',
    name: '80s Linn',
    kitGain: 1.25,
    description: 'LinnDrum LM-2 for disco and 80s pop',
    source: 'LinnDrum LM-2 samples via github.com/danigb/samples',
    license: 'Unverified — source repository lists no license for this set',
    licenseUrl: 'https://github.com/danigb/samples',
    pieces: {
      kick: { layers: linn('kick.ogg'), gain: 1 },
      snare: { layers: linn('snare-m.ogg'), gain: 0.8 },
      snareAlt: { layers: linn('snare-h.ogg'), gain: 0.8 },
      rim: { layers: linn('stick-m.ogg'), gain: 0.5 },
      clap: { layers: linn('clap.ogg'), gain: 0.6 },
      hatClosed: { layers: linn('hhclosed.ogg'), gain: 0.45, pan: 0.3 },
      hatPedal: { layers: linn('hhclosed-short.ogg'), gain: 0.4, pan: 0.3 },
      hatOpen: { layers: linn('hhopen.ogg'), gain: 0.45, pan: 0.3 },
      tomHigh: { layers: linn('tom-h.ogg'), gain: 0.7, pan: 0.3 },
      tomMid: { layers: linn('tom-m.ogg'), gain: 0.7 },
      tomLow: { layers: linn('tom-l.ogg'), gain: 0.7, pan: -0.3 },
      crash: { layers: linn('crash.ogg'), gain: 0.5, pan: 0.3 },
      ride: { layers: linn('ride.ogg'), gain: 0.4, pan: -0.3 },
      tambourine: { layers: linn('tambourine.ogg'), gain: 0.35, pan: 0.45 },
      cowbell: { layers: linn('cowbell.ogg'), gain: 0.3, pan: -0.3 },
      shaker: { layers: linn('cabasa.ogg'), gain: 0.3, pan: 0.45 },
      congaLow: { layers: linn('conga-l.ogg'), gain: 0.4, pan: -0.4 },
      congaHigh: { layers: linn('conga-h.ogg'), gain: 0.4, pan: 0.4 },
    },
  },
];
