// A marked field is kept and not used (thread 100). productsFromField is what
// analyzeFromArchive writes for traffic, class laps, class bests and the finish.
import assert from 'node:assert/strict';
import {test} from 'node:test';

import {productsFromField} from './analyzeFromArchive.mjs';
import {fieldFeedsDerived} from './field.mjs';

const none = [null, null, null, null];
const field = {
  hz: 5,
  et0: 0,
  tDs: [0, 1000, 2000, 3000],
  pathLateralDm: [none, none, none],
  cars: [{class: 'GT3', player: true}, {class: 'GT3'}, {class: 'LMP2'}],
  place: [[3, 3, 2, 1], [2, 2, 3, 3], [1, 1, 1, 2]],
  laps: [[0, 1, 2, 3], [0, 1, 2, 3], [0, 1, 2, 3]],
  lapDistDm: [none, none, none],
  inPits: [none, none, none],
  flag: [none, none, none],
};

const windows = [{from: 0, to: 10}];

test('an unmarked field feeds traffic, class laps, bests and the finish', () => {
  const out = productsFromField(field, {cars: 3}, 'Race', windows);
  assert.ok(Array.isArray(out.traffic));
  assert.equal(out.traffic.length, 1);
  assert.ok(out.classLaps);
  assert.ok(out.classBests);
  assert.equal(out.result.finish.overall, 1);
});

for (const kind of ['garbage', 'misaligned', 'doubted', 'track']) {
  test(`a ${kind} field produces no traffic, class laps, bests or result`, () => {
    const meta = {mark: {kind}, note: 'kept'};
    assert.equal(fieldFeedsDerived(meta), false);
    const out = productsFromField(field, meta, 'Race', windows);
    assert.equal(out.traffic, null);
    assert.equal(out.classLaps, null);
    assert.equal(out.classBests, null);
    assert.equal(out.result, null);
  });
}

test('smaller still feeds: it is an aside, not a field left unused', () => {
  const meta = {mark: {kind: 'smaller', aside: 'field/x'}};
  assert.equal(fieldFeedsDerived(meta), true);
  const out = productsFromField(field, meta, 'Race', windows);
  assert.ok(out.classLaps);
  assert.equal(out.result.finish.overall, 1);
});

test('no field produces nothing', () => {
  const out = productsFromField(null, undefined, 'Race', windows);
  assert.equal(out.traffic, null);
  assert.equal(out.classLaps, null);
  assert.equal(out.classBests, null);
  assert.equal(out.result, null);
});
