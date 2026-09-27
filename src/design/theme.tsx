import {
  IBMPlexMono_400Regular,
  IBMPlexMono_500Medium,
  IBMPlexMono_600SemiBold,
} from '@expo-google-fonts/ibm-plex-mono';
import {
  IBMPlexSansCondensed_400Regular,
  IBMPlexSansCondensed_500Medium,
  IBMPlexSansCondensed_600SemiBold,
} from '@expo-google-fonts/ibm-plex-sans-condensed';
import {useFonts} from 'expo-font';
import {createContext, type ReactNode, useContext, useMemo} from 'react';
import {useColorScheme} from 'react-native';

import {type ColorTokens, colors, lapColors, type Scheme} from './tokens';

export type Theme = {
  scheme: Scheme;
  color: ColorTokens;
  lapColors: readonly string[];
};

const ThemeContext = createContext<Theme | null>(null);

/** Dark is the default; light only when the system asks for it. */
export function ThemeProvider({
  scheme: forced,
  children,
}: {
  scheme?: Scheme;
  children: ReactNode;
}) {
  const system = useColorScheme();
  const scheme: Scheme = forced ?? (system === 'light' ? 'light' : 'dark');
  const theme = useMemo(
    () => ({scheme, color: colors[scheme], lapColors: lapColors[scheme]}),
    [scheme],
  );
  return (
    <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): Theme {
  const theme = useContext(ThemeContext);
  if (!theme) throw new Error('useTheme outside ThemeProvider');
  return theme;
}

/**
 * Loads IBM Plex Sans Condensed and Mono. Returns true once loaded or failed:
 * text falls back to the system font rather than blocking first paint.
 */
export function useAppFonts(): boolean {
  const [loaded, error] = useFonts({
    IBMPlexSansCondensed_400Regular,
    IBMPlexSansCondensed_500Medium,
    IBMPlexSansCondensed_600SemiBold,
    IBMPlexMono_400Regular,
    IBMPlexMono_500Medium,
    IBMPlexMono_600SemiBold,
  });
  return loaded || error != null;
}
