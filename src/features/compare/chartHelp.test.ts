import {describe, expect, it} from '@jest/globals';

import {CHANNEL_IDS} from '@/src/state/comparePrefs';

import {chartHelp, RADAR_HELP} from './chartHelp';

describe('chart help', () => {
  it('has a line for every channel, in the chart order given', () => {
    expect(chartHelp(['speed'])).toHaveLength(1);
    const lines = chartHelp(['throttle', 'brake', 'steering']);
    expect(lines.map(l => l.split(':')[0])).toEqual([
      'Throttle',
      'Brake',
      'Steering',
    ]);
    for (const id of CHANNEL_IDS) expect(chartHelp([id])[0]).toBeTruthy();
  });

  it('describes the data, never the driver: no advice, verdicts or second person', () => {
    const all = [...chartHelp(CHANNEL_IDS), ...RADAR_HELP].join(' ');
    expect(all).not.toMatch(
      /\b(you|your|should|try|better|worse|worst|best|good|bad|brake later|improve)\b/i,
    );
  });

  it('stays within four lines on any one chart, and says nothing on steering direction', () => {
    expect(RADAR_HELP.length).toBeLessThanOrEqual(4);
    expect(chartHelp(CHANNEL_IDS).join(' ')).not.toMatch(/\b(left|right)\b/i);
  });
});
