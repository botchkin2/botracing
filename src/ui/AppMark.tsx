import Svg, {Line, Path, Rect} from 'react-native-svg';

import {lapColors, size, useTheme} from '@/src/design';

/**
 * The app mark, "Trace" (round 3 N1a, `assets/app-mark-trace.svg`): a lap
 * trace over a zero line with the cursor in amber. Same geometry as the SVG
 * source in an 18 x 18 box, coloured from tokens.
 */
export function AppMark({pt = size.logo}: {pt?: number}) {
  const {color, scheme} = useTheme();
  return (
    <Svg
      width={pt}
      height={pt}
      viewBox='0 0 18 18'
      accessibilityLabel='Lap analysis'>
      <Rect
        x={0.5}
        y={0.5}
        width={17}
        height={17}
        rx={4}
        fill={color.surfaceRaised}
        stroke={color.median}
      />
      <Line x1={3} x2={15} y1={10.5} y2={10.5} stroke={color.median} />
      <Path
        d='M3 13 C5 13 5.4 5 7.8 5 S10.4 11.5 12 11.5 S14 8.2 15 7.8'
        fill='none'
        stroke={lapColors[scheme][0]}
        strokeWidth={1.6}
        strokeLinecap='round'
      />
      <Line
        x1={11}
        x2={11}
        y1={3}
        y2={15}
        stroke={color.accent}
        strokeWidth={1.3}
      />
    </Svg>
  );
}
