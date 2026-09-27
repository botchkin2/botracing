import {QueryClientProvider} from '@tanstack/react-query';
import {DarkTheme, DefaultTheme, Stack, ThemeProvider} from 'expo-router';
import {StatusBar} from 'expo-status-bar';
import 'react-native-reanimated';
import {SafeAreaProvider} from 'react-native-safe-area-context';

import {
  ThemeProvider as AppThemeProvider,
  useAppFonts,
  useTheme,
} from '@/src/design';
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
  return (
    <ThemeProvider value={navTheme}>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: {backgroundColor: color.bg},
        }}
      />
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
    </ThemeProvider>
  );
}
