import {StyleSheet, View} from 'react-native';
import Svg, {Circle} from 'react-native-svg';

import {lapColors, space, useTheme} from '@/src/design';
import {Text} from '@/src/ui';

const GLYPH = 12;
const C = GLYPH / 2;

// R1a legend: each state's dot glyph, as drawn on the map (R1d).
export function RaceLegend() {
  const {color, scheme} = useTheme();
  const you = lapColors[scheme][0];
  const item = (label: string, glyph: React.ReactNode) => (
    <View key={label} style={styles.item}>
      <Svg width={GLYPH} height={GLYPH}>
        {glyph}
      </Svg>
      <Text variant='dataSmall' tone='textSecondary'>
        {label}
      </Text>
    </View>
  );
  const dot = (fill: string) => (
    <Circle
      cx={C}
      cy={C}
      r={3.4}
      fill={fill}
      stroke={color.bg}
      strokeWidth={1}
    />
  );
  return (
    <View style={styles.row}>
      {item('Hypercar', dot(color.classHypercar))}
      {item('LMP2', dot(color.classLmp2))}
      {item('GT3', dot(color.classGt3))}
      {item(
        'You',
        <>
          <Circle
            cx={C}
            cy={C}
            r={5.4}
            fill='none'
            stroke={you}
            strokeWidth={1}
          />
          {dot(you)}
        </>,
      )}
      {item(
        'Pit lane',
        <Circle
          cx={C}
          cy={C}
          r={3.4}
          fill={color.bg}
          stroke={color.textSecondary}
          strokeWidth={1.5}
        />,
      )}
      {item(
        'Stopped',
        <>
          <Circle
            cx={C}
            cy={C}
            r={5.4}
            fill='none'
            stroke={color.textSecondary}
            strokeWidth={1.3}
          />
          {dot(color.textSecondary)}
        </>,
      )}
      {item(
        'Off track',
        <>
          <Circle
            cx={C}
            cy={C}
            r={5.4}
            fill='none'
            stroke={color.textSecondary}
            strokeWidth={1}
            strokeDasharray='2 2'
          />
          {dot(color.textSecondary)}
        </>,
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {flexDirection: 'row', flexWrap: 'wrap', gap: space.lg},
  item: {flexDirection: 'row', alignItems: 'center', gap: space.xs},
});
