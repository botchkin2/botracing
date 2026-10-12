// Bundles the session analysis (tools/sessions, src/analysis) into
// lib/engine.cjs for analyzeApi, and on Linux puts the DuckDB CLI the engine
// spawns at bin/duckdb (pinned and hash-checked, as the tray's is in
// desktop/scripts/stage-resources.mjs). Run by `npm run build`.
//
// CommonJS, because tsc compiles the functions to CommonJS and a TypeScript
// `import()` there becomes require(). import.meta.url (duck.mjs, store.mjs)
// is defined from __filename.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chmodSync, existsSync, mkdirSync, readFileSync, rmSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

const functionsDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const DUCKDB_LINUX = {
  version: 'v1.4.2',
  url: 'https://github.com/duckdb/duckdb/releases/download/v1.4.2/duckdb_cli-linux-amd64.zip',
  // The digest .github/workflows/test.yml checks for the same file.
  sha256: 'fae3ba93eedf20b08bca4b23aeac1ba94c446f1c10d029c193e2fc4b4e0bc1bc',
};

await build({
  entryPoints: [resolve(functionsDir, '../tools/sessions/engineEntry.mjs')],
  outfile: resolve(functionsDir, 'lib/engine.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  define: {'import.meta.url': '__engineUrl'},
  banner: {js: "const __engineUrl = require('url').pathToFileURL(__filename).href;"},
  logLevel: 'warning',
});

// The deploy runs on Linux (firebase-functions-deploy.yml); a Windows build is
// for tests, which use the PC's own CLI.
if (process.platform === 'linux') {
  const bin = resolve(functionsDir, 'bin');
  const target = resolve(bin, 'duckdb');
  if (!existsSync(target)) {
    mkdirSync(bin, {recursive: true});
    const zip = resolve(bin, 'duckdb.zip');
    execFileSync('curl', ['-sSL', '-o', zip, DUCKDB_LINUX.url]);
    const sha = createHash('sha256').update(readFileSync(zip)).digest('hex');
    if (sha !== DUCKDB_LINUX.sha256)
      throw new Error(`DuckDB zip sha256 ${sha}, expected ${DUCKDB_LINUX.sha256}`);
    execFileSync('unzip', ['-q', '-o', zip, '-d', bin]);
    rmSync(zip);
    chmodSync(target, 0o755);
  }
}
