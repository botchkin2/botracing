import {StyleSheet, View} from 'react-native';
import Svg, {Line, Polyline} from 'react-native-svg';

import {dash, space, stroke, useTheme} from '@/src/design';
import {Text} from '@/src/ui';

import type {AxleSeries} from '../tireCard';

const H = 72;
const PAD = 4;

/**
 * One value per lap for each axle: front solid, rear dashed (the overlaid
 * channel convention), no colour per axle. A gap in the data breaks the line.
 * The key gives the median over the green laps for each axle.
 */
export function AxleLines({
  title,
  unit,
  series,
  width,
  medianLabel,
}: {
  title: string;
  unit: string;
  series: AxleSeries;
  width: number;
  /** What the key's median is, e.g. "stabilised hot". */
  medianLabel: string;
}) {
  const {color} = useTheme();
  const all = [...series.front, ...series.rear].filter(
    (v): v is number => v != null,
  );
  if (all.length === 0) return null;
  const n = series.lapLabels.length;
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const span = hi - lo || 1;
  const x = (i: number) =>
    n > 1 ? PAD + (i * (width - 2 * PAD)) / (n - 1) : width / 2;
  const y = (v: number) => PAD + (1 - (v - lo) / span) * (H - 2 * PAD);
  const runs = (values: (number | null)[]) => {
    const out: string[] = [];
    let cur: string[] = [];
    values.forEach((v, i) => {
      if (v == null) {
        if (cur.length > 1) out.push(cur.join(' '));
        cur = [];
      } else cur.push(`${x(i)},${y(v)}`);
    });
    if (cur.length > 1) out.push(cur.join(' '));
    return out;
  };
  const fmt = (v: number | null) => (v == null ? '—' : v.toFixed(0));
  return (
    <View style={styles.box}>
      <Text variant='label' tone='textMuted'>
        {title}
      </Text>
      <Svg width={width} height={H}>
        <Line
          x1={0}
          x2={width}
          y1={H - 1}
          y2={H - 1}
          stroke={color.line}
          strokeWidth={stroke.grey}
        />
        {runs(series.front).map(p => (
          <Polyline
            key={`f${p}`}
            points={p}
            fill='none'
            stroke={color.text}
            strokeWidth={stroke.selected}
          />
        ))}
        {runs(series.rear).map(p => (
          <Polyline
            key={`r${p}`}
            points={p}
            fill='none'
            stroke={color.text}
            strokeWidth={stroke.selected}
            strokeDasharray={dash.overlay2}
          />
        ))}
      </Svg>
      <Text variant='dataSmall' tone='textMuted'>
        {`${series.lapLabels[0]}–${series.lapLabels[n - 1]} · ${fmt(lo)}–${fmt(
          hi,
        )} ${unit}`}
      </Text>
      <Text variant='dataSmall' tone='textSecondary'>
        {`Front ${fmt(series.medianFront)} solid · Rear ${fmt(
          series.medianRear,
        )} dashed ${unit}, ${medianLabel}`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({box: {gap: space.xs}});
