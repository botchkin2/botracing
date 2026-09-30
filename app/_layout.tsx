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
import {useSession, useSessions} from '@/src/data/sessions';
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
  destinationOf,
  type Destination,
  type SessionTab,
  sessionTabOf,
} from '@/src/nav/activeTab';
import {sessionsHref, settingsHref} from '@/src/nav/routes';
import {AppChrome, BottomBar, type ChromeTab, Text} from '@/src/ui';
import {planCombos} from '@/src/features/plan/model';
import {useWorkspaceGo} from '@/src/workspace/useWorkspaceGo';
import {queryClient} from '@/src/utils/queryClient';

// Same window the Plan screen reads, so the two agree on the combos.
const PLAN_HISTORY_DAYS = 3650;

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
  const planCombo = usePlanCombo(pathname, id);
  if (pathname === '/plan') {
    return (
      <ChromeBar
        sessionId={null}
        tab='plan'
        context='LMU'
        planCombo={planCombo}
      />
    );
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
    <SessionChrome
      sessionId={sessionId}
      tab={sessionTabOf(pathname)}
      planCombo={planCombo}
    />
  ) : (
    <ChromeBar
      sessionId={null}
      tab={null}
      context='LMU'
      planCombo={planCombo}
    />
  );
}

/** "LMU · Road Atlanta · 911 GT3 R" once the session has loaded. */
function SessionChrome({
  sessionId,
  tab,
  planCombo,
}: {
  sessionId: string;
  tab: SessionTab | 'plan' | null;
  planCombo?: string;
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
  return (
    <ChromeBar
      sessionId={sessionId}
      tab={tab}
      context={context}
      planCombo={planCombo}
    />
  );
}

const DESTINATIONS = [
  {key: 'sessions', label: 'Sessions'},
  {key: 'plan', label: 'Plan'},
  {key: 'settings', label: 'Settings'},
] as const;

/**
 * The Plan link's combo: the open session's track and car, or the first car
 * driven at the open Track page's layout. Elsewhere undefined, so Plan opens on
 * its own default (the combo driven last).
 */
function usePlanCombo(pathname: string, id: string | undefined) {
  const inSession = sessionTabOf(pathname) != null && id != null;
  const onTrack = pathname.startsWith('/track/') && id != null;
  const session = useSession(id ?? '', inSession);
  const sessions = useSessions({ageDays: PLAN_HISTORY_DAYS}, onTrack);
  if (inSession && session.data) {
    return `${session.data.trackId}|${carLabel(session.data.car).model}`;
  }
  if (onTrack) {
    return planCombos(sessions.data?.items ?? []).find(c => c.trackId === id)
      ?.key;
  }
  return undefined;
}

/**
 * Phone navigation (below the desktop chrome width): the three destinations
 * that work without a session in a bottom bar. The Laps / Compare / Corner /
 * Race row belongs under each session screen's title (`SessionNav`). The bar
 * takes the bottom safe-area inset, so the screens above it see none.
 */
function PhoneFrame({children}: {children: ReactNode}) {
  const pathname = usePathname();
  const {id} = useGlobalSearchParams<{id?: string}>();
  const insets = useSafeAreaInsets();
  const go = useWorkspaceGo(null, null, usePlanCombo(pathname, id));
  return (
    <View style={styles.root}>
      <SafeAreaInsetsContext.Provider value={{...insets, bottom: 0}}>
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
  planCombo,
}: {
  sessionId: string | null;
  tab: SessionTab | 'plan' | null;
  context: string;
  planCombo?: string;
}) {
  const router = useRouter();
  const go = useWorkspaceGo(sessionId, tab === 'plan' ? null : tab, planCombo);
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
