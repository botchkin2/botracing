import {useRouter} from 'expo-router';
import {type ReactNode} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';

import {space, useTheme} from '@/src/design';
import {planHref} from '@/src/nav/routes';
import {useFuelPresets} from '@/src/state/fuelPresets';
import {Explainer, Text, useHowToRead} from '@/src/ui';

import {
  FUEL_USE_HELP,
  fuelUseRows,
  limitText,
  planLinkText,
  planMatchesLimit,
  planRaceText,
  verdictText,
} from '../fuelUse';
import {type FuelUseCardModel} from '../model';

/**
 * The practice fuel card (pit-wall thread 36): one row per stint, the laps as
 * a scatter, and the plan these laps belong to. Numbers only; when the stints
 * do not differ it says so and marks no median.
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
  const help = useHowToRead('fuel use', FUEL_USE_HELP);
  const {fuelUse: fu} = card;
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
  // These laps are in the plan's history only when its rules run at this fill limit.
  const inPlan = planMatchesLimit(fu.limitL, planLimitL ?? fu.limitL);
  return (
    <View style={styles.card}>
      <View style={styles.title}>
        <Text variant='label'>Fuel use</Text>
        {help.button}
      </View>
      <Explainer>Fuel and VE used per lap, stint by stint.</Explainer>
      {help.panel}
      <Text variant='dataSmall' tone='textSecondary'>
        {verdictText(fu)}
      </Text>
      {rows.map(r => (
        <View key={r.key} style={[styles.row, {borderColor: color.line}]}>
          <Text variant='bodyStrong'>{r.title}</Text>
          {r.lines.map(line => (
            <Text key={line} variant='dataSmall' tone='textSecondary'>
              {line}
            </Text>
          ))}
          {r.counts && inPlan ? (
            <Pressable
              accessibilityRole='link'
              onPress={() => router.push(planHref(card.planKey))}
              style={styles.link}>
              <Text variant='dataSmall' tone='accentInk'>
                in Plan →
              </Text>
            </Pressable>
          ) : null}
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
  title: {flexDirection: 'row', alignItems: 'center', gap: space.sm},
  row: {gap: space.xxs, paddingVertical: space.md, borderTopWidth: 1},
  link: {minHeight: 44, justifyContent: 'center'},
});
