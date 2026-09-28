import {QueryClientProvider} from '@tanstack/react-query';
import {
  DarkTheme,
  DefaultTheme,
  Stack,
  ThemeProvider,
  useGlobalSearchParams,
  usePathname,
  useRouter,
} from 'expo-router';
import {StatusBar} from 'expo-status-bar';
import {Pressable, StyleSheet, View} from 'react-native';
import 'react-native-reanimated';
import {SafeAreaProvider} from 'react-native-safe-area-context';

import {
  firstCornerOf,
  trackCorners,
  useSession,
  useSessionMap,
} from '@/src/data/sessions';
import {
  ThemeProvider as AppThemeProvider,
  carLabel,
  shortTrackName,
  space,
  useAppFonts,
  useLayout,
  useTheme,
} from '@/src/design';
import {
  compareHref,
  cornerHref,
  parseSelection,
  sessionHref,
  settingsHref,
} from '@/src/nav/routes';
import {AppChrome, type ChromeTab, Text, type WorkspaceTab} from '@/src/ui';
import {queryClient} from '@/src/utils/queryClient';

export default function RootLayout() {
  // Fonts load in the background; text falls back until they arrive.
  useAppFonts();
  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <AppThemeProvider>
          <Navigation />
        </AppThemeProvider>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}

/** Navigation chrome takes its colors and scheme from the design tokens. */
function Navigation() {
  const {scheme, color} = useTheme();
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  const navTheme = {
    ...base,
    colors: {
      ...base.colors,
      primary: color.accent,
      background: color.bg,
      card: color.surface,
      text: color.text,
      border: color.lineHeader,
    },
  };
  const {isWide} = useLayout();
  return (
    <ThemeProvider value={navTheme}>
      <View style={[styles.root, {backgroundColor: color.bg}]}>
        {isWide && <DesktopChrome />}
        <View style={styles.root}>
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: {backgroundColor: color.bg},
            }}
          />
        </View>
      </View>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
    </ThemeProvider>
  );
}

/** Which workspace the path is in; null off the session routes. */
function activeTab(pathname: string): WorkspaceTab | null {
  if (!pathname.startsWith('/session/')) return null;
  if (pathname.includes('/compare')) return 'compare';
  if (pathname.includes('/corner/')) return 'corner';
  return 'session';
}

/**
 * Feeds the data-free AppChrome from the URL: the open session and its
 * selection become the tab links, so switching tabs keeps context.
 */
function DesktopChrome() {
  const pathname = usePathname();
  const {id} = useGlobalSearchParams<{id?: string}>();
  const sessionId = activeTab(pathname) ? id : undefined;
  return sessionId ? (
    <SessionChrome sessionId={sessionId} tab={activeTab(pathname)} />
  ) : (
    <ChromeBar sessionId={null} tab={null} context='LMU' />
  );
}

/** "LMU · Road Atlanta · 911 GT3 R" once the session has loaded. */
function SessionChrome({
  sessionId,
  tab,
}: {
  sessionId: string;
  tab: WorkspaceTab | null;
}) {
  const {data} = useSession(sessionId);
  const context = data
    ? [
        data.sim.toUpperCase(),
        shortTrackName(data.track),
        carLabel(data.car).shortModel,
      ]
        .filter(Boolean)
        .join(' · ')
    : 'LMU';
  return <ChromeBar sessionId={sessionId} tab={tab} context={context} />;
}

function ChromeBar({
  sessionId,
  tab,
  context,
}: {
  sessionId: string | null;
  tab: WorkspaceTab | null;
  context: string;
}) {
  const router = useRouter();
  // Only the lap selection travels between tabs; corner and cursor belong
  // to the workspace that set them.
  const {laps, hl, c, n} = useGlobalSearchParams<{
    laps?: string;
    hl?: string;
    c?: string;
    n?: string;
  }>();
  const map = useSessionMap(sessionId ?? '');
  // Corner tab: the open corner, else the open section's first corner, else C1.
  const cornerN =
    tab === 'corner' && n
      ? Number(n)
      : (map.data && c
          ? firstCornerOf(trackCorners(map.data), Number(c))
          : null) ?? 1;
  const {laps: lapIds, hl: hlId} = parseSelection({laps, hl});
  const sel = {laps: lapIds, hl: hlId};
  const tabs: ChromeTab[] = [
    {
      key: 'session',
      label: 'Session',
      onPress: sessionId
        ? () => router.navigate(sessionHref(sessionId, sel))
        : undefined,
    },
    {
      key: 'compare',
      label: 'Compare',
      onPress: sessionId
        ? () => router.navigate(compareHref(sessionId, sel))
        : undefined,
    },
    {
      key: 'corner',
      label: 'Corner',
      onPress: sessionId
        ? () => router.navigate(cornerHref(sessionId, cornerN, sel))
        : undefined,
    },
  ];
  return (
    <AppChrome
      tabs={tabs}
      active={tab}
      context={context}
      right={
        <Pressable
          accessibilityRole='link'
          onPress={() => router.navigate(settingsHref())}
          hitSlop={space.md}>
          <Text variant='body' tone='textSecondary'>
            Settings
          </Text>
        </Pressable>
      }
    />
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
});
