// The guards and the pointer of applyField.cjs, without Firestore (node --test). The write itself is a dry run
// against production before anyone applies it.
const test = require('node:test');
const assert = require('node:assert/strict');
const {checkSession, pointerOf} = require('./applyField.cjs');

const field = (over = {}) => ({v: 2, hz: 5, cars: [{}, {}], tDs: [0, 10, 7000], alignM: 2.8, ...over});
const doc = (over = {}) => ({sessionType: 'Q', startedAt: '2026-10-22T00:28:30Z', ...over});
const ok = {expectStart: '2026-10-22T00:28:00Z', expectType: 'Q'};

test('a qualifying passes with its own start and type, not only the 10-22 race', () => {
  assert.doesNotThrow(() => checkSession({s: doc(), field: field(), ...ok}));
  assert.doesNotThrow(() =>
    checkSession({
      s: doc({sessionType: 'Race', startedAt: '2026-10-22T00:39:25Z'}),
      field: field(),
      expectStart: '2026-10-22T00:39:25Z',
      expectType: 'R',
    }),
  );
});

test('the type and the start must agree with the doc', () => {
  assert.throws(() => checkSession({s: doc({sessionType: 'R'}), field: field(), ...ok}), /not Q/);
  assert.throws(
    () => checkSession({s: doc({startedAt: '2026-10-22T00:30:30Z'}), field: field(), ...ok}),
    /not within 60 s/,
  );
  // 60 s is the edge
  assert.doesNotThrow(() => checkSession({s: doc({startedAt: '2026-10-22T00:29:00Z'}), field: field(), ...ok}));
});

test('a session that has a field, or is superseded, is not repaired', () => {
  assert.throws(() => checkSession({s: doc({field: {hash: 'x'}}), field: field(), ...ok}), /already has a field/);
  assert.throws(() => checkSession({s: doc({supersededBy: 'abc'}), field: field(), ...ok}), /superseded/);
});

test('a field file without a measured alignment is refused', () => {
  for (const alignM of [undefined, null, NaN, '2.8']) {
    assert.throws(() => checkSession({s: doc(), field: field({alignM}), ...ok}), /no alignM/);
  }
});

test('a file that is not a v2 field of two cars or more is refused', () => {
  assert.throws(() => checkSession({s: doc(), field: field({v: 1}), ...ok}), /not a field v2/);
  assert.throws(() => checkSession({s: doc(), field: field({cars: [{}]}), ...ok}), /not a field v2/);
});

test("the pointer carries the file's own alignment, its hash and its duration", () => {
  const text = JSON.stringify(field());
  const p = pointerOf({field: field(), text, ownerId: 'owner1', sessionId: '88602891a2c24899'});
  assert.equal(p.alignM, 2.8);
  assert.equal(p.source, 'replay');
  assert.equal(p.cars, 2);
  assert.equal(p.durationS, 700);
  assert.match(p.hash, /^[0-9a-f]{12}$/);
  assert.equal(p.path, `field/owner1/88602891a2c24899/${p.hash}.json.gz`);
});
