// `preview_start {name: "live-N"}` runs this (see .claude/launch.json): Metro
// with hot reload against the production API, served from the folder slot N is
// claimed for (tools/dev/liveSlots.mjs), else the main checkout.
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {createStopper} from './liveStop.mjs';
import {mirrorLocalhost} from './loopbackMirror.mjs';
import {holderMessage, holdersOf} from './portHolder.mjs';
import {parseSlot, resolveSlot} from './liveSlots.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const fail = e => {
  console.error(e.message);
  process.exit(1);
};

const slot = parseSlot(process.argv[2]);
if (slot instanceof Error) fail(slot);
const found = resolveSlot({
  root,
  slot,
  fs: {
    read: file => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null),
    exists: fs.existsSync,
  },
});
if (found instanceof Error) fail(found);

console.log(
  `live-${slot}: ${found.claimed ? 'claimed' : 'unclaimed, main checkout'}: serving ${found.dir} on port ${found.port}`,
);
// Metro binds [::1] only, which adb reverse (it dials 127.0.0.1) cannot reach: answer on 127.0.0.1 too, in this
// process, so an emulator proof needs no forwarder run by hand (tools/dev/loopbackMirror.mjs).
// A taken port is named and refused, never moved past: a stale holder is what has to go (ticket 58).
const holders = holdersOf(found.port);
if (holders.length > 0)
  fail(
    new Error(
      `live-${slot}: ${holderMessage(found.port, holders)}; nothing was started`,
    ),
  );
const mirror = await mirrorLocalhost({port: found.port});
if (mirror)
  console.log(
    `live-${slot}: also on 127.0.0.1:${found.port} (adb reverse tcp:${found.port} tcp:${found.port})`,
  );
const preload = path
  .join(root, 'tools', 'dev', 'exitWithParent.cjs')
  .split(path.sep)
  .join('/');
const child = spawn(
  process.execPath,
  // --localhost: Metro listens on loopback only. Without it, it binds every
  // interface and the seat-test token endpoint would be reachable from the LAN.
  [found.cli, 'start', '--web', '--localhost', '--port', String(found.port)],
  {
    cwd: found.dir,
    stdio: 'inherit',
    // Its own process group off Windows, so the launcher can end the whole tree (liveStop.mjs killTree).
    detached: process.platform !== 'win32',
    env: {
      ...process.env,
      // Metro and its workers end when this launcher is gone, however it went (tools/dev/exitWithParent.cjs).
      LIVE_LAUNCHER_PID: String(process.pid),
      // Forward slashes: NODE_OPTIONS reads a backslash as an escape.
      NODE_OPTIONS: [
        process.env.NODE_OPTIONS,
        `--require ${JSON.stringify(preload)}`,
      ]
        .filter(Boolean)
        .join(' '),
      BROWSER: 'none',
      LIVE_SEAT_SIGNIN_PORT: String(found.port),
      // The main checkout's functions/ holds firebase-admin; a worktree has none.
      LIVE_MAIN_ROOT: root,
      // The service account's email, not a secret (docs/TESTING.md): the mint
      // impersonates it with the gcloud login on this PC.
      SMOKE_SERVICE_ACCOUNT:
        process.env.SMOKE_SERVICE_ACCOUNT ??
        'firebase-adminsdk-fbsvc@botracing-61.iam.gserviceaccount.com',
      EXPO_PUBLIC_API_BASE: 'https://botracing-61.web.app/api',
    },
  },
);
// preview_stop ends this process: close the mirror, end Metro's whole tree, exit (liveStop.mjs).
const stop = createStopper({child, mirror});
for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK']) process.on(sig, stop);
process.on('exit', stop);
child.on('error', e => {
  console.error(`live-${slot}: could not start Metro: ${e.message}`);
  stop();
});
child.on('exit', code => {
  stop();
  process.exit(code ?? 0);
});
