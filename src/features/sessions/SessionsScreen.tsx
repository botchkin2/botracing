import {useRouter} from 'expo-router';
import {
  ActivityIndicator,
  Pressable,
  SectionList,
  StyleSheet,
  View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {hitBox, radius, size, space, useLayout, useTheme} from '@/src/design';
import {
  sessionHref,
  sessionsHref,
  settingsHref,
  tracksHref,
} from '@/src/nav/routes';
import {AppMark, Badge, Button, hitFor, MARK_SLOP, Text} from '@/src/ui';

import {type DayGroup, type SessionRow, useSessionsModel} from './model';

// Columns from the handoff: badge | track · car | laps | best | median.
const COL = {badge: 24, laps: 30, time: 64};
const LIST_MAX_WIDTH = 760;

const markHit = hitFor(MARK_SLOP, MARK_SLOP);
// Web grows the box with padding, so the margin takes it back; native only has
// hitSlop, which takes no layout space, so the plain gap stays.
const markGap = {
  marginRight: markHit.style ? space.md - MARK_SLOP : space.md,
};

export function SessionsScreen() {
  const model = useSessionsModel();
  const router = useRouter();
  const {color} = useTheme();
  const layout = useLayout();
  // A list reads badly at 1200 pt; cap it on desktop.
  const contentWidth = Math.min(layout.contentWidth, LIST_MAX_WIDTH);
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.screen,
        {backgroundColor: color.bg, paddingTop: insets.top + space.lg},
      ]}>
      <View style={[styles.column, {width: contentWidth}]}>
        <View style={styles.header}>
          {/* The desktop chrome carries the mark. */}
          {!layout.isWide && (
            <Pressable
              accessibilityRole='link'
              accessibilityLabel='Sessions'
              onPress={() => router.navigate(sessionsHref())}
              hitSlop={markHit.hitSlop}
              style={[markHit.style, markGap]}>
              <AppMark />
            </Pressable>
          )}
          <Text variant='display'>Sessions</Text>
          <Pressable
            accessibilityRole='link'
            onPress={() => router.push(tracksHref())}
            hitSlop={space.md}
            style={[hitBox.link, styles.tracksLink]}>
            <Text variant='body' tone='accentInk'>
              Tracks ›
            </Text>
          </Pressable>
          {/* Sim/track/car filter picker comes with the filter work; label only for now. */}
          <View style={styles.headerRight}>
            <View style={[styles.picker, {borderColor: color.lineStrong}]}>
              <Text variant='dataStrong'>LMU · all tracks ▾</Text>
            </View>
            {/* Handoff v2 M5: Settings opens from the Sessions header on the
                phone; desktop has it in the chrome. */}
            {!layout.isWide && (
              <Pressable
                accessibilityRole='link'
                accessibilityLabel='Settings'
                hitSlop={space.md}
                style={hitBox.icon}
                onPress={() => router.push(settingsHref())}>
                <Text variant='title' tone='textMuted'>
                  ⚙
                </Text>
              </Pressable>
            )}
          </View>
        </View>
      </View>

      {model.state === 'loading' && (
        <ActivityIndicator color={color.accent} style={styles.status} />
      )}
      {model.state === 'error' && (
        <View style={[styles.column, {width: contentWidth}]}>
          <Text tone='textMuted' style={styles.status}>
            Couldn’t load sessions: {model.message}
          </Text>
        </View>
      )}
      {model.state === 'empty' && <EmptyState width={contentWidth} />}
      {model.state === 'ready' && (
        <SessionTable days={model.days} width={contentWidth} />
      )}
    </View>
  );
}

function SessionTable({days, width}: {days: DayGroup[]; width: number}) {
  const {color} = useTheme();
  const router = useRouter();
  return (
    <>
      <View
        style={[
          styles.columnHeader,
          {
            backgroundColor: color.surface,
            borderColor: color.lineHeader,
          },
        ]}>
        <View style={[styles.row, styles.centered, {width}]}>
          <View style={{width: COL.badge}} />
          <Text variant='tableHeader' tone='textMuted' style={styles.flex}>
            Track · car
          </Text>
          <Text variant='tableHeader' tone='textMuted' style={styles.laps}>
            Laps
          </Text>
          <Text variant='tableHeader' tone='textMuted' style={styles.time}>
            Best
          </Text>
          <Text variant='tableHeader' tone='textMuted' style={styles.time}>
            Median
          </Text>
        </View>
      </View>
      <SectionList
        sections={days.map(day => ({...day, data: day.rows}))}
        keyExtractor={row => row.id}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={styles.listContent}
        renderSectionHeader={({section}) => (
          <View style={[styles.dayHeader, styles.centered, {width}]}>
            <Text variant='bodyStrong'>{section.title}</Text>
            <Text variant='dataSmall' tone='textFaint'>
              {section.date}
            </Text>
          </View>
        )}
        renderItem={({item}) => (
          <SessionRowView
            row={item}
            width={width}
            onPress={() => router.push(sessionHref(item.id))}
          />
        )}
      />
    </>
  );
}

function SessionRowView({
  row,
  width,
  onPress,
}: {
  row: SessionRow;
  width: number;
  onPress: () => void;
}) {
  const {color} = useTheme();
  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel={`${row.track}, ${row.subline}`}
      onPress={onPress}
      style={({pressed}) => [
        styles.sessionRow,
        {borderColor: color.line},
        pressed && {backgroundColor: color.surfaceRaised},
      ]}>
      <View style={[styles.row, styles.centered, {width}]}>
        <View style={{width: COL.badge}}>
          <Badge label={row.badge} />
        </View>
        <View style={styles.flex}>
          <Text variant='bodyStrong' style={styles.trackName} numberOfLines={1}>
            {row.track}
          </Text>
          <Text variant='dataSmall' tone='textMuted' numberOfLines={1}>
            {row.subline}
          </Text>
        </View>
        <Text variant='data' tone='textSecondary' style={styles.laps}>
          {row.laps}
        </Text>
        <Text variant='data' tone='textSecondary' style={styles.time}>
          {row.best}
        </Text>
        <Text variant='data' tone='textSecondary' style={styles.time}>
          {row.median}
        </Text>
      </View>
    </Pressable>
  );
}

function EmptyState({width}: {width: number}) {
  const {color} = useTheme();
  const router = useRouter();
  return (
    <View
      style={[
        styles.emptyCard,
        styles.centered,
        {width, backgroundColor: color.surface, borderColor: color.lineHeader},
      ]}>
      <Text variant='title' style={styles.emptyTitle}>
        No sessions yet
      </Text>
      <Text tone='textSecondary' style={styles.emptyBody}>
        Sessions upload automatically from your PC. Install the uploader on your
        sim PC and sign in with the same account.
      </Text>
      <View style={[styles.statusPill, {backgroundColor: color.surfaceRaised}]}>
        <View style={[styles.statusDot, {backgroundColor: color.textFaint}]} />
        <Text variant='dataSmall' tone='textMuted'>
          Uploader: not seen yet
        </Text>
      </View>
      <View style={styles.emptyAction}>
        <Button
          label='Set up uploader'
          onPress={() => router.push(settingsHref())}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {flex: 1},
  column: {alignSelf: 'center'},
  centered: {alignSelf: 'center'},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: space.lg,
  },
  tracksLink: {marginLeft: 'auto', marginRight: space.lg},
  headerRight: {flexDirection: 'row', alignItems: 'center', gap: space.md},
  picker: {
    height: size.chip,
    paddingHorizontal: space.md,
    borderWidth: 1,
    borderRadius: radius.sm,
    justifyContent: 'center',
  },
  status: {marginTop: space.xxl},
  listContent: {paddingBottom: space.xxxl},
  columnHeader: {
    borderTopWidth: 1,
    borderBottomWidth: 1,
    paddingVertical: space.sm,
  },
  row: {flexDirection: 'row', alignItems: 'center', gap: space.md},
  flex: {flex: 1},
  laps: {width: COL.laps, textAlign: 'right'},
  time: {width: COL.time, textAlign: 'right'},
  trackName: {fontSize: 14.5},
  dayHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: space.md,
    paddingTop: space.xl,
    paddingBottom: space.sm,
  },
  sessionRow: {
    minHeight: size.sessionRow,
    justifyContent: 'center',
    borderBottomWidth: 1,
  },
  emptyTitle: {fontSize: 18, lineHeight: 22},
  emptyBody: {fontSize: 13, lineHeight: 19},
  emptyAction: {alignSelf: 'flex-start'},
  statusPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: radius.sm,
  },
  statusDot: {width: 6, height: 6, borderRadius: 3},
  emptyCard: {
    marginTop: space.xl,
    padding: space.xl,
    gap: space.md,
    borderWidth: 1,
    borderRadius: radius.md,
  },
});
