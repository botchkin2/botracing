import {useEffect, useState} from 'react';

import {type ChaseNow} from '@/src/features/race/chase/chaseTypes';
import {type ChaseFrame, type FrameSubscribe, type InputTrace, type LivePedals, livePedalsAt, samePedals} from '@/src/features/race/chase/chaseInputsAt';

import {DriverInputs} from './DriverInputs';

/**
 * The HUD's pedals and wheel at the recording's own rate. React hands the race clock over at the field's 5 Hz in 3D, so
 * `now` alone would repaint five times a second; the engine reports the followed car's lap distance on every frame it
 * draws, and this reads the recorded sample there. Only this small view re-renders, and only when a value changed.
 */
export function LiveDriverInputs({
  now,
  trace,
  subscribe,
  tight,
}: {
  now: ChaseNow;
  trace: InputTrace;
  subscribe: FrameSubscribe;
  tight: boolean;
}) {
  const [live, setLive] = useState<LivePedals | null>(null);
  useEffect(() => {
    subscribe(frame => {
      const next = livePedalsAt(trace, frame, now.anchorM);
      setLive(prev => (samePedals(prev, next) ? prev : next));
    });
    return () => subscribe(null);
  }, [subscribe, trace, now.anchorM]);
  const shown = live ?? now;
  return <DriverInputs brakePct={shown.brakePct} throttlePct={shown.throttlePct} steeringPct={shown.steeringPct} tight={tight} />;
}
