// Headers for a tool that reads the lap API (/api/lmu) as the signed-in user.
// The API takes the owner from a Firebase ID token (functions/src/ownerAccess.ts);
// with no token it is a 401. LAP_TOKEN_FILE is the same file the remote store
// uses (remoteStore.mjs): the user's current ID token, read on every call so a
// refreshed token is picked up. Unset: no header, which only works while the
// API still reads anonymous requests as the legacy owner.
import {readFileSync} from 'node:fs';

export function apiAuthHeaders(env = process.env) {
  const file = env.LAP_TOKEN_FILE;
  if (!file) return {};
  const token = readFileSync(file, 'utf8').trim();
  return token ? {authorization: `Bearer ${token}`} : {};
}
