import {describe, expect, it} from '@jest/globals';

import {formatDistance} from '@/src/design/format';
import {formatSpeed, METRIC, speedUnit} from './units';

const IMPERIAL = {speed: 'mph', distance: 'ft'} as const;

describe('units', () => {
  it('speed', () => {
    expect(formatSpeed(187, METRIC)).toBe('187');
    expect(formatSpeed(160.9344, IMPERIAL)).toBe('100');
    expect(speedUnit(IMPERIAL)).toBe('mph');
  });
  it('distance', () => {
    expect(formatDistance(2150)).toBe('2,150 m');
    expect(formatDistance(304.8, IMPERIAL)).toBe('1,000 ft');
  });
});
