// Writes every session (detail, laps, map) as one JSON line each, so a check
// can run offline over the same data. Skipped unless AUDIT_TOKEN_FILE is set:
//
//   AUDIT_TOKEN_FILE=<id token file> AUDIT_OUT=<dir> npx jest tools/audit/dumpSessions
//
// Read only. The dump holds the user's lap data: keep it out of the repo.
import {appendFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

import {describe, expect, it} from '@jest/globals';

import {signInFromFile, walkSessions} from './allSessions';

const tokenFile = process.env.AUDIT_TOKEN_FILE;
const outDir = process.env.AUDIT_OUT;
const run = tokenFile && outDir ? describe : describe.skip;

run('dump every session', () => {
  it('writes sessions.ndjson', async () => {
    signInFromFile(tokenFile as string);
    mkdirSync(outDir as string, {recursive: true});
    const file = join(outDir as string, 'sessions.ndjson');
    writeFileSync(file, '');
    const errors: string[] = [];
    const {listed, visited} = await walkSessions(
      s => {
        appendFileSync(
          file,
          JSON.stringify({
            id: s.summary.id,
            session: s.session,
            laps: s.laps,
            map: s.map,
          }) + '\n',
        );
      },
      {onError: (id, e) => errors.push(`${id}: ${String(e)}`)},
    );
    console.log(`listed ${listed}, wrote ${visited}, failed ${errors.length}`);
    for (const e of errors.slice(0, 10)) console.log(e);
    expect(visited).toBeGreaterThan(0);
  }, 600_000);
});
