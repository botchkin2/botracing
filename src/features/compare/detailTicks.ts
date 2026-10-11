import {fixedScale, MAX_TICKS, niceStep, type Tick} from '@/src/charts/scale';
import {signedSeconds, withUnit} from '@/src/charts/tickFormat';

import type {ChannelId} from './model';

// Y ticks for a Compare detail chart (Theme D leftover of #475): the first
// channel's own scale, labelled with its unit like every other chart's axis.
// The chart thins labels that would overlap (labelledTicks) and pads its plot
// for them, so a short chart shows its two ends and a tall one every step.
// Pedals carry their own frame and have none here; a gear is its number.

const speedLabel = withUnit('km/h');

/** The ticks of one channel over its y domain: whole 1-2-5 steps inside it. */
export function detailTicks(
  channel: ChannelId,
  [lo, hi]: [number, number],
  maxTicks = MAX_TICKS,
): Tick[] {
  if (channel === 'throttle' || channel === 'brake' || channel === 'steering')
    return [];
  if (!(hi > lo)) return [];
  const gear = channel === 'gear';
  // A gear is a whole number: never a step finer than one.
  const step = Math.max(gear ? 1 : 0, niceStep(hi - lo, maxTicks));
  const first = Math.ceil(lo / step - 1e-9) * step;
  if (first > hi) return [];
  const format =
    channel === 'speed'
      ? speedLabel
      : channel === 'timeDiff'
      ? signedSeconds
      : (v: number) => String(Math.round(v));
  return fixedScale(first, hi, step, format).ticks;
}
