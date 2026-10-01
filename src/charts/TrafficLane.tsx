import {View} from 'react-native';
import Svg, {G, Line, Rect, Text as SvgText} from 'react-native-svg';

import {type LaneRow} from '@/src/analysis/trafficLane';
import {
  gridStepM,
  timeAtDistance,
  timeGridStepM,
  type TimedGrid,
} from '@/src/analysis/window';
import {size, type as typeScale, useTheme} from '@/src/design';

import {laneGeometry} from './trafficLaneLayout';

export type TrafficLaneRow = LaneRow & {
  key: string;
  /** The lap's colour: the span is a property of the lap, so the lap colour is allowed. */
  color: string;
  /** "L9", at the right end of the row. */
  label: string;
};

const TICK_FONT = 8;

/**
 * One row per selected lap, in chip order, under the last trace on the same
 * distance axis and gridlines (round 7, 2C): where a car was within 1 s ahead
 * in the lap's colour, white ticks for faster-class cars that passed (BLUE) and
 * own-class passes (PASS). Pure props; takes no touches (the traces above scrub).
 */
export function TrafficLane({
  width,
  windowM,
  timeAxis,
  rows,
  cursorM,
}: {
  width: number;
  windowM: [number, number];
  /** Time mode: x is the reference's elapsed time, as on the traces. */
  timeAxis?: {ref: TimedGrid; windowS: [number, number]} | null;
  rows: TrafficLaneRow[];
  cursorM: number;
}) {
  const {color} = useTheme();
  const [startM, endM] = windowM;
  const spanM = endM - startM || 1;
  const tRef = timeAxis?.ref;
  const [t0, t1] = timeAxis?.windowS ?? [0, 1];
  const spanS = t1 - t0 || 1;
  // The same mapping and gridline step as TraceChart.
  const xOfM = tRef
    ? (m: number) => ((timeAtDistance(tRef, m) - t0) / spanS) * width
    : (m: number) => ((m - startM) / spanM) * width;
  const step = tRef
    ? timeGridStepM(tRef, spanS, width)
    : gridStepM(spanM, width);
  const grid: number[] = [];
  for (let m = Math.ceil(startM / step) * step; m <= endM; m += step)
    if (m >= 0) grid.push(m);
  const height = rows.length * size.trafficLaneRow;
  const cx = xOfM(cursorM);
  return (
    <View style={{width, height}} pointerEvents='none'>
      <Svg width={width} height={height}>
        {grid.map(m => (
          <Line
            key={m}
            x1={xOfM(m)}
            x2={xOfM(m)}
            y1={0}
            y2={height}
            stroke={color.grid}
            strokeWidth={1}
          />
        ))}
        {rows.map((r, i) => {
          const g = laneGeometry(r, xOfM, width);
          const y = i * size.trafficLaneRow;
          const pad = 3;
          return (
            <G key={r.key}>
              {g.spans.map((s, k) => (
                <Rect
                  key={`s${i}-${k}`}
                  x={s.x}
                  y={y + pad}
                  width={s.w}
                  height={size.trafficLaneRow - 2 * pad}
                  fill={r.color}
                  opacity={0.85}
                />
              ))}
              {g.ticks.map((t, k) => (
                <Line
                  key={`t${i}-${k}`}
                  x1={t.x}
                  x2={t.x}
                  y1={y + 1}
                  y2={y + size.trafficLaneRow - 1}
                  stroke={color.text}
                  strokeWidth={1.5}
                />
              ))}
              {g.ticks.map((t, k) => (
                <SvgText
                  key={`w${i}-${k}`}
                  x={Math.min(width - 28, t.x + 2)}
                  y={y + TICK_FONT + 1}
                  fill={color.text}
                  fontFamily={typeScale.axis.fontFamily}
                  fontSize={TICK_FONT}>
                  {t.label}
                </SvgText>
              ))}
              <SvgText
                x={width - 2}
                y={y + size.trafficLaneRow - 3}
                textAnchor='end'
                fill={r.color}
                fontFamily={typeScale.axis.fontFamily}
                fontSize={9}>
                {r.label}
              </SvgText>
            </G>
          );
        })}
        <Line
          x1={cx}
          x2={cx}
          y1={0}
          y2={height}
          stroke={color.accent}
          strokeWidth={1}
        />
      </Svg>
    </View>
  );
}

// The empty line keeps the axis height the lane would take, so the layout does not jump.
export const TRAFFIC_LANE_EMPTY_H = size.trafficLaneEmpty;
