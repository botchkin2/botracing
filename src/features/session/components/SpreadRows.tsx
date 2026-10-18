import {useRouter} from 'expo-router';
import {StyleSheet, View} from 'react-native';

import {hitBox, radius, size, space, useTheme} from '@/src/design';
import {cornerHref} from '@/src/nav/routes';
import {Pressable, Text} from '@/src/ui';

import {type SpreadRow} from '../spreadRows';

/**
 * Where the set scatters: the sections holding the most lap-to-lap spread,
 * biggest first, a bar and a percent each (analysis/spreadShare.ts). A row
 * opens Corner on that section, keeping the lap selection. No words: the bar
 * is the answer.
 */
export function SpreadRows({
  rows,
  sessionId,
  laps,
  open = true,
}: {
  rows: SpreadRow[];
  sessionId: string;
  /** The ticked laps, carried to Corner. */
  laps: string[];
  /** False in a day: its laps belong to several sessions, so a row opens nothing yet. */
  open?: boolean;
}) {
  const {color} = useTheme();
  const router = useRouter();
  if (rows.length === 0) return null;
  return (
    <View style={styles.block}>
      <Text variant='label' tone='textMuted'>
        Spread
      </Text>
      {rows.map(r => (
        <Pressable
          key={r.head}
          accessibilityRole='link'
          accessibilityLabel={`${r.head} ${r.pct} of the spread`}
          disabled={r.corner == null || !open}
          onPress={() => {
            if (r.corner != null)
              router.push(cornerHref(sessionId, r.corner, {laps}, r.whole));
          }}
          style={styles.row}>
          <Text variant='dataStrong' style={styles.head} numberOfLines={1}>
            {r.head}
          </Text>
          <View style={[styles.track, {backgroundColor: color.surfaceRaised}]}>
            <View
              style={[
                styles.bar,
                {
                  width: `${r.frac * 100}%`,
                  backgroundColor: color.textSecondary,
                },
              ]}
            />
          </View>
          <Text variant='data' tone='textSecondary' style={styles.pct}>
            {r.pct}
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
  track: {flex: 1, height: size.spreadBar, borderRadius: radius.xs},
  bar: {height: size.spreadBar, borderRadius: radius.xs},
  pct: {width: size.spreadPct, textAlign: 'right'},
});
