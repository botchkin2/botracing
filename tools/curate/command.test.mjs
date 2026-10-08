import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as lmu from '../sessions/lmu.mjs';
import {sessionBoundaries} from '../sessions/layoutBoundaries.mjs';
import {makeLap, map as synthMap} from '../sessions/syntheticLap.mjs';
import {parseArgs, run} from './curate.mjs';
import {memoryCatalog} from './fixture.mjs';

const MAP = {
  mapVersion: 4,
  lengthM: synthMap.lengthM,
  stepM: 5,
  corners: synthMap.corners,
};
const state = sessionBoundaries({
  laps: [
    [650, 1450],
    [652, 1452],
    [648, 1448],
  ].map(([a, b]) => makeLap(a, b).lap),
  map: {lengthM: MAP.lengthM, corners: synthMap.corners},
  stored: null,
  sessionId: 'built',
  fold: {minLaps: 1, minSessions: 1},
}).state;
const ID = 'lmu-road_atlanta';
const info = (layout = 'Road Atlanta') => ({
  sim: 'lmu',
  track: layout,
  layout,
  car: 'GT3',
  sessionType: 'practice',
  recordedAt: '2026-09-20T10:00:00.000Z',
});
const session = id => ({
  id,
  files: [{id: `${id}-r`, path: '/x', info: info()}],
});
const loader = layout => ({
  findSessions: () => [
    session('aaaaaa1111'),
    {
      ...session('bbbbbb2222'),
      files: [{id: 'r', path: '/y', info: info('Daytona')}],
    },
  ],
  buildFromSession: ({session: s}) => ({
    map: MAP,
    boundaries: state,
    lapsUsed: 12,
    gps: true,
    sessionId: s.id,
    sim: 'lmu',
    track: {name: layout, variant: layout},
  }),
});
const deps = (backend, layout = 'Road Atlanta') => ({
  backend,
  adapter: lmu,
  folder: '/f',
  ownerId: 'botkin',
  workDir: '/w',
  by: 'botkin',
  now: () => '2026-10-06T12:00:00Z',
  loader: loader(layout),
});
const text = r => r.lines.join('\n');

test('arguments: flags with values, bare flags, and a missing value is an error', () => {
  assert.deepEqual(
    parseArgs(['plan-add', ID, '--session', 'abc123', '--apply']),
    {_: ['plan-add', ID], flags: {session: 'abc123', apply: true}},
  );
  assert.throws(
    () => parseArgs(['plan-add', ID, '--session']),
    /needs a value/,
  );
});

test('sessions lists the local sessions with their track ids, filtered by track', async () => {
  const be = memoryCatalog();
  const all = await run(['sessions'], deps(be));
  assert.equal(all.lines.length, 2);
  assert.ok(
    all.lines[0].includes('aaaaaa1111') && all.lines[0].includes(`[${ID}]`),
  );
  const one = await run(['sessions', '--track', 'lmu-daytona'], deps(be));
  assert.equal(one.lines.length, 1);
});

test('a dry run prints the plan and writes nothing; apply needs a reason; apply with one writes once; the same plan is then stale', async () => {
  const be = memoryCatalog({
    counts: {[ID]: 7},
    lengths: {[ID]: [2000, 2001, 1999]},
  });
  const dry = await run(['plan-add', ID, '--session', 'aaaaaa'], deps(be));
  assert.equal(dry.code, 0, text(dry));
  assert.match(text(dry), /ADD lmu-road_atlanta: catalogRev 0 -> 1/);
  assert.match(text(dry), /7 session/);
  assert.match(text(dry), /DRY RUN: nothing written/);
  assert.equal(be.commits, 0);

  const noReason = await run(
    ['plan-add', ID, '--session', 'aaaaaa', '--apply'],
    deps(be),
  );
  assert.equal(noReason.code, 1);
  assert.match(text(noReason), /--reason/);
  assert.equal(be.commits, 0);

  const done = await run(
    ['plan-add', ID, '--session', 'aaaaaa', '--apply', '--reason', 'first map'],
    deps(be),
  );
  assert.equal(done.code, 0, text(done));
  assert.match(text(done), /APPLIED: lmu-road_atlanta is now at catalogRev 1/);
  assert.equal(be.commits, 1);

  const again = await run(
    ['plan-add', ID, '--session', 'aaaaaa', '--apply', '--reason', 'again'],
    deps(be),
  );
  assert.equal(again.code, 1, 'it already has a map: plan-add refuses');
  assert.equal(be.commits, 1);

  const hist = await run(['history', ID], deps(be));
  assert.match(text(hist), /rev 0 replaced .* by botkin \(add\): first map/);
  const show = await run(['show', ID], deps(be));
  assert.match(show.lines[0], /catalogRev 1, curated/);
});

test('a session from another track is refused, as is a missing session flag; unknown commands print usage', async () => {
  const be = memoryCatalog();
  const wrong = await run(
    ['plan-add', ID, '--session', 'bbbbbb'],
    deps(be, 'Daytona'),
  );
  assert.equal(wrong.code, 1);
  assert.match(
    text(wrong),
    /that session is on lmu-daytona, not lmu-road_atlanta/,
  );
  const missing = await run(['plan-add', ID], deps(be));
  assert.match(text(missing), /needs --session/);
  assert.equal((await run(['frobnicate', ID], deps(be))).code, 2);
  assert.equal((await run(['plan-undo'], deps(be))).code, 2);
  assert.equal(be.commits, 0);
});

test('a refused plan exits 1 even as a dry run, and undo of a fresh track says why', async () => {
  const be = memoryCatalog();
  const r = await run(['plan-undo', ID], deps(be));
  assert.equal(r.code, 1);
  assert.match(text(r), /no history to undo/);
  assert.equal(
    (await run(['plan-undo', ID, '--to-rev', 'x'], deps(be))).code,
    1,
  );
});
