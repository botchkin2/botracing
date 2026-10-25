import {describe, expect, it} from '@jest/globals';

import {phone3dHeight} from './phone3dHeight';

describe('phone3dHeight', () => {
  it('is half the screen on a 375 x 812 phone', () => {
    expect(phone3dHeight(812)).toBe(406);
  });

  it('keeps a floor on a short screen and a cap on a tall one', () => {
    expect(phone3dHeight(500)).toBe(380);
    expect(phone3dHeight(2000)).toBe(560);
  });

  it('never leaves less than a quarter of a 812 pt phone for the page below', () => {
    expect(812 - phone3dHeight(812)).toBeGreaterThanOrEqual(812 / 4);
  });
});
