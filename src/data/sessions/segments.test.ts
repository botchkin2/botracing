import {describe, expect, it} from '@jest/globals';

import {segmentOptimum} from '@/src/analysis/segments';

import {toLaps, toTrackMap} from './adapters';
import {
  sectorSegmentTimes,
  segmentTimesFor,
  turnSegmentTimes,
} from './segments';

// A start straight and one compound section (corners 2, 3 and 5), cut at
// boundaries of revision 3, with the game's three sector times on every lap.
const boundaries = {
  v: 1,
  rev: 3,
  startsM: [150],
  marginM: [20],
  windows: [
    {kind: 'start-straight', section: null, fromM: 0, toM: 150, parts: []},
    {kind: 'section', section: 1, fromM: 150, toM: 1000, parts: []},
  ],
};

const corner = (n: number, entryM: number) => ({
  n,
  entryM,
  apexM: entryM + 20,
  exitM: entryM + 40,
  parts: [],
});

const map = (b: unknown = boundaries) =>
  toTrackMap({
    lengthM: 1000,
    boundaries: b,
    corners: [
      {
        ...corner(1, 200),
        parts: [corner(2, 200), corner(3, 300), corner(5, 400)],
      },
    ],
    outline: {features: []},
  });

const rawLap = (
  id: string,
  i: number,
  comparable = true,
  traffic: unknown = null,
) => ({
  id,
  lapTime: 100 + i,
  stint: 1,
  comparable,
  reasons: [],
  sectors: [30 + i, 31, 39],
  cornerBoundaries: {v: 1, rev: 3},
  startStraight: {
    segTime: 5 + i,
    fromM: 0,
    toM: 150,
    offTrackSec: 0,
    localYellowSec: 0,
    pit: false,
  },
  corners: [
    {
      segTime: 95,
      offTrackSec: 0,
      localYellowSec: 0,
      parts: [],
      brakeApps: [],
      fromM: 150,
      toM: 1000,
      runInS: 30,
      cornerS: 30,
      exitS: 35,
      pit: false,
    },
  ],
  traffic,
});

const laps = (extra: ReturnType<typeof rawLap>[] = []) =>
  toLaps([0, 1, 2, 3, 4].map(i => rawLap(`l${i}`, i)).concat(extra));

describe('turnSegmentTimes', () => {
  it('names the start straight and the section by its corners, in lap order', () => {
    const t = turnSegmentTimes(laps(), map());
    expect(t?.segments.map(s => s.label)).toEqual(['S/F', 'T2–5']);
    expect(t?.segments[1].range).toEqual({fromM: 150, toM: 1000});
    expect(t?.laps[0].timesS).toEqual([5, 95]);
  });

  it('is null before the track has windows', () => {
    expect(turnSegmentTimes(laps(), map(null))).toBeNull();
  });

  it('keeps laps that are not comparable, marked as such', () => {
    const t = turnSegmentTimes(laps([rawLap('slow', 9, false)]), map());
    expect(t?.laps.find(l => l.id === 'slow')?.comparable).toBe(false);
  });
});

describe('tow and traffic per segment', () => {
  // A car within 1 s ahead from 200 to 300 m of the field's 1000 m lap.
  const near = {
    aheadSpans: [{fromM: 200, toM: 300, s: 3}],
    draftSpans: [],
    blueSpans: [],
    fieldLapM: 1000,
  };

  it('marks the segment the span falls in, and no other', () => {
    const t = turnSegmentTimes(
      toLaps([rawLap('a', 0, true, near), rawLap('b', 1)]),
      map(),
    );
    expect(t?.laps[0].alone).toEqual([true, false]);
    expect(t?.laps[1].alone).toBeUndefined();
  });

  it('scales the field’s lap distance to the map’s', () => {
    // The field lapped 2000 m, the map is 1000 m: 200–300 m there is 100–150 m
    // here, inside the start straight (0–150).
    const t = turnSegmentTimes(
      toLaps([rawLap('a', 0, true, {...near, fieldLapM: 2000})]),
      map(),
    );
    expect(t?.laps[0].alone).toEqual([false, true]);
  });

  it('counts a tow the same way', () => {
    const tow = {
      ...near,
      aheadSpans: [],
      draftSpans: [{fromM: 0, toM: 100, s: 2}],
    };
    const t = turnSegmentTimes(toLaps([rawLap('a', 0, true, tow)]), map());
    expect(t?.laps[0].alone).toEqual([false, true]);
  });

  it('cannot be told for the game’s sectors, which have no place on the lap', () => {
    const t = sectorSegmentTimes(toLaps([rawLap('a', 0, true, near)]));
    expect(t?.laps[0].alone).toBeUndefined();
  });
});

describe('sectorSegmentTimes', () => {
  it('is S1 to S3 from the times every lap carries, with no place on the lap', () => {
    const t = sectorSegmentTimes(laps());
    expect(t?.segments.map(s => s.label)).toEqual(['S1', 'S2', 'S3']);
    expect(t?.segments.every(s => s.range === null)).toBe(true);
    expect(t?.laps[2].timesS).toEqual([32, 31, 39]);
  });

  it('is null when no lap has sector times', () => {
    expect(
      sectorSegmentTimes(toLaps([{...rawLap('a', 0), sectors: []}])),
    ).toBeNull();
  });
});

describe('segmentTimesFor', () => {
  it('gives the producer the setting asks for', () => {
    expect(segmentTimesFor('turns', laps(), map())?.segments).toHaveLength(2);
    expect(segmentTimesFor('sectors', laps(), map())?.segments).toHaveLength(3);
  });

  it('falls back to the sectors while the turns have no windows', () => {
    expect(
      segmentTimesFor('turns', laps(), map(null))?.segments.map(s => s.label),
    ).toEqual(['S1', 'S2', 'S3']);
    expect(segmentTimesFor('turns', laps(), null)?.segments).toHaveLength(3);
  });

  it('runs one optimum over either producer', () => {
    const turns = segmentOptimum(turnSegmentTimes(laps(), map())!)[0];
    const sectors = segmentOptimum(sectorSegmentTimes(laps())!)[0];
    expect(turns.bestSumS).toBe(100);
    expect(sectors.bestSumS).toBe(100);
  });
});
