import {StyleSheet, View} from 'react-native';

import {radius, space, useTheme} from '@/src/design';
import {Text} from '@/src/ui';

import {type TankCard, type TankMeter} from '../planCards';

const BAR_H = 8;
const NOTCH_W = 2;
const NOTCH_H = 16;

/** Round up to the next 10 laps, so the scale ends on a number. */
function scaleMax(meters: TankMeter[]): number {
  const most = Math.max(...meters.map(m => m.lapsP90 ?? m.lapsMedian), 10);
  return Math.ceil(most / 10) * 10;
}

/**
 * The Per tank card (round 5, frame 1): one bar per meter, the median use as
 * the bar and the p90 use as a notch, on one shared scale in laps. The shorter
 * meter, the one that sets the stint, carries a boxed "RUNS OUT FIRST". A
 * fuel-only plan has the one bar, at full ink.
 */
export function TankCardView({card}: {card: TankCard}) {
  const max = scaleMax(card.meters);
  return (
    <View style={styles.box}>
      {card.meters.map(m => (
        <Meter
          key={m.key}
          meter={m}
          max={max}
          only={card.meters.length === 1}
        />
      ))}
      <Scale max={max} />
    </View>
  );
}

function Meter({
  meter,
  max,
  only,
}: {
  meter: TankMeter;
  max: number;
  only: boolean;
}) {
  const {color} = useTheme();
  const pctOf = (laps: number) =>
    `${Math.min(100, (laps / max) * 100)}%` as const;
  // The bar that sets the stint, or the only one, is drawn at full ink.
  const strong = meter.runsOutFirst || only;
  return (
    <View style={styles.meter}>
      <View style={styles.head}>
        <Text variant='label' tone='textMuted'>
          {meter.key === 've' ? 'VE' : 'Fuel'}
        </Text>
        {meter.runsOutFirst ? (
          <View style={[styles.boxed, {borderColor: color.textSecondary}]}>
            <Text variant='dataSmall' tone='textSecondary'>
              RUNS OUT FIRST
            </Text>
          </View>
        ) : null}
      </View>
      <View style={styles.numbers}>
        <Text variant='title'>{`${meter.lapsMedian.toFixed(1)} laps`}</Text>
        <Text variant='dataSmall' tone='textMuted'>
          {meter.formula}
        </Text>
      </View>
      <View style={[styles.track, {backgroundColor: color.line}]}>
        <View
          style={[
            styles.fill,
            {
              width: pctOf(meter.lapsMedian),
              backgroundColor: strong ? color.text : color.textMuted,
            },
          ]}
        />
        {meter.lapsP90 != null ? (
          <View
            style={[
              styles.notch,
              {left: pctOf(meter.lapsP90), backgroundColor: color.text},
            ]}
          />
        ) : null}
      </View>
      {meter.lapsP90 != null ? (
        <Text variant='dataSmall' tone='textMuted'>
          {`p90 ${meter.lapsP90.toFixed(1)} laps`}
        </Text>
      ) : null}
    </View>
  );
}

function Scale({max}: {max: number}) {
  const ticks = [0, max / 3, (2 * max) / 3, max].map(Math.round);
  return (
    <View style={styles.scale}>
      {ticks.map((t, i) => (
        <Text key={i} variant='axis' tone='textFaint'>
          {i === ticks.length - 1 ? `${t} laps` : t}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {gap: space.lg},
  meter: {gap: space.xs},
  head: {flexDirection: 'row', alignItems: 'center', gap: space.md},
  boxed: {
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: space.sm,
    paddingVertical: space.xxs,
  },
  numbers: {flexDirection: 'row', alignItems: 'baseline', gap: space.md},
  track: {height: BAR_H, borderRadius: radius.xs, marginVertical: space.sm},
  fill: {height: BAR_H, borderRadius: radius.xs},
  notch: {
    position: 'absolute',
    top: -(NOTCH_H - BAR_H) / 2,
    width: NOTCH_W,
    height: NOTCH_H,
  },
  scale: {flexDirection: 'row', justifyContent: 'space-between'},
});
