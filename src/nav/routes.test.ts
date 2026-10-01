import {describe, expect, it} from '@jest/globals';

import {
  compareHref,
  cornerHref,
  parseSelection,
  planComboKey,
  planHref,
  raceHref,
  sessionHref,
  trackHref,
} from './routes';

describe('routes', () => {
  it('names a plan combo by track and car model', () => {
    expect(planComboKey('t1', '911 GT3 R')).toBe('t1|911 GT3 R');
    expect(planHref(planComboKey('t1', '911 GT3 R')).params.combo).toBe(
      't1|911 GT3 R',
    );
  });

  it('opens the plan on a track and car, or on its own', () => {
    expect(planHref()).toEqual({pathname: '/plan', params: {}});
    expect(planHref('t1|911 GT3 R')).toEqual({
      pathname: '/plan',
      params: {combo: 't1|911 GT3 R'},
    });
  });

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

  it('race is a session tab that carries the selection', () => {
    expect(raceHref('s1', {laps: ['a'], hl: 'a', cursorM: 100})).toEqual({
      pathname: '/session/[id]/race',
      params: {id: 's1', laps: 'a', hl: 'a', t: '100'},
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
