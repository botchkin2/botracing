import {useMemo, useState} from 'react';
import {StyleSheet, View} from 'react-native';

import {FuelScatter} from '@/src/charts';
import {useSessions} from '@/src/data/sessions';
import {space} from '@/src/design';
import {Segment, Skeleton, Text} from '@/src/ui';

import {planCombos} from '../model';
import {pooledUse, thresholdOf, type UseMeasure} from '../pooledUse';
import {usePlanData} from '../usePlanData';

// Every session he has driven, like the Plan screen's.
const ALL_TIME_DAYS = 3650;
const SCATTER_H = 190;
const MEASURES = [
  {value: 'fuel', label: 'Fuel'},
  {value: 've', label: 'VE'},
] as const;
const Y_TITLE = 'Lap time, faster ↑';

/**
 * "Use and lap time" on the practice Session screen (round 5, item 4): the
 * green laps the plan reads for this track and car, all sessions pooled, with
 * a Fuel / VE switch and the plan's "to drop a stop" line. It reads them
 * through the Plan screen's own hooks, at the active rules, so the dots are
 * the laps the plan is built from.
 */
export function PooledUseCard({
  planKey,
  sessionId,
  width,
  measure: asked,
}: {
  planKey: string;
  sessionId: string;
  width: number;
  /** The Plan's own unit switch drives the card: the card's Fuel / VE switch is then not drawn. */
  measure?: UseMeasure;
}) {
  const [own, setMeasure] = useState<UseMeasure>('fuel');
  const measure = asked ?? own;
  const sessions = useSessions({ageDays: ALL_TIME_DAYS});
  const combo = useMemo(
    () =>
      planCombos(sessions.data?.items ?? []).find(c => c.key === planKey) ??
      null,
    [sessions.data, planKey],
  );
  // The Plan screen's own data, so the dots are the laps the plan is built from.
  const {limits, hist, greenLaps, plan} = usePlanData(combo);
  const loading = sessions.isPending || limits.pending || hist.lapsOf.pending;
  const chart = useMemo(
    () =>
      pooledUse(
        greenLaps,
        sessionId,
        measure,
        thresholdOf(plan?.dropStop ?? null, measure),
      ),
    [greenLaps, sessionId, measure, plan],
  );
  return (
    <View style={styles.card}>
      <View style={styles.title}>
        <Text variant='label'>Use and lap time</Text>
      </View>
      {asked ? null : (
        <Segment options={MEASURES} value={measure} onChange={setMeasure} />
      )}
      {loading ? (
        <Skeleton height={SCATTER_H} />
      ) : chart ? (
        <>
          <FuelScatter
            width={width}
            height={SCATTER_H}
            points={chart.points}
            xDomain={chart.xDomain}
            yDomain={chart.yDomain}
            xTicks={chart.xTicks}
            yTicks={chart.yTicks}
            xTitle={
              measure === 'fuel' ? 'Fuel used per lap, L' : 'VE used per lap, %'
            }
            yTitle={Y_TITLE}
            refX={chart.threshold}
          />
          <Text variant='dataSmall' tone='textMuted'>
            {chart.thisSession} of {chart.n} laps are from this session.
          </Text>
        </>
      ) : (
        <Text variant='dataSmall' tone='textMuted'>
          {measure === 've' ? 'No VE recorded' : 'No green laps'}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {gap: space.xs},
  title: {flexDirection: 'row', alignItems: 'center', gap: space.sm},
});
