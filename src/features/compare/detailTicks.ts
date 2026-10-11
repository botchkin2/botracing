import {fixedScale, MAX_TICKS, niceStep, type Tick} from '@/src/charts/scale';

import {CHANNELS, type ChannelId} from './model';

// Y ticks for a Compare detail chart (Theme D leftover of #475): the first
// channel's own scale, labelled with its unit like every other chart's axis.
// The label and the finest step come from the channel's own spec (CHANNELS),
// so a channel's unit and format live in one place. The chart thins labels
// that would overlap (labelledTicks) and pads its plot for them, so a short
// chart shows its two ends and a tall one every step.

/** The ticks of one channel over its y domain: whole 1-2-5 steps inside it. */
export function detailTicks(
  channel: ChannelId,
  [lo, hi]: [number, number],
  maxTicks = MAX_TICKS,
): Tick[] {
  const spec = CHANNELS[channel].tick;
  if (!spec || !(hi > lo)) return [];
  const step = Math.max(spec.minStep ?? 0, niceStep(hi - lo, maxTicks));
  const first = Math.ceil(lo / step - 1e-9) * step;
  if (first > hi) return [];
  return fixedScale(first, hi, step, spec.label).ticks;
}
