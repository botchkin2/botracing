import {describe, expect, it} from '@jest/globals';

import {type GridTrace} from '@/src/analysis/resample';
import {addLap, emptySurface, type SurfaceLap} from '@/src/analysis/trackSurface';
import {mapPlacer, type SessionSummary, type TrackMapData} from '@/src/data/sessions';
import {type TrackInfo} from '@/src/data/tracks';

import {buildHistory} from './history';
import {buildTrackModel, referenceSession} from './model';

const session = (over: Partial<SessionSummary>): SessionSummary => ({
  id: 's1',
  sim: 'lmu',
  trackId: 'lmu-t',
  track: 'Test Ring',
  car: 'Manthey DK Engineering 2026 #91:LM',
  carClass: 'GT3',
  sessionType: 'P',
  startedAt: '2026-09-01T10:00:00Z',
  lapCount: 10,
  comparableCount: 8,
  bestTimeS: 100,
  medianTimeS: 101,
  bestLapId: 's1-001',
  series: null,
  classLaps: null,
  finish: null,
  eventId: null,
  cornerMapSource: 'stored',
  updatedAt: '2026-09-01T12:00:00Z',
  ...over,
});

const info = (over: Partial<TrackInfo> = {}): TrackInfo => ({
  trackId: 'lmu-t',
  layout: 'Test Ring GP',
  location: 'Test Ring',
  lengthM: 4000,
  turnLabels: {},
  openedYear: null,
  country: 'Belgium',
  countryCode: 'BE',
  place: null,
  summary: null,
  osmNames: [],
  ...over,
});

// A 400 m square lap, anticlockwise, on a 5 m grid: every corner is a left.
function squareTrace(): GridTrace {
  const lat: number[] = [];
  const lon: number[] = [];
  const distanceM: number[] = [];
  const side = 100;
  for (let m = 0; m < 4 * side; m += 5) {
    const k = Math.floor(m / side);
    const u = m % side;
    const [x, y] = [
      [u, 0],
      [side, u],
      [side - u, side],
      [0, side - u],
    ][k];
    // Fake-origin degrees for local metres (x east, y north) at 60°N.
    lat.push(60 + y / 110540);
    lon.push(x / (111320 * Math.cos(Math.PI / 3)));
    distanceM.push(m);
  }
  const empty = lat.map(() => 0);
  return {
    stepM: 5,
    distanceM,
    speedKph: empty,
    throttlePct: empty,
    brakePct: empty,
    steeringPct: empty,
    gear: empty,
    lat,
    lon,
    timeS: empty,
    samples: {} as GridTrace['samples'],
  };
}

const corner = (n: number, apexM: number) => ({
  n,
  entryM: apexM - 20,
  apexM,
  exitM: apexM + 20,
});

const map = (): TrackMapData => ({
  lengthM: 400,
  sections: [
    {...corner(1, 100), parts: []},
    {...corner(2, 200), parts: [corner(2, 195), corner(3, 205)]},
    {...corner(4, 300), parts: []},
  ],
  boundaries: null,
  quality: 'poor',
  georef: null,
  outline: [],
  outlineKinds: [],
  pitLane: [],
  attribution: null,
});

describe('buildTrackModel', () => {
  it('hides a fact tile when its fact is missing', () => {
    const m = buildTrackModel({
      trackId: 'lmu-t',
      info: info(),
      layouts: [],
      sessions: [],
      map: null,
      refTrace: null,
      selectedCorner: null,
    });
    expect(m.facts.map(f => f.label)).toEqual(['Length']);
    expect(m.facts[0]).toEqual({
      label: 'Length',
      value: '4.000 km',
      sub: '2.485 mi',
    });
  });

  it('lists corners in sections, unnamed without an outline fit', () => {
    const m = buildTrackModel({
      trackId: 'lmu-t',
      info: info(),
      layouts: [],
      sessions: [session({})],
      map: map(),
      refTrace: squareTrace(),
      selectedCorner: 3,
    });
    expect(m.corners.map(g => g.title)).toEqual([null, 'S2 · T2–3', null]);
    expect(m.corners[0].rows[0]).toMatchObject({
      n: 1,
      name: null,
    });
    expect(m.corners[1].rows.map(r => r.selected)).toEqual([false, true]);
    expect(m.selection).toEqual({n: 3, label: 'T3'});
    // No turn count: the corner-map entries do not give the labelled turns exactly.
    expect(m.facts.find(f => f.label === 'Turns')).toBeUndefined();
    expect(m.map?.real).toBe(false);
    expect(m.map?.note).toMatch(/driven line/);
  });
});

describe('referenceSession', () => {
  it('takes the newest session on the stored corner map', () => {
    const picked = referenceSession([
      session({id: 'old', startedAt: '2026-08-01T00:00:00Z'}),
      session({
        id: 'own',
        startedAt: '2026-09-20T00:00:00Z',
        cornerMapSource: 'session',
      }),
      session({id: 'new', startedAt: '2026-09-10T00:00:00Z'}),
    ]);
    expect(picked?.id).toBe('new');
  });

  it('falls back to sessions that do not say, never to a map of its own', () => {
    const picked = referenceSession([
      session({id: 'unknown', cornerMapSource: null}),
      session({
        id: 'own',
        startedAt: '2026-09-20T00:00:00Z',
        cornerMapSource: 'session',
      }),
    ]);
    expect(picked?.id).toBe('unknown');
  });
});

describe('buildHistory', () => {
  it('keeps each car’s best session and skips sessions with no timed best', () => {
    const h = buildHistory([
      session({id: 'a', bestTimeS: 101.5}),
      session({id: 'b', bestTimeS: 100.25}),
      session({id: 'c', bestTimeS: null}),
      session({
        id: 'd',
        car: 'United Autosports #95:LM',
        bestTimeS: 99,
      }),
    ]);
    expect(h?.bests.map(b => [b.sessionId, b.time])).toEqual([
      ['d', '1:39.000'],
      ['b', '1:40.250'],
    ]);
    expect(h?.stats[0]).toEqual({label: 'Sessions', value: '4'});
  });

  it('draws the trend for the most-driven car only, from 3 sessions', () => {
    const h = buildHistory([
      session({id: 'a', startedAt: '2026-09-01T00:00:00Z', bestTimeS: 101}),
      session({id: 'b', startedAt: '2026-09-02T00:00:00Z', bestTimeS: 100}),
      session({
        id: 'x',
        car: 'United Autosports #95:LM',
        lapCount: 1,
        bestTimeS: 90,
      }),
    ]);
    expect(h?.trend).toBeNull();
    const h3 = buildHistory([
      session({id: 'a', startedAt: '2026-09-01T00:00:00Z', bestTimeS: 101}),
      session({id: 'b', startedAt: '2026-09-02T00:00:00Z', bestTimeS: 100}),
      session({id: 'c', startedAt: '2026-09-03T00:00:00Z', bestTimeS: 100.5}),
    ]);
    expect(h3?.trend?.bars.map(b => b.best)).toEqual([false, true, false]);
    expect(h3?.trend?.title).toBe('Best lap per session · Porsche 911 GT3 R');
  });
});

// A square outline on the same origin as the lap fixture: drawable as a real map.
const realMap = (): TrackMapData => ({
  ...map(),
  quality: 'good',
  georef: {
    originLat: 60,
    originLon: 0,
    rotationRad: 0,
    scale: 1,
    mirror: 1,
    quality: 'good',
  } as unknown as TrackMapData['georef'],
  outline: [
    [
      [0, 60],
      [0.002, 60],
      [0.002, 60.001],
      [0, 60.001],
      [0, 60],
    ],
  ],
  outlineKinds: ['racing'],
  attribution: 'OSM',
});

describe('buildTrackModel: the map without a lap', () => {
  it('draws the outline with no lap: no line, no badges, no S/F', () => {
    const m = buildTrackModel({
      trackId: 'lmu-t',
      info: info(),
      layouts: [],
      sessions: [session({})],
      map: realMap(),
      refTrace: null,
      selectedCorner: null,
    });
    expect(m.map).not.toBeNull();
    expect(m.map?.real).toBe(true);
    expect(m.map?.outline.length).toBeGreaterThan(0);
    expect(m.map?.line).toBeNull();
    expect(m.map?.startFinish).toBeNull();
    expect(m.map?.marks.corners).toEqual([]);
    expect(m.map?.note).toBeNull();
  });

  it('has no map at all with neither an outline nor a lap', () => {
    const m = buildTrackModel({
      trackId: 'lmu-t',
      info: info(),
      layouts: [],
      sessions: [],
      map: map(),
      refTrace: null,
      selectedCorner: null,
    });
    expect(m.map).toBeNull();
  });
});

describe('buildTrackModel: a lap draws the same map as before', () => {
  it('matches the output recorded before the outline was decoupled', () => {
    const georef = {
      originLat: 60,
      originLon: 0,
      rotationRad: 0,
      scale: 1,
      quality: 'good',
    } as unknown as TrackMapData['georef'];
    const m = buildTrackModel({
      trackId: 't',
      info: null,
      layouts: [],
      sessions: [],
      map: {
        ...map(),
        lengthM: 400,
        sections: [{...corner(1, 100), parts: []}],
        quality: 'good',
        georef,
        outline: [
          [
            [0, 60],
            [0.002, 60.0005],
          ],
        ],
        outlineKinds: ['racing'],
        attribution: 'x',
      },
      surface: null,
      refTrace: squareTrace(),
      selectedCorner: null,
    });
    const before = require('./__fixtures__/map-with-lap.before.json') as {
      map: unknown;
    };
    // The lap-placed map is unchanged; it only says now that the lap placed it.
    const {marksFrom, ...rest} = JSON.parse(JSON.stringify(m.map));
    expect(rest).toEqual(before.map);
    expect(marksFrom).toBe('lap');
  });
});

// A 400 m square road in game-world metres (the surface's frame), measured
// by three laps on its centre: every 10 m bin has a centre.
function squareSurface(skip: (m: number) => boolean = () => false) {
  const s = emptySurface(400);
  const lap: SurfaceLap = {distM: [], x: [], y: [], pathLateralM: [], trackEdgeM: []};
  for (let m = 0; m < 400; m += 2) {
    if (skip(m)) continue;
    const k = Math.floor(m / 100);
    const u = m % 100;
    const [x, y] = [[u, 0], [100, u], [100 - u, 100], [0, 100 - u]][k];
    lap.distM.push(m);
    lap.x.push(x);
    lap.y.push(y);
    lap.pathLateralM.push(0);
    lap.trackEdgeM.push(-6);
  }
  for (let i = 0; i < 3; i++) addLap(s, lap);
  return s;
}

const surfaceInputs = (
  surface: ReturnType<typeof squareSurface> | null,
  refTrace: GridTrace | null,
) => ({
  trackId: 'lmu-t',
  info: info(),
  layouts: [],
  sessions: [session({})],
  // The corner map measures the lap in its own metres (here 404 m): the
  // badges go to the same share of the lap on the surface.
  map: {...map(), lengthM: 404},
  surface,
  refTrace,
  selectedCorner: null,
});

const dist = (a: {x: number; y: number}, b: {x: number; y: number}) =>
  Math.hypot(a.x - b.x, a.y - b.y);

describe('buildTrackModel: badges and S/F on the measured road (a map is a map)', () => {
  it('places every badge and the S/F with no lap at all', () => {
    const m = buildTrackModel(surfaceInputs(squareSurface(), null));
    expect(m.map?.marksFrom).toBe('surface');
    expect(m.map?.line).toBeNull();
    expect(m.map?.marks.corners.map(c => c.n)).toEqual([1, 2, 3, 4]);
    expect(m.map?.startFinish).not.toBeNull();
    // Corner 1's apex is a quarter of the lap: the square's first corner, in
    // map metres the placer gives the same game point.
    const placer = mapPlacer(map(), squareSurface());
    const [expected] = placer.placeWorld([{x: 100, z: 0}]);
    const c1 = m.map!.marks.corners.find(c => c.n === 1)!;
    expect(dist(c1.anchor.at, expected)).toBeLessThan(15);
    const [line] = placer.placeWorld([{x: 0, z: 0}]);
    expect(dist(m.map!.startFinish!.at, line)).toBeLessThan(15);
  });

  it('prefers the measured road over the lap, and lands where the lap would', () => {
    const lapOnly = buildTrackModel(surfaceInputs(null, squareTrace()));
    const both = buildTrackModel(surfaceInputs(squareSurface(), squareTrace()));
    expect(lapOnly.map?.marksFrom).toBe('lap');
    expect(both.map?.marksFrom).toBe('surface');
    // Same corners either way.
    expect(both.map?.marks.corners.map(c => c.n)).toEqual(
      lapOnly.map?.marks.corners.map(c => c.n),
    );
    // The lap still draws its own line on top.
    expect(both.map?.line?.length).toBe(squareTrace().lat.length);
  });

  it('falls back to the lap where the road is not measured at a badge, and to none without a lap', () => {
    // No laps measured between 90 and 110 m: corner 1's apex (at 100 of 400).
    const holed = squareSurface(m => m >= 90 && m < 110);
    expect(buildTrackModel(surfaceInputs(holed, squareTrace())).map?.marksFrom).toBe('lap');
    const none = buildTrackModel(surfaceInputs(holed, null)).map;
    expect(none?.marksFrom).toBeNull();
    expect(none?.marks.corners).toEqual([]);
    // The road still draws.
    expect(none?.outline.length).toBeGreaterThan(0);
  });
});
