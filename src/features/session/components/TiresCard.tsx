import {useState} from 'react';
import {ScrollView, StyleSheet, View} from 'react-native';

import {WHEELS} from '@/src/analysis/tyres';
import {space, useTheme} from '@/src/design';
import {EmptyState, Explainer, Segment, Text, useHowToRead} from '@/src/ui';

import type {WearScatterModel} from '../wearScatter';
import {
  NO_TYRE_CHANNELS,
  TIRES_HELP,
  type TiresCard as TiresCardModel,
} from '../tireCard';
import {AxleLines} from './AxleLines';
import {TireGrid} from './TireGrid';
import {WearScatter} from './WearScatter';

/**
 * The Session Tires card (round 7 1A, 1C, 1D): one stint at a time. Wear per
 * wheel in a car-shaped grid, pressure and rubber temperature as axle lines,
 * and the readings as a table when the stint is too short for a trend.
 */
export function TiresCard({
  card,
  scatter,
  width,
}: {
  card: TiresCardModel;
  /** Lap time against wear over the whole race; null with too few laps. */
  scatter: WearScatterModel | null;
  /** The width the card may use, in points. */
  width: number;
}) {
  const {color} = useTheme();
  const help = useHowToRead('the tires', TIRES_HELP);
  const [picked, setPicked] = useState<number | null>(null);
  if (card.kind === 'absent') {
    return (
      <View style={styles.card}>
        <Text variant='label'>Tires</Text>
        <EmptyState title='No tyre channels' body={NO_TYRE_CHANNELS} />
      </View>
    );
  }
  const stint =
    card.stints.find(s => s.n === picked) ??
    card.stints[card.stints.length - 1];
  return (
    <View style={styles.card}>
      <View style={styles.title}>
        <Text variant='label'>Tires</Text>
        {help.button}
      </View>
      <Explainer>
        Seen from above, front at the top. Big number = left at the end of the
        last green lap. Bars = % lost on each lap (hollow = not a green lap),
        dashed line = median of the green laps.
      </Explainer>
      {help.panel}
      {card.stints.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <Segment
            options={card.stints.map(s => ({
              value: String(s.n),
              label: s.tab,
            }))}
            value={String(stint.n)}
            onChange={v => setPicked(Number(v))}
          />
        </ScrollView>
      ) : null}
      <Text variant='bodyStrong'>{stint.title}</Text>
      <Text variant='dataSmall' tone='textMuted'>
        {stint.sub}
      </Text>
      {stint.kind === 'readings' ? (
        <View style={styles.table}>
          <Text variant='dataSmall' tone='textMuted'>
            {SHORT_STINT_NOTE}
          </Text>
          <View style={styles.row}>
            <Text variant='label' tone='textMuted' style={styles.lapCol}>
              Lap
            </Text>
            {WHEELS.map(w => (
              <Text
                key={w}
                variant='label'
                tone='textMuted'
                style={styles.wheelCol}>
                {w}
              </Text>
            ))}
          </View>
          {stint.readings.map(r => (
            <View
              key={r.label}
              style={[styles.row, styles.ruled, {borderColor: color.line}]}>
              <Text variant='dataSmall' style={styles.lapCol}>
                {r.label}
              </Text>
              {WHEELS.map(w => (
                <Text key={w} variant='dataSmall' style={styles.wheelCol}>
                  {r.wearPct[w] == null ? '—' : `${r.wearPct[w]?.toFixed(1)} %`}
                </Text>
              ))}
            </View>
          ))}
        </View>
      ) : null}
      <TireGrid
        cells={stint.wheels}
        width={width}
        showBars={stint.kind === 'trend'}
      />
      {stint.flatNote ? (
        <Text variant='dataSmall' tone='textMuted'>
          {stint.flatNote}
        </Text>
      ) : null}
      <AxleLines
        title='Pressure'
        unit='kPa'
        series={stint.pressure}
        width={width}
        medianLabel='median of the stabilised hot pressure, green laps'
      />
      <AxleLines
        title='Rubber temperature'
        unit='°C'
        series={stint.rubber}
        width={width}
        medianLabel='median over the green laps'
      />
      {scatter ? <WearScatter model={scatter} width={width} /> : null}
    </View>
  );
}

const SHORT_STINT_NOTE =
  "A trend needs 5 green laps. The readings are listed instead: wear left at each lap's end.";

const styles = StyleSheet.create({
  card: {gap: space.md},
  title: {flexDirection: 'row', alignItems: 'center', gap: space.sm},
  table: {gap: space.xs},
  row: {flexDirection: 'row', gap: space.sm},
  ruled: {borderTopWidth: 1, paddingTop: space.xs},
  lapCol: {width: 48},
  wheelCol: {flex: 1, textAlign: 'right'},
});
