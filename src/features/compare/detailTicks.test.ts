import {describe, expect, it} from '@jest/globals';

import {detailTicks} from './detailTicks';

const labels = (t: {label: string}[]) => t.map(x => x.label);

describe('detailTicks', () => {
  it('labels speed in km/h on 1-2-5 steps inside the domain', () => {
    const t = detailTicks('speed', [60, 280]);
    expect(labels(t)).toEqual(['100 km/h', '150 km/h', '200 km/h', '250 km/h']);
    expect(t.every(x => x.v >= 60 && x.v <= 280)).toBe(true);
  });

  it('labels the time diff in signed seconds, with the minus sign', () => {
    const t = detailTicks('timeDiff', [-0.5, 1.5]);
    expect(labels(t)).toContain('0.0 s');
    expect(labels(t)).toContain('−0.5 s');
    expect(labels(t)).toContain('+1.5 s');
  });

  it('labels a gear as its number, never finer than one', () => {
    const t = detailTicks('gear', [0.5, 6.5]);
    expect(t.map(x => x.v)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(labels(t)).toEqual(['1', '2', '3', '4', '5', '6']);
  });

  it('has none for the pedals (they carry their own frame) or an empty domain', () => {
    expect(detailTicks('throttle', [-4, 104])).toEqual([]);
    expect(detailTicks('steering', [-100, 100])).toEqual([]);
    expect(detailTicks('speed', [100, 100])).toEqual([]);
  });
});
