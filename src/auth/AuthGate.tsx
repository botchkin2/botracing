import {type ReactNode} from 'react';
import {StyleSheet, View} from 'react-native';

import {space, useTheme} from '@/src/design';
import {Button, Text} from '@/src/ui';

import {unauthorizedPrompt} from './authState';
import {useAuthStore} from './authStore';
import {useSignIn} from './useSignIn';

/**
 * Covers the app while the sign-in is being read, and with a sign-in prompt
 * when the API has refused a request (a 401). The app underneath stays mounted
 * (the router must keep its navigator); only a cover goes over it. Before the
 * API closes to anonymous requests a 401 never happens, so a signed-out person
 * sees what they always did.
 */
export function AuthGate({children}: {children: ReactNode}) {
  const {color} = useTheme();
  const state = useAuthStore(s => s.state);
  const unauthorized = useAuthStore(s => s.unauthorized);
  const {busy, message, signIn} = useSignIn();

  return (
    <View style={styles.fill}>
      {children}
      {/* The SDK is still reading the stored sign-in. */}
      {state.kind === 'loading' && (
        <View style={[styles.cover, {backgroundColor: color.bg}]} />
      )}
      {state.kind !== 'loading' && unauthorized && (
        <View
          style={[styles.cover, styles.center, {backgroundColor: color.bg}]}>
          <Text variant='bodyStrong' style={styles.text}>
            {unauthorizedPrompt(state)}
          </Text>
          <Button
            label={busy ? 'Signing in…' : 'Sign in with Google'}
            onPress={() => void signIn()}
            disabled={busy}
          />
          {message ? (
            <Text tone='textMuted' style={styles.text}>
              {message}
            </Text>
          ) : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {flex: 1},
  cover: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 1000,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.lg,
    padding: space.xl,
  },
  text: {textAlign: 'center'},
});
