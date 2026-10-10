import {describe, expect, it} from '@jest/globals';

import {lapColors} from '@/src/design';

import {chromeBox} from './chromeBox';

const race = {
  sessionType: 'R' as const,
  track: 'Circuit de la Sarthe',
  car: 'Porsche 911 GT3 R - Manthey #91',
  startedAt: '2026-09-14T12:00:00Z',
};
const laps = [
  {id: 'a', lapIndex: 16},
  {id: 'b', lapIndex: 22},
  {id: 'c', lapIndex: 9},
];
const base = {
  session: race,
  hasField: true,
  laps,
  selection: {},
  cornerN: null,
  corners: undefined,
  tab: 'session' as const,
  scheme: 'dark' as const,
};

describe('chromeBox', () => {
  it('names the tabs, with Corner T5 once a corner is used', () => {
    const box = chromeBox({
      ...base,
      cornerN: 5,
      corners: [{n: 5, official: undefined}],
      tab: 'compare',
    });
    expect(box.tabs.map(t => t.label)).toEqual([
      'Laps',
      'Compare',
      'Corner T5',
      'Race',
    ]);
    expect(box.activeTab).toBe('compare');
    expect(box.badge).toBe('R');
  });

  it('reads plain Corner before any corner is used, and a practice with a field gets Field', () => {
    const box = chromeBox({
      ...base,
      session: {...race, sessionType: 'P'},
      tab: null,
    });
    expect(box.tabs.map(t => t.label)).toEqual([
      'Laps',
      'Compare',
      'Corner',
      'Field',
    ]);
    expect(box.activeTab).toBeNull();
  });

  it('a practice without a field has no fourth tab', () => {
    const box = chromeBox({
      ...base,
      session: {...race, sessionType: 'P'},
      hasField: false,
    });
    expect(box.tabs.map(t => t.label)).toEqual(['Laps', 'Compare', 'Corner']);
  });

  it('uses the official corner label when the map has one', () => {
    const box = chromeBox({
      ...base,
      cornerN: 5,
      corners: [{n: 5, official: 'T7 entry'}],
    });
    expect(box.tabs[2].label).toBe('Corner T7 entry');
  });

  it('lists the selected laps in lap colours, reference first', () => {
    const box = chromeBox({...base, selection: {laps: 'a,b,c'}});
    expect(box.laps.map(l => l.label)).toEqual(['L16', 'L22', 'L9']);
    expect(box.laps[0].color).toBe(lapColors.dark[0]);
    expect(box.laps[1].color).toBe(lapColors.dark[1]);
  });

  it('skips a selected lap that has not loaded', () => {
    const box = chromeBox({...base, laps: undefined, selection: {laps: 'a'}});
    expect(box.laps).toEqual([]);
  });

  it('says the short track and the day', () => {
    const box = chromeBox(base);
    expect(box.track).toBe('Le Mans');
    expect(box.detail).toContain('14 Sep');
  });
});
