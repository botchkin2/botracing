import {useMemo} from 'react';
import {StyleSheet, View} from 'react-native';

import {type Field} from '@/src/analysis/field';
import {fieldClasses} from '@/src/analysis/fieldClasses';
import {raceClock} from '@/src/analysis/raceClock';
import {prepareRace} from '@/src/analysis/raceState';
import {classColor, disabledOpacity, space, useTheme} from '@/src/design';
import {Text} from '@/src/ui';

import {nearbyAtCursor, type NearbyRow} from '../nearbyRows';

// CARS AROUND for a field with no positions (iRacing's): no radar, the cars
// nearest you on the road at the cursor, ahead above you and behind below,
// as a timing screen lists them (pit-wall thread 1 #3209 to #3211).

const ROW_H = 24;

export function NearbyList({
  field,
  lapNumber,
  lapLabel,
  cursorM,
  perSide,
  race,
}: {
  field: Field;
  lapNumber: number;
  /** The lap the list belongs to, as its chip names it ("L7"). */
  lapLabel: string;
  cursorM: number;
  /** Cars each way, pit-lane cars not counted. */
  perSide: number;
  /** A race: laps up and down are shown. */
  race: boolean;
}) {
  const {color} = useTheme();
  // Built once per field: each scans every update.
  const prep = useMemo(() => prepareRace(field), [field]);
  const clock = useMemo(() => raceClock(field), [field]);
  const classes = useMemo(() => fieldClasses(field), [field]);
  const view = nearbyAtCursor(
    prep,
    clock,
    lapNumber,
    cursorM,
    classes,
    perSide,
    race,
  );
  // The field does not cover this moment: nothing to show, not an empty list.
  if (!view) return null;
  const row = (r: NearbyRow) => (
    <View
      key={r.index}
      style={[styles.item, r.pit && {opacity: disabledOpacity}]}>
      <View
        style={[styles.bar, {backgroundColor: classColor(color, r.slot)}]}
      />
      <Text variant='dataSmall' tone='textSecondary' style={styles.cls}>
        {r.short}
      </Text>
      <Text
        variant='dataSmall'
        tone='textSecondary'
        style={styles.model}
        numberOfLines={1}>
        {r.label}
      </Text>
      <Text variant='dataSmall' tone='textMuted' style={styles.laps}>
        {r.pit ? 'IN' : r.lapsText}
      </Text>
      <Text variant='dataSmall' style={styles.gap}>
        {r.gapText}
      </Text>
      <Text variant='dataSmall' tone='textMuted' style={styles.metres}>
        {r.metresText}
      </Text>
    </View>
  );
  return (
    <View style={styles.section}>
      <Text variant='label' tone='textMuted'>
        {`Cars around ${lapLabel}`}
      </Text>
      {[...view.ahead].reverse().map(row)}
      <View style={[styles.you, {borderColor: color.lineStrong}]}>
        <Text variant='dataSmall' tone='textMuted'>
          You
        </Text>
      </View>
      {view.behind.map(row)}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {gap: 0, marginTop: space.sm},
  item: {
    height: ROW_H,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
  bar: {width: 3, height: 14},
  cls: {width: 34},
  model: {flex: 1},
  laps: {width: 30, textAlign: 'right'},
  gap: {width: 52, textAlign: 'right'},
  metres: {width: 52, textAlign: 'right'},
  you: {
    height: ROW_H,
    justifyContent: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
