// The emulators for the contract replay (contract/README.md, layer 2): the
// functions behind the Hosting emulator's own /api rewrites, so a request
// takes the path a tray's does (torsion #5115 2). The rewrites come from
// firebase.json itself, never a copy.
//
//   node functions/test/replay/emulators.mjs -- <command>
//
// runs <command> with the emulators up (firebase emulators:exec) and
// REPLAY_API set to the Hosting emulator's origin. The functions must be
// built first (npm --prefix functions run build).
import {spawnSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const HOSTING_PORT = 5102;
const real = JSON.parse(readFileSync(join(repo, 'firebase.json'), 'utf8'));
const base = JSON.parse(readFileSync(join(repo, 'firebase.emulator.json'), 'utf8'));

// No web app is served: an empty public folder, the real /api rewrites.
const work = mkdtempSync(join(tmpdir(), 'replay-'));
const pub = join(work, 'public');
mkdirSync(pub);
writeFileSync(join(pub, 'index.html'), '');
const config = {
  ...base,
  hosting: {
    public: relative(repo, pub).split(sep).join('/'),
    rewrites: real.hosting.rewrites.filter(r => r.source.startsWith('/api/')),
  },
  emulators: {...base.emulators, hosting: {port: HOSTING_PORT}},
};
// Paths in a firebase config are relative to its own folder: keep it in the repo root.
const path = join(repo, `.replay-firebase-${process.pid}.json`);
writeFileSync(path, JSON.stringify(config, null, 1));

const at = process.argv.indexOf('--');
const command = process.argv.slice(at + 1).join(' ');
const r = spawnSync(
  'npx',
  [
    '--yes',
    'firebase-tools@15.32.1',
    'emulators:exec',
    '--config',
    path,
    '--project',
    'demo-botracing',
    '--only',
    'functions,firestore,auth,storage,hosting',
    JSON.stringify(command),
  ],
  {
    cwd: repo,
    stdio: 'inherit',
    shell: true,
    env: {...process.env, REPLAY_API: `http://127.0.0.1:${HOSTING_PORT}`},
  },
);
try {
  (await import('node:fs')).rmSync(path);
} catch {
  // Left for the next run to overwrite; never committed (.gitignore).
}
process.exit(r.status ?? 1);
