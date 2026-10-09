import {useMemo} from 'react';
import {StyleSheet, View} from 'react-native';

import {type Field} from '@/src/analysis/field';
import {RADAR_RANGE_M, type RadarClass} from '@/src/analysis/radar';
import {raceClock} from '@/src/analysis/raceClock';
import {Radar} from '@/src/charts';
import {space, useTheme} from '@/src/design';
import {Text} from '@/src/ui';

import {aroundYouRows} from '../aroundYou';
import {radarAtCursor} from '../radarModel';

// Desktop side column (round 3 R2c): the radar at 150 × 226 and, beside it,
// the cars in it, nearest first.

const RADAR_W = 150;
const RADAR_H = 226;
const ROW_H = 24;
const CLASS_SHORT: Record<RadarClass, string> = {
  hypercar: 'HY',
  lmp2: 'P2',
  gt3: 'GT3',
};

export function CarsAround({
  field,
  lapNumber,
  lapLabel,
  cursorM,
}: {
  field: Field;
  lapNumber: number;
  /** The lap the radar belongs to, as its chip names it ("L7"). */
  lapLabel: string;
  cursorM: number;
}) {
  const {color} = useTheme();
  const clock = useMemo(() => raceClock(field), [field]);
  const view = radarAtCursor(
    field,
    clock,
    lapNumber,
    cursorM,
    RADAR_W,
    RADAR_H,
  );
  // The field does not cover this lap: nothing to show, not an empty radar.
  if (!view) return null;
  const rows = view.radar ? aroundYouRows(view.radar, field) : [];
  const classColor: Record<RadarClass, string> = {
    hypercar: color.classHypercar,
    lmp2: color.classLmp2,
    gt3: color.classGt3,
  };
  return (
    <View style={styles.section}>
      <Text variant='label' tone='textMuted'>
        {`Cars around ${lapLabel}`}
      </Text>
      <View style={styles.row}>
        <Radar
          width={RADAR_W}
          height={RADAR_H}
          rangeM={RADAR_RANGE_M}
          radar={view.radar}
          sampleLabel={`${view.sampleLabel} · 5 Hz`}
        />
        <View style={styles.list}>
          {rows.length === 0 && (
            <Text variant='dataSmall' tone='textMuted'>
              None within {RADAR_RANGE_M} m
            </Text>
          )}
          {rows.map(r => (
            <View key={r.index} style={styles.item}>
              <View
                style={[styles.bar, {backgroundColor: classColor[r.cls]}]}
              />
              <Text variant='dataSmall' tone='textSecondary' style={styles.cls}>
                {CLASS_SHORT[r.cls]}
              </Text>
              <Text variant='dataSmall' style={styles.fwd}>
                {r.forwardText}
              </Text>
              {r.alongside ? (
                <Text variant='dataStrong' style={styles.side}>
                  ALONGSIDE {r.alongside === 'left' ? 'L' : 'R'}
                </Text>
              ) : (
                <Text variant='dataSmall' tone='textMuted' style={styles.side}>
                  {r.sideText}
                </Text>
              )}
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {gap: space.xs, marginTop: space.sm},
  row: {flexDirection: 'row', gap: space.md},
  list: {flex: 1},
  item: {
    height: ROW_H,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
  bar: {width: 3, height: 14},
  cls: {width: 26},
  fwd: {width: 40, textAlign: 'right'},
  side: {flex: 1},
});
