import {type ComponentProps, memo} from 'react';

import {ChaseView} from './ChaseView';

type Props = ComponentProps<typeof ChaseView> & {
  /** False while Track or Follow is on screen: the 3D is kept, paused, and takes no new props. */
  active: boolean;
};

// The 3D is expensive to make (on the phone it is a whole page in a WebView), so it stays mounted when the map goes to
// another view. While it is not shown it is paused and held: the render that hides it passes `playing: false`, and
// every one after that is skipped, so no clock tick reaches the engine or the page.
export const HeldChaseView = memo(
  function HeldChaseView({active, ...props}: Props) {
    return <ChaseView {...props} playing={active && props.playing} />;
  },
  (prev, next) => !prev.active && !next.active,
);
