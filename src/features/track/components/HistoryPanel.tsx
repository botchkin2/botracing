import {Pressable, StyleSheet, View} from 'react-native';
import Svg, {Rect} from 'react-native-svg';

import {radius, size, space, useTheme} from '@/src/design';
import {Text} from '@/src/ui';

import {type HistoryModel} from '../history';

// "Your history here" (handoff T1 column 3, phone 05): best lap by car,
// one car's session bests, cars driven.
export function HistoryPanel({
  history,
  width,
  compact,
  onOpenSession,
}: {
  history: HistoryModel;
  width: number;
  /** Desktop row heights; the phone uses 54 and 32 pt rows. */
  compact: boolean;
  onOpenSession: (sessionId: string) => void;
}) {
  const {color} = useTheme();
  const bestH = compact ? size.hit : size.sessionRow;
  const carH = compact ? CAR_ROW_DESK : size.lapRow;
  const trend = history.trend;
  return (
    <View style={styles.col}>
      <View style={styles.block}>
        <Text variant='label'>Your history here</Text>
        <View style={styles.stats}>
          {history.stats.map(s => (
            <View key={s.label}>
              <Text variant='tableHeader' tone='textMuted'>
                {s.label}
              </Text>
              <Text variant='factValue'>{s.value}</Text>
            </View>
          ))}
        </View>
      </View>

      {history.bests.length > 0 ? (
        <View>
          <Text variant='label'>Best lap by car</Text>
          {history.bests.map(b => (
            <Pressable
              key={b.key}
              accessibilityRole='link'
              onPress={() => onOpenSession(b.sessionId)}
              style={({pressed}) => [
                styles.best,
                {minHeight: bestH, borderColor: color.line},
                pressed && {backgroundColor: color.surfaceRaised},
              ]}>
              <View style={styles.bestText}>
                {b.carClass ? (
                  <Text variant='tableHeader' tone='textSecondary'>
                    {b.carClass}
                  </Text>
                ) : null}
                <Text variant='dataSmall' tone='textMuted' numberOfLines={1}>
                  {b.car} · {b.date}
                </Text>
              </View>
              <Text variant='dataStrong' tone='best'>
                {b.time}
              </Text>
              <Text variant='body' tone='textFaint'>
                ›
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {trend ? (
        <View>
          <Text variant='label'>{trend.title}</Text>
          <View
            style={[
              styles.trend,
              {width, height: size.trendHeight, backgroundColor: color.surface},
            ]}>
            <Text variant='axis' tone='textFaint' style={styles.trendTop}>
              {trend.fastest}
            </Text>
            <Text variant='axis' tone='textFaint' style={styles.trendBottom}>
              {trend.floor}
            </Text>
            <Svg width={width} height={size.trendHeight}>
              {trend.bars.map((b, i) => {
                const bw = width / trend.bars.length;
                const h =
                  TREND_MIN_H + b.height01 * (size.trendHeight - TREND_MIN_H);
                return (
                  <Rect
                    key={i}
                    x={i * bw + BAR_GAP / 2}
                    y={size.trendHeight - h}
                    width={Math.max(1, bw - BAR_GAP)}
                    height={h}
                    fill={b.best ? color.best : color.barNeutral}
                  />
                );
              })}
            </Svg>
          </View>
          <View style={styles.trendAxis}>
            <Text variant='axis' tone='textFaint'>
              {trend.from}
            </Text>
            <Text variant='axis' tone='textFaint'>
              {trend.to}
            </Text>
          </View>
        </View>
      ) : null}

      <View>
        <Text variant='label'>Cars driven</Text>
        {history.cars.map(c => (
          <View
            key={c.name}
            style={[styles.car, {height: carH, borderColor: color.line}]}>
            <Text variant='body' numberOfLines={1} style={styles.carName}>
              {c.name}
            </Text>
            <Text variant='dataSmall' tone='textMuted'>
              {c.laps}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

// From the handoff mock: 8 pt minimum bar, 6 pt gaps, 26 pt car rows.
const TREND_MIN_H = 8;
const BAR_GAP = 6;
const CAR_ROW_DESK = 26;

const styles = StyleSheet.create({
  col: {gap: space.xl + space.xs},
  block: {gap: space.md},
  stats: {flexDirection: 'row', gap: space.xxl},
  best: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderBottomWidth: 1,
    paddingVertical: space.sm,
  },
  bestText: {flex: 1, minWidth: 0},
  trend: {borderRadius: radius.xs, overflow: 'hidden', marginTop: space.sm},
  trendTop: {position: 'absolute', left: space.xs, top: space.xxs},
  trendBottom: {position: 'absolute', left: space.xs, bottom: space.xxs},
  trendAxis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: space.xxs,
  },
  car: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    borderBottomWidth: 1,
  },
  carName: {flex: 1, minWidth: 0},
});
