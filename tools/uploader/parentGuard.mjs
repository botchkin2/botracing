// The tray app starts the watcher with LAP_PARENT_PID. When the tray is gone
// without a Quit (a crash, a kill), nothing else would stop the watcher, so it
// stops itself. Unset: the logon task's watcher, which has no parent to follow.

// EPERM means the process exists but is not ours to signal: alive.
export function isAlive(pid, kill = process.kill) {
  try {
    kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

export function parentGone(env = process.env, kill = process.kill) {
  const pid = Number(env.LAP_PARENT_PID);
  return Number.isInteger(pid) && pid > 0 && !isAlive(pid, kill);
}
