import {StyleSheet, View} from 'react-native';

import {radius, size, space, useTheme} from '@/src/design';
import {Skeleton, Text} from '@/src/ui';

import {
  type ClassTiming,
  NO_FASTER_TEXT,
  NO_FIELD_TEXT,
  NO_LAPS_TEXT,
  type ReadyClassTiming,
} from '../classTiming';

import {type StopWindow} from '../planCards';

import {PlanCard} from './PlanCard';
import {RaceTimelineView} from './RaceTimelineView';

const TIMELINE_EXPLAINER =
  'Your stints, and the laps when cars of each faster class, at its median lap, reach you. Each band is a range, and the bands widen with each pass. The first pass assumes a level start; a faster class that starts ahead needs less than a lap to catch you. Each band runs from the class p10 to its p90 lap.';
const TIMELINE_KEY =
  'Amber box = pit window, amber line = planned stop, thin grey tick = where the tank runs out at your median use. Stops are planned at p90 use per lap (the heavier 10 % of your laps), and both ends of a window use it, so the window is the safe one: earliest = the first lap after which the remaining stints still reach the end, latest = the last lap the tank covers. Each window assumes the earlier stops at plan. Amber dashes through the class lanes = the planned stops. White tick = class estimate, grey band = range. Staggered starts, grid order and traffic are not modelled.';
const FASTER_EXPLAINER =
  'Gain = your median lap − theirs. First is the range of laps from their p10 to their p90 lap; Every is their median lap ÷ gain, in your laps.';
const YOURS_EXPLAINER =
  'Median green lap of all cars of your class in the sessions here, and yours.';

/**
 * Class timing on the Plan (round 6, section 2), under Race: the timeline, the
 * Faster classes table and Your class, from other cars' laps. `timing` is null
 * while the sessions load. Every sentence and number is finished in the model.
 */
export function ClassTimingSection({
  timing,
  windows,
  windowNote,
  width,
}: {
  timing: ClassTiming | null;
  /** The pit window of each planned stop (the Stops card reads the same ones). */
  windows: StopWindow[];
  windowNote: string | null;
  /** The width a card's content may use. */
  width: number;
}) {
  if (timing == null) return <Skeleton height={size.sessionRow} />;
  if (timing.kind !== 'ready')
    return (
      <PlanCard title='Faster classes'>
        <Text variant='dataSmall' tone='textMuted'>
          {timing.kind === 'no-field' ? NO_FIELD_TEXT : NO_LAPS_TEXT}
        </Text>
      </PlanCard>
    );
  return (
    <>
      {timing.raceLaps != null &&
      (timing.faster.some(c => c.estimate) || windows.length > 0) ? (
        <PlanCard title='Race timeline' explainer={TIMELINE_KEY}>
          <EstimateBadge />
          <Text variant='dataSmall' tone='textSecondary'>
            {TIMELINE_EXPLAINER}
          </Text>
          <RaceTimelineView timing={timing} windows={windows} width={width} />
          {windows.map(w => (
            <Text key={w.stop} variant='dataSmall' tone='textSecondary'>
              {w.text}
            </Text>
          ))}
          {windowNote ? (
            <Text variant='dataSmall' tone='textMuted'>
              {windowNote}
            </Text>
          ) : null}
        </PlanCard>
      ) : null}
      <FasterClasses timing={timing} />
      {timing.yours ? <YourClass yours={timing.yours} /> : null}
    </>
  );
}

function EstimateBadge() {
  const {color} = useTheme();
  return (
    <View style={[styles.badge, {borderColor: color.lineStrong}]}>
      <Text variant='tableHeader' tone='textMuted'>
        ESTIMATE
      </Text>
    </View>
  );
}

function FasterClasses({timing}: {timing: ReadyClassTiming}) {
  const {color} = useTheme();
  return (
    <PlanCard title='Faster classes' explainer={FASTER_EXPLAINER}>
      {timing.noFaster ? (
        <Text variant='dataSmall' tone='textMuted'>
          {NO_FASTER_TEXT}
        </Text>
      ) : (
        <View>
          <View style={styles.row}>
            {['Class', 'Lap', 'Gain', 'First', 'Every'].map(h => (
              <Text
                key={h}
                variant='tableHeader'
                tone='textMuted'
                style={h === 'Class' ? styles.name : styles.cell}>
                {h}
              </Text>
            ))}
          </View>
          {timing.faster.map(c => (
            <View
              key={c.key}
              style={[styles.classBox, {borderColor: color.line}]}>
              {c.estimate ? (
                <View style={styles.row}>
                  <Text variant='bodyStrong' style={styles.name}>
                    {c.label}
                  </Text>
                  <Text variant='dataStrong' style={styles.cell}>
                    {c.estimate.lapText}
                  </Text>
                  <Text variant='dataStrong' style={styles.cell}>
                    {c.estimate.gainText}
                  </Text>
                  <Text variant='dataStrong' style={styles.cell}>
                    {c.estimate.firstText}
                  </Text>
                  <Text variant='dataStrong' style={styles.cell}>
                    {c.estimate.everyText}
                  </Text>
                </View>
              ) : (
                <Text variant='bodyStrong'>{c.label}</Text>
              )}
              <Text variant='dataSmall' tone='textMuted'>
                {c.estimate ? `${c.text} · ${c.estimate.firstNote}` : c.text}
              </Text>
            </View>
          ))}
        </View>
      )}
    </PlanCard>
  );
}

function YourClass({yours}: {yours: NonNullable<ReadyClassTiming['yours']>}) {
  return (
    <PlanCard title='Your class, for context' explainer={YOURS_EXPLAINER}>
      <View style={styles.pair}>
        <Text variant='bodyStrong' style={styles.name}>
          {yours.name}
        </Text>
        <Text variant='dataStrong'>{yours.classText}</Text>
        <Text variant='dataSmall' tone='textMuted'>
          {yours.classSrc}
        </Text>
      </View>
      <View style={styles.pair}>
        <Text variant='bodyStrong' style={styles.name}>
          You
        </Text>
        <Text variant='dataStrong'>{yours.youText}</Text>
        <Text variant='dataSmall' tone='textMuted'>
          {yours.youSrc}
        </Text>
      </View>
    </PlanCard>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: space.sm,
    paddingVertical: space.xxs,
  },
  row: {flexDirection: 'row', alignItems: 'center', gap: space.sm},
  name: {flex: 1.2},
  cell: {flex: 1},
  classBox: {gap: space.xs, paddingVertical: space.md, borderTopWidth: 1},
  pair: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: space.md,
    flexWrap: 'wrap',
  },
});
