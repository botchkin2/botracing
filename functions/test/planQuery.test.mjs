import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  PLAN_FIELDS,
  PLAN_LAP_SESSIONS,
  PLAN_MAX_SESSIONS,
  parsePlanQuery,
  planRows,
} from '../src/planQuery.ts';

test('a request names a combo by sim, track and car model, or says what is missing', () => {
  assert.deepEqual(
    parsePlanQuery({sim: 'iracing', trackId: 'iracing-127-full', car: 'Ford Mustang GT3'}),
    {
      ok: true,
      combo: {sim: 'iracing', trackId: 'iracing-127-full', carModel: 'Ford Mustang GT3'},
      lapSessions: PLAN_LAP_SESSIONS,
    },
  );
  assert.deepEqual(parsePlanQuery({trackId: 't', car: 'c'}), {ok: false, error: 'sim must be lmu or iracing'});
  assert.deepEqual(parsePlanQuery({sim: 'acc', trackId: 't', car: 'c'}), {ok: false, error: 'sim must be lmu or iracing'});
  assert.deepEqual(parsePlanQuery({sim: 'lmu', car: 'c'}), {ok: false, error: 'trackId is required'});
  assert.deepEqual(parsePlanQuery({sim: 'lmu', trackId: 't'}), {ok: false, error: 'car is required'});
  // An array (?car=a&car=b), an over-long value and a control character are not names.
  assert.equal(parsePlanQuery({sim: 'lmu', trackId: 't', car: ['a', 'b']}).ok, false);
  assert.equal(parsePlanQuery({sim: 'lmu', trackId: 't'.repeat(201), car: 'c'}).ok, false);
  assert.equal(parsePlanQuery({sim: 'lmu', trackId: 't\u0000', car: 'c'}).ok, false);
});

test('laps sets how many of the newest sessions keep their lap rows; anything odd is the default', () => {
  const q = laps => parsePlanQuery({sim: 'lmu', trackId: 't', car: 'c', laps});
  assert.equal(q('3').lapSessions, 3);
  assert.equal(q('0').lapSessions, 0);
  for (const bad of ['-1', '1.5', 'x', '', `${PLAN_MAX_SESSIONS + 1}`, undefined])
    assert.equal(q(bad).lapSessions, PLAN_LAP_SESSIONS, String(bad));
});

test('the query reads only the plan block, the start time and the session type', () => {
  assert.deepEqual([...PLAN_FIELDS], ['startedAt', 'sessionType', 'plan']);
});

const doc = (id, data) => ({id, data: () => data});
const block = n => ({
  v: 1,
  fuel: {fillLimitL: 60, startL: 60, tankL: 105, litresPerVePct: null},
  laps: Array.from({length: n}, (_, i) => ({n: i + 1, usedL: 2.4, veUsedPct: null, timeS: 90, comparable: true, traffic: null})),
  race: null,
});

test('only the newest sessions keep their laps; a session with no block reads null, not zero', () => {
  const docs = [
    doc('a', {startedAt: '2026-10-09T10:00:00Z', sessionType: 'Race', plan: block(30)}),
    doc('b', {startedAt: '2026-10-08T10:00:00Z', sessionType: 'Practice', plan: block(20)}),
    doc('c', {startedAt: '2026-09-01T10:00:00Z', sessionType: 'Practice'}), // before the block existed
  ];
  const rows = planRows(docs, 1);
  assert.deepEqual(rows.map(r => r.id), ['a', 'b', 'c']);
  assert.equal(rows[0].plan.laps.length, 30);
  assert.equal(rows[1].plan.laps, null, 'past the newest 1');
  assert.deepEqual(rows[1].plan.fuel, block(1).fuel, 'its fuel limits are still there');
  assert.equal(rows[2].plan, null);
  assert.equal(rows[2].sessionType, 'Practice');
});

test('100 sessions of 100 laps come back small: 8 with laps, 92 with fuel and race only', () => {
  const docs = Array.from({length: 100}, (_, i) =>
    doc(`s${i}`, {startedAt: new Date(Date.UTC(2026, 9, 9) - i * 86400000).toISOString(), sessionType: 'Practice', plan: block(100)}),
  );
  const rows = planRows(docs, PLAN_LAP_SESSIONS);
  assert.equal(rows.length, 100);
  assert.equal(rows.filter(r => r.plan.laps).length, PLAN_LAP_SESSIONS);
  const bytes = JSON.stringify({items: rows}).length;
  const full = JSON.stringify({items: docs.map(d => d.data())}).length;
  assert.ok(bytes < 120_000, `${bytes} bytes`);
  assert.ok(bytes < full / 5, `${bytes} against ${full} with every lap`);
});
