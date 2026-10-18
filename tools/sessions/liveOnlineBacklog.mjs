// A stored live session's online flag, once (pit-wall thread 76, gauge on
// #646). The live path now sends `online` with every lap (syncLive.mjs), but a
// session whose drive ended before the tray carried this reads its capture
// here: the flag goes onto the stored doc on its own. A re-analysis keeps it
// (keepCapture.mjs onlineAfterSync), so nothing else is sent.
//
// state.onlines[sessionId]: 'sent', or 'none' (the capture is gone, has no
// gameMode, or its stretches disagree: nothing to say, nothing to retry).
import {existsSync, readFileSync} from 'node:fs';
import {resolve} from 'node:path';

import {onlineOfMode} from './gameMode.mjs';

/** The capture folder's mode flag, or undefined when it cannot be read. */
function flagOf(captureRoot, key) {
  const path = resolve(captureRoot, key.split('#')[0], 'meta.json');
  if (!existsSync(path)) return undefined;
  try {
    return onlineOfMode(JSON.parse(readFileSync(path, 'utf8')).gameMode);
  } catch {
    return undefined;
  }
}

/**
 * Each live LMU session's flag: true, false, or null when its captures say
 * nothing or disagree. One entry per sessionId in the live index.
 *
 * @returns {Map<string, boolean|null>}
 */
export function liveOnlineFlags(liveIndex, captureRoot) {
  const flags = new Map();
  for (const [key, e] of Object.entries(liveIndex ?? {})) {
    if (e.sim !== 'lmu') continue;
    const flag = flagOf(captureRoot, key) ?? null;
    const seen = flags.get(e.sessionId);
    flags.set(e.sessionId, seen === undefined || seen === flag ? flag : null);
  }
  return flags;
}

/**
 * @param {object} p
 * @param {Map<string, boolean|null>} p.flags  liveOnlineFlags
 * @param {{onlines?: Record<string, string>}} p.state
 * @param {{setOnline: Function}} p.store
 * @param {string} p.ownerId
 * @param {() => void} p.saveState
 * @param {(line: string) => void} p.log
 */
export async function uploadLiveOnlineBacklog({
  flags,
  state,
  store,
  ownerId,
  saveState,
  log,
}) {
  state.onlines ??= {};
  let sent = 0;
  for (const [id, online] of flags) {
    if (state.onlines[id]) continue;
    if (online != null) {
      await store.setOnline(id, ownerId, online);
      sent++;
    }
    // Saved per session, so a run stopped mid-backlog resumes where it was.
    state.onlines[id] = online != null ? 'sent' : 'none';
    saveState();
  }
  if (sent) log(`online flag kept for ${sent} live session(s)`);
  return sent;
}
