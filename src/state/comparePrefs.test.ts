import {describe, expect, it} from '@jest/globals';

import {
  addChart,
  type ChartSet,
  clampRightW,
  FOLLOW_SPANS_M,
  migrateComparePrefs,
  moveChart,
  removeChart,
  stepWindow,
  toggleChannel,
  useComparePrefs,
  windowSize,
} from './comparePrefs';

const charts: ChartSet = [['timeDiff'], ['speed'], ['throttle', 'brake']];

describe('saved prefs from before the stack default', () => {
  it('a v0 blob gets Stack over the whole lap and keeps what he chose', () => {
    const saved = {
      charts: [['speed']],
      view: 'one',
      focused: 2,
      mapZoom: 3,
      rightW: 400,
      windowMode: 'distance',
      windowStep: 1,
      rate: 2,
    };
    expect(migrateComparePrefs(saved, 0)).toEqual({
      ...saved,
      view: 'stack',
      windowMode: 'time',
      windowStep: 'lap',
    });
  });

  it('a current blob is left as it is', () => {
    const saved = {view: 'one', windowMode: 'time', windowStep: 1};
    expect(migrateComparePrefs(saved, 1)).toEqual(saved);
  });

  it('new installs open on Stack over the whole lap', () => {
    const s = useComparePrefs.getState();
    expect([s.view, s.windowMode, s.windowStep]).toEqual([
      'stack',
      'time',
      'lap',
    ]);
  });
});

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
    expect(stepWindow('time', 3, 1)).toBe(4);
    expect(stepWindow('time', 4, 1)).toBe('lap');
    expect(stepWindow('time', 'lap', -1)).toBe(4);
    expect(windowSize('time', 4)).toBe(15);
    expect(stepWindow('time', 0, -1)).toBe(0);
    expect(windowSize('time', 'lap')).toBeNull();
  });

  it('has a 1,000 m distance step between 400 m and Lap', () => {
    expect(windowSize('distance', 3)).toBe(400);
    expect(stepWindow('distance', 3, 1)).toBe(4);
    expect(windowSize('distance', 4)).toBe(1000);
    expect(stepWindow('distance', 4, 1)).toBe('lap');
  });
});

describe('right panel width', () => {
  it('stays within 280-520 and whole points', () => {
    expect(clampRightW(100)).toBe(280);
    expect(clampRightW(9999)).toBe(520);
    expect(clampRightW(360.4)).toBe(360);
  });
});

describe('map zoom steps', () => {
  it('are the spans in metres, close to wide, 120 m the default', () => {
    expect([...FOLLOW_SPANS_M]).toEqual([60, 120, 250, 500]);
    expect(FOLLOW_SPANS_M[useComparePrefs.getState().mapZoom]).toBe(120);
  });
});
