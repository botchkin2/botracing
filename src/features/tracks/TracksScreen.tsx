import {useRouter} from 'expo-router';
import {useMemo} from 'react';
import {Pressable, ScrollView, StyleSheet, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {useSessions} from '@/src/data/sessions';
import {trackCatalog} from '@/src/data/tracks';
import {size, space, useLayout, useTheme} from '@/src/design';
import {sessionsHref, trackHref} from '@/src/nav/routes';
import {Explainer, Text} from '@/src/ui';

import {buildTracksModel} from './model';

// Every session ever driven, for the counts.
const ALL_TIME_DAYS = 3650;

/** Tracks index: every layout in the game, each opening its Track page. */
export function TracksScreen() {
  const {color} = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const {isDesktop} = useLayout();
  const sessions = useSessions({ageDays: ALL_TIME_DAYS});
  const rows = useMemo(
    () => buildTracksModel(trackCatalog(), sessions.data?.items ?? []),
    [sessions.data],
  );
  return (
    <ScrollView
      style={{backgroundColor: color.bg}}
      contentContainerStyle={[
        styles.page,
        {paddingTop: insets.top, paddingBottom: insets.bottom + space.xxl},
      ]}>
      {!isDesktop ? (
        <Pressable
          accessibilityRole='link'
          onPress={() => router.navigate(sessionsHref())}
          style={styles.back}>
          <Text variant='bodyStrong' tone='accentInk'>
            ‹ Sessions
          </Text>
        </Pressable>
      ) : null}
      <View style={styles.head}>
        <Text variant='pageTitle'>Tracks</Text>
        <Explainer>
          Every layout in the game. The ones you have driven come first.
        </Explainer>
      </View>
      <View style={{borderTopWidth: 1, borderColor: color.lineStrong}}>
        {rows.map(r => (
          <Pressable
            key={r.trackId}
            accessibilityRole='link'
            onPress={() => router.push(trackHref(r.trackId))}
            style={({pressed}) => [
              styles.row,
              {borderColor: color.line},
              pressed && {backgroundColor: color.surfaceRaised},
            ]}>
            <View style={styles.rowText}>
              <Text variant='bodyStrong' numberOfLines={1}>
                {r.name}
              </Text>
              <Text variant='explainer' tone='textMuted' numberOfLines={1}>
                {r.place}
              </Text>
            </View>
            {r.driven ? (
              <Text variant='dataSmall' tone='textSecondary'>
                {r.driven}
              </Text>
            ) : null}
            <Text variant='body' tone='textFaint'>
              ›
            </Text>
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: {
    paddingHorizontal: size.gutter,
    gap: space.lg,
    width: '100%',
    maxWidth: size.maxContent,
    alignSelf: 'center',
  },
  back: {height: size.hit, justifyContent: 'center'},
  head: {gap: space.xs, paddingTop: space.md},
  row: {
    minHeight: size.sessionRow,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
    borderBottomWidth: 1,
  },
  rowText: {flex: 1, minWidth: 0},
});
