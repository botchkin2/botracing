import {StyleSheet, View} from 'react-native';
import Svg, {Circle} from 'react-native-svg';

import {type FieldClass} from '@/src/analysis/fieldClasses';
import {classColor, lapColors, space, useTheme} from '@/src/design';
import {Text} from '@/src/ui';

const GLYPH = 12;
const C = GLYPH / 2;

// R1a legend: each class present, fastest first, with its label (the colour
// is a pace rank, so it is never shown without it), then each state's dot
// glyph, as drawn on the map (R1d).
export function RaceLegend({classes}: {classes: readonly FieldClass[]}) {
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
      {classes.map(c => item(c.label, dot(classColor(color, c.slot))))}
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
