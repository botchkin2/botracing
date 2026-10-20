// A ChaseRoad from a hand-made centre path, for tests: the points are taken as they are (the test gives them equally
// spaced), widths constant or per point, the profile read at each point's place on the lap. The real road is
// worldRoad.ts's.

import {roadHeight, type ChaseRoad} from './chaseRoad.ts';

export function fixtureRoad(
  centre: {x: number; y: number}[],
  lapM: number,
  opts: {
    left?: number[];
    right?: number[];
    elevation?: {stepM: number; heightM: number[]} | null;
    elevationLapM?: number;
  } = {},
): ChaseRoad {
  const n = centre.length;
  let pathM = 0;
  for (let i = 0; i < n; i++) pathM += Math.hypot(centre[(i + 1) % n].x - centre[i].x, centre[(i + 1) % n].y - centre[i].y);
  const elev = opts.elevation ? {...opts.elevation, lengthM: opts.elevationLapM ?? lapM} : null;
  return {
    stepM: pathM / n,
    lengthM: pathM,
    lapM,
    cx: centre.map(p => p.x),
    cy: centre.map(p => p.y),
    hl: opts.left ?? centre.map(() => 7),
    hr: opts.right ?? centre.map(() => 7),
    elev,
    heightM: elev ? centre.map((_, i) => roadHeight(elev, (i / n) * lapM, lapM)) : null,
    elevMin: elev ? Math.min(...elev.heightM) : 0,
  };
}
