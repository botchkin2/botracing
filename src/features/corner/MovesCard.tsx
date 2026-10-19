import {StyleSheet, View} from 'react-native';

import {radius, size, space, useTheme} from '@/src/design';
import {Text} from '@/src/ui';

import {type MovesCard as MovesModel} from './moves';

const MINUS = '−';

/** "−0.73", "+0.55": the rank correlation as printed. */
export const rhoText = (rho: number) =>
  `${rho < 0 ? MINUS : '+'}${Math.abs(rho).toFixed(2)}`;

/**
 * What moves with the time in this corner part (moves.ts): one signed bar per
 * input from the centre, its rho beside it, the rows no bigger than noise
 * dimmed. The slowest sample's speed is the head's context, not a row.
 * Renders what the model hands it.
 */
export function MovesCard({moves}: {moves: MovesModel}) {
  const {color} = useTheme();
  const apex = moves.apex
    ? ` · apex ${Math.round(moves.apex.kph)} ± ${moves.apex.spreadKph.toFixed(
        1,
      )} km/h`
    : '';
  return (
    <View style={styles.block}>
      <Text variant='label' tone='textMuted'>
        Moves with time
      </Text>
      <Text variant='dataSmall' tone='textMuted'>
        {`n ${moves.n}${apex}`}
      </Text>
      {moves.rows.map(r => (
        <View
          key={r.id}
          style={[styles.row, r.dimmed && styles.dimmed]}
          accessible
          accessibilityLabel={`${r.label}, rho ${rhoText(r.rho)}, ${r.n} laps${
            r.dimmed ? ', no more than noise' : ''
          }`}>
          <Text variant='dataStrong' style={styles.head} numberOfLines={1}>
            {r.label}
          </Text>
          <View style={[styles.track, {backgroundColor: color.surfaceRaised}]}>
            <View
              style={[
                styles.bar,
                {
                  backgroundColor: color.textSecondary,
                  width: `${Math.abs(r.rho) * 50}%`,
                },
                r.rho < 0 ? styles.left : styles.right,
              ]}
            />
            <View style={[styles.zero, {backgroundColor: color.lineStrong}]} />
          </View>
          <Text variant='dataSmall' style={styles.rho}>
            {rhoText(r.rho)}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  block: {maxWidth: size.contentWidth, marginTop: space.md, gap: space.xs},
  row: {flexDirection: 'row', alignItems: 'center', gap: space.md},
  dimmed: {opacity: 0.4},
  head: {width: size.spreadHead},
  track: {flex: 1, height: size.spreadBar, borderRadius: radius.xs},
  bar: {position: 'absolute', top: 0, bottom: 0, borderRadius: radius.xs},
  left: {right: '50%'},
  right: {left: '50%'},
  zero: {position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1},
  rho: {width: size.spreadPct, textAlign: 'right'},
});
