// The contract for a sender written in another language (the Rust tray): its
// test pipes the JSON it really builds to this script, which puts it through
// the server's own contract (contract/README.md).
//
//   <json> | node contract/check.mjs heartbeat         a heartbeat body
//   <json> | node contract/check.mjs recorder-status   a status.json: the
//            heartbeat the watcher would send from it, and its shape against
//            the real status.json payloads (a new key or type: save one)
//
// Exit 0 when accepted; 1 with the reason on stderr.
import {readFileSync} from 'node:fs';

import {checkHeartbeat} from '../functions/src/contract/heartbeat.ts';
import {heartbeatDoc} from '../tools/uploader/heartbeat.mjs';
import {bodyOf} from '../tools/uploader/heartbeatSender.mjs';

import {newShape, payload} from './payloads.mjs';

const fail = why => {
  console.error(why);
  process.exit(1);
};
const kind = process.argv[2];
const sent = JSON.parse(readFileSync(0, 'utf8'));

let beat;
if (kind === 'heartbeat') beat = sent;
else if (kind === 'recorder-status') {
  const fresh = newShape('recorder-status', sent);
  if (fresh.length)
    fail(
      `status.json has what no real one has (save a real status.json in contract/payloads/recorder-status): ${fresh.join(
        ', ',
      )}`,
    );
  // The watcher's own inputs, from a real beat; the recorder's status fresh.
  const real = payload('heartbeat', '0.1.10-waiting-for-game-rec-no-game');
  beat = bodyOf(
    heartbeatDoc({
      hostId: real.hostId,
      label: real.label,
      version: real.version,
      lmuFound: real.lmuFound,
      state: real.state,
      watch: real,
      queue: real.queue,
      sims: real.sims,
      freeBytes: real.disk.freeBytes,
      recorder: sent,
      nowMs: Date.parse(sent.updatedAt) + 1_000,
    }),
  );
} else
  fail(`usage: <json> | node contract/check.mjs heartbeat|recorder-status`);

const r = checkHeartbeat(beat);
if (!r.ok) fail(`refused ${r.status}: ${r.error}`);
console.log('accepted');
