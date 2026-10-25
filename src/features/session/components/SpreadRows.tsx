import {useRouter} from 'expo-router';
import {StyleSheet, View} from 'react-native';

import {hitBox, radius, size, space, useTheme} from '@/src/design';
import {cornerHref} from '@/src/nav/routes';
import {Pressable, Text} from '@/src/ui';

import {type SpreadBlock} from '../spreadRows';

/**
 * The sections he varies most in, in seconds (analysis/sectionVary.ts): a section he left with wheels off on many
 * laps first, saying so, then the rest by their IQR, a bar and seconds each. A row opens Corner on that section,
 * keeping the lap selection. The line under it says which laps the numbers are of.
 */
export function SpreadRows({
  block,
  sessionId,
  laps,
  set = null,
}: {
  block: SpreadBlock;
  sessionId: string;
  /** The ticked laps, carried to Corner. */
  laps: string[];
  /** `day`: carried to Corner, which reads the sitting's laps. */
  set?: 'day' | null;
}) {
  const {color} = useTheme();
  const router = useRouter();
  if (block.rows.length === 0 && block.line == null) return null;
  return (
    <View style={styles.block}>
      <Text variant='label' tone='textMuted'>
        Varies most
      </Text>
      {block.rows.map(r => (
        <Pressable
          key={r.head}
          accessibilityRole='link'
          accessibilityLabel={[r.head, r.offs, r.seconds]
            .filter(Boolean)
            .join(' ')}
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
          {r.offs != null ? (
            <Text
              variant='data'
              tone='textSecondary'
              style={styles.offs}
              numberOfLines={1}>
              {r.offs}
            </Text>
          ) : (
            <View
              style={[styles.track, {backgroundColor: color.surfaceRaised}]}>
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
          )}
          <Text variant='data' tone='textSecondary' style={styles.seconds}>
            {r.seconds ?? ''}
          </Text>
        </Pressable>
      ))}
      {block.line != null ? (
        <Text variant='dataSmall' tone='textMuted' style={styles.line}>
          {block.line}
        </Text>
      ) : null}
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
  offs: {flex: 1},
  track: {flex: 1, height: size.spreadBar, borderRadius: radius.xs},
  bar: {height: size.spreadBar, borderRadius: radius.xs},
  seconds: {width: size.spreadPct, textAlign: 'right'},
  line: {marginTop: space.xs},
});
