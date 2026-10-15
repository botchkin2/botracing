import {describe, expect, it} from '@jest/globals';

import {compareVersions} from './version';

describe('compareVersions', () => {
  it('compares x.y.z versions and nothing else', () => {
    expect(compareVersions('0.1.2', '0.1.3')).toBeLessThan(0);
    expect(compareVersions('0.2.0', '0.1.9')).toBeGreaterThan(0);
    expect(compareVersions('0.1.3', '0.1.3')).toBe(0);
    expect(compareVersions('0.1.3-rc.1', '0.1.3')).toBe(0);
    expect(compareVersions('4dda01b', '0.1.3')).toBeNull();
    expect(compareVersions('', '0.1.3')).toBeNull();
  });
});
