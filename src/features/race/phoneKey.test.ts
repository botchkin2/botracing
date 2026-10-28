import {describe, expect, it} from '@jest/globals';

import {phone3dOn, phoneKeyShown} from './phoneKey';

const phone = {desktop: false, chaseAvailable: true, hasChase: true};

describe('the phone key', () => {
  it('is shown under the 2D map in Track and in Follow, with no tap', () => {
    for (const mapMode of ['track', 'follow'] as const)
      expect(phoneKeyShown(phone3dOn({...phone, mapMode}))).toBe(true);
  });

  it('is not shown in the phone 3D', () => {
    expect(phoneKeyShown(phone3dOn({...phone, mapMode: 'chase'}))).toBe(false);
  });

  it('is shown when 3D is picked but nothing can be chased: the 2D map is what is drawn', () => {
    expect(
      phoneKeyShown(phone3dOn({...phone, mapMode: 'chase', hasChase: false})),
    ).toBe(true);
    expect(
      phoneKeyShown(
        phone3dOn({...phone, mapMode: 'chase', chaseAvailable: false}),
      ),
    ).toBe(true);
  });

  it('is never the phone 3D on a desktop', () => {
    expect(phone3dOn({...phone, desktop: true, mapMode: 'chase'})).toBe(false);
  });
});
