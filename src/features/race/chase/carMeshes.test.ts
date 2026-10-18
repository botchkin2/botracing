import {describe, expect, it} from '@jest/globals';
import * as THREE from 'three';

import {carOutline, tickSegment} from './carMeshes';

// The engine places a car with rotation.set(0, heading, 0) in the three.js frame (x east, y up, z = -north).
const placed = (local: {x: number; z: number}, heading: number) => {
  const o = new THREE.Object3D();
  o.rotation.order = 'YZX';
  o.rotation.set(0, heading, 0);
  o.updateMatrix();
  const p = new THREE.Vector3(local.x, 0, local.z).applyMatrix4(o.matrix);
  return {x: p.x, y: -p.z}; // back to the world frame: x east, y north
};

describe('car geometry', () => {
  it('the tick starts at the nose and runs forward, 0.3 of the car length', () => {
    const [a, b] = tickSegment('GT3');
    const nose = carOutline('GT3').reduce((m, p) => (p.x > m.x ? p : m));
    expect(a.x).toBeCloseTo(nose.x);
    expect(a.z).toBeCloseTo(nose.z);
    expect(b.x - a.x).toBeCloseTo(0.3 * 4.65);
    expect(b.z).toBeCloseTo(0);
  });
  it('forward on the car is the world heading, whatever the heading', () => {
    for (const h of [0, 0.7, Math.PI / 2, Math.PI, -2.1]) {
      const [a, b] = tickSegment('GT3');
      const wa = placed(a, h);
      const wb = placed(b, h);
      expect(Math.atan2(wb.y - wa.y, wb.x - wa.x)).toBeCloseTo(Math.atan2(Math.sin(h), Math.cos(h)));
    }
  });
  it('the nose is ahead of the car centre along the heading, the tail behind', () => {
    const h = 1.2;
    const outline = carOutline('Hyper');
    const nose = outline.reduce((m, p) => (p.x > m.x ? p : m));
    const tail = outline.reduce((m, p) => (p.x < m.x ? p : m));
    const forward = {x: Math.cos(h), y: Math.sin(h)};
    const wn = placed(nose, h);
    const wt = placed(tail, h);
    expect(wn.x * forward.x + wn.y * forward.y).toBeGreaterThan(2);
    expect(wt.x * forward.x + wt.y * forward.y).toBeLessThan(-2);
  });
});
