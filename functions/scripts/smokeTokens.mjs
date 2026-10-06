// Run the prod upload smoke (smokeUpload.mjs) with two throwaway users that
// this script creates and deletes. For Botkin to run himself: account creation
// is not something a coding session does.
//
// One-time setup (as an owner of botracing-61):
//   gcloud auth application-default login
//   gcloud auth application-default set-quota-project botracing-61
//   gcloud iam service-accounts list --project botracing-61
//       -> note the firebase-adminsdk-...@botracing-61.iam.gserviceaccount.com
//   gcloud iam service-accounts add-iam-policy-binding <that email> //       --member user:<your email> --role roles/iam.serviceAccountTokenCreator
//
// Run:
//   SMOKE_SERVICE_ACCOUNT=<that email> FIREBASE_WEB_API_KEY=<web api key> //     node functions/scripts/smokeTokens.mjs
//
// Both variables are required. A personal login cannot sign a custom token
// itself and a PC has no metadata server, so the script signs as the Admin SDK
// service account (that is what the Token Creator role above allows). The web
// API key is the public one in Firebase console > Project settings > General
// (or `firebase apps:sdkconfig WEB`); it identifies the project and is not a
// secret.
//
// What it does: Admin creates users smoke-a-xxxx and smoke-b-xxxx, mints a
// custom token for each, exchanges them at the Identity Toolkit for ID tokens,
// runs smokeUpload.mjs with those tokens, then deletes both users, the
// users/{uid} usage docs, and any sessions/bands files still left under them,
// whether the smoke passed, failed or was stopped with Ctrl+C. The users are
// never given a password or an email.
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const PROJECT = 'botracing-61';
const BUCKET = 'botracing-61-lmu';
const EXCHANGE =
  'https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken';

// admin: firebase-admin's auth() and firestore() (injectable for the test);
// fetch: injectable; runSmoke(env, signal) -> exit code; sweep(uid) removes
// anything the smoke left under that user; signal (Ctrl+C) stops the run at the
// next step and the cleanup still happens.
export async function smokeWithTemporaryUsers({
  auth,
  firestore,
  fetch = globalThis.fetch,
  apiKey,
  runSmoke,
  sweep = async () => {},
  signal = new AbortController().signal,
  log = console.log,
}) {
  const tag = randomBytes(3).toString('hex');
  const uids = [`smoke-a-${tag}`, `smoke-b-${tag}`];
  const created = [];
  let code = 1;
  try {
    for (const uid of uids) {
      signal.throwIfAborted();
      await auth.createUser({uid, disabled: false});
      created.push(uid);
    }
    log(`created ${created.join(', ')}`);
    const idTokens = [];
    for (const uid of uids) {
      signal.throwIfAborted();
      const customToken = await auth.createCustomToken(uid);
      const res = await fetch(`${EXCHANGE}?key=${encodeURIComponent(apiKey)}`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({token: customToken, returnSecureToken: true}),
      });
      if (!res.ok)
        throw new Error(
          `token exchange for ${uid} failed: ${res.status} ${(
            await res.text()
          ).slice(0, 200)}`,
        );
      idTokens.push((await res.json()).idToken);
    }
    log('exchanged both custom tokens for ID tokens');
    signal.throwIfAborted();
    code = await runSmoke(
      {SMOKE_TOKEN_A: idTokens[0], SMOKE_TOKEN_B: idTokens[1]},
      signal,
    );
  } catch (error) {
    log(`FAILED: ${error.message}`);
  } finally {
    for (const uid of created) {
      await sweep(uid).catch(e => log(`could not sweep ${uid}: ${e.message}`));
      // The usage counters the endpoint keeps per user.
      await firestore
        .doc(`users/${uid}`)
        .delete()
        .catch(e => log(`could not delete users/${uid}: ${e.message}`));
      await auth
        .deleteUser(uid)
        .then(() => log(`deleted ${uid}`))
        .catch(e => log(`COULD NOT DELETE ${uid}: ${e.message}`));
    }
  }
  return code;
}

function runSmokeScript(env, signal) {
  return new Promise(done => {
    const child = spawn(process.execPath, [resolve(here, 'smokeUpload.mjs')], {
      stdio: 'inherit',
      env: {...process.env, ...env},
      signal,
    });
    child.on('exit', code => done(code ?? 1));
    // An abort (Ctrl+C) kills the child and lands here.
    child.on('error', () => done(1));
  });
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const apiKey = process.env.FIREBASE_WEB_API_KEY;
  const serviceAccountId = process.env.SMOKE_SERVICE_ACCOUNT;
  if (!apiKey || !serviceAccountId) {
    console.error(
      'Set FIREBASE_WEB_API_KEY and SMOKE_SERVICE_ACCOUNT (see the top of this file).',
    );
    process.exit(2);
  }
  // Admin calls with user credentials need a quota project; this is the same
  // as `gcloud auth application-default set-quota-project`.
  process.env.GOOGLE_CLOUD_QUOTA_PROJECT ??= PROJECT;
  const require = createRequire(resolve(here, '../package.json'));
  const admin = require('firebase-admin');
  admin.initializeApp({
    projectId: PROJECT,
    serviceAccountId,
    storageBucket: BUCKET,
  });
  const firestore = admin.firestore();
  const bucket = admin.storage().bucket();

  // Ctrl+C stops the run at the next step and the cleanup still happens; a
  // second Ctrl+C gives up and leaves the users (named in the output).
  const abort = new AbortController();
  process.once('SIGINT', () => {
    console.log(
      '\nstopping; deleting the throwaway users first (Ctrl+C again to give up)',
    );
    abort.abort();
    process.once('SIGINT', () => process.exit(130));
  });

  const code = await smokeWithTemporaryUsers({
    auth: admin.auth(),
    firestore,
    apiKey,
    runSmoke: runSmokeScript,
    signal: abort.signal,
    // What smokeUpload leaves if its own cleanup failed.
    sweep: async uid => {
      const sessions = await firestore
        .collection('sessions')
        .where('ownerId', '==', uid)
        .get();
      for (const doc of sessions.docs) await doc.ref.delete();
      await bucket.deleteFiles({prefix: `bands/${uid}/`, force: true});
    },
  });
  process.exit(abort.signal.aborted ? 130 : code);
}
