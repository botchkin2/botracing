import {useCallback, useState} from 'react';

import {queryClient} from '@/src/utils/queryClient';

import {useAuthStore} from './authStore';
import {signIn, signOut} from './signIn';
import {type SignInResult, signInMessage} from './signInResult';

/** The Sign in / Sign out handlers for a button, and the line to show after. */
export function useSignIn() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const start = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    let result: SignInResult;
    try {
      result = await signIn();
    } catch (error) {
      result = {kind: 'failed', message: (error as Error).message};
    }
    setBusy(false);
    setMessage(signInMessage(result));
    if (result.kind === 'ok') {
      // Signing in again after a refused token: ask the API afresh.
      useAuthStore.getState().clearUnauthorized();
      void queryClient.invalidateQueries();
    }
  }, []);

  const end = useCallback(async () => {
    setBusy(true);
    try {
      await signOut();
    } finally {
      setBusy(false);
    }
  }, []);

  return {busy, message, signIn: start, signOut: end};
}
