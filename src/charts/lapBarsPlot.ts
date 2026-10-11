// The lap-time chart's plot range (handoff §2): under the STINT/PIT label rows
// and the top tick's box, above the excluded-lap stubs. Pure, so a test proves
// the ±range ticks sit on their lines inside the svg.

import {tickPad} from './labelBox';

/** An excluded lap's stub on the baseline. */
export const STUB_H = 9;
export const STUB_BOTTOM = 14;
const TOP_PAD = 12;

/** Plot top and bottom: the bars' ±range maps between them. */
export function lapBarsPlot(
  height: number,
  labelRowsBottom: number,
  fontSize: number,
): {plotTop: number; plotBottom: number} {
  return {
    // Below the last label row (stacked labels never sit on a bar), and never
    // so high that the top tick's box crosses the svg's top.
    plotTop: Math.max(TOP_PAD, tickPad(fontSize), labelRowsBottom),
    plotBottom: height - STUB_BOTTOM - STUB_H - 4,
  };
}
