import {BAR_CLAMP_S} from './model';

// The lines behind the "?" on Session's lap-time bars (thread 33 #1119).
export const LAP_BARS_HELP: readonly string[] = [
  `Bar height is the lap's gap to the session median: up is faster than the median, down is slower. Bars stop at ±${BAR_CLAMP_S.toFixed(
    1,
  )} s.`,
  "A hollow bar had at least 5 s in another car's slipstream. The rails under the bars mark laps with a tow, laps held up by traffic or a blue flag, and pit laps.",
  'A comparable lap is a full timed lap without a pit, reset or slow-outlier exclusion. Outlined stubs at the bottom are the laps left out.',
  'Tap a bar to find that lap in the table.',
];
