// Fails if the dev-only seat sign-in (src/auth/devSeatSignIn.ts, tools/dev/
// seatToken.mjs) is in an exported web build. Run after `npm run build`:
//   node tools/ci/assertNoSeatSignIn.mjs dist
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const FORBIDDEN = ['__seat-token', 'DEV_SEAT_SIGNIN'];

/** Returns "<file>: <needle>" for every forbidden string found under dir. */
export function findSeatSignIn(dir, fsApi = fs) {
  const hits = [];
  const walk = d => {
    for (const entry of fsApi.readdirSync(d, {withFileTypes: true})) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        const text = fsApi.readFileSync(full, 'latin1');
        for (const needle of FORBIDDEN)
          if (text.includes(needle)) hits.push(`${full}: ${needle}`);
      }
    }
  };
  walk(dir);
  return hits;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2] ?? 'dist';
  if (!fs.existsSync(dir)) {
    console.error(`${dir} does not exist: build first`);
    process.exit(2);
  }
  const hits = findSeatSignIn(dir);
  if (hits.length) {
    console.error(`dev seat sign-in found in the build:\n${hits.join('\n')}`);
    process.exit(1);
  }
  console.log(`no seat sign-in in ${dir}`);
}
