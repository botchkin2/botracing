import {useMemo} from 'react';
import {StyleSheet, View} from 'react-native';

import {planRace, type RaceFacts} from '@/src/analysis/fuelPlan';
import {useSessions} from '@/src/data/sessions';
import {space, useTheme} from '@/src/design';
import {Explainer, Text, useHowToRead} from '@/src/ui';

import {planCombos} from '../model';
import {buildPlanVsRace, PLAN_VS_RACE_HELP, raceRules} from '../planVsRace';
import {usePlanHistory, usePlanLimits} from '../usePlanHistory';

// Every session he has driven, like the Plan screen's.
const ALL_TIME_DAYS = 3650;

/**
 * The planner against this race (pit-wall thread 42). It reads the history
 * through the Plan screen's own hooks, from the sessions before this race
 * only, so the two never disagree.
 */
export function PlanVsRaceCard({facts}: {facts: RaceFacts}) {
  const {color} = useTheme();
  const help = useHowToRead('plan vs what happened', PLAN_VS_RACE_HELP);
  const sessions = useSessions({ageDays: ALL_TIME_DAYS});
  // The track+car's sessions strictly before this race started.
  const prior = useMemo(() => {
    const combo = planCombos(sessions.data?.items ?? []).find(
      c => c.key === facts.planKey,
    );
    return combo
      ? {
          ...combo,
          sessions: combo.sessions.filter(s => s.startedAt < facts.startedAt),
        }
      : null;
  }, [sessions.data, facts.planKey, facts.startedAt]);
  const limits = usePlanLimits(prior);
  const hist = usePlanHistory(prior, limits.limitsL, facts.limitL, null);
  const rules = raceRules(facts);
  const laps = hist.chosen.laps;
  const plan = rules && laps.length > 0 ? planRace(rules, laps) : null;

  const loading = sessions.isPending || limits.pending || hist.lapsOf.pending;
  const view = loading
    ? null
    : buildPlanVsRace(facts, plan, {
        laps: laps.length,
        sessions: hist.usedSessions.length,
        since:
          hist.usedSessions.length > 0
            ? hist.usedSessions[hist.usedSessions.length - 1].startedAt
            : null,
      });
  return (
    <View style={styles.card}>
      <View style={styles.title}>
        <Text variant='label'>Plan vs what happened</Text>
        {help.button}
      </View>
      <Explainer>The planner, given only laps from before this race.</Explainer>
      {help.panel}
      {view ? (
        view.lines.map(line => (
          <Text
            key={line}
            variant='dataSmall'
            tone='textSecondary'
            style={[styles.line, {borderColor: color.line}]}>
            {line}
          </Text>
        ))
      ) : (
        <Text variant='dataSmall' tone='textMuted'>
          Loading the earlier laps…
        </Text>
      )}
      {hist.lapsOf.failed > 0 ? (
        <Text variant='dataSmall' tone='textMuted'>
          {`${hist.lapsOf.failed} earlier sessions did not load; the plan uses the rest.`}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {gap: space.xs},
  title: {flexDirection: 'row', alignItems: 'center', gap: space.sm},
  line: {paddingTop: space.xs},
});
