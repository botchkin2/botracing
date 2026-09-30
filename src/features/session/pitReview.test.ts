import {describe, expect, it} from '@jest/globals';

import {tyresText} from './pitReview';

describe('tyresText', () => {
  const at = (...wheels: ('FL' | 'FR' | 'RL' | 'RR')[]) =>
    tyresText({changed: wheels.length > 0, wheels});
  it('names the wheels the way a driver would', () => {
    expect(at('FL', 'FR', 'RL', 'RR')).toBe('all four');
    expect(at('FL', 'FR')).toBe('fronts');
    expect(at('RL', 'RR')).toBe('rears');
    expect(at('FL', 'RL')).toBe('lefts');
    expect(at('FR', 'RR')).toBe('rights');
    expect(at('RL')).toBe('RL only');
    expect(at('FL', 'RR')).toBe('FL and RR');
    expect(at('FL', 'FR', 'RL')).toBe('FL, FR and RL');
    expect(at()).toBe('not changed');
  });
});
