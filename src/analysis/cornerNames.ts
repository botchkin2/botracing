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

/** A section of the corner map: the real-world points of its stretch from entry to exit, apexes included. */
export interface SectionSpan {
  n: number;
  points: {lat: number; lon: number}[];
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
  return matchNames(
    apexes.map(a => ({n: a.n, points: [a]})),
    names,
    maxM,
  );
}

/**
 * Section number → OSM name. A name is a point, but a section is a stretch: Monza's Parabolica is a long arc whose
 * name sits off its apex, and Ascari's three parts compete for the names around one chicane (`Curva Vialone` on the
 * approach landed on its first part, ticket 83). So each section is measured by its nearest point from entry to exit,
 * and a name goes to the section it is nearest, once.
 */
export function matchSectionNames(
  sections: SectionSpan[],
  names: NamedPoint[],
  maxM: number = NAME_MATCH_M,
): Map<number, string> {
  return matchNames(sections, names, maxM);
}

function matchNames(
  sections: SectionSpan[],
  names: NamedPoint[],
  maxM: number,
): Map<number, string> {
  const pairs: {n: number; name: string; d: number}[] = [];
  for (const s of sections) {
    for (const p of names) {
      let d = Infinity;
      for (const q of s.points) d = Math.min(d, distanceM(q, p));
      if (d <= maxM) pairs.push({n: s.n, name: p.name, d});
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
