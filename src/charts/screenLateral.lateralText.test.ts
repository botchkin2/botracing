import {describe, expect, it} from '@jest/globals';

import {lateralText} from './screenLateral';

describe('lateralText', () => {
  it('names the side the value points to, so the text agrees with the drawing', () => {
    expect(lateralText(12, 0)).toBe('12 R');
    expect(lateralText(-12, 0)).toBe('12 L');
    expect(lateralText(1.5, 1, 'm')).toBe('1.5 m R');
    expect(lateralText(-1.5, 1, 'm')).toBe('1.5 m L');
  });

  it('prints zero to the precision without a side', () => {
    expect(lateralText(0, 0)).toBe('0');
    expect(lateralText(0.2, 0)).toBe('0');
    expect(lateralText(-0.04, 1, 'm')).toBe('0.0 m');
  });
});
