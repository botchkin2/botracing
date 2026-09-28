import {describe, expect, it} from '@jest/globals';

import {
  insidePolygon,
  nearestVertexDistance,
  offsetFromLine,
  signedArea2,
} from './loopSide';

// An L-shaped loop, 1 unit per step, driven clockwise on screen (y down).
// The notch at (10,10)→(5,10)→(5,20) is concave: "towards the box centre"
// is outside the loop there.
const corners = [
  {x: 0, y: 0},
  {x: 10, y: 0},
  {x: 10, y: 10},
  {x: 5, y: 10},
  {x: 5, y: 20},
  {x: 0, y: 20},
];
function densify(pts: {x: number; y: number}[]) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const n = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    for (let k = 0; k < n; k++)
      out.push({
        x: a.x + ((b.x - a.x) * k) / n,
        y: a.y + ((b.y - a.y) * k) / n,
      });
  }
  return out;
}
const loop = densify(corners);

describe('signedArea2', () => {
  it('is positive for a clockwise loop on screen', () => {
    expect(signedArea2(loop)).toBeGreaterThan(0);
  });
  it('flips when driven the other way', () => {
    expect(signedArea2([...loop].reverse())).toBeLessThan(0);
  });
});

describe('offsetFromLine', () => {
  const at = (i: number, clockwise: boolean, offset: number, pts = loop) =>
    offsetFromLine(
      pts[(i - 1 + pts.length) % pts.length],
      pts[i],
      pts[(i + 1) % pts.length],
      offset,
      clockwise,
    );
  // Index of (7,10), on the concave notch edge.
  const notch = loop.findIndex(p => p.x === 7 && p.y === 10);

  it('puts a positive offset inside on the concave notch', () => {
    expect(insidePolygon(at(notch, true, 1.5), loop)).toBe(true);
    expect(insidePolygon(at(notch, true, -1.5), loop)).toBe(false);
  });

  it('holds for the same loop driven counter-clockwise', () => {
    const rev = [...loop].reverse();
    const i = rev.findIndex(p => p.x === 7 && p.y === 10);
    expect(insidePolygon(at(i, false, 1.5, rev), loop)).toBe(true);
  });

  it('puts inside labels inside on every straight', () => {
    for (let i = 0; i < loop.length; i += 3) {
      const p = loop[i];
      // Skip vertices, where the normal is diagonal.
      if (corners.some(c => c.x === p.x && c.y === p.y)) continue;
      expect(insidePolygon(at(i, true, 0.8), loop)).toBe(true);
    }
  });
});

describe('nearestVertexDistance', () => {
  it('is the distance to the closest vertex', () => {
    expect(nearestVertexDistance({x: 2, y: 3}, loop)).toBeCloseTo(2);
  });
});
