import {useRouter} from 'expo-router';
import {StyleSheet, View} from 'react-native';

import {hitBox, radius, size, space, useTheme} from '@/src/design';
import {cornerHref} from '@/src/nav/routes';
import {Pressable, Text} from '@/src/ui';

import {type BrakeRow} from '../brakeLedger';

/**
 * Where the set brakes: the loosest zones, a dot per lap at where it began to
 * brake against the zone's median (the centre tick), and the p10-p90 spread in
 * metres, all on one scale. A row opens Corner on that zone. No words.
 */
export function BrakeLedger({
  rows,
  sessionId,
  laps,
  set = null,
}: {
  rows: BrakeRow[];
  sessionId: string;
  /** The ticked laps, carried to Corner. */
  laps: string[];
  /** `day`: carried to Corner, which reads the sitting's laps. */
  set?: 'day' | null;
}) {
  const {color} = useTheme();
  const router = useRouter();
  if (rows.length === 0) return null;
  return (
    <View style={styles.block}>
      <Text variant='label' tone='textMuted'>
        Brake
      </Text>
      {rows.map(r => (
        <Pressable
          key={r.head}
          accessibilityRole='link'
          accessibilityLabel={`${r.head} braking spread ${r.spread}`}
          disabled={r.corner == null}
          onPress={() => {
            if (r.corner != null)
              router.push(
                cornerHref(sessionId, r.corner, {laps, set}, r.whole),
              );
          }}
          style={styles.row}>
          <Text variant='dataStrong' style={styles.head} numberOfLines={1}>
            {r.head}
          </Text>
          <View style={styles.strip}>
            <View style={[styles.tick, {backgroundColor: color.textMuted}]} />
            {r.dots.map((d, i) =>
              d == null ? null : (
                <View
                  key={i}
                  style={[
                    styles.dot,
                    {
                      left: `${50 + d * 50}%`,
                      backgroundColor: color.textSecondary,
                    },
                  ]}
                />
              ),
            )}
          </View>
          <Text variant='data' tone='textSecondary' style={styles.spread}>
            {r.spread}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  block: {maxWidth: size.contentWidth, marginTop: space.md},
  row: {
    ...hitBox.link,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  head: {width: size.spreadHead},
  strip: {flex: 1, height: size.brakeStrip, justifyContent: 'center'},
  tick: {
    position: 'absolute',
    left: '50%',
    width: size.brakeTick,
    height: size.brakeStrip,
  },
  dot: {
    position: 'absolute',
    width: size.brakeDot,
    height: size.brakeDot,
    marginLeft: -size.brakeDot / 2,
    borderRadius: radius.md,
    opacity: 0.8,
  },
  spread: {width: size.spreadPct, textAlign: 'right'},
});
