import {useMemo} from 'react';
import {Circle, G, Rect, Text as SvgText} from 'react-native-svg';

import {type Box, placeCarLabels} from '@/src/analysis/carLabels';
import {fonts, lapColors, useTheme} from '@/src/design';

import {type MapPoint} from './TrackMap';

// Every car as a dot on the map (round 3 R1d). Colour is the caller's: class
// colours mark other cars only, never a line or a number.

export type MapCar = {
  key: string;
  at: MapPoint;
  /** Class colour of the fill or, in the pit lane, of the ring. */
  color: string;
  radius: number;
  state: 'running' | 'pit' | 'stopped' | 'off';
  you: boolean;
  focused: boolean;
  /** Text next to the dot (R1e); no label when unset. */
  label?: string;
  /** Lower ranks are placed first and win a contested spot. */
  labelRank?: number;
};

const EDGE_W = 1.1;
const PIT_RING_W = 1.5;
const YOU_RING_W = 1.3;
const YOU_RING_GAP = 3.2;
const FOCUS_RING_W = 1.8;
const FOCUS_RING_GAP = 5;
const STATE_RING_W = 1.3;
const STATE_RING_GAP = 2.5;
const OFF_DASH = '2 2';

// R1e: mono 600 9.5 in the class colour on a badge; yours in white, the
// focused car's badge outlined in the accent.
const LABEL_FONT = 9.5;
const LABEL_H = 12;
const LABEL_CHAR_W = 6;
const LABEL_PAD = 3;
const NO_BOXES: Box[] = [];

/**
 * SVG children for `cars`, already in screen points (the map's own fit).
 * `avoid` are boxes labels stay off (controls, the radar inset), and
 * `bounds` the map's size.
 */
export function CarDots({
  cars,
  avoid = NO_BOXES,
  bounds,
}: {
  cars: MapCar[];
  avoid?: Box[];
  bounds: {width: number; height: number};
}) {
  const {color, scheme} = useTheme();
  const labelBoxes = useMemo(
    () =>
      placeCarLabels(
        cars
          .filter(c => c.label)
          .map(c => ({
            key: c.key,
            x: c.at.x,
            y: c.at.y,
            radius: c.radius,
            width: (c.label ?? '').length * LABEL_CHAR_W + 2 * LABEL_PAD,
            height: LABEL_H,
            rank: c.labelRank ?? 0,
          })),
        avoid,
        bounds,
      ),
    [cars, avoid, bounds],
  );
  // You are the reference white (the key lap's colour), not a class colour.
  const you = lapColors[scheme][0];
  return (
    <G>
      {cars.map(c => {
        const {x, y} = c.at;
        const r = c.radius;
        const label = labelBoxes.get(c.key);
        return (
          <G key={c.key}>
            {label && c.label && (
              <G>
                <Rect
                  x={label.x}
                  y={label.y}
                  width={c.label.length * LABEL_CHAR_W + 2 * LABEL_PAD}
                  height={LABEL_H}
                  rx={2}
                  fill={color.surfaceRaised}
                  stroke={
                    c.focused
                      ? color.accent
                      : c.you
                      ? color.textSecondary
                      : color.median
                  }
                  strokeWidth={1}
                />
                <SvgText
                  x={label.x + LABEL_PAD}
                  y={label.y + LABEL_H - 3.2}
                  fill={c.you ? you : c.color}
                  fontFamily={fonts.monoBold}
                  fontSize={LABEL_FONT}>
                  {c.label}
                </SvgText>
              </G>
            )}
            {c.state === 'stopped' && (
              <Circle
                cx={x}
                cy={y}
                r={r + STATE_RING_GAP}
                fill='none'
                stroke={color.textSecondary}
                strokeWidth={STATE_RING_W}
              />
            )}
            {c.state === 'off' && (
              <Circle
                cx={x}
                cy={y}
                r={r + STATE_RING_GAP}
                fill='none'
                stroke={color.textSecondary}
                strokeWidth={1}
                strokeDasharray={OFF_DASH}
              />
            )}
            {c.focused && (
              <Circle
                cx={x}
                cy={y}
                r={r + FOCUS_RING_GAP}
                fill='none'
                stroke={color.accent}
                strokeWidth={FOCUS_RING_W}
              />
            )}
            {c.you && (
              <Circle
                cx={x}
                cy={y}
                r={r + YOU_RING_GAP}
                fill='none'
                stroke={you}
                strokeWidth={YOU_RING_W}
              />
            )}
            {c.state === 'pit' ? (
              <Circle
                cx={x}
                cy={y}
                r={r}
                fill={color.bg}
                stroke={c.color}
                strokeWidth={PIT_RING_W}
              />
            ) : (
              <Circle
                cx={x}
                cy={y}
                r={r}
                fill={c.you ? you : c.color}
                stroke={color.bg}
                strokeWidth={EDGE_W}
              />
            )}
          </G>
        );
      })}
    </G>
  );
}
