import * as Application from 'expo-application';
import {
  ActivityIndicator,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {accountLabel, useAuthStore, useSignIn} from '@/src/auth';
import {radius, space, useLayout, useTheme} from '@/src/design';
import {androidDownloadUrl, useAndroidRelease} from '@/src/data/android';
import {trayDownloadUrl, useTrayRelease} from '@/src/data/tray';
import {useSectionPrefs, sectionModeOf} from '@/src/state/sectionPrefs';
import {Button, Segment, Text} from '@/src/ui';

import {androidCard, androidSurface, INSTALL_NOTE} from './androidCard';
import {type UploaderCard, useSettingsModel} from './model';
import {trayCard} from './trayCard';

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

      <Account />

      <AndroidApp />

      <WindowsApp />

      <Sections />

      <Text variant='label' tone='textMuted' style={styles.section}>
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

// Who the sessions on screen belong to. Signing in is what ties this app to
// the sessions the PC uploader sent for the same Google account.
function Account() {
  const {color} = useTheme();
  const state = useAuthStore(s => s.state);
  const {busy, message, signIn, signOut} = useSignIn();
  return (
    <>
      <Text variant='label' tone='textMuted'>
        Account
      </Text>
      <View
        style={[
          styles.card,
          {backgroundColor: color.surface, borderColor: color.lineHeader},
        ]}>
        <Text variant='bodyStrong'>{accountLabel(state)}</Text>
        {state.kind === 'signed-in' ? (
          <Button
            label='Sign out'
            kind='outline'
            onPress={() => void signOut()}
            disabled={busy}
          />
        ) : (
          <Button
            label={busy ? 'Signing in…' : 'Sign in with Google'}
            onPress={() => void signIn()}
            disabled={busy || state.kind === 'loading'}
          />
        )}
        {message ? (
          <Text variant='dataSmall' tone='textMuted'>
            {message}
          </Text>
        ) : null}
      </View>
    </>
  );
}

// The tray app that uploads the sessions: download it here, sign in with the
// same Google account. Settings is behind the sign-in, so this is signed-in only.
function WindowsApp() {
  const {color} = useTheme();
  const release = useTrayRelease();
  const card = trayCard({
    isPending: release.isPending,
    isError: release.isError,
    data: release.data,
  });
  return (
    <>
      <Text variant='label' tone='textMuted' style={styles.section}>
        Windows app
      </Text>
      <View
        style={[
          styles.card,
          {backgroundColor: color.surface, borderColor: color.lineHeader},
        ]}>
        <Text variant='data' tone='textSecondary'>
          {card.status}
        </Text>
        {card.version ? (
          <Button
            label='Download for Windows'
            onPress={() => void Linking.openURL(trayDownloadUrl())}
          />
        ) : null}
      </View>
    </>
  );
}

// The Android app: an update in the installed app when EAS built a newer
// versionCode, or the APK in a phone's browser. No card anywhere else.
const surface = androidSurface(
  Platform.OS,
  typeof navigator === 'undefined' ? undefined : navigator.userAgent,
);
const installedVersionCode = Number(Application.nativeBuildVersion) || null;

function AndroidApp() {
  const {color} = useTheme();
  const release = useAndroidRelease({enabled: surface !== 'none'});
  const card = androidCard({
    surface,
    installedVersionCode,
    isPending: release.isPending,
    isError: release.isError,
    data: release.data,
  });
  if (!card) return null;
  return (
    <>
      <Text variant='label' tone='textMuted' style={styles.section}>
        Android app
      </Text>
      <View
        style={[
          styles.card,
          {backgroundColor: color.surface, borderColor: color.lineHeader},
        ]}>
        <Text variant='data' tone='textSecondary'>
          {card.status}
        </Text>
        {card.version ? (
          <>
            <Button
              label={surface === 'app' ? 'Update' : 'Download for Android'}
              onPress={() => void Linking.openURL(androidDownloadUrl())}
            />
            <Text variant='dataSmall' tone='textMuted'>
              {INSTALL_NOTE}
            </Text>
          </>
        ) : null}
      </View>
    </>
  );
}

const SECTION_MODES = [
  {value: 'turns', label: 'Turns'},
  {value: 'sectors', label: 'Game sectors'},
] as const;

function Sections() {
  const mode = useSectionPrefs(s => sectionModeOf(s.mode));
  const setMode = useSectionPrefs(s => s.setMode);
  return (
    <>
      <Text variant='label' tone='textMuted' style={styles.section}>
        Sections
      </Text>
      <Segment options={SECTION_MODES} value={mode} onChange={setMode} />
    </>
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
