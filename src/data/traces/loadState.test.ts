import {describe, expect, it} from '@jest/globals';

import {sliceLoad, traceLoad} from './loadState';

describe('traceLoad', () => {
  it('is idle with no laps asked for', () => {
    expect(traceLoad([])).toEqual({kind: 'idle'});
  });

  it('is loading until the first trace lands', () => {
    expect(traceLoad(['pending'])).toEqual({kind: 'loading'});
    expect(traceLoad(['pending', 'pending', 'pending'])).toEqual({
      kind: 'loading',
    });
  });

  it('draws what has arrived while others are still loading', () => {
    expect(traceLoad(['success', 'pending', 'pending'])).toEqual({
      kind: 'ready',
    });
  });

  it('is ready once every lap loaded', () => {
    expect(traceLoad(['success', 'success'])).toEqual({kind: 'ready'});
  });

  it('is partial when some failed and nothing is pending', () => {
    expect(traceLoad(['success', 'error', 'success'])).toEqual({
      kind: 'partial',
      failed: 1,
    });
  });

  it('is failed when none loaded and nothing is pending', () => {
    expect(traceLoad(['error'])).toEqual({kind: 'failed', failed: 1});
    expect(traceLoad(['error', 'error'])).toEqual({kind: 'failed', failed: 2});
  });

  it('stays loading while a failed lap has another still pending', () => {
    expect(traceLoad(['error', 'pending'])).toEqual({kind: 'loading'});
  });
});

describe('sliceLoad', () => {
  const base = {lapCount: 10, sessionKnown: true, hasFile: true};

  it('no laps to draw: idle', () => {
    expect(sliceLoad({...base, lapCount: 0, status: 'pending'})).toEqual({
      kind: 'idle',
    });
  });

  it('a session with no file for the corner needs a resync, whatever the query says', () => {
    expect(sliceLoad({...base, hasFile: false, status: 'pending'})).toEqual({
      kind: 'needsResync',
    });
  });

  it('while the session doc is still loading a missing file is not yet a fact', () => {
    expect(
      sliceLoad({
        ...base,
        sessionKnown: false,
        hasFile: false,
        status: 'pending',
      }),
    ).toEqual({kind: 'loading'});
  });

  it('a failed fetch is a failure of every lap', () => {
    expect(sliceLoad({...base, status: 'error'})).toEqual({
      kind: 'failed',
      failed: 10,
    });
  });

  it('pending is loading, success is ready', () => {
    expect(sliceLoad({...base, status: 'pending'})).toEqual({kind: 'loading'});
    expect(sliceLoad({...base, status: 'success'})).toEqual({kind: 'ready'});
  });
});
