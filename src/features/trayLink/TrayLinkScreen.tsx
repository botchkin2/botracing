import {useLocalSearchParams} from 'expo-router';
import {useState} from 'react';
import {StyleSheet, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {accountLabel, useAuthStore, useSignIn} from '@/src/auth';
import {requestTrayCode} from '@/src/data/tray/client';
import {space, useTheme} from '@/src/design';
import {AppMark, Button, Text} from '@/src/ui';

import {callbackUrl, parseTrayLink} from './model';

const MAX_WIDTH = 360;

type Step = 'ask' | 'working' | 'sent' | 'rate-limited' | 'failed';

/**
 * The tray's sign-in page (the tray opens it with ?port&state&challenge). The
 * app's gate has already signed the person in; this asks one thing: sign
 * BotRacing on this PC in as this account? A click is required, and the
 * account is shown, so a hostile page cannot silently connect someone's tray
 * to another account. Continue asks for a one-time code and sends the browser
 * to the tray's own loopback address with it (never a token, never a host
 * taken from the address).
 */
export function TrayLinkScreen() {
  const {color} = useTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    port?: string;
    state?: string;
    challenge?: string;
  }>();
  const request = parseTrayLink(params);
  const email = accountLabel(useAuthStore(s => s.state));
  const {signOut} = useSignIn();
  const [step, setStep] = useState<Step>('ask');

  async function connect() {
    if (!request) return;
    setStep('working');
    const result = await requestTrayCode(request.challenge);
    if (result.kind !== 'ok') {
      setStep(result.kind === 'rate-limited' ? 'rate-limited' : 'failed');
      return;
    }
    setStep('sent');
    window.location.assign(callbackUrl(request, result.code));
  }

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
        {!request ? (
          <Text variant='display' style={styles.center}>
            Open this from the tray
          </Text>
        ) : step === 'sent' ? (
          <Text variant='display' style={styles.center}>
            Connected
          </Text>
        ) : (
          <>
            <Text variant='display' style={styles.center}>
              Sign in BotRacing on this PC?
            </Text>
            <Text variant='bodyStrong' style={styles.center}>
              {email}
            </Text>
            <View style={styles.buttons}>
              <Button
                label={step === 'working' ? 'Connecting…' : 'Continue'}
                onPress={() => void connect()}
                disabled={step === 'working'}
              />
              <Button
                label='Use another account'
                kind='tertiary'
                onPress={() => void signOut()}
                disabled={step === 'working'}
              />
            </View>
            {step === 'rate-limited' && (
              <Text tone='textMuted' style={styles.center}>
                Too many tries. Wait a few minutes.
              </Text>
            )}
            {step === 'failed' && (
              <Text tone='textMuted' style={styles.center}>
                Couldn’t connect. Try again.
              </Text>
            )}
          </>
        )}
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
  buttons: {marginTop: space.md, alignItems: 'center', gap: space.sm},
});
