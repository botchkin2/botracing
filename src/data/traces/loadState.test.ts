import {describe, expect, it} from '@jest/globals';

import {traceLoad} from './loadState';

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
