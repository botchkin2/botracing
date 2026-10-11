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

/**
 * A label at (x, y = baseline) in the axis font, moved only as far as needed
 * to keep its box inside the ChartSvg (or `frame`, for a nested area).
 */
export function ChartLabel({
  x,
  y,
  children,
  fill,
  anchor = 'start',
  fontSize = typeScale.axis.fontSize,
  fontFamily = typeScale.axis.fontFamily,
  frame,
}: {
  x: number;
  y: number;
  children: string | number;
  fill: string;
  anchor?: Anchor;
  fontSize?: number;
  fontFamily?: string;
  frame?: {width: number; height: number};
}) {
  const ctx = useContext(Frame);
  const box = frame ?? ctx;
  const text = String(children);
  // A label with no frame could be cut unseen: that is a bug, not a default.
  if (!box) throw new Error('ChartLabel outside a ChartSvg needs a frame');
  const at = insideFrame(text, x, y, fontSize, anchor, box);
  return (
    <SvgText
      x={at.x}
      y={at.baseline}
      textAnchor={anchor}
      fill={fill}
      fontFamily={fontFamily}
      fontSize={fontSize}>
      {text}
    </SvgText>
  );
}
