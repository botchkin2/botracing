// A seat-test session from its refresh token, for the live gate in CI (roadmap
// 2w, pit-wall thread 1 #5037, #5047): the only credential CI holds is
// seat-test's refresh token (secret SEAT_TEST_REFRESH_TOKEN). It is exchanged
// here for an ID token (the upload API's bearer) and a record the web SDK
// restores a signed-in user from (seedRecord, written by livePane). A refresh
// token can only ever be the account it was issued for, and any uid but
// seat-test is refused, so a mix-up cannot run the gate as a real person.

// The web app's public key (src/auth/firebase.web.ts); it names the project.
export const WEB_API_KEY = 'AIzaSyBR6G55O4qJhLwaKAj6rybIedwWfPKHpw8';
export const SEAT_UID = 'seat-test';
const REFRESH = 'https://securetoken.googleapis.com/v1/token';

/** {uid, idToken, refreshToken, expiresAtMs} for a seat-test refresh token. */
export async function seatSession({
  refreshToken,
  fetch = globalThis.fetch,
  apiKey = WEB_API_KEY,
  now = Date.now,
}) {
  const res = await fetch(`${REFRESH}?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: {'content-type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken.trim(),
    }).toString(),
  });
  if (!res.ok)
    throw new Error(`refresh failed: ${res.status} (is the seat-test refresh token current?)`);
  const body = await res.json();
  if (body.user_id !== SEAT_UID)
    throw new Error(`the refresh token is not seat-test's (${body.user_id ? 'another uid' : 'no uid'}): refused`);
  return {
    uid: body.user_id,
    idToken: body.id_token,
    // Google may rotate it; the new one is what the browser keeps.
    refreshToken: body.refresh_token ?? refreshToken.trim(),
    expiresAtMs: now() + Number(body.expires_in ?? 3600) * 1000,
  };
}

/**
 * The record the Firebase web SDK (@firebase/auth, UserImpl._fromJSON) restores
 * a signed-in user from, in IndexedDB `firebaseLocalStorageDb` /
 * `firebaseLocalStorage`, keyed `firebase:authUser:<apiKey>:[DEFAULT]`.
 */
export function seedRecord(session, apiKey = WEB_API_KEY) {
  return {
    fbase_key: `firebase:authUser:${apiKey}:[DEFAULT]`,
    value: {
      uid: session.uid,
      emailVerified: false,
      isAnonymous: false,
      providerData: [],
      stsTokenManager: {
        refreshToken: session.refreshToken,
        accessToken: session.idToken,
        expirationTime: session.expiresAtMs,
      },
      apiKey,
      appName: '[DEFAULT]',
    },
  };
}

/** Script for the page: writes the record where the SDK looks, before the app loads. */
export function seedScript(record) {
  return `new Promise((ok, fail) => {
  const open = indexedDB.open('firebaseLocalStorageDb', 1);
  open.onupgradeneeded = () =>
    open.result.createObjectStore('firebaseLocalStorage', {keyPath: 'fbase_key'});
  open.onerror = () => fail(String(open.error));
  open.onsuccess = () => {
    const tx = open.result.transaction('firebaseLocalStorage', 'readwrite');
    tx.objectStore('firebaseLocalStorage').put(${JSON.stringify(record)});
    tx.oncomplete = () => { open.result.close(); ok(true); };
    tx.onerror = () => fail(String(tx.error));
  };
})`;
}
