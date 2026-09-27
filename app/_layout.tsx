import {QueryClientProvider} from '@tanstack/react-query';
import {DarkTheme, DefaultTheme, Stack, ThemeProvider} from 'expo-router';
import {StatusBar} from 'expo-status-bar';
import {Platform, StyleSheet, View} from 'react-native';
import 'react-native-reanimated';
import {SafeAreaProvider} from 'react-native-safe-area-context';

import {useColorScheme} from '@/hooks/use-color-scheme';
import {WebHeader} from '@/src/components';
import {ThemeProvider as AppThemeProvider, useAppFonts} from '@/src/design';
import {queryClient} from '@/src/utils/queryClient';

export const unstable_settings = {
  initialRouteName: 'index',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();
  // Fonts load in the background; text falls back until they arrive.
  useAppFonts();

  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <AppThemeProvider>
          <ThemeProvider
            value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
            <View style={styles.container}>
              {Platform.OS === 'web' && <WebHeader />}
              <Stack
                screenOptions={{
                  headerShown: false,
                }}>
                <Stack.Screen name='index' />
                <Stack.Screen name='session-analysis' />
                <Stack.Screen name='multi-lap-comparison' />
                <Stack.Screen name='cache-management' />
                <Stack.Screen name='modal' options={{presentation: 'modal'}} />
              </Stack>
            </View>
            <StatusBar style='auto' />
          </ThemeProvider>
        </AppThemeProvider>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
