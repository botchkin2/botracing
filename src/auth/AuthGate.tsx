import {type ReactNode} from 'react';
import {StyleSheet, View} from 'react-native';

import {space, useTheme} from '@/src/design';
import {Button, Text} from '@/src/ui';

import {gateView, unauthorizedPrompt} from './authState';
import {signInRequired} from './authSession';
import {useAuthStore} from './authStore';
import {LoginScreen} from './LoginScreen';
import {useSignIn} from './useSignIn';

/**
 * What the app shows for the sign-in state (authState.ts gateView):
 *   - while the stored sign-in is read: a blank screen, never the login screen;
 *   - signed out, in a build that can sign in (the web build): the login
 *     screen INSTEAD of the app, so nothing is mounted or fetched for a
 *     stranger;
 *   - otherwise the app, with a prompt over it when the API answers 401: a
 *     refused token ("sign in again"), or, in a build that cannot sign in yet
 *     (the Android app), a plain line saying an update is needed.
 * The app stays mounted under that prompt so the router keeps its navigator.
 */
export function AuthGate({children}: {children: ReactNode}) {
  const {color} = useTheme();
  const state = useAuthStore(s => s.state);
  const unauthorized = useAuthStore(s => s.unauthorized);
  const {busy, message, signIn} = useSignIn();
  const view = gateView(state, signInRequired);

  if (view === 'blank')
    return <View style={[styles.fill, {backgroundColor: color.bg}]} />;
  if (view === 'login') return <LoginScreen />;
  return (
    <View style={styles.fill}>
      {children}
      {unauthorized && (
        <View
          style={[styles.cover, styles.center, {backgroundColor: color.bg}]}>
          <Text variant='bodyStrong' style={styles.text}>
            {unauthorizedPrompt(state, signInRequired)}
          </Text>
          {signInRequired ? (
            <Button
              label={busy ? 'Signing in…' : 'Sign in with Google'}
              onPress={() => void signIn()}
              disabled={busy}
            />
          ) : null}
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
