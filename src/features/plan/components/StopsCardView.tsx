import {StyleSheet, View} from 'react-native';

import {refuelScope} from '@/src/analysis/refuel';
import {space, useTheme} from '@/src/design';
import {Text, useHowToRead} from '@/src/ui';

import {type StintLine, type StopRow, type StopsCard} from '../planCards';

const WINDOW_HELP = [
  'Stops are planned at p90 use per lap (the heavier 10 % of the laps), with no reserve, so the window is the safe one.',
  'Earliest: the laps after it still fit in full tanks. Latest: the lap the tank runs out, the earlier stops as late as they can be. Each stop after the first must also come within a tank of the one before.',
  'In a timed race the window uses the race length plus one lap, because the flag can fall late. At median use is where the tank would run out at the median lap.',
  'A mandatory stop that refuels makes the real window wider.',
] as const;

/**
 * The Stops card (round 5, frame 1; table form after parc #1870): each plan is
 * a table with one row per stint and one number a cell: laps, what the stint
 * uses in the unit shown, what the stop that ends it refuels, and the lap that
 * stop comes after. The full-tank plan is at full ink, equal stints under it
 * as the comparison in secondary ink. The formation lap has its own row, so
 * "after L10" after a first stint of 9 reads as L1 plus nine racing laps. The
 * pit window's long explanation is behind its "?".
 */
export function StopsCardView({
  card,
  carClass,
}: {
  card: StopsCard;
  carClass: string;
}) {
  const {color} = useTheme();
  const help = useHowToRead('the pit window', WINDOW_HELP);
  if (!card.full && !card.equal)
    return (
      <Text variant='dataSmall' tone='textMuted'>
        no data: a median needs 3 green laps
      </Text>
    );
  const scope = refuelScope(carClass);
  const cells = (
    cols: (string | null)[],
    tone: 'text' | 'textSecondary' | 'textMuted',
    variant: 'data' | 'tableHeader' = 'data',
  ) => (
    <View style={styles.cols}>
      {cols.map((c, i) => (
        <Text
          key={i}
          variant={variant}
          tone={tone}
          style={i === 0 ? styles.first : styles.col}>
          {c ?? '–'}
        </Text>
      ))}
    </View>
  );
  const table = (r: StopRow, strong: boolean) => {
    const tone = strong ? 'text' : 'textSecondary';
    const line = (l: StintLine) =>
      cells([`Stint ${l.n}`, l.laps, l.use, l.refuel, l.stopAfter], tone);
    return (
      <View key={r.kind} style={[styles.table, {borderColor: color.line}]}>
        <Text variant='label' tone={strong ? 'text' : 'textMuted'}>
          {r.kind === 'full' ? 'Full tank' : 'Equal stints'}
        </Text>
        {cells(
          [
            'Stint',
            'Laps',
            card.perStintHeader,
            card.refuelHeader,
            'Stop after',
          ],
          'textMuted',
          'tableHeader',
        )}
        {card.formationUse != null
          ? cells(['Formation', '1', card.formationUse, null, null], tone)
          : null}
        {r.lines.map(l => (
          <View key={l.n}>{line(l)}</View>
        ))}
        {r.lines.length === 0 ? (
          <Text variant='dataSmall' tone='textMuted'>
            no stop
          </Text>
        ) : null}
      </View>
    );
  };
  return (
    <View style={styles.box}>
      {card.full ? table(card.full, true) : null}
      {card.windows.length > 0 ? (
        <View style={[styles.table, {borderColor: color.line}]}>
          <View style={styles.head}>
            <Text variant='label' tone='textMuted'>
              Pit window
            </Text>
            {help.button}
          </View>
          {help.panel}
          {card.windows.map(w => (
            <Text key={w.stop} variant='dataStrong' tone='textSecondary'>
              {w.text}
            </Text>
          ))}
          {card.windowNote ? (
            <Text variant='dataSmall' tone='textSecondary'>
              {card.windowNote}
            </Text>
          ) : null}
        </View>
      ) : null}
      {card.windows.length === 0 && card.windowNote ? (
        <Text variant='dataSmall' tone='textSecondary'>
          {card.windowNote}
        </Text>
      ) : null}
      {card.equal ? table(card.equal, false) : null}
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
  table: {gap: space.xs, paddingTop: space.sm, borderTopWidth: 1},
  head: {flexDirection: 'row', alignItems: 'center', gap: space.sm},
  cols: {flexDirection: 'row', gap: space.md},
  first: {flex: 1.4},
  col: {flex: 1},
});
