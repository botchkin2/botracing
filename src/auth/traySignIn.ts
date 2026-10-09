// The tray's own window (desktop/src-tauri/src/viewer.rs) shows this app with no
// Google in the webview: the tray signs the window in as the tray's user. The
// page asks the tray over Tauri's IPC (never a URL, so the token is not in
// WebView2's history) and signs in with the custom token it gets back, then
// checks it is the user the tray said. Outside the tray window none of this
// exists. Pure over what it is given, so it is tested without Tauri.
//
// Pit-wall thread 55: rake's design, apex's order.

/** The IPC call the tray window provides (`window.__TAURI_INTERNALS__.invoke`). */
export type Invoke = (command: string) => Promise<unknown>;

type TauriWindow = {
  __TAURI_INTERNALS__?: {invoke?: unknown};
};

/** The window's IPC, or null when the page is not in the tray's window. */
export function trayInvoke(win: unknown): Invoke | null {
  const invoke = (win as TauriWindow | undefined)?.__TAURI_INTERNALS__?.invoke;
  return typeof invoke === 'function' ? (invoke as Invoke) : null;
}

/** True inside the tray's window (web only; false in Node and on the phone). */
export function inTrayWindow(): boolean {
  return typeof window !== 'undefined' && trayInvoke(window) !== null;
}

/** What the tray window's login screen says instead of offering Google. */
export const TRAY_SIGN_IN_LINE = 'Sign in from the tray icon';

export interface TrayToken {
  customToken: string;
  uid: string;
}

/** The tray's answer, or null when it is not a token and a uid. */
export function toTrayToken(raw: unknown): TrayToken | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  return typeof o.customToken === 'string' &&
    o.customToken !== '' &&
    typeof o.uid === 'string' &&
    o.uid !== ''
    ? {customToken: o.customToken, uid: o.uid}
    : null;
}

type TrayAuth = {
  authStateReady: () => Promise<void>;
  currentUser: {uid: string} | null;
  signOut: () => Promise<void>;
};

export type TraySignInDeps = {
  invoke: Invoke;
  auth: TrayAuth;
  signIn: (customToken: string) => Promise<unknown>;
};

/**
 * Signs the window in as the tray's user when it is signed out. The user it
 * ends up as must be the one the tray named, or it signs out again: the window
 * is never signed in as someone the tray is not. Never throws.
 */
export async function signInFromTray(
  deps: TraySignInDeps,
): Promise<'skipped' | 'signed-in' | 'refused' | 'failed'> {
  const {invoke, auth, signIn} = deps;
  try {
    await auth.authStateReady();
    // Signed in already (Firebase keeps and renews it): nothing to ask, and
    // nothing spent of the tray's hourly allowance. A different tray user
    // always goes through the tray's sign-out, which empties this storage.
    if (auth.currentUser) return 'skipped';
    const token = toTrayToken(await invoke('viewer_token'));
    if (!token) return 'failed';
    await signIn(token.customToken);
    // Read again: signIn changed it, which the compiler cannot see.
    const user = auth.currentUser as {uid: string} | null;
    if (user?.uid !== token.uid) {
      await auth.signOut();
      return 'refused';
    }
    return 'signed-in';
  } catch {
    return 'failed';
  }
}

/** The window's Sign out is the tray's: it signs the tray out, empties this window's storage and closes it. */
export async function traySignOut(invoke: Invoke): Promise<void> {
  await invoke('sign_out');
}
