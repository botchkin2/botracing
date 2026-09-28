import {StyleSheet, View} from 'react-native';

import {size, space, useTheme} from '@/src/design';
import {Explainer, Text} from '@/src/ui';

import {type StintVsStintModel} from '../desktopModel';

// Columns from the handoff D1: corner 30 | distance 64 | 84 | 84 | value.
const COL = {n: 30, dist: 64};
const BAR_H = 10;

/**
 * Desktop (≥1280) "Stint 2 vs Stint 1 by corner": diverging bars around a
 * centre line, faster (green) to the left, slower (red) to the right.
 */
export function StintCornerBars({model}: {model: StintVsStintModel}) {
  const {color} = useTheme();
  return (
    <View>
      <View style={styles.titleRow}>
        <Text variant='label'>{model.title} · by corner</Text>
        <Text variant='dataSmall' tone='textSecondary' style={styles.total}>
          Σ {model.total} s
        </Text>
      </View>
      <Explainer>{model.explainer}</Explainer>
      <View style={styles.rows}>
        {model.rows.map(r => (
          <View key={r.key} style={styles.row}>
            <Text variant='dataStrong' style={{width: COL.n}}>
              {r.label}
            </Text>
            <Text
              variant='dataSmall'
              tone='textFaint'
              style={{width: COL.dist}}>
              {r.dist ?? ''}
            </Text>
            <View
              style={[styles.half, styles.left, {borderColor: color.median}]}>
              {r.deltaS < 0 && (
                <View
                  style={{
                    width: r.frac * size.divergeHalf,
                    height: BAR_H,
                    backgroundColor: color.faster,
                  }}
                />
              )}
            </View>
            <View style={styles.half}>
              {r.deltaS > 0 && (
                <View
                  style={{
                    width: r.frac * size.divergeHalf,
                    height: BAR_H,
                    backgroundColor: color.slower,
                  }}
                />
              )}
            </View>
            <Text
              variant='dataSmall'
              tone={
                r.deltaS < 0 ? 'faster' : r.deltaS > 0 ? 'slower' : 'textMuted'
              }
              style={styles.value}>
              {r.value}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  titleRow: {flexDirection: 'row', alignItems: 'baseline', gap: space.md},
  total: {marginLeft: 'auto'},
  rows: {marginTop: space.sm},
  row: {
    height: size.divergeRow,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
  half: {width: size.divergeHalf, height: BAR_H, flexDirection: 'row'},
  left: {justifyContent: 'flex-end', borderRightWidth: 1},
  value: {flex: 1, textAlign: 'right'},
});
