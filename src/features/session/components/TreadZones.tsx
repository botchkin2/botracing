import {StyleSheet, View} from 'react-native';
import Svg, {Rect} from 'react-native-svg';

import {radius, space, useTheme} from '@/src/design';
import {Text} from '@/src/ui';

import {TREAD_BAR_MAX_C, TREAD_BAR_MIN_C, type TreadZone} from '../tireCard';

const BAR_H = 32;
const BAR_W = 14;
const BAR_GAP = space.sm;
const GRID_GAP = space.md;

type Zone = 'inner' | 'centre' | 'outer';
const ZONES: Zone[] = ['inner', 'centre', 'outer'];

/**
 * Seen from above with the outer edges facing out: on the left wheels the
 * outer third is on the left, on the right wheels on the right.
 */
const ORDER: Record<'left' | 'right', Zone[]> = {
  left: ['outer', 'centre', 'inner'],
  right: ['inner', 'centre', 'outer'],
};
const LETTER: Record<Zone, string> = {inner: 'I', centre: 'C', outer: 'O'};

/**
 * The tread of each wheel in the car-shaped 2x2 of the wear grid (round 7
 * 1A): three small bars per wheel, 70 to 100 C, with I - O printed. Secondary
 * to the wear grid, so no headline number.
 */
export function TreadZones({
  zones,
  width,
}: {
  zones: TreadZone[];
  width: number;
}) {
  const cellW = Math.floor((width - GRID_GAP) / 2);
  // A tyre under the scale's floor (a cold stint) draws no bar; when every bar
  // of the four is empty the bar rows would be blank space above the numbers,
  // so they are left out and the numbers stand alone.
  const barH = zones.some(z => ZONES.some(p => (z[p] ?? 0) > TREAD_BAR_MIN_C))
    ? BAR_H
    : 0;
  return (
    <View style={[styles.grid, {width, gap: GRID_GAP}]}>
      {zones.map(z => (
        <ZoneCell key={z.wheel} zone={z} width={cellW} barH={barH} />
      ))}
    </View>
  );
}

function ZoneCell({
  zone,
  width,
  barH,
}: {
  zone: TreadZone;
  width: number;
  barH: number;
}) {
  const {color} = useTheme();
  const order = ORDER[zone.wheel.endsWith('L') ? 'left' : 'right'];
  const scale = (v: number) =>
    (Math.min(
      Math.max(v - TREAD_BAR_MIN_C, 0),
      TREAD_BAR_MAX_C - TREAD_BAR_MIN_C,
    ) /
      (TREAD_BAR_MAX_C - TREAD_BAR_MIN_C)) *
    barH;
  const diff = zone.innerMinusOuter;
  return (
    <View
      accessible
      accessibilityLabel={label(zone)}
      style={[
        styles.cell,
        {width, borderColor: color.line, backgroundColor: color.surface},
      ]}>
      <View style={styles.head}>
        <Text variant='label' tone='textMuted'>
          {zone.wheel}
        </Text>
        <Text variant='dataSmall' tone='textMuted'>
          {diff == null
            ? 'I − O —'
            : `I − O ${diff < 0 ? '−' : '+'}${Math.abs(diff).toFixed(1)} °C`}
        </Text>
      </View>
      <View style={styles.bars}>
        {order.map(part => {
          const v = zone[part];
          return (
            <View key={part} style={styles.bar}>
              {barH > 0 ? (
                <Svg width={BAR_W} height={barH}>
                  {v != null ? (
                    <Rect
                      x={0}
                      y={barH - scale(v)}
                      width={BAR_W}
                      height={scale(v)}
                      fill={color.textFaint}
                    />
                  ) : null}
                </Svg>
              ) : null}
              <Text variant='dataSmall'>{v == null ? '—' : v.toFixed(0)}</Text>
              <Text variant='label' tone='textMuted'>
                {LETTER[part]}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const temp = (v: number | null) =>
  v == null ? 'no reading' : `${v.toFixed(0)} °C`;

function label(z: TreadZone): string {
  return `${z.wheel} tread: inner ${temp(z.inner)}, centre ${temp(
    z.centre,
  )}, outer ${temp(z.outer)}`;
}

const styles = StyleSheet.create({
  grid: {flexDirection: 'row', flexWrap: 'wrap'},
  cell: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.sm,
  },
  head: {flexDirection: 'row', justifyContent: 'space-between'},
  bars: {flexDirection: 'row', justifyContent: 'center', gap: BAR_GAP},
  bar: {alignItems: 'center', gap: space.xxs},
});
