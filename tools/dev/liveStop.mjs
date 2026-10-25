// Stopping a live slot (pit-wall ticket 58, chassis #7697, steward #7694): the launcher (tools/dev/live.mjs) owns
// everything it starts, so on every exit path it ends Metro's whole process tree, not only the first process
// (`child.kill()` on Windows leaves Metro's workers), closes its loopback mirror, and exits after a short delay
// whatever the child does. Nothing it started outlives it.
import {spawnSync} from 'node:child_process';

import {shutMirror} from './loopbackMirror.mjs';

/** End `pid` and everything it started. Windows: taskkill /T; elsewhere the child is its own process group (spawned `detached`). */
export function killTree(
  pid,
  {platform = process.platform, run = spawnSync} = {},
) {
  if (pid == null) return;
  if (platform === 'win32') {
    run('taskkill', ['/PID', String(pid), '/T', '/F'], {stdio: 'ignore'});
    return;
  }
  for (const target of [-pid, pid]) {
    try {
      process.kill(target, 'SIGKILL');
    } catch {
      // Already gone.
    }
  }
}

/**
 * The launcher's one stop path: close the mirror and its connections, end Metro's tree, and exit after `delayMs`
 * whatever the child does (its own exit ends the launcher sooner). Safe to call on every signal and at exit.
 */
export function createStopper({
  child,
  mirror,
  kill = killTree,
  exit = process.exit,
  delayMs = 2000,
}) {
  let stopping = false;
  return function stop() {
    if (stopping) return;
    stopping = true;
    shutMirror(mirror);
    kill(child.pid);
    setTimeout(() => exit(0), delayMs);
  };
}
