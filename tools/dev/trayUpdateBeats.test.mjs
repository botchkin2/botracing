import assert from 'node:assert/strict';
import {test} from 'node:test';

import {parseBeats, report, updatesSeen} from './trayUpdateBeats.mjs';

const beat = (at, version, updateWaiting) => JSON.stringify({lastSeenAt: at, version, ...(updateWaiting ? {updateWaiting} : {})});

// His 10-22 and 10-26 shapes (status.jsonl, read 2026-10-27): 0.1.15 saw 0.1.16 in one beat
// and came back as 0.1.16 48 s later; 0.1.17 held 0.1.18 for a day.
const LOG = [
  beat('2026-10-22T02:55:00.000Z', '0.1.15'),
  beat('2026-10-22T03:01:17.284Z', '0.1.15', '0.1.16'),
  beat('2026-10-22T03:02:05.799Z', '0.1.16'),
  beat('2026-10-26T02:27:47.080Z', '0.1.17', '0.1.18'),
  beat('2026-10-26T12:00:00.000Z', '0.1.17', '0.1.18'),
  beat('2026-10-26T23:50:31.954Z', '0.1.17', '0.1.18'),
  beat('2026-10-26T23:54:03.626Z', '0.1.18'),
].join('\n');

test('a line that is not a beat is skipped, a half-written last line included', () => {
  const beats = parseBeats(`${beat('2026-10-22T03:00:00Z', '0.1.15')}\nnot json\n{"version":"x"}\n{"lastSeenAt":"2026-10-2`);
  assert.equal(beats.length, 1);
});

test('each update is reported with its beats, its span and when the tray came back on it', () => {
  const seen = updatesSeen(parseBeats(LOG));
  assert.deepEqual(
    seen.map(e => [e.version, e.runningVersion, e.beats, e.installedAt]),
    [
      ['0.1.16', '0.1.15', 1, '2026-10-22T03:02:05.799Z'],
      ['0.1.18', '0.1.17', 3, '2026-10-26T23:54:03.626Z'],
    ],
  );
  assert.equal(seen[1].firstAt, '2026-10-26T02:27:47.080Z');
  assert.equal(seen[1].lastAt, '2026-10-26T23:50:31.954Z');
});

test('a target that was waiting passes, and the report says how long it lasted', () => {
  const {lines, found} = report(parseBeats(LOG), '0.1.18');
  assert.equal(found, true);
  assert.match(lines.join('\n'), /updateWaiting 0\.1\.18: seen by tray 0\.1\.17, 3 beats, .* \(1282\.7 min\); running 0\.1\.18 at/);
  assert.match(lines.at(-1), /^PASS: 3 beats carried updateWaiting 0\.1\.18/);
});

test('a target no beat carried fails, and says so', () => {
  const {lines, found} = report(parseBeats(LOG), '0.1.19');
  assert.equal(found, false);
  assert.equal(lines.at(-1), 'FAIL: no beat carried updateWaiting 0.1.19');
});

test('an update seen in one beat reads as one beat, and one not yet installed says so', () => {
  const {lines} = report(parseBeats(beat('2026-10-30T10:00:00Z', '0.1.18', '0.1.19')));
  assert.match(lines.join('\n'), /1 beat, 2026-10-30T10:00:00Z to 2026-10-30T10:00:00Z \(0\.0 min\); not running it yet/);
});

test('a log with no update waiting says so, and an empty log does not throw', () => {
  assert.match(report(parseBeats(beat('2026-10-22T02:55:00Z', '0.1.15'))).lines.join('\n'), /no beat carried updateWaiting/);
  assert.equal(report([]).lines[0], '0 beats, none to none');
});
