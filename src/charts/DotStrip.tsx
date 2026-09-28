import {Pressable, StyleSheet, View} from 'react-native';
import Svg, {Circle, Line} from 'react-native-svg';

import {useTheme} from '@/src/design';

// One measure across many laps (handoff §4 "dot strips"): a dot per lap on a
// horizontal axis. Equal values stack alternately up and down in 5 pt steps.
// Pure props; the caller picks each dot's color and size.

export type StripDot = {
  key: string;
  value: number;
  color: string;
  r: number;
  opacity: number;
  /** 0, +1, −1, +2, … × STACK_PT. */
  stack: number;
  /** Drawn last, on top. */
  top: boolean;
};

const H = 40;
const PAD_X = 8;
const STACK_PT = 5;

export function DotStrip({
  width,
  min,
  max,
  flipped,
  dots,
  onPressDot,
}: {
  width: number;
  min: number;
  max: number;
  /** Left = larger values (brake point: left is earlier). */
  flipped?: boolean;
  dots: StripDot[];
  onPressDot: (key: string) => void;
}) {
  const {color} = useTheme();
  const span = max - min || 1;
  const x = (v: number) => {
    const f = (v - min) / span;
    return PAD_X + (flipped ? 1 - f : f) * (width - 2 * PAD_X);
  };
  const ordered = [...dots].sort((a, b) => Number(a.top) - Number(b.top));
  return (
    <View style={{width, height: H}}>
      <Svg width={width} height={H}>
        <Line
          x1={PAD_X}
          x2={width - PAD_X}
          y1={H / 2}
          y2={H / 2}
          stroke={color.lineStrong}
          strokeWidth={1}
        />
        {ordered.map(d => (
          <Circle
            key={d.key}
            cx={x(d.value)}
            cy={H / 2 - d.stack * STACK_PT}
            r={d.r}
            fill={d.color}
            opacity={d.opacity}
          />
        ))}
      </Svg>
      {/* Hit targets for the key dots, where a tap matters most. */}
      {ordered.map(d => (
        <Pressable
          key={`hit-${d.key}`}
          accessibilityLabel={`Highlight ${d.key}`}
          onPress={() => onPressDot(d.key)}
          style={[
            styles.hit,
            {left: x(d.value) - 8, top: H / 2 - d.stack * STACK_PT - 8},
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  hit: {position: 'absolute', width: 16, height: 16},
});
