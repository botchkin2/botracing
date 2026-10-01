import {describe, expect, it} from '@jest/globals';

import {toLaps, toTrackMap} from './adapters';
import {sessionOptimum} from './windowOptimum';

// A start straight and one section, boundaries at revision 3.
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

const map = (b: unknown = boundaries) =>
  toTrackMap({
    lengthM: 1000,
    boundaries: b,
    corners: [{n: 1, entryM: 200, apexM: 250, exitM: 300, parts: []}],
    outline: {features: []},
  });

interface Over {
  stint?: number;
  comparable?: boolean;
  stamp?: unknown;
  startS?: number;
  sectionS?: number;
  pit?: boolean;
  offTrackSec?: number;
  localYellowSec?: number;
  flagged?: boolean;
}

const rawLap = (id: string, o: Over = {}) => ({
  id,
  lapTime: 100,
  stint: o.stint ?? 1,
  comparable: o.comparable ?? true,
  reasons: [],
  cornerBoundaries: o.stamp === undefined ? {v: 1, rev: 3} : o.stamp,
  startStraight: {
    segTime: o.startS ?? 5,
    fromM: 0,
    toM: 150,
    offTrackSec: 0,
    localYellowSec: 0,
    pit: false,
  },
  corners: [
    {
      segTime: o.sectionS ?? 95,
      offTrackSec: o.offTrackSec ?? 0,
      localYellowSec: o.localYellowSec ?? 0,
      parts: [],
      brakeApps: [],
      fromM: 150,
      toM: 1000,
      runInS: 30,
      cornerS: 30,
      exitS: (o.sectionS ?? 95) - 60,
      pit: o.pit ?? false,
    },
  ],
  // Tow and traffic ride on the lap and must never matter here.
  traffic: o.flagged ? {towS: 9, aheadS: 9} : null,
});

const optimum = (laps: ReturnType<typeof rawLap>[], m = map()) =>
  sessionOptimum(toLaps(laps), m);

const five = (over: (i: number) => Over = () => ({})) =>
  [0, 1, 2, 3, 4].map(i =>
    rawLap(`l${i}`, {startS: 5 + i, sectionS: 95 + i, ...over(i)}),
  );

describe('sessionOptimum', () => {
  it('is null before the track has windows', () => {
    expect(optimum(five(), map(null))).toBeNull();
  });

  it('sums best and median over the windows of one stint', () => {
    const s = optimum(five())?.stints;
    expect(s).toHaveLength(1);
    expect(s?.[0].windows.map(w => w.n)).toEqual([5, 5]);
    expect(s?.[0].bestSumS).toBe(100);
    expect(s?.[0].medianSumS).toBe(5 + 2 + 95 + 2);
  });

  it('leaves out a window that crosses the pit lane, off track or under a yellow', () => {
    // One lap of six per cause: that window loses a time, the rest stay.
    const laps = [
      ...five(),
      rawLap('pit', {pit: true, sectionS: 80}),
      rawLap('off', {offTrackSec: 0.2, sectionS: 80}),
      rawLap('yel', {localYellowSec: 0.5, sectionS: 80}),
    ];
    const w = optimum(laps)?.stints[0].windows;
    expect(w?.[1]).toMatchObject({n: 5, bestS: 95});
    expect(w?.[0].n).toBe(8);
  });

  it('keeps a touch of the white line and a brief yellow', () => {
    const laps = [
      ...five(),
      rawLap('a', {offTrackSec: 0.19, sectionS: 80}),
      rawLap('b', {localYellowSec: 0.49, sectionS: 81}),
    ];
    const w = optimum(laps)?.stints[0].windows[1];
    expect(w).toMatchObject({n: 7, bestS: 80, bestLapId: 'a'});
  });

  it('never leaves a time out for tow or traffic', () => {
    const laps = five(i => ({flagged: i < 3, sectionS: 90 + i}));
    const w = optimum(laps)?.stints[0].windows[1];
    expect(w).toMatchObject({n: 5, bestS: 90, bestLapId: 'l0'});
  });

  it('skips laps that are not comparable or were cut at other boundaries', () => {
    const laps = [
      ...five(),
      rawLap('slow', {comparable: false, sectionS: 70}),
      rawLap('old', {stamp: {v: 1, rev: 2}, sectionS: 70}),
      rawLap('none', {stamp: null, sectionS: 70}),
    ];
    const s = optimum(laps)?.stints[0];
    expect(s?.lapCount).toBe(5);
    expect(s?.windows[1].bestS).toBe(95);
  });

  it('keeps stints apart and drops one under 5 laps', () => {
    const laps = [
      ...five(),
      ...[0, 1, 2, 3].map(i => rawLap(`s${i}`, {stint: 2, sectionS: 50})),
    ];
    expect(optimum(laps)?.stints.map(s => s.stint)).toEqual([1]);
  });
});
