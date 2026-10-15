import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';

import {parseResults, resultsFor} from './lmuResults.mjs';

const row = (driver, lap, res, et, pts = 0) =>
  `<TrackLimits Driver="${driver}" ID="1" Lap="${lap}" WarningPoints="${pts}" CurrentPoints="${pts}" Resolution="${res}" et="${et}">x</TrackLimits>`;
const file = (rows, over = '') => `<rFactorXML><RaceResults>
<DateTime>1792025756</DateTime><TrackCourse>Silverstone Grand Prix Circuit - ELMS</TrackCourse>${over}
<Stream>${rows.join('\n')}</Stream></RaceResults></rFactorXML>`;

test('a row identical to the one before it, et included, is one strike; two strikes at different et are two', () => {
  const xml = file([
    row('A', 0, 7, 166.7),
    row('A', 0, 7, 166.7),
    row('Me', 23, 4, 6795.5, 0.25),
    row('Me', 23, 4, 6813.4, 0.25),
  ]);
  const r = parseResults(xml);
  assert.deepEqual(r.rows.map(x => [x.driver, x.et]), [['A', 166.7], ['Me', 6795.5], ['Me', 6813.4]]);
  assert.equal(r.startedAtMs, 1792025756000);
});

test('the Resolution code is the ruling', () => {
  const r = parseResults(file([row('Me', 1, 4, 1), row('Me', 2, 5, 2), row('Me', 3, 6, 3), row('Me', 4, 7, 4), row('Me', 5, 9, 5)]));
  assert.deepEqual(r.rows.map(x => x.outcome), ['warning', 'invalidCut', 'invalidOff', 'none']);
});

test('resultsFor returns our driver by name from the file that covers the session', () => {
  const dir = mkdtempSync(join(tmpdir(), 'results-'));
  try {
    writeFileSync(join(dir, 'a.xml'), file([row('Me', 10, 4, 1390.7, 0.25), row('Other', 10, 4, 1391.1, 0.25)]));
    writeFileSync(join(dir, 'b.xml'), file([row('Me', 1, 5, 9)]).replace('1792025756', '1700000000'));
    const start = new Date(1792025756000 + 60000).toISOString();
    const end = new Date(1792025756000 + 1500000).toISOString();
    const span = {startedAt: start, endedAt: end};
    assert.deepEqual(resultsFor({span, driverName: 'Me', folder: dir}), {
      strikes: [{et: 1390.7, lap: 10, points: 0.25, outcome: 'warning'}],
    });
    assert.deepEqual(resultsFor({span, driverName: 'Nobody', folder: dir}), {strikes: []});
    assert.deepEqual(resultsFor({span, driverName: '', folder: dir}), {absent: 'no driver name'});
    assert.deepEqual(
      resultsFor({span: {startedAt: '2020-01-01T00:00:00Z', endedAt: '2020-01-01T01:00:00Z'}, driverName: 'Me', folder: dir}),
      {absent: 'no results file covers the session'},
    );
    assert.deepEqual(resultsFor({span, driverName: 'Me', trackCourse: 'Elsewhere', folder: dir}), {
      absent: 'no results file covers the session',
    });
    assert.deepEqual(resultsFor({span, driverName: 'Me', folder: join(dir, 'missing')}), {absent: 'no results folder'});
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test("the game's real doubled pair (2026_10_14_22_14_53-60R1.xml lines 39-40, name scrubbed) is one strike", () => {
  const real = '<TrackLimits Driver="AI One" ID="3" Lap="0" WarningPoints="0" CurrentPoints="0" Resolution="7" et="166.7">No Further Action</TrackLimits>';
  const r = parseResults(file([real, real, real.replace('166.7', '192.9'), real.replace('166.7', '192.9')]));
  assert.deepEqual(r.rows.map(x => x.et), [166.7, 192.9]);
});

test('a name is matched exactly: accents and a trailing space count, XML entities are decoded', () => {
  const dir = mkdtempSync(join(tmpdir(), 'results-'));
  try {
    writeFileSync(
      join(dir, 'a.xml'),
      file([
        row('Zoë Müller ', 3, 4, 100, 0.25),
        row('Zoë Müller', 4, 5, 200),
        row('Tom &amp; Jerry', 5, 6, 300),
      ]),
    );
    const span = {startedAt: new Date(1792025756000 + 1000).toISOString(), endedAt: new Date(1792025756000 + 400000).toISOString()};
    const strikes = driverName => resultsFor({span, driverName, folder: dir}).strikes.map(s => s.et);
    assert.deepEqual(strikes('Zoë Müller '), [100]);
    assert.deepEqual(strikes('Zoë Müller'), [200]);
    assert.deepEqual(strikes('Tom & Jerry'), [300]);
    assert.deepEqual(strikes('Zoe Muller'), []);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});
