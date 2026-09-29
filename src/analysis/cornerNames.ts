// Real-world corner names from OpenStreetMap, matched to the corner map by
// position (tools/track-info/README.md). Each corner's apex, put on the real
// map with the track's georef, takes the nearest named OSM point within
// 60 m. The match is one-to-one: every (corner, name) pair is ranked by
// distance and each corner and each name is used once, so two close apexes
// (Eau Rouge and Raidillon) never share a name. A corner with no match
// stays unnamed (pit-wall thread 20 #522).
//
// Plain TypeScript with erasable syntax only, no imports: Node runs it as is.

export interface NamedPoint {
  name: string;
  lat: number;
  lon: number;
}

export interface ApexPoint {
  n: number;
  lat: number;
  lon: number;
}

export const NAME_MATCH_M = 60;

const M_PER_DEG_LAT = 110540;
const M_PER_DEG_LON_EQUATOR = 111320;

function distanceM(
  a: {lat: number; lon: number},
  b: {lat: number; lon: number},
) {
  const dx =
    (b.lon - a.lon) * M_PER_DEG_LON_EQUATOR * Math.cos((a.lat * Math.PI) / 180);
  const dy = (b.lat - a.lat) * M_PER_DEG_LAT;
  return Math.hypot(dx, dy);
}

/** Corner number → OSM name, for the corners that matched. */
export function matchCornerNames(
  apexes: ApexPoint[],
  names: NamedPoint[],
  maxM: number = NAME_MATCH_M,
): Map<number, string> {
  const pairs: {n: number; name: string; d: number}[] = [];
  for (const a of apexes) {
    for (const p of names) {
      const d = distanceM(a, p);
      if (d <= maxM) pairs.push({n: a.n, name: p.name, d});
    }
  }
  pairs.sort((x, y) => x.d - y.d);
  const out = new Map<number, string>();
  const used = new Set<string>();
  for (const p of pairs) {
    if (out.has(p.n) || used.has(p.name)) continue;
    out.set(p.n, p.name);
    used.add(p.name);
  }
  return out;
}
