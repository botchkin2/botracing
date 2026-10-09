import {brakeZone} from './brakeZone';

// A 1 m grid: pedal at 0 except a press from 10 m to 20 m (release at 20 m).
const press = (from: number, to: number, n = 40) =>
  Array.from({length: n}, (_, i) => (i >= from && i < to ? 80 : 0));

describe('brakeZone', () => {
  it('is the median brake point to the median release', () => {
    const lines = [
      {brakeAtM: 10, brakePct: press(10, 20)},
      {brakeAtM: 12, brakePct: press(12, 22)},
      {brakeAtM: 14, brakePct: press(14, 30)},
    ];
    expect(brakeZone(lines, 1)).toEqual([12, 22]);
  });

  it('skips laps that did not brake here', () => {
    const lines = [
      {brakeAtM: null, brakePct: press(0, 0)},
      {brakeAtM: 10, brakePct: press(10, 20)},
    ];
    expect(brakeZone(lines, 1)).toEqual([10, 20]);
  });

  it('is null when no lap in the set braked', () => {
    expect(brakeZone([{brakeAtM: null, brakePct: press(0, 0)}], 1)).toBeNull();
    expect(brakeZone([], 1)).toBeNull();
  });

  it('reads the release on the grid, not the distance', () => {
    // 5 m grid: onset at 50 m is index 10; pedal held to index 14 (70 m).
    const pct = Array.from({length: 30}, (_, i) =>
      i >= 10 && i < 14 ? 60 : 0,
    );
    expect(brakeZone([{brakeAtM: 50, brakePct: pct}], 5)).toEqual([50, 70]);
  });
});
