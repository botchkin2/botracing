// Map a Firebase user to an owner key: writes users/{uid}.ownerKey, the one
// thing that makes the upload endpoint treat that user as an existing owner
// (Botkin's is 'botkin', so his sessions, ids and bucket paths keep working).
// Nothing in any client endpoint can write it; this is the reviewed way.
//
//   gcloud auth application-default login            (an owner of botracing-61)
//   gcloud auth application-default set-quota-project botracing-61
//   node functions/scripts/setOwnerKey.mjs <uid> <ownerKey> --dry-run
//   node functions/scripts/setOwnerKey.mjs <uid> <ownerKey>
//
// The uid is the Firebase Auth uid shown in the tray menu or in the console
// (Authentication > Users > User UID). It refuses, and writes nothing, when:
//   - the uid is not a Firebase Auth user (a typo);
//   - the key is not a safe path segment (uploadCore.ts SAFE_SEGMENT);
//   - users/{uid} already maps to a different key (it never overwrites one);
//   - anything already exists under the uid: a session, lap or recording with
//     ownerId == uid, or a file under traces|bands|slices|field|archive/{uid}/.
//     The user uploaded under their uid, so mapping now would split their data
//     across two owners. Laps, recordings and files are checked too: the
//     session doc is written last, so an interrupted first upload has none;
//   - another user is already mapped to the same key, or the key is another
//     Firebase user's uid (an unmapped user's implicit key is their uid).
// --dry-run prints the same before/plan and writes nothing.
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const PROJECT = 'botracing-61';
const BUCKET = 'botracing-61-lmu';
// Same rule the endpoint applies to an owner key (functions/src/uploadCore.ts).
const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,199}$/;

// Where an unmapped user's uploads land (functions/src/uploadCore.ts): the
// owner-scoped folders carry the owner key, and archive/ is prefixed with it.
const OWNER_FOLDERS = ['traces', 'bands', 'slices', 'field', 'archive'];

export class Refusal extends Error {}

// auth.getUser(uid); firestore: doc(path).get()/set(), collection(name).where()
// .limit().get(); hasFiles(prefix) says whether the bucket holds anything
// there. Returns {changed, before, after}; throws Refusal when it will not
// write.
export async function setOwnerKey({
  auth,
  firestore,
  hasFiles,
  uid,
  ownerKey,
  dryRun = false,
  log = console.log,
}) {
  if (!uid || !ownerKey)
    throw new Refusal('usage: <uid> <ownerKey> [--dry-run]');
  if (!SAFE_KEY.test(ownerKey) || ownerKey.includes('..'))
    throw new Refusal(`'${ownerKey}' is not a safe owner key`);

  try {
    await auth.getUser(uid);
  } catch (error) {
    throw new Refusal(`no Firebase Auth user ${uid}: ${error.message}`);
  }

  const ref = firestore.doc(`users/${uid}`);
  const snap = await ref.get();
  const before = snap.exists ? snap.data() : null;
  log(`users/${uid} before: ${JSON.stringify(before)}`);

  if (before?.ownerKey === ownerKey) {
    log(`already mapped to '${ownerKey}'; nothing to do`);
    return {changed: false, before, after: before};
  }
  if (before?.ownerKey)
    throw new Refusal(
      `users/${uid} is already mapped to '${before.ownerKey}'; refusing to overwrite it with '${ownerKey}'`,
    );

  // Anything already written under the uid is a split in waiting.
  for (const collection of ['sessions', 'laps', 'recordings']) {
    const found = await firestore
      .collection(collection)
      .where('ownerId', '==', uid)
      .limit(1)
      .get();
    if (!found.empty)
      throw new Refusal(
        `${collection} already exist with ownerId == ${uid}: this user has uploaded under their uid, so mapping now would split their data. Sort those out first.`,
      );
  }
  for (const folder of OWNER_FOLDERS) {
    if (await hasFiles(`${folder}/${uid}/`))
      throw new Refusal(
        `files already exist under ${folder}/${uid}/: this user has uploaded under their uid, so mapping now would split their data. Sort those out first.`,
      );
  }

  // An unmapped user's key is their uid: mapping onto another user's uid
  // would merge this user into theirs.
  if (ownerKey !== uid) {
    const isAnotherUser = await auth.getUser(ownerKey).then(
      () => true,
      () => false,
    );
    if (isAnotherUser)
      throw new Refusal(
        `owner key '${ownerKey}' is the uid of another Firebase user; their data lives under it`,
      );
  }

  const taken = await firestore
    .collection('users')
    .where('ownerKey', '==', ownerKey)
    .limit(1)
    .get();
  if (!taken.empty && taken.docs[0].id !== uid)
    throw new Refusal(
      `owner key '${ownerKey}' is already mapped to user ${taken.docs[0].id}`,
    );

  if (dryRun) {
    log(
      `dry run: would set users/${uid}.ownerKey = '${ownerKey}' (merge; other fields untouched)`,
    );
    return {changed: false, before, after: before};
  }
  // Merge: the usage counters on this doc stay as they are.
  await ref.set({ownerKey}, {merge: true});
  const after = (await ref.get()).data();
  log(`users/${uid} after:  ${JSON.stringify(after)}`);
  if (after?.ownerKey !== ownerKey)
    throw new Error(
      'the write did not stick: ownerKey is not set after the write',
    );
  return {changed: true, before, after};
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const [uid, ownerKey] = args.filter(a => !a.startsWith('--'));
  if (!uid || !ownerKey) {
    console.error(
      'usage: node functions/scripts/setOwnerKey.mjs <uid> <ownerKey> [--dry-run]',
    );
    process.exit(2);
  }
  process.env.GOOGLE_CLOUD_QUOTA_PROJECT ??= PROJECT;
  const require = createRequire(resolve(here, '../package.json'));
  const admin = require('firebase-admin');
  admin.initializeApp({projectId: PROJECT, storageBucket: BUCKET});
  const bucket = admin.storage().bucket();
  try {
    await setOwnerKey({
      auth: admin.auth(),
      firestore: admin.firestore(),
      hasFiles: async prefix => {
        const [files] = await bucket.getFiles({prefix, maxResults: 1});
        return files.length > 0;
      },
      uid,
      ownerKey,
      dryRun,
    });
  } catch (error) {
    console.error(
      error instanceof Refusal ? `REFUSED: ${error.message}` : error,
    );
    process.exit(error instanceof Refusal ? 1 : 3);
  }
}
