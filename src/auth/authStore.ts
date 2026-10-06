import {create} from 'zustand';

import {type AuthState, userChanged} from './authState';

// Not persisted: the Firebase SDK keeps the sign-in itself. This is only what
// the screens need to render now.
export type AuthStore = {
  state: AuthState;
  /** The API answered 401 since the last user change or sign-in. */
  unauthorized: boolean;
  /** A line for the login screen: why a redirect sign-in did not finish. */
  notice: string | null;
  setNotice: (notice: string | null) => void;
  markUnauthorized: () => void;
  clearUnauthorized: () => void;
  setState: (next: AuthState) => void;
};

export const useAuthStore = create<AuthStore>(set => ({
  state: {kind: 'loading'},
  unauthorized: false,
  notice: null,
  setNotice: notice => set({notice}),
  markUnauthorized: () => set({unauthorized: true}),
  clearUnauthorized: () => set({unauthorized: false}),
  setState: next => set({state: next}),
}));

/**
 * Moves the store to the new sign-in state. If the person changed (sign in,
 * sign out, switch account), the server data cached for the previous one is
 * dropped first and a 401 seen for them no longer applies.
 */
export function applyAuthState(
  next: AuthState,
  clearCache: () => void,
  store: AuthStore = useAuthStore.getState(),
): void {
  if (userChanged(store.state, next)) {
    clearCache();
    store.clearUnauthorized();
  }
  store.setState(next);
}
