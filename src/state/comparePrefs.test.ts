import {describe, expect, it} from '@jest/globals';

import {
  addChart,
  type ChartSet,
  moveChart,
  removeChart,
  stepWindow,
  toggleChannel,
  windowSize,
} from './comparePrefs';

const charts: ChartSet = [['timeDiff'], ['speed'], ['throttle', 'brake']];

describe('chart set edits', () => {
  it('overlays up to 3 channels, then refuses', () => {
    const two = toggleChannel(charts, 1, 'brake');
    expect(two[1]).toEqual(['speed', 'brake']);
    const three = toggleChannel(two, 1, 'gear');
    expect(three[1]).toHaveLength(3);
    expect(toggleChannel(three, 1, 'steering')).toBe(three);
  });

  it('removing the last channel removes the chart', () => {
    expect(toggleChannel(charts, 0, 'timeDiff')).toEqual([
      ['speed'],
      ['throttle', 'brake'],
    ]);
  });

  it('never leaves zero charts', () => {
    expect(removeChart([['speed']], 0)).toEqual([['speed']]);
  });

  it('adds and moves charts', () => {
    expect(addChart(charts, 'gear').at(-1)).toEqual(['gear']);
    expect(moveChart(charts, 2, -1)[1]).toEqual(['throttle', 'brake']);
    expect(moveChart(charts, 0, -1)).toBe(charts);
  });
});

describe('window stepper', () => {
  it('steps through sizes, then Lap', () => {
    expect(windowSize('time', 2)).toBe(2);
    expect(windowSize('distance', 2)).toBe(200);
    expect(stepWindow('time', 3, 1)).toBe('lap');
    expect(stepWindow('time', 'lap', -1)).toBe(3);
    expect(stepWindow('time', 0, -1)).toBe(0);
    expect(windowSize('time', 'lap')).toBeNull();
  });
});
