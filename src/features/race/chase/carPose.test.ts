import {describe, expect, it} from '@jest/globals';
import * as THREE from 'three';

import {fixtureRoad} from '@/src/analysis/chaseRoadFixture';
import {roadIndex} from '@/src/analysis/chaseRoadIndex';
import {surfacePose} from '@/src/analysis/chasePose';
import {setCarRotation} from './carPose';
import {buildRoadScene, disposeGroup} from './roadScene';

const theme = {
  bg: '#000000', fill: '#222222', edge: '#555555', edgeFaint: '#333333', grid: '#111111',
  text: '#ffffff', muted: '#888888', line: '#444444', accent: '#fea92f', good: '#00ff00', bad: '#ff0000',
};
const rad = (deg: number) => (deg * Math.PI) / 180;

describe('a car on a banked road', () => {
  // a straight road heading +x (east), banked 10 degrees: its right side (south, +z in three.js) is the high side
  const centre = Array.from({length: 40}, (_, i) => ({x: i * 10, y: 0}));
  const road = fixtureRoad(centre, 400, {left: centre.map(() => 6), right: centre.map(() => 6), bankDeg: () => 10});
  const ix = roadIndex(road);

  it("the road's right edge is higher than its left, by the width times tan(bank)", () => {
    const group = buildRoadScene(road, ix, theme);
    const pos = (group.children[0] as THREE.Mesh).geometry.getAttribute('position');
    const left = new THREE.Vector3().fromBufferAttribute(pos, 20 * 2);
    const right = new THREE.Vector3().fromBufferAttribute(pos, 20 * 2 + 1);
    expect(right.y - left.y).toBeCloseTo(12 * Math.tan(rad(10)), 6);
    disposeGroup(group);
  });

  it("the car's up vector is perpendicular to the road's cross-slope, and its right side is the high side", () => {
    const group = buildRoadScene(road, ix, theme);
    const pos = (group.children[0] as THREE.Mesh).geometry.getAttribute('position');
    const left = new THREE.Vector3().fromBufferAttribute(pos, 20 * 2);
    const right = new THREE.Vector3().fromBufferAttribute(pos, 20 * 2 + 1);
    const across = right.clone().sub(left).normalize();
    const pose = surfacePose(ix, 20 * ix.stepM, 0);
    const car = new THREE.Object3D();
    setCarRotation(car, 0, pose.pitch, pose.roll); // heading 0: facing east
    car.updateMatrix();
    const up = new THREE.Vector3(0, 1, 0).transformDirection(car.matrix);
    const carRight = new THREE.Vector3(0, 0, 1).transformDirection(car.matrix);
    expect(up.dot(across)).toBeCloseTo(0, 6);
    expect(up.y).toBeCloseTo(Math.cos(rad(10)), 6);
    expect(carRight.y).toBeCloseTo(Math.sin(rad(10)), 6); // right side up
    expect(carRight.dot(across)).toBeCloseTo(1, 6); // the car's right is the road's right
    disposeGroup(group);
  });

  it('nose up for a positive pitch, whatever the heading', () => {
    for (const heading of [0, 1.1, -2.4]) {
      const car = new THREE.Object3D();
      setCarRotation(car, heading, rad(6), 0);
      car.updateMatrix();
      expect(new THREE.Vector3(1, 0, 0).transformDirection(car.matrix).y).toBeCloseTo(Math.sin(rad(6)), 6);
    }
  });
});
