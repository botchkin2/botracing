import {useRouter} from 'expo-router';
import {Fragment, useMemo, useState} from 'react';
import {type GestureResponderEvent, StyleSheet, View} from 'react-native';
import {Circle, Line} from 'react-native-svg';

import {ChartLabel, ChartSvg} from '@/src/charts/ChartLabel';
import {baselineUnder} from '@/src/charts/labelBox';
import {carLabel} from '@/src/design/carModels';
import {formatDayMonth} from '@/src/design/format';
import {radius, size, space, type as typeScale, useTheme} from '@/src/design';
import {sessionDayHref, sessionHref} from '@/src/nav/routes';
import {Chip, Pressable, Skeleton, Text} from '@/src/ui';
import {type Combo} from '@/src/workspace/planCombo';

import {usePlanRows} from '../../plan/usePlanHistory';
import {
  dotLine,
  nearestDot,
  type PlacedDot,
  placeLanes,
  progressionLanes,
} from '../progression';

// S5 (pit wall thread 88, chord #6056): the median and p10-p90 of every set
// he drove here in one car, one lane per session type. Reads the Plan's one
// /plan request, so it costs nothing the Plan card has not already fetched.

const LANE_H = 56;
const LABEL_W = 16;
const PAD = 8;
const DOT_R = 4;

export function ProgressionCard({
  combos,
  width,
}: {
  combos: Combo[];
  width: number;
}) {
  const [key, setKey] = useState<string | null>(null);
  const combo = combos.find(c => c.key === key) ?? combos[0] ?? null;
  if (!combo) return null;
  return (
    <View style={styles.block}>
      <Text variant='label'>Progression</Text>
      {combos.length > 1 ? (
        <View style={styles.chips}>
          {combos.map(c => (
            <Chip
              key={c.key}
              label={carLabel(c.sessions[0].car).shortModel}
              selected={c.key === combo.key}
              onPress={() => setKey(c.key)}
            />
          ))}
        </View>
      ) : null}
      <Lanes key={combo.key} combo={combo} width={width} />
    </View>
  );
}

function Lanes({combo, width}: {combo: Combo; width: number}) {
  const {color} = useTheme();
  const router = useRouter();
  const rows = usePlanRows(combo);
  const [picked, setPicked] = useState<PlacedDot | null>(null);
  const plotW = width - LABEL_W;
  const placed = useMemo(() => {
    const lanes = progressionLanes([...rows.byId.values()]);
    return lanes.length > 0 ? placeLanes(lanes, plotW, LANE_H, PAD) : [];
  }, [rows.byId, plotW]);

  if (rows.pending) return <Skeleton height={LANE_H * 2} />;
  if (placed.length === 0) return null;
  const all = placed.flatMap(l => l.dots);
  const first = all.reduce((a, b) => (a.x <= b.x ? a : b));
  const last = all.reduce((a, b) => (a.x >= b.x ? a : b));
  const open = (d: PlacedDot) =>
    router.push(
      d.dot.ids.length > 1
        ? sessionDayHref(d.dot.ids[d.dot.ids.length - 1])
        : sessionHref(d.dot.ids[0]),
    );

  return (
    <View style={[styles.card, {backgroundColor: color.surface}]}>
      {placed.map(lane => (
        <View
          key={lane.type}
          style={[styles.lane, {borderColor: color.line, height: LANE_H}]}>
          <ChartSvg width={width} height={LANE_H}>
            <ChartLabel
              x={0}
              y={baselineUnder(PAD - 2, typeScale.axis.fontSize)}
              fill={color.textFaint}>
              {lane.type}
            </ChartLabel>
            {lane.dots.map(p => {
              const on = picked?.dot === p.dot;
              const ink = on ? color.accent : color.textSecondary;
              const x = LABEL_W + p.x;
              return (
                <Fragment key={p.dot.ids[0]}>
                  {p.y10 != null && p.y90 != null ? (
                    <Line
                      x1={x}
                      x2={x}
                      y1={p.y10}
                      y2={p.y90}
                      stroke={ink}
                      strokeWidth={1}
                    />
                  ) : null}
                  <Circle
                    cx={x}
                    cy={p.y}
                    r={DOT_R}
                    fill={p.y10 != null ? ink : color.surface}
                    stroke={ink}
                    strokeWidth={1.5}
                  />
                </Fragment>
              );
            })}
          </ChartSvg>
          <Pressable
            accessibilityRole='button'
            accessibilityLabel={`${lane.type} sets`}
            onPress={(e: GestureResponderEvent) =>
              setPicked(nearestDot(lane.dots, e.nativeEvent.locationX - LABEL_W))
            }
            style={[StyleSheet.absoluteFill, {left: LABEL_W}]}
          />
        </View>
      ))}
      <View style={[styles.axis, {paddingLeft: LABEL_W}]}>
        <Text variant='axis' tone='textFaint'>
          {formatDayMonth(first.dot.startedAt)}
        </Text>
        {last !== first ? (
          <Text variant='axis' tone='textFaint'>
            {formatDayMonth(last.dot.startedAt)}
          </Text>
        ) : null}
      </View>
      {picked ? (
        <Pressable
          accessibilityRole='link'
          onPress={() => open(picked)}
          style={styles.picked}>
          <Text variant='dataSmall' numberOfLines={1} style={styles.fill}>
            {dotLine(picked.dot)}
          </Text>
          <Text variant='body' tone='accentInk'>
            ›
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: {gap: space.md},
  chips: {flexDirection: 'row', flexWrap: 'wrap', gap: space.sm},
  card: {borderRadius: radius.xs, paddingVertical: space.xs},
  lane: {borderBottomWidth: StyleSheet.hairlineWidth},
  axis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: space.xxs,
  },
  picked: {
    minHeight: size.hit,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.xs,
  },
  fill: {flex: 1, minWidth: 0},
});
