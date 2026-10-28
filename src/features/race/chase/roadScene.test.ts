import {describe, expect, it} from '@jest/globals';
import * as THREE from 'three';

import {fixtureRoad} from '@/src/analysis/chaseRoadFixture';
import {roadIndex} from '@/src/analysis/chaseRoadIndex';
import {USE_COLUMNS} from '@/src/analysis/roadUse';
import {buildRoadScene, disposeGroup} from './roadScene';

const theme = {
  bg: '#000000', fill: '#222222', edge: '#555555', edgeFaint: '#333333', grid: '#111111',
  text: '#ffffff', muted: '#888888', line: '#444444', accent: '#fea92f', good: '#00ff00', bad: '#ff0000', classes: [],
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

  it('draws a darker lane and a kerb where the cars ran and touched the edge, and none without use', () => {
    const centre = Array.from({length: 40}, (_, i) => ({x: i * 10, y: 0}));
    const base = fixtureRoad(centre, 400);
    const plain = buildRoadScene(base, roadIndex(base), theme);
    const kerbs = (g: THREE.Group) => g.children.filter(c => (c as THREE.Mesh).isMesh && ((c as THREE.Mesh).material as THREE.MeshBasicMaterial).map?.image?.height === 2);
    expect(kerbs(plain)).toHaveLength(0);
    const rows = 40;
    const use = {
      shade: new Float32Array(rows * USE_COLUMNS).fill(0.5),
      kerbLeft: new Uint8Array(rows),
      kerbRight: new Uint8Array(rows).fill(1),
    };
    const withUse = buildRoadScene({...base, use}, roadIndex(base), theme);
    expect(kerbs(withUse)).toHaveLength(2);
    const fill = withUse.children[0] as THREE.Mesh;
    expect((fill.material as THREE.MeshLambertMaterial).map).toBeTruthy();
    // the right kerb has width, the left none (its flags are off): outer column vs the edge column of a mid row
    const [left, right] = kerbs(withUse) as THREE.Mesh[];
    const width = (m: THREE.Mesh) => {
      const pos = m.geometry.getAttribute('position');
      return new THREE.Vector3().fromBufferAttribute(pos, 20 * 2).distanceTo(new THREE.Vector3().fromBufferAttribute(pos, 20 * 2 + 1));
    };
    expect(width(left)).toBeCloseTo(0, 5);
    expect(width(right)).toBeCloseTo(1.4, 5);
    disposeGroup(plain);
    disposeGroup(withUse);
  });
  it('carries the use texture across the lap seam: its v never steps back, so no quad squeezes the whole map into 1.5 m', () => {
    const centre = Array.from({length: 40}, (_, i) => ({x: i * 10, y: 0}));
    const base = fixtureRoad(centre, 400);
    const use = {shade: new Float32Array(40 * USE_COLUMNS).fill(0.5), kerbLeft: new Uint8Array(40), kerbRight: new Uint8Array(40)};
    const group = buildRoadScene({...base, use}, roadIndex(base), theme);
    const fill = group.children[0] as THREE.Mesh;
    const uv = fill.geometry.getAttribute('uv');
    // two columns per row; the largest step of v between neighbouring rows is one row of the map
    for (let r = 1; r < uv.count / 2; r++) expect(uv.getY(r * 2) - uv.getY((r - 1) * 2)).toBeCloseTo(1 / 40, 5);
    expect((((fill.material as THREE.MeshLambertMaterial).map) as THREE.Texture).wrapT).toBe(THREE.RepeatWrapping);
    disposeGroup(group);
  });
  it('lays the start line on a cambered road surface, both sides above it (Road Atlanta rolls -1.3 degrees at the line)', () => {
    const centre = Array.from({length: 40}, (_, i) => ({x: i * 10, y: 0}));
    const road = fixtureRoad(centre, 400, {bankDeg: centre.map(() => -1.31)});
    const group = buildRoadScene(road, roadIndex(road), theme);
    const fill = group.children[0] as THREE.Mesh;
    // the theme's text colour is only the start line's; the ground is also one 4-point quad, in the fill colour
    const line = group.children.find(
      c => (c as THREE.Mesh).isMesh && ((c as THREE.Mesh).material as THREE.MeshBasicMaterial).color?.getHexString() === 'ffffff',
    ) as THREE.Mesh;
    const surface = fill.geometry.getAttribute('position');
    const quad = line.geometry.getAttribute('position');
    // row 0 of both: the left edge (column 0) and the right edge (column 1); three.js y is up
    for (const column of [0, 1]) {
      const above = quad.getY(column) - surface.getY(column);
      expect(above).toBeGreaterThan(0);
      expect(above).toBeLessThan(0.2);
    }
    disposeGroup(group);
  });
});
