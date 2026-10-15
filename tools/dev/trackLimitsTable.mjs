// Which Resolutions delete the lap they land in: the table behind
// DELETING_RESOLUTIONS in tools/sessions/lmuResults.mjs (pit-wall thread 70,
// #5632 and #5634). Re-run it when LMU changes its rules.
//
//   node tools/dev/trackLimitsTable.mjs --driver "<name>" [<results folder>]
//
// The folder defaults to LMU's UserData\Log\Results; the driver, as the game
// names him in the files, is required. It reads the XML itself, not through
// parseResults, because that keeps only the Resolutions the reader knows and
// this table exists to show a new one. For each session type (P, Q, R from the file name) and Resolution:
// how many of his strikes land in a lap that reads `--.----` (deleted) and how
// many in a timed one. A lap n is [et_n, et_n+1): `et` is the lap's start
// (et[n+1] - et[n] is lap n's time, checked first and printed). Left out: lap 1,
// a pit lap, the out-lap after one, and the last lap (it has no end): they are
// counted beside each row, so No Further Action on an in-lap never looks like a
// deletion. A row identical to the one before it, et included, is dropped.
// A Resolution is a deleting one when its deleted share is 100 %.
import {readdirSync, readFileSync} from 'node:fs';
import {resolve} from 'node:path';

import {defaultResultsFolder, RULINGS} from '../sessions/lmuResults.mjs';

const args = process.argv.slice(2);
const flag = name => {
  const i = args.indexOf(name);
  return i < 0 ? null : args[i + 1];
};
const driverName = flag('--driver');
if (!driverName) {
  console.error('--driver "<name>" is required');
  process.exit(2);
}
const dir =
  args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--driver') ??
  defaultResultsFolder;

const table = {};
let timedLaps = 0;
let startMatches = 0;
let files = 0;
for (const name of readdirSync(dir).filter(n => n.endsWith('.xml'))) {
  const xml = readFileSync(resolve(dir, name), 'utf8');
  const block = xml
    .split('<Driver>')
    .slice(1)
    .find(b => b.includes(`<Name>${driverName}</Name>`));
  if (!block) continue;
  files++;
  const type = /-\d+([PQR])\d*\.xml$/.exec(name)?.[1] ?? '?';
  const laps = [
    ...block.matchAll(/<Lap num="(\d+)"([^>]*)>([^<]*)<\/Lap>/g),
  ].map(m => ({
    num: Number(m[1]),
    et: Number(/ et="([\d.]+)"/.exec(m[2])?.[1]),
    pit: / pit="1"/.test(m[2]),
    deleted: m[3].trim() === '--.----',
    time: Number(m[3]),
  }));
  for (let i = 0; i + 1 < laps.length; i++) {
    if (Number.isFinite(laps[i].time) && laps[i].time > 0) {
      timedLaps++;
      if (Math.abs(laps[i + 1].et - laps[i].et - laps[i].time) < 0.05)
        startMatches++;
    }
  }
  const spans = laps.map((l, i) => ({
    ...l,
    end: i + 1 < laps.length ? laps[i + 1].et : null,
    afterPit: i > 0 && laps[i - 1].pit,
  }));
  let previous = null;
  for (const [, raw] of xml.matchAll(/<TrackLimits ([^>]*)>/g)) {
    if (raw === previous) continue;
    previous = raw;
    if (!raw.includes(`Driver="${driverName}"`)) continue;
    const resolution = Number(/Resolution="(\d+)"/.exec(raw)[1]);
    const et = Number(/ et="([\d.]+)"/.exec(raw)[1]);
    const row = (table[`${type} ${resolution} ${RULINGS[resolution] ?? ''}`] ??=
      {
        strikes: 0,
        deleted: 0,
        timed: 0,
        lap1: 0,
        pit: 0,
        out: 0,
        unplaced: 0,
      });
    row.strikes++;
    const lap = spans.find(s => s.end != null && et >= s.et && et < s.end);
    if (!lap) row.unplaced++;
    else if (lap.num === 1) row.lap1++;
    else if (lap.pit) row.pit++;
    else if (lap.afterPit) row.out++;
    else if (lap.deleted) row.deleted++;
    else row.timed++;
  }
}
console.log(`${files} files with ${driverName} as a driver`);
console.log(
  `et[n+1] - et[n] = lap n's time on ${startMatches} of ${timedLaps} timed laps`,
);
console.log(
  [
    'session Resolution',
    'strikes',
    'deleted',
    'timed',
    'deleted %',
    'excl lap 1',
    'excl pit lap',
    'excl out-lap',
    'unplaced',
  ].join('\t'),
);
for (const key of Object.keys(table).sort()) {
  const t = table[key];
  const placed = t.deleted + t.timed;
  console.log(
    [
      key,
      t.strikes,
      t.deleted,
      t.timed,
      placed ? ((100 * t.deleted) / placed).toFixed(1) : '-',
      t.lap1,
      t.pit,
      t.out,
      t.unplaced,
    ].join('\t'),
  );
}
