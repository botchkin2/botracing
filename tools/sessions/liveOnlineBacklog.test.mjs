// Run: node --test tools/sessions/liveOnlineBacklog.test.mjs
import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {
  liveOnlineFlags,
  uploadLiveOnlineBacklog,
} from './liveOnlineBacklog.mjs';

function withRoot(modes, fn) {
  const root = mkdtempSync(join(tmpdir(), 'liveonline-'));
  try {
    for (const [name, mode] of Object.entries(modes)) {
      mkdirSync(join(root, name));
      writeFileSync(
        join(root, name, 'meta.json'),
        JSON.stringify(mode === undefined ? {} : {gameMode: mode}),
      );
    }
    return fn(root);
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
}

const entry = (sessionId, sim = 'lmu') => ({sessionId, sim});

test('a live session reads its capture folder: offline false, online true, no mode or no folder null', () =>
  withRoot({algarve: 0, silverstone: 2, old: undefined}, root => {
    const flags = liveOnlineFlags(
      {
        'algarve#0': entry('a'),
        'silverstone#0': entry('s'),
        'old#0': entry('o'),
        'gone#0': entry('g'),
        'ir#0': entry('i', 'iracing'),
      },
      root,
    );
    assert.deepEqual(
      [...flags],
      [
        ['a', false],
        ['s', true],
        ['o', null],
        ['g', null],
      ],
    );
  }));

test('stretches of one session that disagree say nothing', () =>
  withRoot({a: 0, b: 2}, root => {
    const flags = liveOnlineFlags({'a#0': entry('x'), 'b#0': entry('x')}, root);
    assert.equal(flags.get('x'), null);
  }));

test('the backlog sends each known flag once, offline included, and never retries', async () => {
  const sent = [];
  const store = {setOnline: async (...a) => sent.push(a)};
  const state = {};
  const run = () =>
    uploadLiveOnlineBacklog({
      flags: new Map([
        ['a', false],
        ['s', true],
        ['n', null],
      ]),
      state,
      store,
      ownerId: 'o',
      saveState: () => {},
      log: () => {},
    });
  assert.equal(await run(), 2);
  assert.deepEqual(sent, [
    ['a', 'o', false],
    ['s', 'o', true],
  ]);
  assert.deepEqual(state.onlines, {a: 'sent', s: 'sent', n: 'none'});
  assert.equal(await run(), 0);
  assert.equal(sent.length, 2);
});
