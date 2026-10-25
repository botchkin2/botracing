import {beforeEach, describe, expect, it, jest} from '@jest/globals';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';

import {HeldChaseView} from './HeldChaseView';

const seen: {playing: boolean; timeS: number}[] = [];
jest.mock('./ChaseView', () => ({
  ChaseView: (props: {playing: boolean; timeS: number}) => {
    seen.push({playing: props.playing, timeS: props.timeS});
    return null;
  },
}));

// The 3D stays mounted while Track or Follow is shown: the render that hides it pauses it, and the clock ticks after
// that never reach it (they would redraw a page nobody sees).
const view = (active: boolean, timeS: number) => (
  <HeldChaseView {...({active, playing: true, timeS} as unknown as Parameters<typeof HeldChaseView>[0])} />
);

const mount = (active: boolean, timeS: number): ReactTestRenderer => {
  let r: ReactTestRenderer | undefined;
  act(() => {
    r = create(view(active, timeS));
  });
  return r as ReactTestRenderer;
};

describe('HeldChaseView', () => {
  beforeEach(() => {
    seen.length = 0;
  });

  it('passes the clock through while shown', () => {
    const r = mount(true, 1);
    act(() => r.update(view(true, 2)));
    expect(seen).toEqual([
      {playing: true, timeS: 1},
      {playing: true, timeS: 2},
    ]);
  });

  it('pauses on the render that hides it, then takes no more ticks', () => {
    const r = mount(true, 1);
    act(() => r.update(view(false, 2)));
    act(() => r.update(view(false, 3)));
    act(() => r.update(view(false, 4)));
    expect(seen).toEqual([
      {playing: true, timeS: 1},
      {playing: false, timeS: 2},
    ]);
  });

  it('plays from the current moment when shown again', () => {
    const r = mount(true, 1);
    act(() => r.update(view(false, 2)));
    act(() => r.update(view(false, 9)));
    act(() => r.update(view(true, 10)));
    expect(seen[seen.length - 1]).toEqual({playing: true, timeS: 10});
  });
});
