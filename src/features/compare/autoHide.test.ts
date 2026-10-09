import {afterEach, beforeEach, describe, expect, it, jest} from '@jest/globals';

import {scheduleHide} from './autoHide';

describe('scheduleHide', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('hides after the idle time and not before', () => {
    const onHide = jest.fn();
    scheduleHide(3000, onHide);
    jest.advanceTimersByTime(2999);
    expect(onHide).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(onHide).toHaveBeenCalledTimes(1);
  });

  it('a touch that cancels and reschedules restarts the countdown', () => {
    const onHide = jest.fn();
    let cancel = scheduleHide(3000, onHide);
    jest.advanceTimersByTime(2000);
    cancel();
    cancel = scheduleHide(3000, onHide);
    jest.advanceTimersByTime(2000);
    expect(onHide).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1000);
    expect(onHide).toHaveBeenCalledTimes(1);
  });

  it('does not hide when cancelled', () => {
    const onHide = jest.fn();
    const cancel = scheduleHide(3000, onHide);
    cancel();
    jest.advanceTimersByTime(10000);
    expect(onHide).not.toHaveBeenCalled();
  });
});
