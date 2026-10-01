import {StyleSheet, View} from 'react-native';

import {radius, space, useTheme} from '@/src/design';
import {Text} from '@/src/ui';

import type {CoolDownBlock, CoolDownWheel} from '../tireCard';

const GRID_GAP = space.md;

/**
 * The stop cool-down of a stint (round 7 1A): its own block, never part of
 * the wear bars. A 2x2 of the wheels that kept their tyre, each with the
 * change in rubber and carcass temperature and in pressure from pit entry to
 * `afterS` after pit exit; for any other stint, one line says why it is not
 * there.
 */
export function CoolDown({
  block,
  width,
}: {
  block: CoolDownBlock;
  width: number;
}) {
  if (block.kind === 'absent') {
    return (
      <Text variant='dataSmall' tone='textMuted'>
        {block.why}
      </Text>
    );
  }
  const cellW = Math.floor((width - GRID_GAP) / 2);
  return (
    <View style={styles.block}>
      <Text variant='dataSmall' tone='textMuted'>
        {`${block.after} · pit entry vs ${block.afterS} s after exit`}
      </Text>
      <View style={[styles.grid, {width, gap: GRID_GAP}]}>
        {block.wheels.map(w => (
          <Cell key={w.wheel} wheel={w} width={cellW} />
        ))}
      </View>
    </View>
  );
}

const signed = (v: number | null, digits: number, unit: string) =>
  v == null
    ? `— ${unit}`
    : `${v < 0 ? '−' : '+'}${Math.abs(v).toFixed(digits)} ${unit}`;

function Cell({wheel, width}: {wheel: CoolDownWheel; width: number}) {
  const {color} = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={`${wheel.wheel} cooling: rubber ${signed(
        wheel.rubberC,
        1,
        '°C',
      )}, carcass ${signed(wheel.carcassC, 1, '°C')}, pressure ${signed(
        wheel.pressureKpa,
        1,
        'kPa',
      )}`}
      style={[
        styles.cell,
        {width, borderColor: color.line, backgroundColor: color.surface},
      ]}>
      <Text variant='label' tone='textMuted'>
        {wheel.wheel}
      </Text>
      <Text variant='dataSmall'>{`rubber ${signed(
        wheel.rubberC,
        1,
        '°C',
      )}`}</Text>
      <Text variant='dataSmall'>{`carcass ${signed(
        wheel.carcassC,
        1,
        '°C',
      )}`}</Text>
      <Text variant='dataSmall'>{signed(wheel.pressureKpa, 1, 'kPa')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  block: {gap: space.sm},
  grid: {flexDirection: 'row', flexWrap: 'wrap'},
  cell: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.xxs,
  },
});
