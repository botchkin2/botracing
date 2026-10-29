import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gzipSync} from 'node:zlib';
import {test} from 'node:test';

import {classPaceDoc} from '../../src/analysis/classPace.ts';
import {finishOf} from '../../src/analysis/raceResult.ts';
import {docProblems} from './docShape.mjs';
import {iracingResultsInput} from './irResults.mjs';
import {
  IBT_QUALIFYING_SOURCE,
  carriesRulings,
  readResultsInput,
} from './resultsInput.mjs';

// His Road Atlanta race of 2026-08-27 (fordmustanggt3_roadatlanta full 21-08-42.ibt), cut down to what the reader looks at:
// DriverInfo's cars (class, model; no names) and the QUALIFY session's results. The practice and the race are there with
// their empty and snapshot results, as in the file.
const YAML = readFileSync(
  new URL('./__fixtures__/irQualify.yaml', import.meta.url),
  'utf8',
);

test("the qualifying session's timed cars become drivers: a class, a model, a class place, one lap", () => {
  const input = iracingResultsInput(YAML);
  assert.equal(input.v, 2);
  assert.equal(input.source, IBT_QUALIFYING_SOURCE);
  assert.deepEqual(input.strikes, []);
  assert.equal(input.coveredFrom, null);
  const classes = new Map();
  for (const d of input.drivers)
    classes.set(d.cls, (classes.get(d.cls) ?? 0) + 1);
  assert.deepEqual([...classes.keys()].sort(), ['GT3', 'GTP']);
  assert.ok(input.drivers.length >= 30);
  const me = input.drivers.filter(d => d.player);
  assert.equal(me.length, 1);
  assert.equal(me[0].cls, 'GT3');
  assert.equal(me[0].car, 'Ford Mustang GT3');
  for (const d of input.drivers) {
    assert.equal(d.laps.length, 1);
    assert.ok(d.laps[0].t > 60 && d.laps[0].t < 120);
    assert.deepEqual(
      [d.laps[0].s1, d.laps[0].s2, d.laps[0].s3],
      [null, null, null],
    );
    assert.ok(Number.isInteger(d.pos) && d.pos >= 1);
  }
});

test('a qualifying place is not a finish: no overall and no status, so the race result is never read from it', () => {
  const input = iracingResultsInput(YAML);
  for (const d of input.drivers) {
    assert.equal('overall' in d, false);
    assert.equal('status' in d, false);
  }
  const stored = readResultsInput(JSON.stringify(input));
  const field = {
    overall: 12,
    inClass: 5,
    ofOverall: 38,
    ofClass: 30,
    lapsDone: 34,
    leaderLapsDone: 34,
    classLeaderLapsDone: 34,
    leftEarly: false,
  };
  assert.deepEqual(
    finishOf({drivers: stored.drivers, sessionType: 'R', field}),
    field,
  );
});

test("class pace folds from it like the LMU file's: one best a car, no median, per class, nobody named", () => {
  const input = iracingResultsInput(YAML);
  const doc = classPaceDoc(readResultsInput(JSON.stringify(input)).drivers);
  assert.equal(doc.drivers.length, input.drivers.length);
  for (const d of doc.drivers) {
    assert.equal(d.laps, 1);
    assert.equal(d.median, null);
    assert.ok(d.best > 0);
  }
  assert.equal(doc.drivers.filter(d => d.you).length, 1);
  assert.deepEqual(docProblems(doc), []);
});

test('the stored input keeps its source, and a stored LMU input has none', () => {
  const input = iracingResultsInput(YAML);
  assert.equal(
    readResultsInput(JSON.stringify(input)).source,
    IBT_QUALIFYING_SOURCE,
  );
  const lmu = {
    v: 2,
    strikes: [],
    unplaced: 0,
    coveredFrom: 1,
    coveredTo: 2,
    drivers: [],
  };
  assert.equal('source' in readResultsInput(JSON.stringify(lmu)), false);
  assert.ok(gzipSync(JSON.stringify(input)).length < 4000);
});

test('no input from a file with no timed qualifying lap: a practice drive, a session that skipped qualifying, a file with no YAML', () => {
  assert.equal(iracingResultsInput(''), null);
  assert.equal(iracingResultsInput(null), null);
  const noQualify = YAML.replace(
    /SessionType: Lone Qualify/,
    'SessionType: Practice',
  );
  assert.equal(iracingResultsInput(noQualify), null);
  const untimed = YAML.replace(/FastestTime: [\d.]+/g, 'FastestTime: -1.0000');
  assert.equal(iracingResultsInput(untimed), null);
});

test('the last qualifying session with a timed lap is the weekend grid', () => {
  const second = `   SessionType: Open Qualify
   ResultsPositions:
   - Position: 1
     ClassPosition: 0
     CarIdx: 40
     FastestLap: 3
     FastestTime: 70.5000
     LapsComplete: 3
`;
  const yaml = YAML.replace(
    /\n - SessionNum: 2\n   SessionType: Race/,
    `\n - SessionNum: 2\n${second} - SessionNum: 3\n   SessionType: Race`,
  );
  const input = iracingResultsInput(yaml);
  assert.equal(input.drivers.length, 1);
  assert.equal(input.drivers[0].laps[0].t, 70.5);
  assert.equal(input.drivers[0].player, true);
});

test('no name or number is read: the YAML names are not in the input', () => {
  const withNames = YAML.replace(
    / - CarIdx: 40\n/,
    ' - CarIdx: 40\n   UserName: Somebody Real\n   TeamName: A Team\n   CarNumber: "77"\n',
  );
  const text = JSON.stringify(iracingResultsInput(withNames));
  assert.equal(/Somebody|A Team|CarNumber|UserName|TeamName/.test(text), false);
});

test('an input of class bests carries no rulings, so the session gets no track-limit totals from it; an LMU input and no input behave as before', () => {
  assert.equal(
    carriesRulings(readResultsInput(JSON.stringify(iracingResultsInput(YAML)))),
    false,
  );
  assert.equal(
    carriesRulings({
      strikes: [],
      unplaced: 0,
      coveredFrom: null,
      coveredTo: null,
    }),
    true,
  );
  assert.equal(carriesRulings(null), false);
});
