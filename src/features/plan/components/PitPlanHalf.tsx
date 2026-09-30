import {useMemo} from 'react';
import {StyleSheet, View} from 'react-native';

import {planRace, type RaceFacts} from '@/src/analysis/fuelPlan';
import {useSessions} from '@/src/data/sessions';
import {size, space, useTheme} from '@/src/design';
import {type PitCard} from '@/src/features/session/pitCard';
import {Explainer, Text, useHowToRead} from '@/src/ui';

import {planCombos} from '../model';
import {buildPlanHalf, PLAN_HALF_HELP, type PlanHalf} from '../planHalf';
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
  const hist = usePlanHistory(prior, limits.limitsL, facts.limitL, null);
  const rules = raceRules(facts);
  const laps = hist.chosen.laps;
  const plan = rules && laps.length > 0 ? planRace(rules, laps) : null;

  const loading = sessions.isPending || limits.pending || hist.lapsOf.pending;
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
  return <PlanHalfView half={half} failed={hist.lapsOf.failed} />;
}

/** The half itself, from finished rows: Plan in secondary ink, Actual at full ink. */
export function PlanHalfView({
  half,
  failed = 0,
}: {
  /** Null while the earlier laps load. */
  half: PlanHalf | null;
  failed?: number;
}) {
  const {color} = useTheme();
  const help = useHowToRead('plan vs what happened', PLAN_HALF_HELP);
  return (
    <View style={styles.card}>
      <View style={styles.title}>
        <Text variant='label'>Plan vs what happened</Text>
        {help.button}
      </View>
      {help.panel}
      {half ? (
        <>
          <Explainer>{half.desc}</Explainer>
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
      {failed > 0 ? (
        <Text variant='dataSmall' tone='textMuted'>
          {`${failed} earlier sessions did not load; the plan uses the rest.`}
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
