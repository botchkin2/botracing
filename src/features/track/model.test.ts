import {describe, expect, it} from '@jest/globals';

import {type GridTrace} from '@/src/analysis/resample';
import {type SessionSummary, type TrackMapData} from '@/src/data/sessions';
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
  quality: 'poor',
  georef: null,
  outline: [],
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
    expect(m.corners.map(g => g.title)).toEqual([null, 'S2 · T2–T3', null]);
    expect(m.corners[0].rows[0]).toMatchObject({
      n: 1,
      name: null,
      turn: 'Left',
      dist: '100 m',
    });
    expect(m.corners[1].rows.map(r => r.selected)).toEqual([false, true]);
    expect(m.selection).toEqual({n: 3, label: 'T3 · 205 m'});
    expect(m.facts.find(f => f.label === 'Turns')?.value).toBe('4');
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
