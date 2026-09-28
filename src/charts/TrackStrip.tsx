import {useEffect, useRef, useState} from 'react';
import {PanResponder, View} from 'react-native';
import Svg, {Line, Rect, Text as SvgText} from 'react-native-svg';

import {radius, type as typeScale, useTheme} from '@/src/design';

// The map's stand-in when it is hidden (handoff §3 "Map (hidden) → strip"):
// the lap as a bar, corner numbers under it, the chart window as a frame,
// and a marker per lap. Drag or tap to move the cursor.

export type StripMarker = {key: string; m: number; color: string};

const BAR_Y = 6;
const BAR_H = 4;
const H = 28;

export function TrackStrip({
  width,
  lengthM,
  corners,
  windowM,
  markers,
  onScrub,
}: {
  width: number;
  lengthM: number;
  corners: {n: number; m: number}[];
  windowM: [number, number];
  markers: StripMarker[];
  onScrub: (distanceM: number) => void;
}) {
  const {color} = useTheme();
  const x = (m: number) => (m / (lengthM || 1)) * width;
  const latest = useRef({onScrub, lengthM, width});
  useEffect(() => {
    latest.current = {onScrub, lengthM, width};
  });
  const toM = (px: number) => {
    const p = latest.current;
    return Math.max(0, Math.min(p.lengthM, (px / p.width) * p.lengthM));
  };
  // Read only inside gesture callbacks (see TraceChart).
  // eslint-disable-next-line react-hooks/refs
  const [responder] = useState(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: e =>
        latest.current.onScrub(toM(e.nativeEvent.locationX)),
      onPanResponderMove: e =>
        latest.current.onScrub(toM(e.nativeEvent.locationX)),
    }),
  );
  return (
    <View
      {...responder.panHandlers}
      accessibilityLabel='Track strip: drag to move through the lap'
      style={{width, height: H}}>
      <Svg width={width} height={H} pointerEvents='none'>
        <Rect
          x={0}
          y={BAR_Y}
          width={width}
          height={BAR_H}
          rx={radius.xs}
          fill={color.track}
        />
        <Rect
          x={x(windowM[0])}
          y={BAR_Y - 4}
          width={Math.max(2, x(windowM[1]) - x(windowM[0]))}
          height={BAR_H + 8}
          fill='none'
          stroke={color.accent}
          strokeWidth={1}
        />
        {corners.map(c => (
          <SvgText
            key={c.n}
            x={x(c.m)}
            y={H - 2}
            textAnchor='middle'
            fill={color.textFaint}
            fontFamily={typeScale.axis.fontFamily}
            fontSize={9}>
            {`S${c.n}`}
          </SvgText>
        ))}
        {markers.map(mk => (
          <Line
            key={mk.key}
            x1={x(mk.m)}
            x2={x(mk.m)}
            y1={BAR_Y - 6}
            y2={BAR_Y + BAR_H + 6}
            stroke={mk.color}
            strokeWidth={3}
          />
        ))}
      </Svg>
    </View>
  );
}
