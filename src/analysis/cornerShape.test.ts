import {describe, expect, it} from '@jest/globals';

import {cornerTurn, type ShapeLine} from './cornerShape';

// A line on a 5 m grid from a heading profile: radians turned per metre.
function lineFrom(turnPerM: (m: number) => number, lengthM: number): ShapeLine {
  const stepM = 5;
  const x = [0];
  const y = [0];
  let h = 0;
  for (let m = stepM; m < lengthM; m += stepM) {
    h += turnPerM(m) * stepM;
    x.push(x[x.length - 1] + Math.cos(h) * stepM);
    y.push(y[y.length - 1] + Math.sin(h) * stepM);
  }
  return {stepM, x, y};
}

const corner = {n: 1, entryM: 400, apexM: 500, exitM: 600};

describe('cornerTurn', () => {
  it('reads a left-hander as L', () => {
    const line = lineFrom(m => (m > 450 && m < 550 ? 0.015 : 0), 2000);
    expect(cornerTurn(line, corner)).toBe('L');
  });

  it('reads a right-hander as R', () => {
    const line = lineFrom(m => (m > 450 && m < 550 ? -0.015 : 0), 2000);
    expect(cornerTurn(line, corner)).toBe('R');
  });

  it('labels an S-bend in driving order, not by its near-zero net turn', () => {
    const s = (m: number) =>
      m > 430 && m < 500 ? -0.02 : m >= 500 && m < 570 ? 0.02 : 0;
    expect(cornerTurn(lineFrom(s, 2000), corner)).toBe('R-L');
    expect(
      cornerTurn(
        lineFrom(m => -s(m), 2000),
        corner,
      ),
    ).toBe('L-R');
  });

  it('ignores a small wiggle on the way into a real corner', () => {
    const line = lineFrom(
      m => (m > 410 && m < 420 ? -0.005 : m > 460 && m < 560 ? 0.015 : 0),
      2000,
    );
    expect(cornerTurn(line, corner)).toBe('L');
  });
});
