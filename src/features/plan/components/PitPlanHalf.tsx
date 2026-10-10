import {useMemo} from 'react';
import {StyleSheet, View} from 'react-native';

import {planRace, type RaceFacts, usage} from '@/src/analysis/fuelPlan';
import {useSessions} from '@/src/data/sessions';
import {size, space, useTheme} from '@/src/design';
import {type PitCard} from '@/src/features/session/pitCard';
import {Text} from '@/src/ui';

import {formationBurnOf} from '../formation';
import {planCombos} from '../model';
import {seriesWeek} from '../planEvent';
import {buildPlanHalf, type PlanHalf} from '../planHalf';
import {raceRules} from '../planVsRace';
import {usePlanHistory, usePlanLimits} from '../usePlanHistory';

// Every session he has driven, like the Plan screen's.
const ALL_TIME_DAYS = 3650;

/**
 * "Plan vs what happened", the lower half of the Pit stops card (round 5 item
 * 3, pit-wall thread 43). It reads the history through the Plan screen's own
 * hooks, from the sessions before this race only, so the two never disagree.
 */
export function PitPlanHalf({card, facts}: {card: PitCard; facts: RaceFacts}) {
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
  // The race's own event: the sessions before it in its series week, whose
  // ratio the plan takes.
  const week = seriesWeek(facts.startedAt);
  const eventIds =
    prior?.sessions
      .filter(s => seriesWeek(s.startedAt) === week)
      .map(s => s.id) ?? null;
  const hist = usePlanHistory(
    prior,
    limits.limitsL,
    facts.limitL,
    null,
    eventIds,
  );
  const laps = hist.chosen.laps;
  // The formation lap burns what the driver's earlier races say.
  const baseRules = raceRules(facts);
  const rules = baseRules && {
    ...baseRules,
    formationFactor: formationBurnOf(
      hist.formationBurnsL,
      usage(laps.map(l => l.fuelL))?.median ?? null,
    ).factor,
  };
  const plan = rules && laps.length > 0 ? planRace(rules, laps) : null;

  const loading = sessions.isPending || limits.pending || hist.loading.pending;
  const half = loading
    ? null
    : buildPlanHalf({
        facts,
        plan,
        rules,
        basis: {
          laps: laps.length,
          sessions: hist.usedSessions.length,
          since:
            hist.usedSessions.length > 0
              ? hist.usedSessions[hist.usedSessions.length - 1].startedAt
              : null,
        },
        hasVe: card.hasVe,
        stops: card.actual.stops,
        end: card.actual.end,
      });
  return <PlanHalfView half={half} failed={hist.loading.failed} />;
}

/** The half itself, from finished rows: Plan in secondary ink, Actual at full ink. */
export function PlanHalfView({
  half,
  failed = false,
}: {
  /** Null while the earlier laps load. */
  half: PlanHalf | null;
  failed?: boolean;
}) {
  const {color} = useTheme();
  return (
    <View style={styles.card}>
      <View style={styles.title}>
        <Text variant='label'>Plan vs what happened</Text>
      </View>
      {half ? (
        <>
          {half.note ? (
            <Text variant='dataSmall' tone='textMuted'>
              {half.note}
            </Text>
          ) : null}
          {half.rows.length > 0 ? (
            <View>
              <View style={styles.row}>
                <View style={{width: size.pitPlanKey}} />
                <Text variant='label' tone='textMuted' style={styles.cell}>
                  Plan
                </Text>
                <Text variant='label' tone='textMuted' style={styles.cell}>
                  Actual
                </Text>
              </View>
              {half.rows.map((r, i) => (
                <View
                  key={`${r.k}-${i}`}
                  style={[styles.row, styles.body, {borderColor: color.line}]}>
                  <Text
                    variant='label'
                    tone='textMuted'
                    style={{width: size.pitPlanKey}}>
                    {r.k}
                  </Text>
                  <Text
                    variant='dataSmall'
                    tone='textSecondary'
                    style={styles.cell}>
                    {r.p}
                  </Text>
                  <Text variant='dataSmall' style={styles.cell}>
                    {r.a}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </>
      ) : (
        <Text variant='dataSmall' tone='textMuted'>
          Loading the earlier laps…
        </Text>
      )}
      {failed ? (
        <Text variant='dataSmall' tone='textMuted'>
          {'The earlier sessions did not load; the plan has no history.'}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {gap: space.xs},
  title: {flexDirection: 'row', alignItems: 'center', gap: space.sm},
  row: {flexDirection: 'row', gap: space.sm},
  body: {paddingVertical: space.sm, borderTopWidth: 1},
  cell: {flex: 1},
});
