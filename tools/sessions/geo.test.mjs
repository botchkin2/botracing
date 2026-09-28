// Tests for src/analysis/geo.ts. Run: node --test tools/sessions/
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  LMU_FAKE_ORIGIN,
  applyGeoref,
  canDrawOnRealMap,
  distanceM,
  fromLocalMetres,
  toLocalMetres,
  traceToLocalMetres,
} from '../../src/analysis/geo.ts';

// Road Atlanta, from tools/track-fit/georef.json.
const roadAtlanta = {
  rotationDeg: 1.6995,
  mirror: 1,
  originLat: 34.1503164,
  originLon: -83.8142749,
};

test('local metres round-trip', () => {
  const origin = {lat: 34.15, lon: -83.81};
  const p = {lat: 34.1437, lon: -83.8201};
  const back = fromLocalMetres(toLocalMetres(p, origin), origin);
  assert.ok(Math.abs(back.lat - p.lat) < 1e-9);
  assert.ok(Math.abs(back.lon - p.lon) < 1e-9);
});

test('fake GPS is metres around 60N: a degree of longitude there is half a degree at the equator', () => {
  const east = toLocalMetres({lat: 60, lon: 0.001}, LMU_FAKE_ORIGIN);
  const north = toLocalMetres({lat: 60.001, lon: 0}, LMU_FAKE_ORIGIN);
  assert.ok(Math.abs(east.x - 55.66) < 0.01, `east ${east.x}`);
  assert.ok(Math.abs(north.y - 110.54) < 0.01, `north ${north.y}`);
});

test('trace to local metres keeps distances', () => {
  const [a, b] = traceToLocalMetres([
    {lat: 60, lon: 0},
    {lat: 60, lon: 0.002},
  ]);
  assert.ok(Math.abs(Math.hypot(b.x - a.x, b.y - a.y) - 111.32) < 0.01);
});

test('georef lands a real Road Atlanta sample on the real track', () => {
  // First sample of the recording the fit used, and where the fit puts it
  // (checked against the OSM outline: within the track's width).
  const [p] = applyGeoref(
    [{lat: 59.987117767333984, lon: -0.007311809342354536}],
    roadAtlanta,
  );
  assert.ok(
    distanceM(p, {lat: 34.13733, lon: -83.81823}) < 2,
    JSON.stringify(p),
  );
});

test('georef is rigid: distances between points survive', () => {
  const pts = [
    {lat: 59.99, lon: -0.005},
    {lat: 59.995, lon: 0.003},
  ];
  const after = distanceM(...applyGeoref(pts, roadAtlanta));
  // Fake metres (around 60N) and real metres (around 34N) must agree.
  const local = traceToLocalMetres(pts);
  const fakeM = Math.hypot(local[1].x - local[0].x, local[1].y - local[0].y);
  assert.ok(Math.abs(after - fakeM) < 0.05, `${after} vs ${fakeM}`);
});

test('only good, unmirrored fits go on a real map', () => {
  assert.equal(canDrawOnRealMap('good', roadAtlanta), true);
  assert.equal(canDrawOnRealMap('poor', roadAtlanta), false);
  assert.equal(canDrawOnRealMap('fair', roadAtlanta), false);
  assert.equal(canDrawOnRealMap('good', {...roadAtlanta, mirror: -1}), false);
  assert.equal(canDrawOnRealMap(undefined, undefined), false);
});
