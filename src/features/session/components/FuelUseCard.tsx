import {useRouter} from 'expo-router';
import {Pressable, StyleSheet, View} from 'react-native';

import {FuelScatter} from '@/src/charts';
import {space, useTheme} from '@/src/design';
import {planHref} from '@/src/nav/routes';
import {useFuelPresets} from '@/src/state/fuelPresets';
import {Explainer, Text, useHowToRead} from '@/src/ui';

import {
  FUEL_USE_HELP,
  fuelScatter,
  fuelUseRows,
  limitText,
  planLinkText,
  planRaceText,
  verdictText,
} from '../fuelUse';
import {type FuelUseCardModel} from '../model';

const X_TITLE = 'Fuel used per lap, L (the axis does not start at zero)';
const SCATTER_H = 190;

/**
 * The practice fuel card (pit-wall thread 36): one row per stint, the laps as
 * a scatter, and the plan these laps belong to. Numbers only; when the stints
 * do not differ it says so and marks no median.
 */
export function FuelUseCard({
  card,
  width,
}: {
  card: FuelUseCardModel;
  width: number;
}) {
  const {color} = useTheme();
  const router = useRouter();
  const help = useHowToRead('fuel use', FUEL_USE_HELP);
  const {fuelUse: fu} = card;
  const scatter = fuelScatter(fu);
  const rows = fuelUseRows(fu);
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
        {help.button}
      </View>
      <Explainer>
        Fuel used per lap against lap time, one dot per green lap.
      </Explainer>
      {help.panel}
      <Text variant='dataSmall' tone='textSecondary'>
        {verdictText(fu)}
      </Text>
      <FuelScatter
        width={width}
        height={SCATTER_H}
        points={scatter.points}
        medians={scatter.medians}
        xDomain={scatter.xDomain}
        yDomain={scatter.yDomain}
        xTicks={scatter.xTicks}
        yTicks={scatter.yTicks}
        xTitle={X_TITLE}
      />
      {rows.map(r => (
        <View key={r.key} style={[styles.row, {borderColor: color.line}]}>
          <Text variant='bodyStrong'>{r.title}</Text>
          {r.lines.map(line => (
            <Text key={line} variant='dataSmall' tone='textSecondary'>
              {line}
            </Text>
          ))}
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
  title: {flexDirection: 'row', alignItems: 'center', gap: space.sm},
  row: {gap: space.xxs, paddingVertical: space.md, borderTopWidth: 1},
  link: {minHeight: 44, justifyContent: 'center'},
});
