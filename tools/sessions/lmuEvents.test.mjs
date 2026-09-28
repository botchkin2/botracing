// Run: node --test tools/sessions/
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {eventFor, logStart, parseLog} from './lmuEvents.mjs';

const T0 = Date.parse('2026-09-25T23:17:32Z');
const join = (s, kind, id, series) =>
  `${s}s RestNavigati  577: "UI info: Joining ${kind} server for online event ${id} - ${series} with car 397_25_911GT3R"`;
const menu = s =>
  `${s}s RestNavigati  342: Executing NAV_TO_MAIN_MENU from state NAV_EVENT `;
const ID1 = '5fcde786-da98-491a-bb48-126f411cfc55';
const ID2 = 'ccb85c6f-1a03-467d-a966-a7b415675401';

test('logStart reads the name as local time', () => {
  const ms = logStart('trace_2026_09_25_19_17_32-81.txt');
  assert.equal(ms, new Date(2026, 8, 25, 19, 17, 32).getTime());
  assert.equal(logStart('trace.txt'), null);
});

test('parseLog: practice, back to menu, then race until the log ends', () => {
  const text = [
    '   9.53s SoundEngineA  320: noise',
    join(650.98, 'practice', ID1, 'ELMS Super 60'),
    ' 700.00s slot.cpp     1060: sr(1,0)',
    menu(3716.81),
    join(4050.82, 'race', ID1, 'ELMS Super 60'),
    '8000.50s game.cpp     2855: last line',
  ].join('\r\n');
  const w = parseLog(text, T0, 'trace_x.txt');
  assert.equal(w.length, 2);
  assert.deepEqual(w[0], {
    eventId: ID1,
    series: 'ELMS Super 60',
    kind: 'practice',
    car: '397_25_911GT3R',
    joinedAt: new Date(T0 + 650980).toISOString(),
    endedAt: new Date(T0 + 3716810).toISOString(),
    source: 'trace_x.txt',
  });
  assert.equal(w[1].kind, 'race');
  assert.equal(w[1].endedAt, new Date(T0 + 8000500).toISOString());
});

test('parseLog: a second join closes the first', () => {
  const text = [
    join(10, 'race', ID1, 'One Stint Sprint'),
    join(20, 'race', ID2, 'ELMS Super 60'),
    menu(30),
  ].join('\n');
  const w = parseLog(text, T0, 'x');
  assert.deepEqual(
    w.map(x => [x.series, x.endedAt]),
    [
      ['One Stint Sprint', new Date(T0 + 20000).toISOString()],
      ['ELMS Super 60', new Date(T0 + 30000).toISOString()],
    ],
  );
});

test('parseLog: a log with no join has no windows', () => {
  assert.deepEqual(parseLog(menu(5), T0, 'x'), []);
});

test('eventFor matches inside a window, null outside', () => {
  const windows = parseLog(
    [join(100, 'race', ID1, 'ELMS Super 60'), menu(4000)].join('\n'),
    T0,
    'x',
  );
  const during = new Date(T0 + 900 * 1000).toISOString();
  assert.deepEqual(eventFor(windows, during), {
    eventId: ID1,
    series: 'ELMS Super 60',
    kind: 'race',
    joinedAt: new Date(T0 + 100000).toISOString(),
    gapS: 800,
  });
  // Offline running after leaving the server, and before joining.
  assert.equal(
    eventFor(windows, new Date(T0 + 5000 * 1000).toISOString()),
    null,
  );
  assert.equal(eventFor(windows, new Date(T0 + 50 * 1000).toISOString()), null);
  assert.equal(eventFor([], during), null);
});
