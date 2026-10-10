import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

import {
  fingerprintOf,
  makeReporter,
  maskMessage,
  PROBLEM_TTL_MS,
  problemDoc,
  problemMessage,
  WRITE_EVERY_MS,
} from '../src/problemsCore.ts';

const TOKEN =
  'eyJhbGciOiJSUzI1NiJ9.eyJ1aWQiOiJzZWF0LXRlc3QifQ.c2lnbmF0dXJlLXBhcnQ';

function reporter({failWrite = false, failLog = false} = {}) {
  let t = 1_000_000;
  const writes = [];
  const logs = [];
  const report = makeReporter({
    write: async w => {
      if (failWrite) throw new Error('DEADLINE_EXCEEDED');
      writes.push(w);
    },
    log: (message, fields) => {
      if (failLog) throw new Error('no logger');
      logs.push({message, fields});
    },
    now: () => t,
  });
  return {report, writes, logs, advance: ms => (t += ms)};
}

test('masking takes out tokens, emails, ids and numbers, in that order', () => {
  assert.equal(
    maskMessage(`bad token ${TOKEN} for botchkin@gmail.com`),
    'bad token <token> for <email>',
  );
  assert.equal(
    maskMessage(
      'session 4dda01bc58a237af lap 12 of 3f2504e0-4f89-11d3-9a0c-0305e82c3301',
    ),
    'session <id> lap # of <id>',
  );
  assert.equal(maskMessage('timeout after 3000 ms'), 'timeout after # ms');
});

test('an error that echoes an ID token and an email stores and logs neither', async () => {
  const r = reporter();
  await r.report(
    'uploadApi',
    new Error(`refused ${TOKEN} (seat@example.com)`),
    {
      route: '/docs/write',
    },
  );
  const stored = JSON.stringify(r.writes) + JSON.stringify(r.logs);
  assert.ok(!stored.includes(TOKEN), 'no token');
  assert.ok(!stored.includes('seat@example.com'), 'no email');
  assert.equal(r.writes[0].message, 'Error: refused <token> (<email>)');
});

test('the same kind of error counts in one doc; another kind gets its own', async () => {
  const a = problemMessage(
    new Error('doc sessions/4dda01bc58a237af not found'),
  );
  const b = problemMessage(
    new Error('doc sessions/c32d2e9d21f3433e not found'),
  );
  assert.equal(a, b);
  assert.equal(
    fingerprintOf('lmuApi', '/x', a),
    fingerprintOf('lmuApi', '/x', b),
  );
  assert.notEqual(
    fingerprintOf('lmuApi', '/x', a),
    fingerprintOf('uploadApi', '/x', a),
  );
  assert.notEqual(
    fingerprintOf('lmuApi', '/x', a),
    fingerprintOf('lmuApi', '/y', a),
  );
});

test('a 5xx is written with its route masked and a 30-day expiry; a 4xx is only logged', async () => {
  const r = reporter();
  await r.report('lmuApi', new Error('boom'), {
    route: '/sessions/4dda01bc58a237af?x=1',
  });
  assert.equal(r.writes.length, 1);
  const w = r.writes[0];
  assert.equal(w.route, '/sessions/<id>');
  assert.equal(w.status, 500);
  assert.equal(w.count, 1);
  assert.equal(w.expiresAt - w.at, PROBLEM_TTL_MS);
  await r.report('lmuApi', new Error('nope'), {route: '/x', status: 404});
  assert.equal(r.writes.length, 1);
  assert.equal(r.logs.length, 2);
});

test('a storm is throttled per kind: counts accumulate into the next write', async () => {
  const r = reporter();
  const err = new Error('boom');
  for (let i = 0; i < 5; i += 1)
    await r.report('uploadApi', err, {route: '/x'});
  assert.deepEqual(
    r.writes.map(w => w.count),
    [1],
  );
  r.advance(WRITE_EVERY_MS);
  await r.report('uploadApi', err, {route: '/x'});
  assert.deepEqual(
    r.writes.map(w => w.count),
    [1, 5],
  );
  await r.report('uploadApi', new Error('other'), {route: '/x'});
  assert.equal(r.writes.length, 3, 'another kind is not held back');
});

test('the stored doc adds up the count, keeps firstAt, and expires 30 days after the last error', () => {
  const w = {
    id: 'f',
    where: 'lmuApi',
    route: '/x',
    status: 500,
    message: 'Error: boom',
    count: 5,
    at: 2_000,
    expiresAt: 2_000 + PROBLEM_TTL_MS,
  };
  const created = problemDoc(undefined, {...w, count: 1, at: 1_000});
  assert.equal(created.count, 1);
  assert.deepEqual(created.firstAt, new Date(1_000));
  const next = problemDoc(created, w);
  assert.equal(next.count, 6);
  assert.deepEqual(next.firstAt, new Date(1_000));
  assert.deepEqual(next.lastAt, new Date(2_000));
  assert.ok(next.expiresAt instanceof Date, 'a Timestamp for the TTL policy');
  assert.equal(next.expiresAt - next.lastAt, PROBLEM_TTL_MS);
});

test('reporting never throws: a failed write or a failed logger is swallowed', async () => {
  await assert.doesNotReject(() =>
    reporter({failWrite: true}).report('uploadApi', new Error('boom'), {
      route: '/x',
    }),
  );
  await assert.doesNotReject(() =>
    reporter({failLog: true}).report('uploadApi', new Error('boom'), {
      route: '/x',
    }),
  );
  const r = reporter({failWrite: true});
  await r.report('uploadApi', new Error('boom'), {route: '/x'});
  assert.match(
    r.logs.at(-1).message,
    /^reportError failed: Error: DEADLINE_EXCEEDED/,
  );
});

test('every function catch-all reports through reportError, none logs the raw error', () => {
  for (const f of ['lmuApi', 'uploadApi', 'releaseApi', 'traySignInApi']) {
    const src = readFileSync(
      new URL(`../src/${f}.ts`, import.meta.url),
      'utf8',
    );
    assert.match(src, /reportError\(/, f);
    assert.doesNotMatch(src, /console\.error/, f);
  }
});

test('Firestore rules give clients nothing, problems/* included', () => {
  const rules = readFileSync(
    new URL('../../firestore.rules', import.meta.url),
    'utf8',
  )
    .replace(/\/\/.*$/gm, '')
    .replace(/\s+/g, ' ');
  assert.match(
    rules,
    /match \/\{document=\*\*\} \{ allow read, write: if false; \}/,
  );
  assert.equal((rules.match(/allow /g) ?? []).length, 1, 'no other allow rule');
});
