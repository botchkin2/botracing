import {useRouter} from 'expo-router';
import {Pressable, StyleSheet, View} from 'react-native';

import {radius, size, space, useTheme} from '@/src/design';
import {planHref} from '@/src/nav/routes';
import {useFuelPresets} from '@/src/state/fuelPresets';
import {Explainer, Skeleton, Text} from '@/src/ui';

import {type Combo, rulesFor} from '../../plan/model';
import {usePlanHistory, usePlanLimits} from '../../plan/usePlanHistory';
import {planCardModel} from '../planCards';

// Round 5, item 4: the Plan block above the session list, one card per car
// driven at this track. It reads the laps through the same hooks as the Plan
// screen, with the active preset and length, so the numbers here are the ones
// the plan starts from.

/** One card per car driven on this layout; nothing when there are none. */
export function PlanBlock({combos}: {combos: Combo[]}) {
  if (combos.length === 0) return null;
  return (
    <View style={styles.block}>
      <Text variant='label'>Plan</Text>
      <Explainer>One per car driven here.</Explainer>
      {combos.map(combo => (
        <PlanCard key={combo.key} combo={combo} />
      ))}
    </View>
  );
}

function PlanCard({combo}: {combo: Combo}) {
  const {color} = useTheme();
  const router = useRouter();
  const {lastFuel, pending, limitsL} = usePlanLimits(combo);
  const presets = useFuelPresets(s => s.presets);
  const activeId = useFuelPresets(s => s.activeId);
  const length = useFuelPresets(s => s.length);
  const preset = presets.find(p => p.id === activeId) ?? null;
  const rules = rulesFor(preset, length, lastFuel);
  const {chosen, lapsOf} = usePlanHistory(
    combo,
    limitsL,
    rules?.rules.fuelL ?? null,
    preset,
  );
  // The rules need the last session's fuel, and the laps need the sessions.
  const loading = pending || (rules != null && lapsOf.pending);
  if (loading) return <Skeleton height={size.sessionRow} />;
  const card = planCardModel(combo, chosen.laps);
  return (
    <Pressable
      accessibilityRole='link'
      accessibilityLabel={`Plan for ${card.car}`}
      onPress={() => router.push(planHref(card.key))}
      style={({pressed}) => [
        styles.card,
        {
          borderColor: color.line,
          backgroundColor: pressed ? color.surfaceRaised : color.surface,
        },
      ]}>
      <View style={styles.head}>
        <Text variant='bodyStrong' numberOfLines={1} style={styles.car}>
          {card.car}
        </Text>
        <Text variant='bodyStrong' tone='accentInk'>
          Plan →
        </Text>
      </View>
      <Text variant='dataSmall' tone='textSecondary'>
        {card.last}
      </Text>
      <Text variant='dataSmall' tone={card.use ? 'textSecondary' : 'textMuted'}>
        {card.use ?? 'No green laps to plan from yet'}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  block: {gap: space.md},
  card: {
    minHeight: size.hit,
    gap: space.xs,
    padding: space.lg,
    borderWidth: 1,
    borderRadius: radius.md,
  },
  head: {flexDirection: 'row', alignItems: 'center', gap: space.md},
  car: {flex: 1},
});
