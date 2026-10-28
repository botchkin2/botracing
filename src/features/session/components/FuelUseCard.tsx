import {useRouter} from 'expo-router';
import {type ReactNode} from 'react';
import {StyleSheet, View} from 'react-native';

import {space, useTheme} from '@/src/design';
import {planHref} from '@/src/nav/routes';
import {useFuelPresets} from '@/src/state/fuelPresets';
import {Pressable, Text} from '@/src/ui';

import {limitText, planLinkText, planRaceText} from '../fuelUse';
import {type FuelUseCardModel} from '../model';
import {stintFuelTable, type TableCell} from '../stintFuelTable';

/** Column weights at 343 pt: the lap time (m:ss.sss) and the stint end ("need 5.91") need the width, the use and coast figures do not. */
const END_FLEX = 1.3;
const USE_FLEX = 0.9;
const TIME_FLEX = 1.2;

function Cell({cell, flex}: {cell: TableCell; flex: number}) {
  return (
    <View style={{flex}}>
      <Text variant='data'>{cell.value}</Text>
      {cell.note ? (
        <Text variant='dataSmall' tone='textMuted'>
          {cell.note}
        </Text>
      ) : null}
    </View>
  );
}

function Head({label, flex}: {label: string; flex: number}) {
  return (
    <View style={{flex}}>
      <Text variant='label' tone='textMuted' numberOfLines={2}>
        {label}
      </Text>
    </View>
  );
}

/**
 * The fuel card (pit-wall thread 36 and 121): one table, a row per stint, and
 * the plan these laps belong to. A race adds how each stint ended.
 */
export function FuelUseCard({
  card,
  pooled,
}: {
  card: FuelUseCardModel;
  /** "Use and lap time", pooled over the sessions the plan reads; composed by the route. */
  pooled?: ReactNode;
}) {
  const {color} = useTheme();
  const router = useRouter();
  const {fuelUse: fu} = card;
  const table = stintFuelTable(fu);
  const presets = useFuelPresets(s => s.presets);
  const activeId = useFuelPresets(s => s.activeId);
  const length = useFuelPresets(s => s.length);
  const preset = presets.find(p => p.id === activeId) ?? null;
  const planLimitL = preset?.fuelL ?? null;
  const race = planRaceText(
    fu,
    length,
    `${length.value} ${length.kind === 'min' ? 'min' : 'laps'}`,
    planLimitL,
  );
  const limit = limitText(fu);
  return (
    <View style={styles.card}>
      <View style={styles.title}>
        <Text variant='label'>Fuel use</Text>
        {table.against ? (
          <Text variant='dataSmall' tone='textMuted'>
            {table.against}
          </Text>
        ) : null}
      </View>
      <View
        style={[styles.row, styles.headRow, {borderColor: color.lineStrong}]}>
        <View style={styles.stint} />
        {table.endHead != null ? (
          <Head label={table.endHead} flex={END_FLEX} />
        ) : null}
        <Head label={table.useHead} flex={USE_FLEX} />
        <Head label={table.coastHead} flex={USE_FLEX} />
        <Head label={table.timeHead} flex={TIME_FLEX} />
      </View>
      {table.rows.map(r => (
        <View key={r.key} style={[styles.row, {borderColor: color.line}]}>
          <View style={styles.stint}>
            <Text variant='bodyStrong'>{r.stint.value}</Text>
            <Text variant='dataSmall' tone='textMuted'>
              {r.stint.note}
            </Text>
          </View>
          {r.end ? <Cell cell={r.end} flex={END_FLEX} /> : null}
          <Cell cell={r.use} flex={USE_FLEX} />
          <Cell cell={r.coast} flex={USE_FLEX} />
          <Cell cell={r.time} flex={TIME_FLEX} />
        </View>
      ))}
      {limit ? (
        <Text variant='dataSmall' tone='textMuted'>
          {limit}
        </Text>
      ) : null}
      {race ? (
        <Text variant='dataSmall' tone='textMuted'>
          {race}
        </Text>
      ) : null}
      {pooled}
      <Pressable
        accessibilityRole='link'
        onPress={() => router.push(planHref(card.planKey))}
        style={styles.link}>
        <Text variant='dataSmall' tone='accentInk'>
          {planLinkText(card.greenLaps, card.planLabel, fu.limitL, planLimitL)}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {gap: space.xs},
  title: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  row: {
    flexDirection: 'row',
    gap: space.xs,
    paddingVertical: space.md,
    borderTopWidth: 1,
  },
  headRow: {paddingVertical: space.sm},
  stint: {width: 56},
  link: {minHeight: 44, justifyContent: 'center'},
});
