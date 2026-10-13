// Runs the numbers audit over every session (read only). Skipped unless
// AUDIT_TOKEN_FILE is set (an ID token file, docs/TESTING.md), or AUDIT_NDJSON
// names a dump written by dumpSessions.test.ts:
//
//   AUDIT_TOKEN_FILE=<token file> npx jest tools/audit/numbersAudit
//   AUDIT_NDJSON=<sessions.ndjson> npx jest tools/audit/numbersAudit
//
// AUDIT_REPORT=<file> also writes the full report as JSON. Rerun after a
// Theme 1 / Theme 2 PR: the counts go to 0.
import {readFileSync, writeFileSync} from 'node:fs';

import {describe, expect, it} from '@jest/globals';

import {signInFromFile, walkSessions, type WalkedSession} from './allSessions';
import {auditSession, summarise, type Finding} from './numbersAudit';

const tokenFile = process.env.AUDIT_TOKEN_FILE;
const ndjson = process.env.AUDIT_NDJSON;
const run = tokenFile || ndjson ? describe : describe.skip;

run('numbers audit', () => {
  it('reports every finding over every session', async () => {
    const perSession: {id: string; label: string; findings: Finding[]}[] = [];
    const check = (
      s: Pick<WalkedSession, 'session' | 'laps' | 'map'>,
    ): void => {
      perSession.push({
        id: s.session.id,
        label: `${s.session.sessionType} ${s.session.track} ${s.session.startedAt}`,
        findings: auditSession(s.session, s.laps, s.map),
      });
    };
    if (ndjson) {
      for (const line of readFileSync(ndjson, 'utf8')
        .split('\n')
        .filter(Boolean))
        check(JSON.parse(line));
    } else {
      signInFromFile(tokenFile as string);
      await walkSessions(check, {
        onError: (id, e) => console.log(`skip ${id}: ${e}`),
      });
    }
    const report = summarise(perSession);
    if (process.env.AUDIT_REPORT)
      writeFileSync(
        process.env.AUDIT_REPORT,
        JSON.stringify({report, perSession}, null, 2),
      );
    console.log(
      `sessions ${report.sessions}\ncounts ${JSON.stringify(
        report.counts,
      )}\nsessions with ${JSON.stringify(report.sessionsWith)}\n` +
        report.byWhat
          .slice(0, 25)
          .map(([k, n]) => `${String(n).padStart(5)}  ${k}`)
          .join('\n') +
        '\nworst:\n' +
        report.worst
          .map(w => `${w.id} ${w.label} ${w.n} ${JSON.stringify(w.first[0])}`)
          .join('\n'),
    );
    expect(report.sessions).toBeGreaterThan(0);
  }, 900_000);
});
