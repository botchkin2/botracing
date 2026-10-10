// The tray's report when it cannot keep the uploader running: the uploader is
// the one that normally sends the status doc, so when it dies (or exits in a
// loop) nothing reaches Settings. The tray (desktop/src-tauri/src/sidecar.rs)
// runs this one-shot with its bundled node and the same token file; it sends
// one heartbeat for this PC with a single `uploader-stopped` problem and the
// tray's version (LAP_VERSION), under the same hostId the uploader uses, so it
// is the same row in Settings and the next real heartbeat replaces it.
//
//   node tools/uploader/trayFailure.mjs --reason "exit code: 1" --count 3 --log <sidecar.log>
//
// Always exits 0: a failed report must never become another failure.
import {readFileSync} from 'node:fs';
import {hostname} from 'node:os';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {httpSend} from './heartbeatSender.mjs';
import {PROBLEM_MESSAGE_MAX, hostIdOf, redact, scrub} from './heartbeat.mjs';

/** The last non-empty line of the uploader's stderr log, or '' without one. */
export function lastLine(text) {
  const lines = String(text ?? '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('--- uploader start'));
  return lines.at(-1) ?? '';
}

/** The message: why it stopped, then what it last wrote, in 120 characters. */
export function messageOf({reason, logText}) {
  const last = lastLine(logText);
  const text = last ? `${reason}: ${last}` : reason;
  return redact(scrub(text)).slice(0, PROBLEM_MESSAGE_MAX);
}

/** The heartbeat body for send(): only what the server requires, plus the problem. */
export function bodyOf({
  hostId,
  label,
  version,
  reason,
  logText,
  count,
  nowMs,
}) {
  const problem = {
    kind: 'uploader-stopped',
    at: new Date(nowMs).toISOString(),
    message: messageOf({reason, logText}),
  };
  if (Number.isInteger(count) && count > 0) problem.count = count;
  return {
    hostId,
    label,
    version,
    lmuFound: false,
    state: 'error',
    problems: [problem],
  };
}

function argOf(name) {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 ? process.argv[at + 1] : undefined;
}

async function main() {
  const tokenFile = process.env.LAP_TOKEN_FILE;
  if (!tokenFile) return;
  const home = process.env.LAP_UPLOADER_HOME;
  let label = 'Race PC';
  try {
    if (home)
      label =
        JSON.parse(readFileSync(resolve(home, 'config.json'), 'utf8')).label ??
        label;
  } catch {
    // No config: the default name, as the uploader does.
  }
  let logText = '';
  try {
    const log = argOf('log');
    if (log) logText = readFileSync(log, 'utf8').slice(-4000);
  } catch {
    // No log yet.
  }
  const body = bodyOf({
    hostId: hostIdOf(hostname()),
    label,
    version: process.env.LAP_VERSION || 'unknown',
    reason: argOf('reason') || 'stopped',
    logText,
    count: Number(argOf('count')),
    nowMs: Date.now(),
  });
  const res = await httpSend({
    api: process.env.LAP_API || undefined,
    tokenFile,
  })(body);
  if (res.status < 200 || res.status >= 300)
    console.error(
      `report not accepted: HTTP ${res.status} ${res.reason ?? ''}`,
    );
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  main().catch(error => console.error(`report failed: ${error.message}`));
