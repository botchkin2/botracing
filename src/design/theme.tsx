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
import {type ColorTokens, color, lapColors} from './tokens';

export type Theme = {
  color: ColorTokens;
  lapColors: readonly string[];
};

const THEME: Theme = {color, lapColors};

/** The app's colours. Dark only, so this is a constant; kept as a hook so
 *  components read colours in one way. */
export function useTheme(): Theme {
  return THEME;
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
