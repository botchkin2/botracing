import {describe, expect, it} from '@jest/globals';
import * as THREE from 'three';

import {COUPE} from './__fixtures__/coupeBody';
import {bodyStations, sectionRing, STATIONS} from './bodyCurves';
import {MAX_BODY_TRIANGLES, bodyGeometry, bodyRings} from './bodyMesh';

const positions = (g: THREE.BufferGeometry) =>
  g.getAttribute('position') as THREE.BufferAttribute;
const key = (p: THREE.BufferAttribute, i: number) =>
  `${Math.round(p.getX(i) * 1e5)},${Math.round(p.getY(i) * 1e5)},${Math.round(
    p.getZ(i) * 1e5,
  )}`;

describe('bodyGeometry', () => {
  const g = bodyGeometry(COUPE);
  const p = positions(g);
  const triangles = p.count / 3;

  it('is non-indexed and all finite', () => {
    expect(g.index).toBeNull();
    for (let i = 0; i < p.count; i++) {
      expect(Number.isFinite(p.getX(i))).toBe(true);
      expect(Number.isFinite(p.getY(i))).toBe(true);
      expect(Number.isFinite(p.getZ(i))).toBe(true);
    }
  });

  it('is closed: every edge is shared by exactly two triangles', () => {
    const edges = new Map<string, number>();
    const add = (a: string, b: string) => {
      const k = a < b ? `${a}|${b}` : `${b}|${a}`;
      edges.set(k, (edges.get(k) ?? 0) + 1);
    };
    for (let t = 0; t < triangles; t++) {
      const [a, b, c] = [key(p, 3 * t), key(p, 3 * t + 1), key(p, 3 * t + 2)];
      add(a, b);
      add(b, c);
      add(c, a);
    }
    const bad = [...edges.values()].filter(n => n !== 2);
    expect(bad).toEqual([]);
  });

  it('is wound outward: its signed volume is positive and is the body, not its inside-out twin', () => {
    let volume = 0;
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    for (let t = 0; t < triangles; t++) {
      a.fromBufferAttribute(p, 3 * t);
      b.fromBufferAttribute(p, 3 * t + 1);
      c.fromBufferAttribute(p, 3 * t + 2);
      volume += a.dot(b.clone().cross(c)) / 6;
    }
    // a 4 x 1.9 x ~0.6 m coupe body is a few cubic metres; a negative value is an inside-out mesh
    expect(volume).toBeGreaterThan(1);
    expect(volume).toBeLessThan(8);
  });

  it('points every flank facet away from the centre line', () => {
    // the left flank's facets face -z, the right's +z, at the widest belt station
    const rings = bodyRings(COUPE);
    const mid = rings[Math.floor(STATIONS / 2)];
    const beltLeft = mid[2];
    expect(beltLeft.z).toBeLessThan(0);
    let out = 0;
    let inward = 0;
    const n = new THREE.Vector3();
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    for (let t = 0; t < triangles; t++) {
      a.fromBufferAttribute(p, 3 * t);
      b.fromBufferAttribute(p, 3 * t + 1);
      c.fromBufferAttribute(p, 3 * t + 2);
      n.copy(b).sub(a).cross(c.clone().sub(a));
      const centre = a.clone().add(b).add(c).divideScalar(3);
      // flank triangles: well off the centre line and not a cap
      if (Math.abs(centre.z) > 0.5 && Math.abs(centre.x) < 1.8) {
        if (n.z * Math.sign(centre.z) > 0) out++;
        else inward++;
      }
    }
    expect(inward).toBe(0);
    expect(out).toBeGreaterThan(100);
  });

  it('is the model: its length, its widest half-width and its highest point', () => {
    const box = new THREE.Box3().setFromBufferAttribute(p);
    expect(box.max.x - box.min.x).toBeCloseTo(COUPE.lengthM, 6);
    const widest = Math.max(...bodyStations(COUPE).map(st => st.half));
    expect(box.max.z).toBeCloseTo(widest, 6);
    expect(box.min.z).toBeCloseTo(-widest, 6);
    const highest = Math.max(...bodyStations(COUPE).map(st => st.top));
    expect(box.max.y).toBeCloseTo(highest + 0.012, 6);
  });

  it('stands on the road: nothing below the ground', () => {
    const box = new THREE.Box3().setFromBufferAttribute(p);
    expect(box.min.y).toBeGreaterThanOrEqual(0);
  });

  it('stays inside the triangle budget', () => {
    expect(triangles).toBeLessThanOrEqual(MAX_BODY_TRIANGLES);
    // 27 bands of 15 sections, two triangles each, and a 13-triangle fan at each end
    expect(triangles).toBe(27 * 15 * 2 + 2 * 13);
  });
});

describe('bodyRings', () => {
  it('has one ring per station, each a section of the model at that x', () => {
    const rings = bodyRings(COUPE);
    const stations = bodyStations(COUPE);
    expect(rings).toHaveLength(STATIONS);
    rings.forEach((r, i) => {
      expect(r).toHaveLength(sectionRing(stations[i]).length);
      for (const v of r) expect(v.x).toBeCloseTo(stations[i].x, 9);
    });
  });
});
