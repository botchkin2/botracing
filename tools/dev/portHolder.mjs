// Who already listens on a slot's port. A launcher that finds its port taken names the holder and stops; it never
// moves to the next port (which left a slot "moved to 19102 and exited" beside a stale Metro, ticket 58, chassis #7697).
import {spawnSync} from 'node:child_process';

/** The listeners on `port` in `netstat -ano -p tcp` output: [{address, pid}], any address family. */
export function listenersOn(netstat, port) {
  const out = [];
  for (const line of netstat.split(/\r?\n/)) {
    const m = line
      .trim()
      .match(/^TCP\s+(\S+):(\d+)\s+\S+\s+LISTENING\s+(\d+)$/i);
    if (m && Number(m[2]) === port)
      out.push({address: m[1].replace(/^\[|\]$/g, ''), pid: Number(m[3])});
  }
  return out;
}

/** Listeners on `port` now (Windows, where the leak happened; elsewhere none: a taken port fails Metro's own bind). */
export function holdersOf(
  port,
  {platform = process.platform, run = spawnSync} = {},
) {
  if (platform !== 'win32') return [];
  const r = run('netstat', ['-ano', '-p', 'tcp'], {encoding: 'utf8'});
  return r.status === 0 ? listenersOn(String(r.stdout), port) : [];
}

/** "port 19103 is held by pid 32172 (127.0.0.1)", for the launcher's refusal. */
export function holderMessage(port, holders) {
  const who = holders.map(h => `pid ${h.pid} (${h.address})`).join(', ');
  return `port ${port} is held by ${who}`;
}
