import {useRouter} from 'expo-router';
import {
  ActivityIndicator,
  Pressable,
  SectionList,
  StyleSheet,
  View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {radius, size, space, useLayout, useTheme} from '@/src/design';
import {Badge, Button, Text} from '@/src/ui';

import {type DayGroup, type SessionRow, useSessionsModel} from './model';

// Columns from the handoff: badge | track · car | laps | best | median.
const COL = {badge: 24, laps: 30, time: 64};
const LIST_MAX_WIDTH = 760;

export function SessionsScreen() {
  const model = useSessionsModel();
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
          <Text variant='display'>Sessions</Text>
          {/* Sim/track/car filter picker comes with the filter work; label only for now. */}
          <View style={[styles.picker, {borderColor: color.lineStrong}]}>
            <Text variant='dataStrong'>LMU · all tracks ▾</Text>
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
            <Text variant='data' tone='textFaint'>
              {section.date}
            </Text>
          </View>
        )}
        renderItem={({item}) => (
          <SessionRowView
            row={item}
            width={width}
            onPress={() => router.push(`/session/${item.id}`)}
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
      accessibilityLabel={`${row.track} ${row.typeLabel}, ${row.subline}`}
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
          <Text numberOfLines={1}>
            <Text variant='bodyStrong' style={styles.trackName}>
              {row.track}
            </Text>
            <Text tone='textMuted'> · {row.typeLabel}</Text>
          </Text>
          <Text variant='data' tone='textMuted' numberOfLines={1}>
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
        {
          width,
          backgroundColor: color.surfaceRaised,
          borderColor: color.lineStrong,
        },
      ]}>
      <Text variant='title'>No sessions yet</Text>
      <Text tone='textMuted'>
        Sessions upload automatically from your PC. Install the uploader on your
        sim PC and sign in with the same account.
      </Text>
      <Text variant='data' tone='textFaint'>
        Uploader: not seen yet
      </Text>
      <Button
        label='Set up uploader'
        onPress={() => router.push('/settings')}
      />
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
  emptyCard: {
    marginTop: space.xl,
    padding: space.xl,
    gap: space.md,
    borderWidth: 1,
    borderRadius: radius.md,
  },
});
