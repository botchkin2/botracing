import {describe, expect, it} from '@jest/globals';

import {
  compareHref,
  cornerHref,
  parseSelection,
  sessionHref,
  trackHref,
} from './routes';

describe('routes', () => {
  it('carries the selection in params, reference first', () => {
    expect(sessionHref('s1', {laps: ['a', 'b'], hl: 'b'})).toEqual({
      pathname: '/session/[id]',
      params: {id: 's1', laps: 'a,b', hl: 'b'},
    });
    expect(compareHref('s1', {laps: ['a'], cursorM: 2186.4})).toEqual({
      pathname: '/session/[id]/compare',
      params: {id: 's1', laps: 'a', t: '2186'},
    });
  });

  it('corner goes in the path, not the query', () => {
    expect(cornerHref('s1', 4, {laps: ['a'], corner: 2})).toEqual({
      pathname: '/session/[id]/corner/[n]',
      params: {id: 's1', n: '4', laps: 'a'},
    });
  });

  it('round-trips through parseSelection', () => {
    const {params} = compareHref('s1', {
      laps: ['a', 'b'],
      hl: 'b',
      corner: 3,
      cursorM: 600,
    });
    expect(parseSelection(params)).toEqual({
      laps: ['a', 'b'],
      hl: 'b',
      corner: 3,
      cursorM: 600,
    });
    expect(parseSelection({c: 'x', t: ''})).toMatchObject({
      corner: null,
      cursorM: null,
    });
  });

  it('puts the track page corner in the shared c param', () => {
    expect(trackHref('lmu-fuji_speedway', 9)).toEqual({
      pathname: '/track/[id]',
      params: {id: 'lmu-fuji_speedway', c: '9'},
    });
    expect(trackHref('lmu-fuji_speedway').params).toEqual({
      id: 'lmu-fuji_speedway',
    });
  });
});
