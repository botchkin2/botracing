import {toLaps, toTrackMap} from '../adapters';

// A start straight and two sections (corners 1-2 and 3), cut at boundaries.
const boundaries = {
  v: 1,
  rev: 3,
  startsM: [150, 600],
  marginM: [20, 20],
  windows: [
    {kind: 'start-straight', section: null, fromM: 0, toM: 150, parts: []},
    {kind: 'section', section: 1, fromM: 150, toM: 600, parts: []},
    {kind: 'section', section: 3, fromM: 600, toM: 1000, parts: []},
  ],
};
const corner = (n: number, entryM: number) => ({
  n,
  entryM,
  apexM: entryM + 20,
  exitM: entryM + 40,
  parts: [],
});
export const map = () =>
  toTrackMap({
    lengthM: 1000,
    boundaries,
    corners: [
      {...corner(1, 200), parts: [corner(1, 200), corner(2, 300)]},
      corner(3, 700),
    ],
    outline: {features: []},
  });

export const seg = (time: number, fromM: number, toM: number) => ({
  segTime: time,
  offTrackSec: 0,
  localYellowSec: 0,
  parts: [],
  brakeApps: [],
  fromM,
  toM,
  runInS: time / 4,
  cornerS: time / 2,
  exitS: time / 4,
  pit: false,
});
// Twelve laps: the start straight scatters most (not a section, so skipped),
// section 2 scatters more than section 1.
export const lap = (i: number, comparable = true) => ({
  id: `l${i}`,
  lapTime: 100,
  stint: 1,
  comparable,
  reasons: [],
  sectors: [],
  cornerBoundaries: {v: 1, rev: 3},
  startStraight: {
    ...seg(5 + 2 * (i % 4), 0, 150),
    fromM: 0,
    toM: 150,
    pit: false,
  },
  corners: [
    seg(40 + 0.05 * (i % 4), 150, 600),
    seg(55 + 0.4 * (i % 4), 600, 1000),
  ],
  traffic: null,
});
export const laps = (n = 12) =>
  toLaps(Array.from({length: n}, (_, i) => lap(i)));
