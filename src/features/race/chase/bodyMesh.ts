// The body of a car as one closed mesh (ticket 59, real bodies, steward #8297): its stations' rounded sections, lofted
// from the nose to the tail with a cap at each end. Non-indexed, so every facet keeps its own flat normal, and wound
// outward like carMeshes' own loft, so shellOf (the halo) and the closed-shell tests treat it the same. The greenhouse is
// part of the sections (bodyCurves), not a second box.

import * as THREE from 'three';

import {
  bodyStations,
  sectionRing,
  SHOULDER_ROUNDNESS,
  STATIONS,
  type BodyModel,
} from './bodyCurves';

/** A body's triangles never exceed this: a test holds it, so a richer body cannot creep up the cost of a car. */
export const MAX_BODY_TRIANGLES = 1500;

/** The rings of the body: one list of 3D points per station, the left flank first (as carMeshes' ring does). */
export function bodyRings(
  model: BodyModel,
  n: number = STATIONS,
): THREE.Vector3[][] {
  return bodyStations(model, n).map(st =>
    sectionRing(st, model.roundness ?? SHOULDER_ROUNDNESS).map(
      ([z, y]) => new THREE.Vector3(st.x, y, z),
    ),
  );
}

/** The model's body as one closed, outward-wound, non-indexed geometry, a cap at the nose and one at the tail. */
export function bodyGeometry(
  model: BodyModel,
  n: number = STATIONS,
): THREE.BufferGeometry {
  const rings = bodyRings(model, n);
  const tri: THREE.Vector3[] = [];
  for (let k = 0; k < rings.length - 1; k++) {
    const a = rings[k];
    const b = rings[k + 1];
    const count = a.length;
    for (let i = 0; i < count; i++) {
      const j = (i + 1) % count;
      tri.push(a[i], b[i], b[j], a[i], b[j], a[j]);
    }
  }
  // the nose and tail caps, fanned from their first corner
  for (const [r, flip] of [
    [rings[0], false],
    [rings[rings.length - 1], true],
  ] as const) {
    for (let i = 1; i < r.length - 1; i++)
      tri.push(...(flip ? [r[0], r[i], r[i + 1]] : [r[0], r[i + 1], r[i]]));
  }
  const g = new THREE.BufferGeometry().setFromPoints(tri);
  g.computeVertexNormals();
  return g;
}

/** The glass of the greenhouse lifts off the body by this much, so it never fights the body's own surface. */
const GLASS_LIFT_M = 0.006;

/**
 * The greenhouse's glass: an open strip over the sections between the screen's foot and the rear window's foot, from the
 * belt on one flank across the roof to the belt on the other, lifted off the body. Drawn dark (the cabin material).
 */
export function glassGeometry(
  model: BodyModel,
  n: number = STATIONS,
): THREE.BufferGeometry {
  const g = model.greenhouse;
  const rings = bodyStations(model, n)
    .filter(st => st.x <= g.screenBaseX && st.x >= g.rearBaseX)
    .map(st => {
      const ring = sectionRing(st, model.roundness ?? SHOULDER_ROUNDNESS);
      // from the belt on the left (index 2) to the belt on the right (the mirror)
      return ring
        .slice(2, ring.length - 2)
        .map(
          ([z, y]) =>
            new THREE.Vector3(
              st.x,
              y + GLASS_LIFT_M,
              z + Math.sign(z) * GLASS_LIFT_M,
            ),
        );
    });
  const tri: THREE.Vector3[] = [];
  for (let k = 0; k < rings.length - 1; k++) {
    const a = rings[k];
    const b = rings[k + 1];
    for (let i = 0; i < a.length - 1; i++)
      tri.push(a[i], b[i], b[i + 1], a[i], b[i + 1], a[i + 1]);
  }
  return new THREE.BufferGeometry().setFromPoints(tri);
}
