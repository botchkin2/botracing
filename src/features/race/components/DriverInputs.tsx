import {StyleSheet, View} from 'react-native';
import Svg, {Circle, G, Path} from 'react-native-svg';

import {radius, size, space, useTheme} from '@/src/design';

import {throttleState} from '@/src/features/race/chase/inputState';

// The followed player's own inputs on the 3D view, as large as the view can spare: brake and throttle bars as tall as
// the steering wheel is wide. A full lock reads about 210 degrees.
export function DriverInputs({
  brakePct,
  throttlePct,
  steeringPct,
  tight,
}: {
  brakePct: number;
  throttlePct: number;
  steeringPct: number;
  tight: boolean;
}) {
  const {color} = useTheme();
  const wheel = tight ? size.chaseWheelTight : size.chaseWheel;
  // the road ribbon's colours: full throttle green, part throttle accent, brake red
  const throttleFill = {full: color.faster, part: color.accent, coast: color.textMuted}[throttleState(throttlePct)];
  const pedalW = tight ? size.chasePedalWTight : size.chasePedalW;
  return (
    <View
      pointerEvents='none'
      style={[styles.box, {backgroundColor: color.surface, borderColor: color.lineStrong}]}>
      <Pedal value={brakePct} fill={color.slower} track={color.median} width={pedalW} height={wheel} />
      <Pedal value={throttlePct} fill={throttleFill} track={color.median} width={pedalW} height={wheel} />
      <Wheel pct={steeringPct} px={wheel} ink={color.text} mark={color.accent} ring={color.lineStrong} />
    </View>
  );
}

function Pedal({value, fill, track, width, height}: {value: number; fill: string; track: string; width: number; height: number}) {
  return (
    <View style={[styles.pedal, {width, height, backgroundColor: track}]}>
      <View style={[styles.pedalFill, {height: `${Math.max(0, Math.min(100, value))}%`, backgroundColor: fill}]} />
    </View>
  );
}

function Wheel({pct, px, ink, mark, ring}: {pct: number; px: number; ink: string; mark: string; ring: string}) {
  const deg = Math.max(-100, Math.min(100, pct)) * 2.1;
  return (
    <Svg width={px} height={px} viewBox='-26 -26 52 52'>
      <Circle r={20} fill='none' stroke={ring} strokeWidth={3.5} />
      <G rotation={deg}>
        <Path d='M-20 0H20M0 0V20' stroke={ink} strokeWidth={3.5} strokeLinecap='round' />
        <Path d='M-5 -20h10' stroke={mark} strokeWidth={4} strokeLinecap='round' />
      </G>
    </Svg>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.sm,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: space.sm,
  },
  pedal: {borderRadius: radius.sm, overflow: 'hidden'},
  pedalFill: {position: 'absolute', left: 0, right: 0, bottom: 0},
});
