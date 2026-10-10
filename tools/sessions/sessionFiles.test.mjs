import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, utimesSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {groupFiles, hash, sameSession, scanFolder} from './sessionFiles.mjs';

// A recording's description as the adapter makes it (the fields grouping reads).
const info = (n, extra = {}) => ({
  sim: 'lmu',
  source: `Road Atlanta_P_${n}.duckdb`,
  recordedAt: new Date(Date.UTC(2026, 8, 20, 10, 0, 0) + n * 20 * 60_000).toISOString(),
  layout: 'Road Atlanta',
  car: 'Porsche 911 GT3 R',
  sessionType: 'practice',
  sessionClock: 36000,
  startT: 1000 + n * 20 * 60, // the game's session timer advances with the wall clock
  endT: 1000 + n * 20 * 60 + 900,
  ...extra,
});
const file = (n, extra) => ({path: `/t/${n}.duckdb`, size: 100 + n, info: info(n, extra)});

test('files whose session timer kept pace with the wall clock are one session', () => {
  const [a, b, c] = [file(0), file(1), file(2)];
  assert.equal(sameSession(a.info, b.info), true);
  const sessions = groupFiles([c, a, b], 'botkin');
  assert.equal(sessions.length, 1);
  assert.deepEqual(sessions[0].files.map(f => f.info.source), [a, b, c].map(f => f.info.source), 'in time order, whatever order they came in');
});

test('a gap of more than six hours, a different car, layout or session type, or another owner is another session', () => {
  const far = file(30); // 10 hours later
  assert.equal(sameSession(file(0).info, far.info), false);
  assert.equal(groupFiles([file(0), far], 'botkin').length, 2);
  for (const change of [{car: 'Ferrari 296 GT3'}, {layout: 'Daytona'}, {sessionType: 'race'}]) {
    assert.equal(groupFiles([file(0), file(1, change)], 'botkin').length, 2, JSON.stringify(change));
  }
  const ids = owner => groupFiles([file(0)], owner)[0].id;
  assert.notEqual(ids('botkin'), ids('someone-else'), 'the owner is part of the id');
});

test('a restart on the same session clock is the same session only after a short false start or right after the file', () => {
  // The timer did not advance with the wall clock (a race restart), same clock.
  const first = file(0, {startT: 5000, endT: 5100}); // a 100 s false start
  const restart = file(1, {startT: 5000, endT: 7000});
  assert.equal(sameSession(first.info, restart.info), true, 'previous file was a short false start');
  // Two real races on the default clock must not merge.
  const longFirst = file(0, {startT: 5000, endT: 9000});
  const secondRace = file(1, {
    startT: 5000,
    endT: 9000,
    recordedAt: new Date(Date.parse(longFirst.info.recordedAt) + 2 * 3600_000).toISOString(), // two hours later
  });
  assert.equal(sameSession(longFirst.info, secondRace.info), false);
  assert.equal(sameSession(file(0, {sessionClock: 1}).info, file(1, {startT: 5000, sessionClock: 2}).info), false, 'a different clock is a different session');
});

test('the ids are the hash of the owner key and the first recording, exactly as the store has them', () => {
  const [session] = groupFiles([file(0), file(1)], 'botkin');
  const first = session.files[0].info;
  assert.equal(session.id, hash(['botkin', first.sim, first.layout, first.car, first.sessionType].join('|'), first.recordedAt));
  assert.equal(session.files[1].id, hash('botkin', first.sim, session.files[1].info.source, session.files[1].info.recordedAt));
  assert.match(session.id, /^[0-9a-f]{16}$/);
});

test('grouping does not reorder or change the array it is given', () => {
  const given = [file(2), file(0), file(1)];
  const copy = [...given];
  groupFiles(given, 'botkin');
  assert.deepEqual(given, copy);
});

test('groupId joins iRacing split files even when the wall clock would split them', () => {
  const gid = 'iracing|88284244|2';
  const first = file(0, {
    sim: 'iracing',
    groupId: gid,
    sessionClock: '88284244:2',
    startT: 100,
    endT: 1000,
  });
  const later = file(1, {
    sim: 'iracing',
    groupId: gid,
    sessionClock: '88284244:2',
    recordedAt: new Date(
      Date.parse(first.info.recordedAt) + 3 * 3600_000,
    ).toISOString(),
    startT: 400,
    endT: 8000,
  });
  assert.equal(sameSession(first.info, later.info), false);
  assert.equal(groupFiles([later, first], 'botkin').length, 1);
  const [session] = groupFiles([later, first], 'botkin');
  assert.deepEqual(
    session.files.map(f => f.info.startT),
    [100, 400],
  );
  assert.equal(
    groupFiles(
      [first, file(2, {sim: 'iracing', groupId: 'iracing|88284244|1'})],
      'botkin',
    ).length,
    2,
  );
});

test('offline iRacing drives (no groupId) are separate sessions on different days, one when the clock runs on', () => {
  // Every offline drive has SubSessionID 0; joining them by that id merged 603
  // files over two years into one session (thread 1 #3941).
  const day = d => new Date(Date.UTC(2026, 9, d, 14, 0, 0)).toISOString();
  const offline = (n, over) =>
    file(n, {
      sim: 'iracing',
      groupId: null,
      sessionClock: '0:0',
      layout: '444-grand_prix',
      car: 'Ford Mustang GT3',
      sessionType: 'Practice',
      ...over,
    });
  const fuji = offline(0, {recordedAt: day(4), startT: 119, endT: 2240});
  const sebring = offline(1, {recordedAt: day(9), startT: 90, endT: 1521});
  const sessions = groupFiles([sebring, fuji], 'botkin');
  assert.equal(sessions.length, 2);
  assert.deepEqual(
    sessions.map(x => x.files.length),
    [1, 1],
  );
  // The next file of the same drive, a minute later with the game clock running on.
  const next = offline(2, {
    recordedAt: new Date(Date.parse(day(4)) + (2240 - 119 + 60) * 1000).toISOString(),
    startT: 2300,
    endT: 2900,
  });
  assert.equal(groupFiles([fuji, next], 'botkin').length, 1);
});

test('session ids are owner-scoped for iRacing, online and offline: one drive, two owners, two ids', () => {
  const online = file(0, {sim: 'iracing', groupId: 'iracing|88284244|2'});
  const offline = file(1, {sim: 'iracing', groupId: null, sessionClock: '0:0'});
  for (const f of [online, offline]) {
    // groupFiles writes the recording ids onto the file objects it is given:
    // read each owner's ids before the next call.
    const ids = owner => {
      const [s] = groupFiles([f], owner);
      return [s.id, s.files[0].id];
    };
    const [sessionA, fileA] = ids('owner-a');
    const [sessionB, fileB] = ids('owner-b');
    assert.notEqual(sessionA, sessionB);
    assert.notEqual(fileA, fileB);
  }
  // The same owner and files give the same id every time.
  assert.equal(
    groupFiles([online], 'owner-a')[0].id,
    groupFiles([online], 'owner-a')[0].id,
  );
});

// -- scanning a folder ---------------------------------------------------------------------

function fakeAdapter(infos) {
  return {
    describeVersion: 7,
    described: [],
    isRecording: path => path.endsWith('.duckdb'),
    describe(path) {
      this.described.push(path);
      const name = path.split(/[\\/]/).pop();
      if (!infos[name]) throw new Error('not a database\nsecond line');
      return infos[name];
    },
  };
}

test('a scan describes recordings, skips files still being written and short ones, reuses its cache, and filters', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scan-'));
  const put = (name, ageMin) => {
    const p = join(dir, name);
    writeFileSync(p, 'x');
    const t = new Date(Date.now() - ageMin * 60_000);
    utimesSync(p, t, t);
  };
  mkdirSync(join(dir, 'sub'));
  put('a.duckdb', 60);
  put('b.duckdb', 60);
  put('short.duckdb', 60);
  put('writing.duckdb', 0.5);
  put('broken.duckdb', 60);
  put('notes.txt', 60);
  const infos = {
    'a.duckdb': info(0),
    'b.duckdb': info(1),
    'short.duckdb': info(2, {startT: 0, endT: 10}),
    'writing.duckdb': info(3),
  };
  const adapter = fakeAdapter(infos);
  const state = {files: {}};
  const lines = [];
  const found = scanFolder({folder: dir, adapter, state, log: l => lines.push(l)});
  assert.deepEqual(found.map(f => f.path.split(/[\\/]/).pop()).sort(), ['a.duckdb', 'b.duckdb']);
  assert.ok(lines.some(l => l.includes('1 file(s) still being written')));
  assert.ok(lines.some(l => l.startsWith('skip broken.duckdb: not a database')), lines.join('|'));
  assert.equal(adapter.described.filter(p => p.endsWith('a.duckdb')).length, 1);

  // Again: unchanged files come from the cache, not described again.
  const before = adapter.described.length;
  scanFolder({folder: dir, adapter, state});
  const again = adapter.described.slice(before).map(p => p.split(/[\\/]/).pop());
  assert.ok(!again.includes('a.duckdb') && !again.includes('b.duckdb'), `re-described: ${again}`);

  assert.deepEqual(scanFolder({folder: dir, adapter, state, only: 'b.'}).map(f => f.path.split(/[\\/]/).pop()), ['b.duckdb']);
  assert.deepEqual(scanFolder({folder: dir, adapter, state, since: '2026-09-21'}), [], 'nothing from that day on');
  assert.throws(() => scanFolder({folder: join(dir, 'nope'), adapter, state}), /No telemetry folder at/);
});
