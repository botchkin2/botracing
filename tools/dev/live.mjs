// `preview_start {name: "live-N"}` runs this (see .claude/launch.json): Metro
// with hot reload against the production API, served from the folder slot N is
// claimed for (tools/dev/liveSlots.mjs), else the main checkout.
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

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
const child = spawn(
  process.execPath,
  [found.cli, 'start', '--web', '--port', String(found.port)],
  {
    cwd: found.dir,
    stdio: 'inherit',
    env: {
      ...process.env,
      BROWSER: 'none',
      LIVE_SEAT_SIGNIN_PORT: String(found.port),
      EXPO_PUBLIC_LMU_API_BASE: 'https://botracing-61.web.app/api/lmu',
    },
  },
);
// preview_stop ends this process; take Metro with it.
for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK'])
  process.on(sig, () => child.kill());
process.on('exit', () => child.kill());
child.on('exit', code => process.exit(code ?? 0));
