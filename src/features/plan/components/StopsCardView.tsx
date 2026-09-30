import {StyleSheet, View} from 'react-native';

import {refuelScope} from '@/src/analysis/refuel';
import {space, useTheme} from '@/src/design';
import {Text} from '@/src/ui';

import {type StopRow, type StopsCard} from '../planCards';

/**
 * The Stops card (round 5, frame 1): the full-tank strategy first, at full ink,
 * then equal stints as the comparison in secondary ink. "Stop after" is the
 * app's lap name and "Stint laps" the sum that adds up to the race. The key
 * under it says how the formation lap and the refuelling are counted; the
 * refuel rate, with its scope, only where it is measured.
 */
export function StopsCardView({
  card,
  carClass,
}: {
  card: StopsCard;
  carClass: string;
}) {
  const {color} = useTheme();
  if (!card.full && !card.equal)
    return (
      <Text variant='dataSmall' tone='textMuted'>
        no data: a median needs 3 green laps
      </Text>
    );
  const scope = refuelScope(carClass);
  const f = card.formation;
  const formation = f
    ? [
        f.vePct != null && `${f.vePct.toFixed(1)} % VE`,
        f.fuelL != null && `${f.fuelL.toFixed(1)} L`,
      ].filter(Boolean)
    : [];
  const row = (r: StopRow, strong: boolean) => (
    <View key={r.kind} style={[styles.row, {borderColor: color.line}]}>
      <Text variant='label' tone={strong ? 'text' : 'textMuted'}>
        {r.kind === 'full' ? 'Full tank' : 'Equal stints'}
      </Text>
      <View style={styles.cols}>
        <Text
          variant='dataStrong'
          tone={strong ? 'text' : 'textSecondary'}
          style={styles.col}>
          {r.stopAfter.length > 0 ? r.stopAfter.join(' · ') : 'no stop'}
        </Text>
        <Text
          variant='dataStrong'
          tone={strong ? 'text' : 'textSecondary'}
          style={styles.col}>
          {r.stintLaps.join(' + ')}
        </Text>
      </View>
    </View>
  );
  return (
    <View style={styles.box}>
      <View style={styles.cols}>
        <Text variant='tableHeader' tone='textMuted' style={styles.col}>
          Stop after
        </Text>
        <Text variant='tableHeader' tone='textMuted' style={styles.col}>
          Stint laps
        </Text>
      </View>
      {card.full ? row(card.full, true) : null}
      {card.equal ? row(card.equal, false) : null}
      {formation.length > 0 ? (
        <Text variant='dataSmall' tone='textMuted'>
          {`Stint 1 includes the formation lap: ${formation.join(', ')}.`}
        </Text>
      ) : null}
      {scope ? (
        <Text variant='dataSmall' tone='textMuted'>
          {`Refuelling: ${scope}.`}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {gap: space.sm},
  row: {gap: space.xxs, paddingTop: space.sm, borderTopWidth: 1},
  cols: {flexDirection: 'row', gap: space.lg},
  col: {flex: 1},
});
