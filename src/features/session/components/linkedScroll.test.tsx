import {describe, expect, it, jest} from '@jest/globals';
import {act, create} from 'react-test-renderer';
import {type ScrollView} from 'react-native';

import {
  DRIVE_QUIET_MS,
  type LinkedScroll,
  useLinkedScroll,
} from './linkedScroll';

// A table of rows, each its own scroller, shares one offset (2h a): a move on
// one is a scrollTo on every other, once, and a row that mounts later starts
// at the offset the others are at.

function fakeView() {
  const scrollTo = jest.fn<(o: {x: number; animated: boolean}) => void>();
  return {view: {scrollTo} as unknown as ScrollView, scrollTo};
}

function linkOf(): LinkedScroll {
  let link: LinkedScroll | null = null;
  function Probe() {
    link = useLinkedScroll();
    return null;
  }
  act(() => {
    create(<Probe />);
  });
  return link as unknown as LinkedScroll;
}

describe('useLinkedScroll', () => {
  it('moves every other scroller to the offset one of them was moved to', () => {
    const link = linkOf();
    const a = fakeView();
    const b = fakeView();
    const c = fakeView();
    for (const v of [a, b, c]) link.register(v.view);
    link.moved(a.view, 120);
    expect(a.scrollTo).not.toHaveBeenCalled();
    expect(b.scrollTo).toHaveBeenCalledWith({x: 120, animated: false});
    expect(c.scrollTo).toHaveBeenCalledWith({x: 120, animated: false});
  });

  it('ignores the echo of its own scrollTo, so two scrollers do not trade', () => {
    const link = linkOf();
    const a = fakeView();
    const b = fakeView();
    link.register(a.view);
    link.register(b.view);
    link.moved(a.view, 80);
    link.moved(b.view, 80);
    expect(a.scrollTo).not.toHaveBeenCalled();
    expect(b.scrollTo).toHaveBeenCalledTimes(1);
  });

  it('starts a row that mounts later at the current offset, and forgets one that unmounts', () => {
    const link = linkOf();
    const a = fakeView();
    link.register(a.view);
    link.moved(a.view, 64);
    const late = fakeView();
    const off = link.register(late.view);
    expect(late.scrollTo).toHaveBeenCalledWith({x: 64, animated: false});
    off();
    link.moved(a.view, 10);
    expect(late.scrollTo).toHaveBeenCalledTimes(1);
  });

  it('starts a row at 0 when nothing has moved yet', () => {
    const link = linkOf();
    const a = fakeView();
    link.register(a.view);
    expect(a.scrollTo).not.toHaveBeenCalled();
  });
});

describe('one scroller drives at a time', () => {
  it('ignores the lagging offsets the followers report back during a fling', () => {
    jest.useFakeTimers();
    const link = linkOf();
    const a = fakeView();
    const b = fakeView();
    link.register(a.view);
    link.register(b.view);
    link.begin(a.view);
    link.moved(a.view, 100);
    // b has not caught up yet and reports an older offset: it must not pull a back.
    link.moved(b.view, 60);
    link.moved(a.view, 180);
    link.moved(b.view, 120);
    expect(a.scrollTo).not.toHaveBeenCalled();
    expect(b.scrollTo.mock.calls.map(c => c[0].x)).toEqual([100, 180]);
    jest.useRealTimers();
  });

  it('hands the drive over when the momentum ends or the driver goes quiet', () => {
    jest.useFakeTimers();
    const link = linkOf();
    const a = fakeView();
    const b = fakeView();
    link.register(a.view);
    link.register(b.view);
    link.begin(a.view);
    link.moved(a.view, 100);
    link.end(a.view);
    link.moved(b.view, 40);
    expect(a.scrollTo).toHaveBeenCalledWith({x: 40, animated: false});
    // Without an end event (a wheel on web): quiet for a moment, then another may drive.
    link.moved(b.view, 50);
    jest.advanceTimersByTime(DRIVE_QUIET_MS + 1);
    link.moved(a.view, 90);
    expect(b.scrollTo).toHaveBeenCalledWith({x: 90, animated: false});
    jest.useRealTimers();
  });
});
