// Run the prod upload smoke (smokeUpload.mjs) with two throwaway users that
// this script creates and deletes. For Botkin to run himself: account creation
// is not something a coding session does.
//
//   gcloud auth application-default login          (once; an owner of botracing-61)
//   FIREBASE_WEB_API_KEY=<web api key> node functions/scripts/smokeTokens.mjs
//
// The web API key is the public one in Firebase console > Project settings >
// General > Web API Key (or `firebase apps:sdkconfig WEB`); it identifies the
// project and is not a secret.
//
// What it does: Admin creates users smoke-a-xxxx and smoke-b-xxxx, mints a
// custom token for each, exchanges them at the Identity Toolkit for ID tokens,
// runs smokeUpload.mjs with those tokens, then deletes both users (and the
// users/{uid} usage docs the endpoint wrote for them), whether or not the
// smoke passed. The users are never given a password or an email.
//
// If minting fails with a permission error on signBlob, your account needs
// "Service Account Token Creator" on the project's Admin SDK service account
// (set SMOKE_SERVICE_ACCOUNT to its email to sign as it).
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const PROJECT = 'botracing-61';
const EXCHANGE =
  'https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken';

// admin: firebase-admin's auth() and firestore() (injectable for the test);
// fetch: injectable; runSmoke(env) -> exit code.
export async function smokeWithTemporaryUsers({
  auth,
  firestore,
  fetch = globalThis.fetch,
  apiKey,
  runSmoke,
  log = console.log,
}) {
  const tag = randomBytes(3).toString('hex');
  const uids = [`smoke-a-${tag}`, `smoke-b-${tag}`];
  const created = [];
  let code = 1;
  try {
    for (const uid of uids) {
      await auth.createUser({uid, disabled: false});
      created.push(uid);
    }
    log(`created ${created.join(', ')}`);
    const idTokens = [];
    for (const uid of uids) {
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
    code = await runSmoke({
      SMOKE_TOKEN_A: idTokens[0],
      SMOKE_TOKEN_B: idTokens[1],
    });
  } catch (error) {
    log(`FAILED: ${error.message}`);
  } finally {
    for (const uid of created) {
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

function runSmokeScript(env) {
  return new Promise(done => {
    const child = spawn(process.execPath, [resolve(here, 'smokeUpload.mjs')], {
      stdio: 'inherit',
      env: {...process.env, ...env},
    });
    child.on('exit', code => done(code ?? 1));
    child.on('error', () => done(1));
  });
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const apiKey = process.env.FIREBASE_WEB_API_KEY;
  if (!apiKey) {
    console.error('Set FIREBASE_WEB_API_KEY (see the top of this file).');
    process.exit(2);
  }
  const require = createRequire(resolve(here, '../package.json'));
  const admin = require('firebase-admin');
  admin.initializeApp({
    projectId: PROJECT,
    ...(process.env.SMOKE_SERVICE_ACCOUNT
      ? {serviceAccountId: process.env.SMOKE_SERVICE_ACCOUNT}
      : {}),
  });
  const code = await smokeWithTemporaryUsers({
    auth: admin.auth(),
    firestore: admin.firestore(),
    apiKey,
    runSmoke: runSmokeScript,
  });
  process.exit(code);
}
