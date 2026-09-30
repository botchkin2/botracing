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

describe('laps at full throttle by the slowest point', () => {
  // A flat lap has no full-throttle point: the model gives it throttleM null.
  const flat = (i: number, over: Partial<StripLap> = {}) =>
    lap(i, {throttleAtEdge: true, throttleM: null, ...over});

  it('leaves flat laps off the strip and counts them beside it', () => {
    const laps = [lap(0), lap(1), flat(2), flat(3), lap(4)];
    const throttle = buildStrips(laps)[3];
    expect(throttle.dots.map(d => d.lapId)).toEqual(['l0', 'l1', 'l4']);
    expect(throttle.dots.every(d => !d.flagged)).toBe(true);
    expect(throttle.flatNote).toBe(
      'Full throttle by the slowest point: 2 of 5 laps',
    );
    // The band is over the laps that have a point.
    expect(throttle.band?.p50).toBe(51);
  });

  it('one flat lap reads singular; none reads nothing', () => {
    expect(buildStrips([lap(0), flat(1)])[3].flatNote).toBe(
      'Full throttle by the slowest point: 1 of 2 laps',
    );
    expect(buildStrips([lap(0), lap(1)])[3].flatNote).toBeNull();
  });

  it('the count is out of every lap in view, plotted or not', () => {
    // 2 plotted, 1 with no throttle point at all, 2 flat at the slowest point.
    const laps = [lap(0), lap(1), lap(2, {throttleM: null}), flat(3), flat(4)];
    const throttle = buildStrips(laps)[3];
    expect(throttle.dots).toHaveLength(2);
    expect(throttle.flatNote).toBe(
      'Full throttle by the slowest point: 2 of 5 laps',
    );
  });

  it('every lap flat: empty strip with the count, no scale', () => {
    const throttle = buildStrips([flat(0), flat(1), flat(2)])[3];
    expect(throttle.empty).toBe(true);
    expect(throttle.dots).toEqual([]);
    expect(throttle.flatNote).toBe(
      'Full throttle by the slowest point: 3 of 3 laps',
    );
  });

  it('an on lap that is flat says so beside the title', () => {
    const throttle = buildStrips([
      lap(0, {onIndex: 0}),
      flat(1, {onIndex: 1}),
    ])[3];
    expect(throttle.keyValues.map(k => k.text)).toEqual(['L0 50', 'L1 at min']);
  });

  it('other strips are not touched by a flat throttle lap', () => {
    const [time, brake] = buildStrips([lap(0), flat(1)]);
    expect(time.dots).toHaveLength(2);
    expect(brake.dots).toHaveLength(2);
    expect(time.flatNote).toBeNull();
  });
});
