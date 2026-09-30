import {describe, expect, it} from '@jest/globals';

import {
  addLap,
  addSession,
  dropOsmInsideSurface,
  emptySurface,
  MAX_EDGE_M,
  type SurfaceLap,
  surfaceGeometry,
} from './trackSurface';

// A straight 1,000 m road along +x (east), centre at y = 0. Travelling east,
// the right-hand side is south (-y). A car at lateral `pl` sits at y = -pl.
const LENGTH_M = 1000;
const STEP_M = 5;

function lap(
  pl: number,
  edge: number,
  range: [number, number] = [0, LENGTH_M],
): SurfaceLap {
  const out: SurfaceLap = {
    distM: [],
    x: [],
    y: [],
    pathLateralM: [],
    trackEdgeM: [],
  };
  for (let d = range[0]; d < range[1]; d += STEP_M) {
    out.distM.push(d);
    out.x.push(d);
    out.y.push(-pl);
    out.pathLateralM.push(pl);
    out.trackEdgeM.push(edge);
  }
  return out;
}

describe('addLap and surfaceGeometry', () => {
  it('finds the same centre from laps at different lateral positions', () => {
    const s = emptySurface(LENGTH_M);
    addLap(s, lap(-2, -6));
    addLap(s, lap(3, 6));
    const g = surfaceGeometry(s);
    expect(g.runs).toHaveLength(1);
    for (const c of g.runs[0].centre) expect(c.y).toBeCloseTo(0, 6);
    expect(g.runs[0].centre[10].x).toBeCloseTo(102.5, 6);
  });

  it('puts the left edge on the left of travel (north) and the right on the south', () => {
    const s = emptySurface(LENGTH_M);
    addLap(s, lap(-2, -6));
    addLap(s, lap(3, 6));
    const g = surfaceGeometry(s);
    expect(g.halfWidthM).toBeCloseTo(6, 6);
    const run = g.runs[0];
    expect(run.left[20]?.y).toBeCloseTo(6, 6);
    expect(run.right[20]?.y).toBeCloseTo(-6, 6);
    expect(g.coverage).toEqual({bins: 100, both: 1, oneEdge: 0, centreOnly: 0});
  });

  it('one lap measures one edge; the other is not measured and not invented', () => {
    const s = emptySurface(LENGTH_M);
    addLap(s, lap(-2, -6));
    const g = surfaceGeometry(s);
    expect(g.runs[0].left[5]).not.toBeNull();
    expect(g.runs[0].right[5]).toBeNull();
    // No bin has both edges, so there is no width to dash at.
    expect(g.halfWidthM).toBeNull();
    expect(g.runs[0].rightDashed[5]).toBeNull();
    expect(g.coverage).toEqual({bins: 100, both: 0, oneEdge: 1, centreOnly: 0});
  });

  it('dashes the unmeasured edge at the track median half-width, separate from the measured ones', () => {
    const s = emptySurface(LENGTH_M);
    addLap(s, lap(-2, -6, [0, 500]));
    addLap(s, lap(3, 6, [0, 500]));
    addLap(s, lap(-2, -6, [500, 1000]));
    const g = surfaceGeometry(s);
    const run = g.runs[0];
    expect(run.right[70]).toBeNull();
    expect(run.rightDashed[70]?.y).toBeCloseTo(-6, 6);
    expect(run.leftDashed[70]).toBeNull();
    expect(run.left[70]?.y).toBeCloseTo(6, 6);
    // Where both are measured nothing is dashed.
    expect(run.leftDashed[20]).toBeNull();
    expect(run.rightDashed[20]).toBeNull();
    expect(g.coverage.both).toBeCloseTo(0.5, 6);
    expect(g.coverage.oneEdge).toBeCloseTo(0.5, 6);
  });

  it('a lap with no edge in range still gives the centre (centre only)', () => {
    const s = emptySurface(LENGTH_M);
    addLap(s, lap(1, MAX_EDGE_M + 5));
    const g = surfaceGeometry(s);
    expect(g.coverage).toEqual({bins: 100, both: 0, oneEdge: 0, centreOnly: 1});
    expect(g.runs[0].centre[3].y).toBeCloseTo(0, 6);
  });

  it('bins without a lap split the road into runs', () => {
    const s = emptySurface(LENGTH_M);
    addLap(s, lap(0, -6, [0, 300]));
    addLap(s, lap(0, -6, [600, 1000]));
    const g = surfaceGeometry(s);
    expect(g.runs.map(r => r.fromM)).toEqual([0, 600]);
    expect(g.coverage.bins).toBe(70);
  });

  it('minLaps holds a bin back until enough laps drove it', () => {
    const s = emptySurface(LENGTH_M);
    addLap(s, lap(0, -6));
    addLap(s, lap(0, -6, [0, 500]));
    const g = surfaceGeometry(s, 2);
    expect(g.coverage.bins).toBe(50);
  });
});

describe('addSession', () => {
  it('adding the same session twice changes nothing', () => {
    const s = emptySurface(LENGTH_M);
    expect(addSession(s, 'a', [lap(-2, -6), lap(3, 6)])).toBe(true);
    const once = JSON.stringify(s);
    expect(addSession(s, 'a', [lap(-2, -6), lap(3, 6)])).toBe(false);
    expect(JSON.stringify(s)).toBe(once);
    expect(s.sessions).toEqual(['a']);
  });

  it('two sessions equal the same laps in one', () => {
    const together = emptySurface(LENGTH_M);
    addSession(together, 'a', [lap(-2, -6), lap(3, 6)]);
    const parts = emptySurface(LENGTH_M);
    addSession(parts, 'a', [lap(-2, -6)]);
    addSession(parts, 'b', [lap(3, 6)]);
    expect(parts.bins).toEqual(together.bins);
    expect(parts.sessions).toEqual(['a', 'b']);
  });

  it('two sessions with different lateral driving agree on the centre', () => {
    const s = emptySurface(LENGTH_M);
    addSession(s, 'a', [lap(-4, -6)]);
    addSession(s, 'b', [lap(4, 6)]);
    const c = surfaceGeometry(s).runs[0].centre;
    expect(Math.max(...c.map(p => Math.abs(p.y)))).toBeLessThan(1e-6);
  });
});

describe('dropOsmInsideSurface', () => {
  const s = emptySurface(LENGTH_M);
  addSession(s, 'a', [lap(-2, -6), lap(3, 6)]);
  const g = surfaceGeometry(s);
  const road = (y: number, from = 0, to = 1000) => [
    {x: from, y},
    {x: to, y},
  ];

  it('drops a road way that lies inside the measured surface', () => {
    const [r] = dropOsmInsideSurface(
      [{id: 1, kind: 'track', points: road(4)}],
      g,
    );
    expect(r.kept).toEqual([]);
    // The way is 1,000 m long: the dropped length is its real length.
    expect(r.droppedM).toBeCloseTo(1000, 0);
  });

  it('keeps a road way beyond half-width plus the margin', () => {
    const [r] = dropOsmInsideSurface(
      [{id: 1, kind: 'track', points: road(20)}],
      g,
    );
    expect(r.droppedM).toBe(0);
    expect(r.kept).toHaveLength(1);
  });

  it('never touches a pit way, even on top of the road', () => {
    const [r] = dropOsmInsideSurface(
      [{id: 2, kind: 'pit', points: road(1)}],
      g,
    );
    expect(r.droppedM).toBe(0);
    expect(r.kept).toEqual([road(1)]);
  });

  it('cuts a way that leaves the surface part-way and keeps the outside part', () => {
    const way = [
      {x: 0, y: 0},
      {x: 400, y: 0},
      {x: 400, y: 200},
    ];
    const [r] = dropOsmInsideSurface([{id: 3, kind: 'track', points: way}], g);
    expect(r.droppedM).toBeGreaterThan(380);
    expect(r.kept).toHaveLength(1);
    expect(r.kept[0][r.kept[0].length - 1]).toEqual({x: 400, y: 200});
    expect(Math.min(...r.kept[0].map(p => p.y))).toBeGreaterThan(8);
  });

  it('keeps every way when nothing is measured', () => {
    const none = surfaceGeometry(emptySurface(LENGTH_M));
    const [r] = dropOsmInsideSurface(
      [{id: 4, kind: 'track', points: road(0)}],
      none,
    );
    expect(r.droppedM).toBe(0);
  });
});
