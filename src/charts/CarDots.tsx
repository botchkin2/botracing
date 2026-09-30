import {Circle, G} from 'react-native-svg';

import {lapColors, useTheme} from '@/src/design';

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

/** SVG children for `cars`, already in screen points (the map's own fit). */
export function CarDots({cars}: {cars: MapCar[]}) {
  const {color, scheme} = useTheme();
  // You are the reference white (the key lap's colour), not a class colour.
  const you = lapColors[scheme][0];
  return (
    <G>
      {cars.map(c => {
        const {x, y} = c.at;
        const r = c.radius;
        return (
          <G key={c.key}>
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
