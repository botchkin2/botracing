import {useMemo, useState} from 'react';
import {StyleSheet, View} from 'react-native';

import {planRace} from '@/src/analysis/fuelPlan';
import {FuelScatter} from '@/src/charts';
import {useSessions} from '@/src/data/sessions';
import {space} from '@/src/design';
import {useFuelPresets} from '@/src/state/fuelPresets';
import {Explainer, Segment, Skeleton, Text, useHowToRead} from '@/src/ui';

import {planCombos, rulesFor} from '../model';
import {
  POOLED_USE_HELP,
  pooledUse,
  thresholdOf,
  type UseMeasure,
} from '../pooledUse';
import {usePlanHistory, usePlanLimits} from '../usePlanHistory';

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
}: {
  planKey: string;
  sessionId: string;
  width: number;
}) {
  const [measure, setMeasure] = useState<UseMeasure>('fuel');
  const help = useHowToRead('use and lap time', POOLED_USE_HELP);
  const sessions = useSessions({ageDays: ALL_TIME_DAYS});
  const combo = useMemo(
    () =>
      planCombos(sessions.data?.items ?? []).find(c => c.key === planKey) ??
      null,
    [sessions.data, planKey],
  );
  const {lastFuel, pending, limitsL} = usePlanLimits(combo);
  const presets = useFuelPresets(s => s.presets);
  const activeId = useFuelPresets(s => s.activeId);
  const length = useFuelPresets(s => s.length);
  const preset = presets.find(p => p.id === activeId) ?? null;
  const rules = rulesFor(preset, length, lastFuel);
  const hist = usePlanHistory(
    combo,
    limitsL,
    rules?.rules.fuelL ?? null,
    preset,
  );
  const laps = hist.chosen.laps;
  const drop = useMemo(
    () =>
      rules && laps.length > 0 ? planRace(rules.rules, laps).dropStop : null,
    [rules, laps],
  );
  const loading =
    sessions.isPending || pending || (rules != null && hist.lapsOf.pending);
  const chart = useMemo(
    () => pooledUse(laps, sessionId, measure, thresholdOf(drop, measure)),
    [laps, sessionId, measure, drop],
  );
  return (
    <View style={styles.card}>
      <View style={styles.title}>
        <Text variant='label'>Use and lap time</Text>
        {help.button}
      </View>
      <Explainer>
        One dot per green lap here in this car, all sessions. Right = more used
        per lap. Up = faster lap.
      </Explainer>
      {help.panel}
      <Segment options={MEASURES} value={measure} onChange={setMeasure} />
      {loading ? (
        <Skeleton height={SCATTER_H} />
      ) : chart ? (
        <>
          <FuelScatter
            width={width}
            height={SCATTER_H}
            points={chart.points}
            medians={[]}
            xDomain={chart.xDomain}
            yDomain={chart.yDomain}
            xTicks={chart.xTicks}
            yTicks={chart.yTicks}
            xTitle={
              measure === 'fuel'
                ? 'Fuel used per lap, L (the axis does not start at zero)'
                : 'VE used per lap, % (the axis does not start at zero)'
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
          {measure === 've'
            ? 'No green laps here recorded Virtual Energy.'
            : 'No green laps for the plan here yet.'}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {gap: space.xs},
  title: {flexDirection: 'row', alignItems: 'center', gap: space.sm},
});
