import {describe, expect, it} from '@jest/globals';

import {buildStrips, speedMeasure, type StripLap} from './strips';

const lap = (i: number, over: Partial<StripLap> = {}): StripLap => ({
  lapId: `l${i}`,
  label: `L${i}`,
  onIndex: null,
  timeS: 10 + i / 10,
  brakeM: 100 + i,
  minSpeedKph: 90 + i,
  minSpeedAtEdge: false,
  throttleAtEdge: false,
  apexSpeedKph: 95 + i,
  throttleM: 50 + i,
  brakeResM: 1.2,
  throttleResM: null,
  ...over,
});

describe('buildStrips', () => {
  const strips = buildStrips(
    Array.from({length: 20}, (_, i) => lap(i, {onIndex: i === 0 ? 0 : null})),
  );
  const brake = strips[1];

  it('puts position measures in track order with physical words', () => {
    expect(brake).toMatchObject({
      flipped: true,
      leftWord: 'earlier',
      rightWord: 'later',
    });
    expect(strips[3]).toMatchObject({
      flipped: false,
      leftWord: 'earlier',
      rightWord: 'later',
    });
    expect(strips[2]).toMatchObject({leftWord: 'slower', rightWord: 'faster'});
  });

  it('labels the ends and the pedal resolution', () => {
    expect([brake.minLabel, brake.maxLabel, brake.resolution]).toEqual([
      '100',
      '119',
      '±1.2 m',
    ]);
    expect(brake.coincidentWithin).toBe(1.2);
    expect(strips[3].resolution).toBeNull();
  });

  it('has a p10–90 band and median', () => {
    expect(brake.band).toEqual({p10: 101.9, p50: 109.5, p90: 117.1});
  });
});

describe('speedMeasure', () => {
  it('shows apex speed when most minimums sit on the edge', () => {
    const laps = [0, 1, 2].map(i => lap(i, {minSpeedAtEdge: i > 0}));
    expect(speedMeasure(laps)).toBe('apexSpeed');
  });

  it('keeps min speed and greys the few edge laps', () => {
    const laps = [0, 1, 2].map(i => lap(i, {minSpeedAtEdge: i === 2}));
    expect(speedMeasure(laps)).toBe('minSpeed');
    const [, , min] = buildStrips(laps);
    expect(min.dots.map(d => d.flagged)).toEqual([false, false, true]);
  });

  it('keeps min speed until apex speed is recorded', () => {
    const laps = [0, 1].map(i =>
      lap(i, {minSpeedAtEdge: true, apexSpeedKph: null}),
    );
    expect(speedMeasure(laps)).toBe('minSpeed');
  });
});

describe('a measure no lap has', () => {
  it('is marked empty instead of drawing a made-up scale', () => {
    const [, brake] = buildStrips([0, 1, 2].map(i => lap(i, {brakeM: null})));
    expect(brake.empty).toBe(true);
    expect(brake.dots).toEqual([]);
  });
});

describe('full throttle at the edge', () => {
  it('greys edge laps and notes when most laps are flat through', () => {
    const laps = [0, 1, 2].map(i => lap(i, {throttleAtEdge: i > 0}));
    const throttle = buildStrips(laps)[3];
    expect(throttle.dots.map(d => d.flagged)).toEqual([false, true, true]);
    expect(throttle.note).toMatch(/^Flat through this turn/);
    expect(buildStrips([lap(0)])[3].note).toBeNull();
  });
});
