import {ActivityIndicator, ScrollView, StyleSheet, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {radius, space, useLayout, useTheme} from '@/src/design';
import {Text} from '@/src/ui';

import {type UploaderCard, useSettingsModel} from './model';

// Settings (handoff v2 M5): the uploader card per sim PC, then the app
// version. Theme, pairing and offline data are not on the list (decision
// 2026-09-28-claude-design-v2); units come in their own PR.

const MAX_WIDTH = 560;

export function SettingsScreen() {
  const model = useSettingsModel();
  const {color} = useTheme();
  const layout = useLayout();
  const insets = useSafeAreaInsets();
  const width = Math.min(layout.contentWidth, MAX_WIDTH);
  const u = model.uploaders;

  return (
    <ScrollView
      style={{backgroundColor: color.bg}}
      contentContainerStyle={[
        styles.content,
        {paddingTop: insets.top + space.lg, width},
      ]}>
      <View style={styles.header}>
        <Text variant='display'>Settings</Text>
      </View>

      <Text variant='label' tone='textMuted'>
        Uploader
      </Text>
      {u.state === 'loading' && <ActivityIndicator color={color.accent} />}
      {u.state === 'error' && (
        <Text tone='textMuted'>
          Couldn’t load the uploader status: {u.message}
        </Text>
      )}
      {u.state === 'none' && (
        <View
          style={[
            styles.card,
            {backgroundColor: color.surface, borderColor: color.lineHeader},
          ]}>
          <View style={styles.row}>
            <Dot on={false} />
            <Text variant='bodyStrong'>No uploader has reported yet</Text>
          </View>
        </View>
      )}
      {u.state === 'ready' &&
        u.cards.map(c => <Card key={c.hostId} card={c} />)}

      <Text variant='label' tone='textMuted' style={styles.section}>
        About
      </Text>
      <Text variant='data' tone='textSecondary'>
        Version {model.version}
      </Text>
    </ScrollView>
  );
}

function Dot({on}: {on: boolean}) {
  const {color} = useTheme();
  return (
    <View
      accessibilityLabel={on ? 'Connected' : 'Not seen recently'}
      style={[
        styles.dot,
        {backgroundColor: on ? color.statusConnected : color.textFaint},
      ]}
    />
  );
}

function Card({card}: {card: UploaderCard}) {
  const {color} = useTheme();
  return (
    <View
      style={[
        styles.card,
        {backgroundColor: color.surface, borderColor: color.lineHeader},
      ]}>
      <View style={styles.row}>
        <Dot on={card.dot === 'connected'} />
        <Text variant='bodyStrong'>{card.title}</Text>
        <Text variant='dataSmall' tone='textMuted'>
          {card.subtitle}
        </Text>
      </View>
      <Text variant='data'>{card.status}</Text>
      {card.lines.map(l => (
        <Text key={l} variant='dataSmall' tone='textSecondary'>
          {l}
        </Text>
      ))}
      {card.recorderWarning && (
        <View
          style={[
            styles.notice,
            {
              backgroundColor: color.surfaceOverlay,
              borderColor: color.lineStrong,
            },
          ]}>
          <Text tone='textSecondary'>{card.recorderWarning}</Text>
        </View>
      )}
      {card.error && (
        <View
          style={[
            styles.notice,
            {
              backgroundColor: color.surfaceOverlay,
              borderColor: color.lineStrong,
            },
          ]}>
          <Text variant='dataSmall' tone='textMuted'>
            Last error{card.error.when ? ` · ${card.error.when}` : ''}
          </Text>
          <Text>{card.error.message}</Text>
          {card.error.path && (
            <Text variant='dataSmall' tone='textSecondary' selectable>
              {card.error.path}
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  content: {gap: space.md, alignSelf: 'center', paddingBottom: space.xxxl},
  header: {gap: space.sm, paddingBottom: space.md},
  section: {marginTop: space.xl},
  card: {
    padding: space.lg,
    gap: space.xs,
    borderWidth: 1,
    borderRadius: radius.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    flexWrap: 'wrap',
  },
  dot: {width: 8, height: 8, borderRadius: 4},
  // Neutral, never amber or red (handoff v2 M3: status banners).
  notice: {
    marginTop: space.sm,
    padding: space.md,
    gap: space.xxs,
    borderWidth: 1,
    borderRadius: radius.sm,
  },
});
