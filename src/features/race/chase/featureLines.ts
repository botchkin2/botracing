// The outline of a real body, drawn as explicit segments (ticket 59, real bodies, steward #8297): a smooth body has few
// creases, so EdgesGeometry would find almost nothing on it and the lit-outline look would vanish. These lines are
// appended to the body edges (the same single LineSegments the tail lights ride) and, for the glasshouse, to the cabin
// edges. A segment is [x1, y1, z1, x2, y2, z2] in the body frame (x forward, y up, z across).

import {
  CROWN_M,
  SHOULDER_ROUNDNESS,
  bodyStations,
  sectionRing,
  stationAt,
  STATIONS,
  type BodyModel,
  type BodyStation,
} from './bodyCurves';

export type Segment = [number, number, number, number, number, number];

/** The lines stand this far off the body's surface, so they never sink into it. */
export const LINE_OFFSET_M = 0.006;
/** A wheel arch's rim is drawn this far outside the wheel's radius. */
export const ARCH_CLEARANCE_M = 0.07;
/** The arch's arc is drawn in steps of this many degrees. */
const ARCH_STEP_DEG = 12;

/** A polyline's consecutive pairs as segments. */
function chain(points: [number, number, number][]): Segment[] {
  const out: Segment[] = [];
  for (let i = 0; i + 1 < points.length; i++)
    out.push([...points[i], ...points[i + 1]] as Segment);
  return out;
}

/** The z of the lower flank at height y: along the sill-to-belt line of the section (z > 0 is the right side). */
export function flankZ(st: BodyStation, y: number): number {
  const lo: [number, number] = [st.sillHalf, st.sill];
  const mid: [number, number] = [
    st.half * 0.99,
    st.sill + 0.4 * (st.belt - st.sill),
  ];
  const hi: [number, number] = [st.half, st.belt];
  const [a, b] = y <= mid[1] ? [lo, mid] : [mid, hi];
  const t =
    b[1] === a[1] ? 0 : Math.max(0, Math.min(1, (y - a[1]) / (b[1] - a[1])));
  return a[0] + (b[0] - a[0]) * t;
}

export interface Lines {
  /** The outline of the body: top line, beltline, sill, wheel-arch rims. */
  body: Segment[];
  /** The glasshouse: its edge round the roof and screens, and the pillars at the screen and the rear window. */
  glass: Segment[];
}

/**
 * The feature lines of a body: the silhouette's top line along the centre, the beltline and the sill on both flanks, an
 * arch rim round each wheel on each flank (the wheel's `radius` is the car's own), and the glasshouse's edge.
 */
export function featureLines(
  model: BodyModel,
  wheelRadius: number,
  n: number = STATIONS,
): Lines {
  const stations = bodyStations(model, n);
  const body: Segment[] = [];
  body.push(
    ...chain(stations.map(st => [st.x, st.top + CROWN_M + LINE_OFFSET_M, 0])),
  );
  for (const side of [-1, 1]) {
    body.push(
      ...chain(
        stations.map(st => [st.x, st.belt, side * (st.half + LINE_OFFSET_M)]),
      ),
    );
    body.push(
      ...chain(
        stations.map(st => [
          st.x,
          st.sill,
          side * (st.sillHalf + LINE_OFFSET_M),
        ]),
      ),
    );
  }
  // the arch rim: an arc over each wheel, on the flank surface between the sill and the belt
  const radius = wheelRadius + ARCH_CLEARANCE_M;
  for (const axleX of [model.frontAxleX, model.rearAxleX]) {
    for (const side of [-1, 1]) {
      const arc: [number, number, number][] = [];
      for (let deg = 0; deg <= 180; deg += ARCH_STEP_DEG) {
        const a = (deg * Math.PI) / 180;
        const x = axleX + radius * Math.cos(a);
        const st = stationAt(model, x);
        const y = wheelRadius + radius * Math.sin(a);
        if (y > st.belt - 0.01 || y < st.sill + 0.02) continue;
        arc.push([x, y, side * (flankZ(st, y) + LINE_OFFSET_M)]);
      }
      body.push(...chain(arc));
    }
  }

  const g = model.greenhouse;
  const glass: Segment[] = [];
  const inGlass = stations.filter(
    st => st.x <= g.screenBaseX && st.x >= g.rearBaseX,
  );
  const edgeY = (st: BodyStation) => st.top + LINE_OFFSET_M;
  for (const side of [-1, 1])
    glass.push(
      ...chain(inGlass.map(st => [st.x, edgeY(st), side * st.topHalf])),
    );
  // the screen's foot and the rear window's foot across the top, and the pillars down the shoulder to the belt
  for (const x of [g.screenBaseX, g.rearBaseX]) {
    const st = stationAt(model, x);
    glass.push([x, edgeY(st), -st.topHalf, x, edgeY(st), st.topHalf]);
    const ring = sectionRing(st, model.roundness ?? SHOULDER_ROUNDNESS);
    const half = (ring.length - 1) / 2;
    for (const side of [-1, 1]) {
      const flank = ring
        .slice(2, half + 1)
        .map(
          ([z, y]) =>
            [x, y + LINE_OFFSET_M, side === -1 ? z : -z] as [
              number,
              number,
              number,
            ],
        );
      glass.push(...chain(flank));
    }
  }
  return {body, glass};
}
