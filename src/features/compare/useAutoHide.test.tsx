import {afterEach, beforeEach, describe, expect, it, jest} from '@jest/globals';
import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';

import {useAutoHide} from './useAutoHide';

type Hook = ReturnType<typeof useAutoHide>;

// Renders the hook once per call and keeps its latest result.
function mount(idleMs: number, holdOpen: boolean) {
  const latest: {current: Hook | null} = {current: null};
  function Probe(props: {holdOpen: boolean}) {
    latest.current = useAutoHide(idleMs, props.holdOpen);
    return null;
  }
  let r!: TestRenderer.ReactTestRenderer;
  act(() => {
    r = TestRenderer.create(<Probe holdOpen={holdOpen} />);
  });
  return {
    get hook() {
      return latest.current!;
    },
    setHold(next: boolean) {
      act(() => {
        r.update(<Probe holdOpen={next} />);
      });
    },
    reveal() {
      act(() => latest.current!.reveal());
    },
    wait(ms: number) {
      act(() => {
        jest.advanceTimersByTime(ms);
      });
    },
  };
}

describe('useAutoHide', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('starts hidden, shows on reveal, hides after the idle time', () => {
    const m = mount(3000, false);
    expect(m.hook.visible).toBe(false);
    m.reveal();
    expect(m.hook.visible).toBe(true);
    m.wait(2999);
    expect(m.hook.visible).toBe(true);
    m.wait(1);
    expect(m.hook.visible).toBe(false);
  });

  it('a touch restarts the countdown', () => {
    const m = mount(3000, false);
    m.reveal();
    m.wait(2000);
    m.reveal();
    m.wait(2000);
    expect(m.hook.visible).toBe(true);
    m.wait(1000);
    expect(m.hook.visible).toBe(false);
  });

  it('stays shown while held open, however long', () => {
    const m = mount(3000, true);
    m.wait(60000);
    expect(m.hook.visible).toBe(true);
  });

  it('a pause from anywhere counts down from the pause, not at once', () => {
    const m = mount(3000, true);
    m.setHold(false);
    expect(m.hook.visible).toBe(true);
    m.wait(2999);
    expect(m.hook.visible).toBe(true);
    m.wait(1);
    expect(m.hook.visible).toBe(false);
  });
});
