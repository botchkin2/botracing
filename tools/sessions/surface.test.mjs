// Run: node --test tools/sessions/surface.test.mjs
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fromLocalMetres, LMU_FAKE_ORIGIN} from '../../src/analysis/geo.ts';
import {surfaceGeometry} from '../../src/analysis/trackSurface.ts';
import {
  buildSurface,
  gzipSurface,
  parseSurface,
  surfaceLapFromCsv,
  usableLap,
} from './surface.mjs';

const LENGTH_M = 1000;
const HEADER =
  'Speed,LapDistPct,Lat,Lon,Brake,Throttle,RPM,SteeringWheelAngle,Gear,OffAsphalt,PathLateral,TrackEdge';

// A straight road east along y = 0; a car at lateral `pl` (right of travel)
// sits south of the centre. Position rows (10 Hz) carry Lat/Lon and the lateral
// columns; the rows between are empty like the real file.
function csv({
  pl,
  edge,
  from = 0,
  to = LENGTH_M,
  columns = true,
  wrap = false,
}) {
  const head = columns ? HEADER : HEADER.split(',').slice(0, 10).join(',');
  const rows = [head];
  for (let d = from; d < to; d += 5) {
    const p = fromLocalMetres({x: d, y: -pl}, LMU_FAKE_ORIGIN);
    const cells = [30, d / LENGTH_M, p.lat, p.lon, 0, 1, 8000, 0, 5, 0];
    if (columns) cells.push(pl, edge);
    rows.push(cells.join(','));
    rows.push(
      [
        30,
        (d + 2) / LENGTH_M,
        '',
        '',
        '',
        '',
        8000,
        0,
        5,
        0,
        ...(columns ? ['', ''] : []),
      ].join(','),
    );
  }
  if (wrap) {
    // The counter has wrapped: the next lap's first samples.
    const p = fromLocalMetres({x: 5, y: -pl}, LMU_FAKE_ORIGIN);
    rows.push(
      [30, 0.005, p.lat, p.lon, 0, 1, 8000, 0, 5, 0, pl, edge].join(','),
    );
  }
  return rows.join('\n');
}

test('a lap CSV becomes the game-metre samples with a position', () => {
  const lap = surfaceLapFromCsv(csv({pl: 2, edge: 6}), LENGTH_M);
  assert.equal(lap.x.length, 200);
  assert.ok(Math.abs(lap.y[10] + 2) < 0.01);
  assert.ok(Math.abs(lap.x[10] - 50) < 0.01);
  assert.equal(lap.distM[10], 50);
  assert.equal(lap.pathLateralM[10], 2);
  assert.equal(lap.trackEdgeM[10], 6);
});

test('a trace from before PathLateral and TrackEdge gives nothing', () => {
  assert.equal(
    surfaceLapFromCsv(csv({pl: 2, edge: 6, columns: false}), LENGTH_M),
    null,
  );
});

test('samples after the lap counter wraps are the next lap and are left out', () => {
  const lap = surfaceLapFromCsv(
    csv({pl: 0, edge: -6, to: LENGTH_M, wrap: true}),
    LENGTH_M,
  );
  assert.equal(lap.x.length, 200);
});

test('only whole timed comparable laps off the pit lane are used', () => {
  const ok = {timed: true, comparable: true};
  assert.equal(usableLap(ok), true);
  assert.equal(usableLap({...ok, pitlane: true}), false);
  assert.equal(usableLap({...ok, pitIn: true}), false);
  assert.equal(usableLap({...ok, partial: true}), false);
  assert.equal(usableLap({...ok, comparable: false}), false);
  assert.equal(usableLap({...ok, timed: false}), false);
});

test('folding sessions in: the centre agrees, and a repeat adds nothing', () => {
  const sessions = [
    {id: 'a', csvs: [csv({pl: -2, edge: -6})]},
    {id: 'b', csvs: [csv({pl: 3, edge: 6})]},
  ];
  const first = buildSurface(null, LENGTH_M, sessions);
  assert.equal(first.sessionsAdded, 2);
  assert.equal(first.lapsAdded, 2);
  const g = surfaceGeometry(first.surface);
  assert.ok(Math.max(...g.runs[0].centre.map(p => Math.abs(p.y))) < 0.01);
  assert.ok(Math.abs(g.halfWidthM - 6) < 0.01);
  const again = buildSurface(first.surface, LENGTH_M, sessions);
  assert.equal(again.sessionsAdded, 0);
  assert.deepEqual(again.surface.bins, first.surface.bins);
});

test('a session whose traces have no lateral columns is not recorded as folded in', () => {
  const old = {id: 'old', csvs: [csv({pl: 0, edge: -6, columns: false})]};
  const r = buildSurface(null, LENGTH_M, [old]);
  assert.equal(r.sessionsAdded, 0);
  assert.deepEqual(r.surface.sessions, []);
  // Once its traces are re-uploaded with the columns, it is picked up.
  const later = buildSurface(r.surface, LENGTH_M, [
    {id: 'old', csvs: [csv({pl: 0, edge: -6})]},
  ]);
  assert.equal(later.sessionsAdded, 1);
});

test('a track whose length changed is rebuilt from scratch', () => {
  const first = buildSurface(null, LENGTH_M, [
    {id: 'a', csvs: [csv({pl: 0, edge: -6})]},
  ]);
  const rebuilt = buildSurface(first.surface, 2000, [
    {id: 'b', csvs: [csv({pl: 0, edge: -6})]},
  ]);
  assert.equal(rebuilt.replaced, true);
  assert.deepEqual(rebuilt.surface.sessions, ['b']);
  assert.equal(rebuilt.surface.bins.length, 200);
});

test('the stored file round-trips and stays small', () => {
  const {surface} = buildSurface(null, LENGTH_M, [
    {id: 'a', csvs: [csv({pl: -2, edge: -6}), csv({pl: 3, edge: 6})]},
  ]);
  const gz = gzipSurface(surface);
  const back = parseSurface(gz);
  assert.equal(back.sessions[0], 'a');
  assert.equal(back.bins.length, surface.bins.length);
  assert.ok(Math.abs(back.bins[7].sx - surface.bins[7].sx) < 0.001);
  assert.ok(gz.length < 20000);
});
