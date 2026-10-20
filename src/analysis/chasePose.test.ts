import {describe, expect, it} from '@jest/globals';

import {surfacePose} from './chasePose';
import {fixtureRoad} from './chaseRoadFixture';
import {roadIndex} from './chaseRoadIndex';

const R = 100;
const N = 72;
const LAP = 2 * Math.PI * R;
const circle = Array.from({length: N}, (_, i) => ({
  x: R * Math.cos((2 * Math.PI * i) / N),
  y: R * Math.sin((2 * Math.PI * i) / N),
}));
// the circle is driven counter-clockwise, so the right of travel is outward
const rad = (deg: number) => (deg * Math.PI) / 180;

describe('surfacePose', () => {
  it('stands a car on the tilted surface at its lateral offset, rolled to the bank', () => {
    const ix = roadIndex(fixtureRoad(circle, LAP, {bankDeg: () => 5}));
    const s = 10 * ix.stepM;
    const right = surfacePose(ix, s, 3);
    expect(right.roll).toBeCloseTo(rad(5), 10);
    expect(right.z).toBeCloseTo(3 * Math.tan(rad(5)), 10); // right side up: higher than the centre line
    expect(surfacePose(ix, s, -3).z).toBeCloseTo(-3 * Math.tan(rad(5)), 10);
    expect(surfacePose(ix, s, 0).z).toBeCloseTo(0, 10);
  });

  it('takes the pitch from the grade and leaves an unbanked road unrolled', () => {
    const heightM = Array.from({length: 64}, (_, i) => i); // 1 m per 10 m: 10%
    const ix = roadIndex(fixtureRoad(circle, LAP, {elevation: {stepM: 10, heightM}, elevationLapM: LAP}));
    const p = surfacePose(ix, 20 * ix.stepM, 2);
    expect(p.pitch).toBeCloseTo(Math.atan(0.1), 3);
    expect(p.roll).toBe(0);
  });

  it('a car on a 10 degree banked circle has its up vector on the road normal', () => {
    const ix = roadIndex(fixtureRoad(circle, LAP, {bankDeg: () => 10}));
    const lateral = 2;
    const pose = surfacePose(ix, 10 * ix.stepM, lateral);
    // in the plane across the road (right, up): the cross-slope from the left edge to the right edge, and the car's up
    const across = [1, Math.tan(rad(10))];
    const up = [-Math.sin(pose.roll), Math.cos(pose.roll)]; // the up of a car whose right side is higher leans left
    expect(up[0] * across[0] + up[1] * across[1]).toBeCloseTo(0, 10);
    expect(pose.z).toBeCloseTo(lateral * Math.tan(rad(10)), 10);
  });
});
