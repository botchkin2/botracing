import {
  type ComponentProps,
  createContext,
  type ReactNode,
  useContext,
} from 'react';
import Svg, {Text as SvgText} from 'react-native-svg';

import {type as typeScale} from '@/src/design';

import {type Anchor, insideFrame} from './labelBox';

// Every chart's svg and every label in it (labelBox.ts): ChartSvg knows its
// size, and ChartLabel draws its text held inside it, so no label is ever cut
// by the svg's edge. Charts draw text only through ChartLabel.

// Labels already reported as moved (dev only).
const warned = new Set<string>();

const Frame = createContext<{width: number; height: number} | null>(null);

type SvgProps = ComponentProps<typeof Svg>;

/** An svg whose labels are held inside its width × height. */
export function ChartSvg({
  width,
  height,
  children,
  ...rest
}: Omit<SvgProps, 'width' | 'height'> & {
  width: number;
  height: number;
  children?: ReactNode;
}) {
  return (
    <Frame.Provider value={{width, height}}>
      <Svg width={width} height={height} {...rest}>
        {children}
      </Svg>
    </Frame.Provider>
  );
}

/** Tick and tag text in a chart: the axis face at the dense-axis size. */
export const TICK_PT = typeScale.tick.fontSize;

/**
 * A label at (x, y = baseline) in the axis font. The chart places it from its
 * box (labelBox.ts) so it fits; if it would still cross the ChartSvg's edge (or
 * `frame`'s), it is moved inside and a dev warning names it: that is a chart
 * whose plot is not padded for its labels.
 */
export function ChartLabel({
  x,
  y,
  children,
  fill,
  anchor = 'start',
  fontSize = typeScale.axis.fontSize,
  frame,
  lineY,
}: {
  x: number;
  y: number;
  children: string | number;
  fill: string;
  anchor?: Anchor;
  fontSize?: number;
  frame?: {width: number; height: number};
  /**
   * The y of the line this label marks (a tick's value). On web it is written
   * as data-line-y, so tools/dev/chartLabelProbe.js can measure the label
   * against its line.
   */
  lineY?: number;
}) {
  const ctx = useContext(Frame);
  const box = frame ?? ctx;
  const text = String(children);
  // A label with no frame could be cut unseen: that is a bug, not a default.
  if (!box) throw new Error('ChartLabel outside a ChartSvg needs a frame');
  const at = insideFrame(text, x, y, fontSize, anchor, box);
  const moved = Math.abs(at.x - x) > 0.05 || Math.abs(at.baseline - y) > 0.05;
  if (__DEV__ && moved && !warned.has(text)) {
    // Once per text: a chart redraws every frame while it plays.
    warned.add(text);
    console.warn(
      `ChartLabel "${text}" moved ${(at.x - x).toFixed(1)}, ${(
        at.baseline - y
      ).toFixed(1)} pt to stay inside its chart: pad the plot for it`,
    );
  }
  return (
    <SvgText
      x={at.x}
      y={at.baseline}
      textAnchor={anchor}
      fill={fill}
      fontFamily={typeScale.axis.fontFamily}
      fontSize={fontSize}
      {...(lineY == null ? {} : {'data-line-y': lineY.toFixed(2)})}>
      {text}
    </SvgText>
  );
}
