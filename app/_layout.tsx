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
import {type ReactNode} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';
import {
  SafeAreaInsetsContext,
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import 'react-native-reanimated';

import {trackInfo} from '@/src/data/tracks';
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
  raceHref,
  parseSelection,
  sessionHref,
  sessionsHref,
  settingsHref,
  planHref,
  tracksHref,
} from '@/src/nav/routes';
import {
  destinationOf,
  type Destination,
  type SessionTab,
  sessionTabOf,
} from '@/src/nav/activeTab';
import {tabTarget, type TabName} from '@/src/nav/tabTarget';
import {
  AppChrome,
  BottomBar,
  type ChromeTab,
  SessionTabs,
  Text,
} from '@/src/ui';
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
  const stack = (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: {backgroundColor: color.bg},
      }}
    />
  );
  return (
    <ThemeProvider value={navTheme}>
      <View style={[styles.root, {backgroundColor: color.bg}]}>
        {isWide && <DesktopChrome />}
        <View style={styles.root}>
          {isWide ? stack : <PhoneFrame>{stack}</PhoneFrame>}
        </View>
      </View>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
    </ThemeProvider>
  );
}

/**
 * Feeds the data-free AppChrome from the URL: the open session and its
 * selection become the tab links, so switching tabs keeps context.
 */
function DesktopChrome() {
  const pathname = usePathname();
  const {id} = useGlobalSearchParams<{id?: string}>();
  if (pathname === '/plan') {
    return <ChromeBar sessionId={null} tab='plan' context='LMU' />;
  }
  if (pathname === '/tracks' || pathname.startsWith('/track/')) {
    const layout = id ? trackInfo(id)?.layout : null;
    return (
      <ChromeBar
        sessionId={null}
        tab={null}
        context={layout ? `LMU · ${layout}` : 'LMU'}
      />
    );
  }
  const sessionId = sessionTabOf(pathname) ? id : undefined;
  return sessionId ? (
    <SessionChrome sessionId={sessionId} tab={sessionTabOf(pathname)} />
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
  tab: SessionTab | 'plan' | null;
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

/**
 * One `go` for the desktop bar and the phone bars, so switching keeps the lap
 * selection and lands on the same places.
 */
function useWorkspaceGo(sessionId: string | null, tab: SessionTab | null) {
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
  return (name: TabName) => {
    const target = tabTarget(name, sessionId);
    switch (target.kind) {
      case 'sessions':
        return router.navigate(sessionsHref());
      case 'tracks':
        return router.navigate(tracksHref());
      case 'plan':
        return router.navigate(planHref());
      case 'settings':
        return router.navigate(settingsHref());
      case 'session':
        return router.navigate(sessionHref(target.sessionId, sel));
      case 'compare':
        return router.navigate(compareHref(target.sessionId, sel));
      case 'race':
        return router.navigate(raceHref(target.sessionId, sel));
      case 'corner':
        return router.navigate(cornerHref(target.sessionId, cornerN, sel));
    }
  };
}

const DESTINATIONS = [
  {key: 'sessions', label: 'Sessions'},
  {key: 'plan', label: 'Plan'},
  {key: 'settings', label: 'Settings'},
] as const;

const SESSION_TABS = [
  {key: 'session', label: 'Laps'},
  {key: 'compare', label: 'Compare'},
  {key: 'corner', label: 'Corner'},
  {key: 'race', label: 'Race'},
] as const;

/**
 * Phone navigation (below the desktop chrome width): the three destinations
 * that work without a session in a bottom bar, and inside a session a
 * Laps / Compare / Corner / Race row above the screen. Each bar takes its
 * safe-area inset, so the screens between them see none.
 */
function PhoneFrame({children}: {children: ReactNode}) {
  const pathname = usePathname();
  const {id} = useGlobalSearchParams<{id?: string}>();
  const insets = useSafeAreaInsets();
  const tab = sessionTabOf(pathname);
  const sessionId = tab ? id ?? null : null;
  const go = useWorkspaceGo(sessionId, tab);
  const {data} = useSession(sessionId ?? '');
  // The Race view is only for race sessions; while the session loads the
  // row shows the three that always apply.
  const items =
    data?.sessionType === 'R'
      ? SESSION_TABS
      : SESSION_TABS.filter(t => t.key !== 'race');
  const inner = {...insets, top: tab ? 0 : insets.top, bottom: 0};
  return (
    <View style={styles.root}>
      {tab && (
        <View style={{paddingTop: insets.top}}>
          <SessionTabs items={items} active={tab} onSelect={go} />
        </View>
      )}
      <SafeAreaInsetsContext.Provider value={inner}>
        <View style={styles.root}>{children}</View>
      </SafeAreaInsetsContext.Provider>
      <BottomBar<Destination>
        items={DESTINATIONS}
        active={destinationOf(pathname)}
        onSelect={go}
        bottomInset={insets.bottom}
      />
    </View>
  );
}

function ChromeBar({
  sessionId,
  tab,
  context,
}: {
  sessionId: string | null;
  tab: SessionTab | 'plan' | null;
  context: string;
}) {
  const router = useRouter();
  const go = useWorkspaceGo(sessionId, tab === 'plan' ? null : tab);
  const tabs: ChromeTab[] = [
    {key: 'session', label: 'Session', onPress: () => go('session')},
    {key: 'compare', label: 'Compare', onPress: () => go('compare')},
    {key: 'race', label: 'Race', onPress: () => go('race')},
    {key: 'corner', label: 'Corner', onPress: () => go('corner')},
    {key: 'plan', label: 'Plan', onPress: () => go('plan')},
  ];
  return (
    <AppChrome
      onHome={() => router.navigate(sessionsHref())}
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
