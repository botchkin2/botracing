import {useMemo} from 'react';
import {PanResponder, View} from 'react-native';
import Svg, {Line, Path} from 'react-native-svg';

import {stroke, useTheme} from '@/src/design';

// Channels against distance on a shared grid (handoff §3 charts). Pure props:
// the caller picks colors, widths and dashes. Drag or tap to move the cursor.

export type TraceSeries = {
  key: string;
  /** One value per grid point (index * stepM metres from the line). */
  values: number[];
  color: string;
  width: number;
  opacity: number;
  dash?: string;
  /** Own y range; series without one share the chart's. */
  domain?: [number, number];
};

export type TraceBand = {low: number[]; high: number[]};

const Y_PAD = 3;

function pathFor(
  values: number[],
  from: number,
  to: number,
  x: (i: number) => number,
  y: (v: number) => number,
  maxPoints: number,
): string {
  const n = to - from + 1;
  const stride = Math.max(1, Math.floor(n / maxPoints));
  let d = '';
  for (let i = from; i <= to; i += stride) {
    d += `${d ? 'L' : 'M'}${x(i).toFixed(1)},${y(values[i]).toFixed(1)}`;
  }
  return d;
}

export function TraceChart({
  width,
  height,
  stepM,
  windowM,
  domain,
  series,
  band,
  zeroLine,
  cursorM,
  onScrub,
}: {
  width: number;
  height: number;
  stepM: number;
  /** Visible distance range [start, end] in metres. */
  windowM: [number, number];
  domain: [number, number];
  series: TraceSeries[];
  band?: TraceBand;
  zeroLine?: boolean;
  cursorM: number;
  onScrub: (distanceM: number) => void;
}) {
  const {color} = useTheme();
  const [startM, endM] = windowM;
  const from = Math.max(0, Math.floor(startM / stepM));
  const to = Math.ceil(endM / stepM);
  const x = (i: number) => ((i * stepM - startM) / (endM - startM)) * width;
  const yFor =
    ([lo, hi]: [number, number]) =>
    (v: number) =>
      Y_PAD + (1 - (v - lo) / (hi - lo || 1)) * (height - 2 * Y_PAD);
  const y = yFor(domain);

  const paths = useMemo(
    () =>
      series.map(s => {
        const last = Math.min(to, s.values.length - 1);
        return {
          ...s,
          d: pathFor(s.values, from, last, x, yFor(s.domain ?? domain), width),
        };
      }),
    // x and yFor are derived from the listed inputs.
    [series, from, to, width, height, startM, endM, domain],
  );

  const bandPath = useMemo(() => {
    if (!band) return null;
    const last = Math.min(to, band.low.length - 1);
    const top = pathFor(band.high, from, last, x, y, width);
    const bottom: string[] = [];
    const stride = Math.max(1, Math.floor((last - from + 1) / width));
    for (let i = last; i >= from; i -= stride)
      bottom.push(`L${x(i).toFixed(1)},${y(band.low[i]).toFixed(1)}`);
    return `${top}${bottom.join('')}Z`;
  }, [band, from, to, width, height, startM, endM, domain]);

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > Math.abs(g.dy),
        onPanResponderGrant: e =>
          onScrub(startM + (e.nativeEvent.locationX / width) * (endM - startM)),
        onPanResponderMove: e =>
          onScrub(startM + (e.nativeEvent.locationX / width) * (endM - startM)),
      }),
    [onScrub, startM, endM, width],
  );

  const cx = ((cursorM - startM) / (endM - startM)) * width;
  return (
    <View {...responder.panHandlers} style={{width, height}}>
      <Svg width={width} height={height} pointerEvents='none'>
        {bandPath && <Path d={bandPath} fill={color.band} />}
        {zeroLine && (
          <Line
            x1={0}
            x2={width}
            y1={y(0)}
            y2={y(0)}
            stroke={color.median}
            strokeWidth={stroke.mark}
          />
        )}
        {paths.map(p => (
          <Path
            key={p.key}
            d={p.d}
            stroke={p.color}
            strokeWidth={p.width}
            strokeOpacity={p.opacity}
            strokeDasharray={p.dash}
            strokeLinejoin='round'
            fill='none'
          />
        ))}
        {cx >= 0 && cx <= width && (
          <Line
            x1={cx}
            x2={cx}
            y1={0}
            y2={height}
            stroke={color.accent}
            strokeWidth={stroke.cursor}
          />
        )}
      </Svg>
    </View>
  );
}
