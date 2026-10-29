// The results input the tray stores and the cloud reader takes (tools/sessions/resultsInput.mjs), on a real payload:
// pit-wall thread 123, ticket 61 item 4. Run: node --test contract/
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

import {classPaceDoc} from '../src/analysis/classPace.ts';
import {finishOf} from '../src/analysis/raceResult.ts';
import {iracingResultsInput} from '../tools/sessions/irResults.mjs';
import {
  IBT_QUALIFYING_SOURCE,
  carriesRulings,
  readResultsInput,
} from '../tools/sessions/resultsInput.mjs';
import {newShape, payload} from './payloads.mjs';

const IR = payload('results-input', 'dev-iracing-ibt-qualifying');
const FIELD = {
  overall: 12,
  inClass: 5,
  ofOverall: 38,
  ofClass: 30,
  lapsDone: 34,
  leaderLapsDone: 34,
  classLeaderLapsDone: 34,
  leftEarly: false,
};

test('the reader takes the iRacing payload: its source kept, its cars folded into class pace', () => {
  const read = readResultsInput(JSON.stringify(IR));
  assert.equal(read.source, IBT_QUALIFYING_SOURCE);
  assert.equal(read.drivers.length, IR.drivers.length);
  assert.equal(carriesRulings(read), false);
  const doc = classPaceDoc(read.drivers);
  assert.equal(doc.drivers.filter(d => d.you).length, 1);
});

test('a qualifying input gives no race finish, even if a later edit gives its cars a place and a status', () => {
  const read = readResultsInput(JSON.stringify(IR));
  const finish = (drivers, field) =>
    finishOf({drivers, sessionType: 'R', field});
  assert.equal(finish(read.drivers, null), null);
  assert.deepEqual(finish(read.drivers, FIELD), FIELD);
  // The guard is the input's source, not the absence of fields: with `overall` and a finished status on every car, a
  // reader that trusted the drivers alone would answer from them.
  const forged = readResultsInput(
    JSON.stringify({
      ...IR,
      drivers: IR.drivers.map(d => ({
        ...d,
        overall: d.pos,
        status: 'Finished Normally',
      })),
    }),
  );
  assert.equal(forged.source, IBT_QUALIFYING_SOURCE);
  assert.equal(finish(forged.drivers, null), null);
  assert.deepEqual(finish(forged.drivers, FIELD), FIELD);
  // An input with no source (LMU's) is read as before: the same drivers give the file's finish.
  const lmuLike = readResultsInput(
    JSON.stringify({
      ...IR,
      source: undefined,
      drivers: IR.drivers.map(d => ({
        ...d,
        overall: d.pos,
        status: 'Finished Normally',
      })),
    }),
  );
  assert.equal(finish(lmuLike.drivers, null)?.source, 'results');
});

test('today\'s LMU input has no source and reads as it did: rulings kept, every key the writer made', () => {
  const lmu = {
    v: 2,
    strikes: [{et: 120.5, points: 1, outcome: 'warning', ruling: 'Warning'}],
    unplaced: 1,
    coveredFrom: 7.1,
    coveredTo: 1800,
    drivers: [
      {
        player: true,
        cls: 'GT3',
        car: 'Ford Mustang GT3',
        pos: 4,
        overall: 9,
        status: 'Finished Normally',
        laps: [{t: 101.2, s1: 30.1, s2: 40.2, s3: 30.9, pit: false}],
      },
    ],
  };
  const read = readResultsInput(JSON.stringify(lmu));
  assert.deepEqual(read, {
    strikes: lmu.strikes,
    unplaced: 1,
    coveredFrom: 7.1,
    coveredTo: 1800,
    drivers: lmu.drivers,
  });
  assert.equal('source' in read, false);
  assert.equal(carriesRulings(read), true);
});

test('a value of `source` the reader does not know is dropped, so a stored input from a later writer cannot change what the reader does', () => {
  const read = readResultsInput(JSON.stringify({...IR, source: 'something-new'}));
  assert.equal('source' in read, false);
  assert.equal(carriesRulings(read), true);
});

test('the producer writes no key or type the payload lacks', () => {
  const yaml = readFileSync(
    new URL('../tools/sessions/__fixtures__/irQualify.yaml', import.meta.url),
    'utf8',
  );
  assert.deepEqual(newShape('results-input', iracingResultsInput(yaml)), []);
});
