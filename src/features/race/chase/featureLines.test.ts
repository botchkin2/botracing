import {describe, expect, it} from '@jest/globals';

import {COUPE} from './__fixtures__/coupeBody';
import {STATIONS, bodyStations, stationAt} from './bodyCurves';
import {
  ARCH_CLEARANCE_M,
  LINE_OFFSET_M,
  featureLines,
  flankZ,
} from './featureLines';

const WHEEL_R = 0.36;
const lines = featureLines(COUPE, WHEEL_R);

describe('featureLines', () => {
  it('is all finite, inside the body frame, and nothing is below the road', () => {
    for (const s of [...lines.body, ...lines.glass]) {
      for (const n of s) expect(Number.isFinite(n)).toBe(true);
      for (const x of [s[0], s[3]])
        expect(Math.abs(x)).toBeLessThanOrEqual(COUPE.lengthM / 2 + 1e-9);
      for (const y of [s[1], s[4]]) expect(y).toBeGreaterThanOrEqual(0);
    }
  });

  it('runs the top line down the centre, one segment between neighbouring stations, nose to tail', () => {
    const top = lines.body.filter(s => s[2] === 0 && s[5] === 0);
    expect(top).toHaveLength(STATIONS - 1);
    expect(top[0][0]).toBeCloseTo(COUPE.lengthM / 2, 9);
    expect(top[top.length - 1][3]).toBeCloseTo(-COUPE.lengthM / 2, 9);
    for (let i = 1; i < top.length; i++)
      expect(top[i][0]).toBeCloseTo(top[i - 1][3], 9);
  });

  it('draws the beltline and the sill on both flanks, just outside the body', () => {
    const stations = bodyStations(COUPE);
    for (const side of [-1, 1]) {
      const belt = lines.body.filter(
        s => Math.abs(s[1] - s[4]) < 0.5 && side * s[2] > 0 && side * s[5] > 0,
      );
      expect(belt.length).toBeGreaterThanOrEqual(2 * (STATIONS - 1));
    }
    const mid = stations[Math.floor(STATIONS / 2)];
    const atMid = lines.body.filter(
      s =>
        Math.abs(s[0] - mid.x) < 1e-9 &&
        s[2] > 0 &&
        Math.abs(s[1] - mid.belt) < 1e-9,
    );
    expect(atMid.length).toBeGreaterThan(0);
    expect(atMid[0][2]).toBeCloseTo(mid.half + LINE_OFFSET_M, 9);
  });

  it('puts an arch rim over each wheel on each flank, a radius clear of the wheel, between the sill and the belt', () => {
    for (const axleX of [COUPE.frontAxleX, COUPE.rearAxleX]) {
      for (const side of [-1, 1]) {
        const arch = lines.body.filter(
          s =>
            side * s[2] > 0 &&
            side * s[5] > 0 &&
            Math.abs(s[0] - axleX) < WHEEL_R + ARCH_CLEARANCE_M + 1e-6 &&
            Math.abs(s[3] - axleX) < WHEEL_R + ARCH_CLEARANCE_M + 1e-6 &&
            Math.abs(s[1] - s[4]) > 1e-9 &&
            Math.abs(s[0] - s[3]) > 1e-9,
        );
        expect(arch.length).toBeGreaterThan(3);
        for (const s of arch) {
          for (const [x, y] of [
            [s[0], s[1]],
            [s[3], s[4]],
          ]) {
            const st = stationAt(COUPE, x);
            expect(y).toBeLessThanOrEqual(st.belt + 1e-9);
            expect(y).toBeGreaterThanOrEqual(st.sill - 1e-9);
          }
        }
      }
    }
  });

  it('draws the glasshouse edge only between the foot of the screen and the foot of the rear window', () => {
    const g = COUPE.greenhouse;
    expect(lines.glass.length).toBeGreaterThan(10);
    for (const s of lines.glass) {
      for (const x of [s[0], s[3]]) {
        expect(x).toBeLessThanOrEqual(g.screenBaseX + 1e-9);
        expect(x).toBeGreaterThanOrEqual(g.rearBaseX - 1e-9);
      }
    }
    // the screen's foot is a crossbar from one side to the other
    const bar = lines.glass.find(
      s =>
        Math.abs(s[0] - g.screenBaseX) < 1e-9 &&
        Math.abs(s[3] - g.screenBaseX) < 1e-9 &&
        s[2] < 0 &&
        s[5] > 0,
    );
    expect(bar).toBeDefined();
  });
});

describe('flankZ', () => {
  it('runs from the sill half-width at the sill to the belt half-width at the belt, widening up', () => {
    const st = stationAt(COUPE, 0);
    expect(flankZ(st, st.sill)).toBeCloseTo(st.sillHalf, 9);
    expect(flankZ(st, st.belt)).toBeCloseTo(st.half, 9);
    expect(flankZ(st, (st.sill + st.belt) / 2)).toBeGreaterThan(st.sillHalf);
    expect(flankZ(st, (st.sill + st.belt) / 2)).toBeLessThan(st.half + 1e-9);
    // outside the flank it holds the end values
    expect(flankZ(st, st.belt + 1)).toBeCloseTo(st.half, 9);
    expect(flankZ(st, st.sill - 1)).toBeCloseTo(st.sillHalf, 9);
  });
});
