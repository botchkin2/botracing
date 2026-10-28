import {beforeEach, describe, expect, it} from '@jest/globals';

import {startTextFor, usePlanStart} from './planStart';

describe('planStart', () => {
  beforeEach(() => {
    usePlanStart.setState({key: '', ve: '', fuel: ''});
  });

  it('keeps what he typed for a track and car', () => {
    usePlanStart.getState().setStart('road|911', {ve: '87', fuel: ''});
    expect(startTextFor(usePlanStart.getState(), 'road|911')).toEqual({
      ve: '87',
      fuel: '',
    });
  });

  it('reads blank for another combo, and for none', () => {
    usePlanStart.getState().setStart('road|911', {ve: '87', fuel: '60'});
    expect(startTextFor(usePlanStart.getState(), 'sebring|911')).toEqual({
      ve: '',
      fuel: '',
    });
    expect(startTextFor(usePlanStart.getState(), null)).toEqual({
      ve: '',
      fuel: '',
    });
  });

  it('typing for another combo replaces it: a start never carries to another race', () => {
    usePlanStart.getState().setStart('road|911', {ve: '87', fuel: ''});
    usePlanStart.getState().setStart('sebring|911', {ve: '50', fuel: ''});
    expect(startTextFor(usePlanStart.getState(), 'road|911').ve).toBe('');
    expect(startTextFor(usePlanStart.getState(), 'sebring|911').ve).toBe('50');
  });

  it('a blank entry clears it', () => {
    usePlanStart.getState().setStart('road|911', {ve: '87', fuel: ''});
    usePlanStart.getState().setStart('road|911', {ve: '', fuel: ''});
    expect(startTextFor(usePlanStart.getState(), 'road|911')).toEqual({
      ve: '',
      fuel: '',
    });
  });
});
