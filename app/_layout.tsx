import {QueryClientProvider} from '@tanstack/react-query';
import {
  DarkTheme,
  DefaultTheme,
  Stack,
  ThemeProvider,
  useGlobalSearchParams,
  usePathname,
} from 'expo-router';
import {StatusBar} from 'expo-status-bar';
import {type ReactNode, useEffect} from 'react';
import {StyleSheet, View} from 'react-native';
import {
  SafeAreaInsetsContext,
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import 'react-native-reanimated';

import {AuthGate, startAuthSession} from '@/src/auth';
import {
  ThemeProvider as AppThemeProvider,
  useAppFonts,
  useLayout,
  useTheme,
} from '@/src/design';
import {
  destinationOf,
  type Destination,
  sessionTabOf,
} from '@/src/nav/activeTab';
import {BottomBar} from '@/src/ui';
import {queryClient} from '@/src/utils/queryClient';
import {DesktopChrome} from '@/src/workspace/DesktopChrome';
import {usePlanCombo} from '@/src/workspace/usePlanCombo';
import {useWorkspaceGo} from '@/src/workspace/useWorkspaceGo';

export default function RootLayout() {
  // Fonts load in the background; text falls back until they arrive.
  useAppFonts();
  // Follow the sign-in for the life of the app.
  useEffect(() => startAuthSession(), []);
  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <AppThemeProvider>
          <AuthGate>
            <Navigation />
          </AuthGate>
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
  const {isDesktop} = useLayout();
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
        {isDesktop && <DesktopChrome />}
        <View style={styles.root}>
          {isDesktop ? stack : <PhoneFrame>{stack}</PhoneFrame>}
        </View>
      </View>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
    </ThemeProvider>
  );
}

const DESTINATIONS = [
  {key: 'sessions', label: 'Sessions'},
  {key: 'plan', label: 'Plan'},
  {key: 'settings', label: 'Settings'},
] as const;

/**
 * Phone navigation (below 900 pt): the three destinations
 * that work without a session in a bottom bar. The Laps / Compare / Corner /
 * Race row belongs under each session screen's title (`SessionNav`). The bar
 * takes the bottom safe-area inset, so the screens above it see none.
 */
function PhoneFrame({children}: {children: ReactNode}) {
  const pathname = usePathname();
  const {id} = useGlobalSearchParams<{id?: string}>();
  const insets = useSafeAreaInsets();
  const tab = sessionTabOf(pathname);
  const plan = usePlanCombo(
    tab ? id ?? null : null,
    pathname.startsWith('/track/') ? id ?? null : null,
    false,
  );
  const go = useWorkspaceGo({
    sessionId: null,
    selection: {},
    cornerN: 1,
    planCombo: plan.key,
  });
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

const styles = StyleSheet.create({
  root: {flex: 1},
});
