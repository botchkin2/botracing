// The remote store as sync.mjs configures it: where the API is and where the
// ID token comes from.
//   LAP_API         the upload function's base URL (default storeClient.defaultApi)
//   LAP_TOKEN_FILE  a file holding the user's current Firebase ID token. Read on
//                   every request: the tray app rewrites it when it refreshes.
import {readFileSync} from 'node:fs';
import {defaultApi, httpStore, uidOfToken} from './storeClient.mjs';

export async function openRemoteStore(env = process.env) {
  const file = env.LAP_TOKEN_FILE;
  if (!file)
    throw new Error('--remote needs LAP_TOKEN_FILE (the ID token file)');
  const token = () => readFileSync(file, 'utf8').trim();
  uidOfToken(token()); // a file that is not a token fails here, not mid-upload
  return httpStore({api: env.LAP_API || defaultApi, token});
}

// The measured surface is folded after a sync (surface.mjs), which reads and
// writes Firestore with Admin credentials (store.connect). A remote sync has
// none, so it must not try: it would only log "surface: not updated" on every
// run. The PC uploader, which has the credentials, does the fold.
export const foldsSurface = ({local, remote, tracks}) =>
  !local && !remote && tracks > 0;
