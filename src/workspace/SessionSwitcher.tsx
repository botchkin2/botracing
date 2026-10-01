import {useRouter} from 'expo-router';
import {Pressable, StyleSheet, View} from 'react-native';

import {useSessions} from '@/src/data/sessions';
import {radius, size, space, useTheme} from '@/src/design';
import {sessionHref, trackHref} from '@/src/nav/routes';
import {Sheet, Text} from '@/src/ui';

import {switcherRows} from './switcherRows';

// Same window the Plan screen reads.
const HISTORY_DAYS = 3650;

/**
 * The ▾ menu on the desktop bar's session box (round 6): the other sessions at
 * this track, and the way to the track's page. At 1024 the car, team and date
 * that left the box are the sheet's first line.
 */
export function SessionSwitcher({
  visible,
  onClose,
  sessionId,
  trackId,
  trackName,
  detail,
}: {
  visible: boolean;
  onClose: () => void;
  sessionId: string;
  trackId: string;
  trackName: string;
  /** "Porsche 911 GT3 R · Manthey #91 · 14 Sep" */
  detail: string;
}) {
  const router = useRouter();
  const {color} = useTheme();
  const sessions = useSessions({ageDays: HISTORY_DAYS}, visible);
  const rows = switcherRows(sessions.data?.items ?? [], trackId, sessionId);
  return (
    <Sheet
      visible={visible}
      title={trackName}
      onClose={onClose}
      header={
        <View style={styles.head}>
          <Text variant='dataSmall' tone='textMuted'>
            {detail}
          </Text>
          <Pressable
            accessibilityRole='link'
            onPress={() => {
              onClose();
              router.push(trackHref(trackId));
            }}
            style={styles.link}>
            <Text variant='bodyStrong' tone='accentInk'>
              Track page ›
            </Text>
          </Pressable>
        </View>
      }>
      <Text variant='label' tone='textMuted'>
        Sessions at this track
      </Text>
      {sessions.isPending && (
        <Text variant='dataSmall' tone='textMuted'>
          Loading sessions…
        </Text>
      )}
      {rows.map(row => (
        <Pressable
          key={row.id}
          accessibilityRole='link'
          accessibilityState={{selected: row.open}}
          onPress={() => {
            onClose();
            if (!row.open) router.navigate(sessionHref(row.id));
          }}
          style={[
            styles.row,
            {borderColor: color.lineStrong},
            row.open && {backgroundColor: color.tabActive},
          ]}>
          <View style={[styles.badge, {borderColor: color.textSecondary}]}>
            <Text variant='dataSmall'>{row.badge}</Text>
          </View>
          <View style={styles.rowText}>
            <Text variant={row.open ? 'bodyStrong' : 'body'} numberOfLines={1}>
              {row.date}
            </Text>
            <Text variant='dataSmall' tone='textMuted' numberOfLines={1}>
              {row.car}
            </Text>
          </View>
          {row.best ? <Text variant='data'>{row.best}</Text> : null}
        </Pressable>
      ))}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  head: {paddingHorizontal: space.xl, gap: space.xs},
  link: {minHeight: size.hit, justifyContent: 'center'},
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
    minHeight: size.hit,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderWidth: 1,
    borderRadius: radius.sm,
  },
  badge: {
    width: size.logo,
    height: size.logo,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: radius.xs,
  },
  rowText: {flex: 1, gap: space.xxs},
});
