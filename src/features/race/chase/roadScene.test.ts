import {describe, expect, it} from '@jest/globals';
import * as THREE from 'three';

import {fixtureRoad} from '@/src/analysis/chaseRoadFixture';
import {roadIndex} from '@/src/analysis/chaseRoadIndex';
import {buildRoadScene, disposeGroup} from './roadScene';

const theme = {
  bg: '#000000', fill: '#222222', edge: '#555555', edgeFaint: '#333333', grid: '#111111',
  text: '#ffffff', muted: '#888888', line: '#444444', accent: '#fea92f', good: '#00ff00', bad: '#ff0000',
};

describe('road scene', () => {
  it('draws the road at its measured width: 6.3 m left plus 6.0 m right is 12.3 m across', () => {
    // a straight 400 m road heading +x (east): left of travel is north (+y), which three.js puts at -z
    const centre = Array.from({length: 40}, (_, i) => ({x: i * 10, y: 0}));
    const left = centre.map(() => 6.3);
    const right = centre.map(() => 6.0);
    const road = fixtureRoad(centre, 400, {left, right});
    const group = buildRoadScene(road, roadIndex(road), theme);
    const fill = group.children[0] as THREE.Mesh;
    const pos = fill.geometry.getAttribute('position');
    // the row in the middle of the straight: its two points, across the road
    const r = 20;
    const a = new THREE.Vector3().fromBufferAttribute(pos, r * 2);
    const b = new THREE.Vector3().fromBufferAttribute(pos, r * 2 + 1);
    expect(a.distanceTo(b)).toBeCloseTo(12.3, 5);
    expect(-a.z).toBeCloseTo(6.3, 5); // left of travel: north
    expect(b.z).toBeCloseTo(6.0, 5); // right of travel: south
    disposeGroup(group);
  });

  it('lays the near ground at the road height, 60 m out from each edge', () => {
    const centre = Array.from({length: 40}, (_, i) => ({x: i * 10, y: 0}));
    const road = fixtureRoad(centre, 400, {left: centre.map(() => 6), right: centre.map(() => 6)});
    const group = buildRoadScene(road, roadIndex(road), theme);
    const ground = group.children.filter(
      c => (c as THREE.Mesh).isMesh && (c as THREE.Mesh).material instanceof THREE.MeshBasicMaterial && (c as THREE.Mesh).geometry.getAttribute('position').count > 4,
    ) as THREE.Mesh[];
    // a ground strip is a two-column ribbon whose outer column is 66 m from the centre line (6 m edge + 60 m)
    const outer = ground.filter(m => {
      const pos = m.geometry.getAttribute('position');
      return Math.abs(Math.abs(pos.getZ(21)) - 66) < 1e-6 || Math.abs(Math.abs(pos.getZ(20)) - 66) < 1e-6;
    });
    expect(outer.length).toBe(2);
    disposeGroup(group);
  });
});
