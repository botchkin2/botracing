// Prints sign-in links for the seat-test user, so a coding seat can test the
// app signed in without Botkin's Google account (docs/TESTING.md). Open a link
// once in a live slot or a preview pane: the app signs in with the token in
// the address fragment and removes it from the address. The token is good for
// an hour; the sign-in it makes then renews itself.
//
// Only seat-test users: any other uid is refused, so this cannot mint a way
// into a real account. For Botkin, once (PowerShell, as an owner of
// botracing-61), the same Token Creator setup as smokeTokens.mjs, then:
//   $env:SMOKE_SERVICE_ACCOUNT = "<firebase-adminsdk service account email>"
//   node functions/scripts/mintTestToken.mjs --create        (makes the user)
// After that a seat on this PC runs it without --create:
//   node functions/scripts/mintTestToken.mjs --origin http://localhost:19101 --origin https://<preview>.web.app
// To upload test data as seat-test (sync.mjs --remote reads LAP_TOKEN_FILE), add
// --id-token-file <path>: it writes seat-test's ID token there (good for an hour).
// --custom-token-file <path>: the custom token a local test tray signs in with
// (BOTRACING_SEAT_TOKEN_FILE, docs/TESTING.md).
// A link is a credential for seat-test only: do not paste it anywhere shared.
import {writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const PROJECT = 'botracing-61';
export const TEST_UID = 'seat-test';
// The web app's public key (src/auth/firebase.web.ts); it names the project.
const WEB_API_KEY = 'AIzaSyBR6G55O4qJhLwaKAj6rybIedwWfPKHpw8';
const EXCHANGE =
  'https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken';

// A custom token for an ID token, which the upload API takes as a bearer token.
export async function exchangeForIdToken({
  customToken,
  fetch = globalThis.fetch,
  apiKey = WEB_API_KEY,
}) {
  const res = await fetch(`${EXCHANGE}?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({token: customToken, returnSecureToken: true}),
  });
  if (!res.ok)
    throw new Error(
      `token exchange failed: ${res.status} ${(await res.text()).slice(
        0,
        200,
      )}`,
    );
  return (await res.json()).idToken;
}

// The live site: seats test on localhost and preview channels, never there.
const LIVE_HOSTS = new Set([
  'botracing-61.web.app',
  'botracing-61.firebaseapp.com',
]);

// auth: firebase-admin's auth() (injectable for the test).
export async function mintTestLinks({
  auth,
  origins,
  create = false,
  uid = TEST_UID,
}) {
  if (!/^seat-test(-[a-z0-9]+)?$/.test(uid))
    throw new Error(`only seat-test users: refusing uid "${uid}"`);
  for (const origin of origins)
    if (LIVE_HOSTS.has(new URL(origin).hostname))
      throw new Error(
        `refusing the live site (${origin}): use a live slot or a preview channel`,
      );
  const exists = await auth
    .getUser(uid)
    .then(() => true)
    .catch(error => {
      if (error?.code === 'auth/user-not-found') return false;
      throw error;
    });
  if (!exists) {
    if (!create)
      throw new Error(
        `${uid} does not exist yet. Botkin creates it once: node functions/scripts/mintTestToken.mjs --create`,
      );
    await auth.createUser({uid});
  }
  const token = await auth.createCustomToken(uid);
  return {
    token,
    links: origins.map(origin => `${origin.replace(/\/+$/, '')}/#ct=${token}`),
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const serviceAccountId = process.env.SMOKE_SERVICE_ACCOUNT;
  if (!serviceAccountId) {
    console.error('Set SMOKE_SERVICE_ACCOUNT (see the top of this file).');
    process.exit(2);
  }
  const args = process.argv.slice(2);
  const origins = args.flatMap((a, i) =>
    a === '--origin' ? [args[i + 1]] : [],
  );
  process.env.GOOGLE_CLOUD_QUOTA_PROJECT ??= PROJECT;
  const require = createRequire(resolve(here, '../package.json'));
  const admin = require('firebase-admin');
  admin.initializeApp({projectId: PROJECT, serviceAccountId});
  try {
    const {token, links} = await mintTestLinks({
      auth: admin.auth(),
      origins: origins.length ? origins : ['http://localhost:19101'],
      create: args.includes('--create'),
    });
    for (const link of links) console.log(link);
    // A local test tray signs in from this file (BOTRACING_SEAT_TOKEN_FILE);
    // it has an hour to use it, then keeps itself signed in.
    const customFile = args[args.indexOf('--custom-token-file') + 1];
    if (args.includes('--custom-token-file') && customFile) {
      writeFileSync(customFile, token);
      console.log(`wrote seat-test's custom token to ${customFile}`);
    }
    const tokenFile = args[args.indexOf('--id-token-file') + 1];
    if (args.includes('--id-token-file') && tokenFile) {
      writeFileSync(tokenFile, await exchangeForIdToken({customToken: token}));
      console.log(`wrote seat-test's ID token to ${tokenFile}`);
    }
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
