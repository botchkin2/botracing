// Read-only check of the tray's own heartbeat log for an update banner (ticket 22,
// pit-wall thread 118 #8031): did the tray on this PC tell the app that an
// update was waiting, for how long, and when did it come back running it?
//
//   node tools/dev/trayUpdateBeats.mjs [<target version>] [<status.jsonl>]
//
// `status.jsonl` is the watcher's log of every heartbeat it sent
// (%LOCALAPPDATA%\BotRacing\status.jsonl); a beat names the running `version`
// and, only while an update is downloaded and waiting, `updateWaiting`
// (tools/uploader/heartbeat.mjs). With a target (0.1.19) the exit code is 0
// when some beat carried `updateWaiting: <target>` and 1 when none did; without
// one it lists every update seen. It reads the file and nothing else: no
// network, no write. What the banner showed on screen is not in this log: the
// app only shows a waiting update to a tray seen in the last 10 minutes
// (`updateReady`), so the lines say how long the updateWaiting beats lasted.
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';

/** The beats of a status.jsonl text, in order; a line that is not JSON is skipped. */
export function parseBeats(text) {
  const beats = [];
  for (const line of String(text).split('\n')) {
    if (!line.trim()) continue;
    try {
      const b = JSON.parse(line);
      if (b && typeof b.lastSeenAt === 'string' && Number.isFinite(Date.parse(b.lastSeenAt))) beats.push(b);
    } catch {
      // A half-written last line.
    }
  }
  return beats;
}

/**
 * Every update that was waiting: for each `updateWaiting` version, the first
 * and last beat that carried it, the beats, the running version it was waiting
 * on, and the first beat of the target version after it (when the tray came
 * back updated), or null.
 */
export function updatesSeen(beats) {
  const seen = new Map();
  for (const b of beats) {
    if (!b.updateWaiting) continue;
    const key = b.updateWaiting;
    const e = seen.get(key) ?? {
      version: key,
      runningVersion: b.version,
      firstAt: b.lastSeenAt,
      lastAt: b.lastSeenAt,
      beats: 0,
      installedAt: null,
    };
    e.lastAt = b.lastSeenAt;
    e.beats++;
    seen.set(key, e);
  }
  for (const e of seen.values()) {
    const after = beats.find(b => b.version === e.version && Date.parse(b.lastSeenAt) >= Date.parse(e.firstAt));
    e.installedAt = after ? after.lastSeenAt : null;
  }
  return [...seen.values()];
}

const minutes = (fromIso, toIso) => (Date.parse(toIso) - Date.parse(fromIso)) / 60000;

/** The report lines and whether the target (if any) was seen. */
export function report(beats, target = null) {
  const lines = [`${beats.length} beats, ${beats[0]?.lastSeenAt ?? 'none'} to ${beats.at(-1)?.lastSeenAt ?? 'none'}`];
  const updates = updatesSeen(beats);
  for (const e of updates) {
    const waited = minutes(e.firstAt, e.lastAt);
    lines.push(
      `updateWaiting ${e.version}: seen by tray ${e.runningVersion}, ${e.beats} beat${e.beats === 1 ? '' : 's'}, ` +
        `${e.firstAt} to ${e.lastAt} (${waited.toFixed(1)} min)` +
        (e.installedAt ? `; running ${e.version} at ${e.installedAt}` : '; not running it yet'),
    );
  }
  if (updates.length === 0) lines.push('no beat carried updateWaiting');
  if (target == null) return {lines, found: updates.length > 0};
  const hit = updates.find(e => e.version === target);
  lines.push(
    hit
      ? `PASS: ${hit.beats} beat${hit.beats === 1 ? '' : 's'} carried updateWaiting ${target}`
      : `FAIL: no beat carried updateWaiting ${target}`,
  );
  return {lines, found: Boolean(hit)};
}

export function defaultLogPath() {
  return join(process.env.LOCALAPPDATA ?? '.', 'BotRacing', 'status.jsonl');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [target, path] = process.argv.slice(2);
  const {lines, found} = report(parseBeats(readFileSync(path ?? defaultLogPath(), 'utf8')), target ?? null);
  console.log(lines.join('\n'));
  process.exit(target && !found ? 1 : 0);
}
