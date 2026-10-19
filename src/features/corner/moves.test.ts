import {describe, expect, it} from '@jest/globals';

import {buildMoves, MOVES_MIN_LAPS, type MovesLap} from './moves';

const lap = (i: number, over: Partial<MovesLap> = {}): MovesLap => ({
  time: 10 + i * 0.1,
  brake: 100 - i,
  lateral: i % 5,
  steerPct: 20,
  throttle: 50,
  minSpeedKph: 100 + (i % 3),
  ...over,
});
const laps = (n: number, over?: (i: number) => Partial<MovesLap>) =>
  Array.from({length: n}, (_, i) => lap(i, over?.(i)));

describe('buildMoves', () => {
  it('draws nothing under the floor of laps with a time, whatever they say', () => {
    expect(MOVES_MIN_LAPS).toBe(10);
    expect(buildMoves(laps(9), 'right')).toBeNull();
    // Ten laps, but one without a time: nine.
    expect(
      buildMoves(
        laps(10, i => (i === 3 ? {time: null} : {})),
        'right',
      ),
    ).toBeNull();
    expect(buildMoves(laps(10), 'right')).not.toBeNull();
  });

  it('ranks the inputs by |rho| with the rho signed, and says n', () => {
    // brake falls as the time rises (rho -1); the line rises with it (+1) on
    // alternating laps; steering and throttle never vary: no row.
    const m = buildMoves(
      laps(12, i => ({lateral: i, steerPct: (i * 7) % 12})),
      'right',
    )!;
    expect(m.n).toBe(12);
    expect(m.rows.map(r => r.id)).toEqual(
      expect.arrayContaining(['brake', 'line', 'steer']),
    );
    expect(m.rows.find(r => r.id === 'brake')!.rho).toBeCloseTo(-1);
    expect(m.rows.find(r => r.id === 'line')!.rho).toBeCloseTo(1);
    expect(m.rows.some(r => r.id === 'throttle')).toBe(false);
    const abs = m.rows.map(r => Math.abs(r.rho));
    expect(abs).toEqual([...abs].sort((a, b) => b - a));
  });

  it('turns the line toward the inside: the same drive reads the opposite sign in a left-hander', () => {
    const right = buildMoves(
      laps(12, i => ({lateral: i})),
      'right',
    )!;
    const left = buildMoves(
      laps(12, i => ({lateral: i})),
      'left',
    )!;
    expect(right.rows.find(r => r.id === 'line')!.rho).toBeCloseTo(1);
    expect(left.rows.find(r => r.id === 'line')!.rho).toBeCloseTo(-1);
  });

  it('has no line row for a part that turns both ways', () => {
    const m = buildMoves(
      laps(12, i => ({lateral: i})),
      'mixed',
    )!;
    expect(m.rows.some(r => r.id === 'line')).toBe(false);
  });

  it('dims a row no bigger than noise for its n, and only that one', () => {
    // 13 laps: the 5 % critical size is 0.56. Steering is a fixed shuffle with a
    // small rank correlation; the brake is exactly the time's reverse.
    const shuffle = [4, 9, 1, 12, 6, 0, 10, 3, 8, 2, 11, 5, 7];
    const m = buildMoves(
      laps(13, i => ({steerPct: shuffle[i]})),
      'right',
    )!;
    const steer = m.rows.find(r => r.id === 'steer')!;
    expect(Math.abs(steer.rho)).toBeLessThan(0.56);
    expect(steer.dimmed).toBe(true);
    expect(m.rows.find(r => r.id === 'brake')!.dimmed).toBe(false);
    expect(steer.n).toBe(13);
  });

  it('puts the slowest sample’s speed in the head as context, not among the rows', () => {
    const m = buildMoves(
      laps(12, i => ({minSpeedKph: 112 + (i % 2)})),
      'right',
    )!;
    expect(m.apex!.kph).toBeCloseTo(112.5, 1);
    expect(m.rows.every(r => r.id !== ('minSpeed' as never))).toBe(true);
  });

  it('skips an input with too few pairs, and returns null with no row left', () => {
    // The brake was never recorded on a flat part: no brake row.
    const flat = buildMoves(
      laps(12, () => ({brake: null})),
      'right',
    )!;
    expect(flat.rows.some(r => r.id === 'brake')).toBe(false);
    expect(
      buildMoves(
        laps(12, () => ({
          brake: null,
          lateral: null,
          steerPct: null,
          throttle: null,
        })),
        'right',
      ),
    ).toBeNull();
  });
});
