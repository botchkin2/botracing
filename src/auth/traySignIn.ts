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

/** The tray's uid, or null when it is signed out or the answer is not a uid. */
function toTrayUid(raw: unknown): string | null {
  return typeof raw === 'string' && raw !== '' ? raw : null;
}

/**
 * Makes the window's user the tray's user, on every load. A sign-in kept in
 * this storage is checked against the tray's uid (`tray_uid`, which spends
 * nothing of the tray's hourly allowance): the same user is kept, anyone else
 * is signed out, and a signed-out tray means a signed-out window. Storage can
 * outlive a tray user when a sign-out could not empty it (rake, thread 55
 * #3161). The user it ends up as must be the one the tray named, or it signs
 * out again. Never throws.
 */
export async function signInFromTray(
  deps: TraySignInDeps,
): Promise<'skipped' | 'signed-in' | 'signed-out' | 'refused' | 'failed'> {
  const {invoke, auth, signIn} = deps;
  try {
    await auth.authStateReady();
    const trayUid = toTrayUid(await invoke('tray_uid'));
    const mine = auth.currentUser?.uid ?? null;
    if (mine != null && mine === trayUid) return 'skipped';
    if (mine != null) await auth.signOut();
    if (trayUid == null) return mine != null ? 'signed-out' : 'skipped';
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
