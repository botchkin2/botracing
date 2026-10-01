import {describe, expect, it} from '@jest/globals';

import {foreignLapId, isForeignLapId, ownLapIds, parseLapRef} from './lapRef';

describe('lap refs', () => {
  it('round-trips a lap of another session', () => {
    const id = foreignLapId('9f0ea4efff1d692b', '8d9b1d7aa13edbb8-011');
    expect(id).toBe('9f0ea4efff1d692b~8d9b1d7aa13edbb8-011');
    expect(parseLapRef(id)).toEqual({
      sessionId: '9f0ea4efff1d692b',
      lapId: '8d9b1d7aa13edbb8-011',
    });
  });

  it('leaves a bare lap id as the URL session’s own', () => {
    expect(parseLapRef('8d9b1d7aa13edbb8-011')).toEqual({
      sessionId: null,
      lapId: '8d9b1d7aa13edbb8-011',
    });
  });

  it('does not split on a stray separator at either end', () => {
    expect(parseLapRef('~abc')).toEqual({sessionId: null, lapId: '~abc'});
    expect(parseLapRef('abc~')).toEqual({sessionId: null, lapId: 'abc~'});
  });
});

describe('which ids leave Compare', () => {
  it('tells a lap of another session from this session’s own', () => {
    expect(isForeignLapId('s9~lap-001')).toBe(true);
    expect(isForeignLapId('lap-001')).toBe(false);
    expect(ownLapIds(['s9~lap-001', 'a', 'b'])).toEqual(['a', 'b']);
  });
});
