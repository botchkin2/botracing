import {StyleSheet, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {space, useTheme} from '@/src/design';
import {AppMark, Button, Text} from '@/src/ui';

import {useAuthStore} from './authStore';
import {TRAY_SIGN_IN_LINE, inTrayWindow} from './traySignIn';
import {useSignIn} from './useSignIn';

const MAX_WIDTH = 360;

/**
 * The first thing a signed-out person sees: the mark, the name, one line, one
 * button. Nothing else on the screen and nothing fetched behind it.
 */
export function LoginScreen() {
  const {color} = useTheme();
  const insets = useSafeAreaInsets();
  const {busy, message, signIn} = useSignIn();
  const notice = useAuthStore(s => s.notice);
  const line = message ?? notice;
  return (
    <View
      style={[
        styles.fill,
        {
          backgroundColor: color.bg,
          paddingTop: insets.top + space.xl,
          paddingBottom: insets.bottom + space.xl,
        },
      ]}>
      <View style={styles.column}>
        <AppMark pt={56} />
        <Text variant='display' style={styles.center}>
          BotRacing
        </Text>
        {/* The tray's window has no Google: the tray signs it in. */}
        {inTrayWindow() ? (
          <Text tone='textSecondary' style={styles.center}>
            {TRAY_SIGN_IN_LINE}
          </Text>
        ) : (
          <>
            <Text tone='textSecondary' style={styles.center}>
              Sign in to see your sessions.
            </Text>
            <View style={styles.button}>
              <Button
                label={busy ? 'Signing in…' : 'Sign in with Google'}
                onPress={() => void signIn()}
                disabled={busy}
              />
            </View>
          </>
        )}
        {line ? (
          <Text tone='textMuted' style={styles.center}>
            {line}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {flex: 1, alignItems: 'center', justifyContent: 'center'},
  column: {
    width: '100%',
    maxWidth: MAX_WIDTH,
    alignItems: 'center',
    gap: space.lg,
    paddingHorizontal: space.xl,
  },
  center: {textAlign: 'center'},
  button: {marginTop: space.md},
});
