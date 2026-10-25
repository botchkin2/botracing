import {StyleSheet, View} from 'react-native';

import {space, useTheme} from '@/src/design';
import {Text} from '@/src/ui';

import {type StintTableRow} from '../desktopModel';

// Columns from the handoff D1: name 62 | n 38 | median | best | spread 50.
const COL = {name: 62, n: 38, spread: 50};

/** Desktop (≥1280) Stints table: stored per-stint stats, comparable laps only. */
export function StintsPanel({rows}: {rows: StintTableRow[]}) {
  const {color} = useTheme();
  return (
    <View>
      <Text variant='label'>Stints</Text>
      <View style={[styles.row, styles.head, {borderColor: color.lineHeader}]}>
        <View style={{width: COL.name}} />
        <Text variant='tableHeader' tone='textMuted' style={{width: COL.n}}>
          n
        </Text>
        <Text variant='tableHeader' tone='textMuted' style={styles.flex}>
          Median
        </Text>
        <Text variant='tableHeader' tone='textMuted' style={styles.flex}>
          Best
        </Text>
        <Text
          variant='tableHeader'
          tone='textMuted'
          style={{width: COL.spread}}>
          Spread
        </Text>
      </View>
      {rows.map(r => (
        <View key={r.n} style={[styles.stint, {borderColor: color.line}]}>
          <View style={styles.row}>
            <Text variant='bodyStrong' style={[styles.name, {width: COL.name}]}>
              {r.name}
            </Text>
            <Text variant='data' tone='textMuted' style={{width: COL.n}}>
              {r.count}
            </Text>
            <Text variant='data' style={styles.flex}>
              {r.median}
            </Text>
            <Text variant='data' tone='textSecondary' style={styles.flex}>
              {r.best}
            </Text>
            <Text variant='data' style={{width: COL.spread}}>
              {r.spread}
            </Text>
          </View>
          <Text variant='dataSmall' tone='textMuted'>
            {r.detail}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {flexDirection: 'row', alignItems: 'baseline', gap: space.sm},
  head: {marginTop: space.md, paddingVertical: space.xs, borderBottomWidth: 1},
  stint: {paddingVertical: space.sm, borderBottomWidth: 1, gap: space.xxs},
  flex: {flex: 1},
  name: {fontSize: 12.5},
});
