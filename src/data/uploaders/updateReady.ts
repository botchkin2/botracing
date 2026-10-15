import {type Uploader} from './adapters';

import {SEEN_MS, compareVersions} from './version';

// A newer tray the tray has already downloaded and holds ready to install:
// the banner on top of every screen and the Settings row read this, so both
// say the same. Pure, so each case is tested.

export type UpdateReady = {
  version: string;
  /** The words, with no explanation: the button (if any) is separate. */
  line: string;
  /** True only inside the tray's own window: a phone or a browser cannot
   *  restart a PC. */
  canRestart: boolean;
};

/**
 * The highest waiting version among the PCs seen in the last 10 minutes, or
 * null. The watcher sends `updateWaiting` only when it is newer than the
 * tray running it (tools/uploader/heartbeat.mjs `updateWaitingOf`, the one
 * place that rule is written), so this does not check it again.
 */
export function updateReady(
  pcs: Uploader[] | undefined,
  nowMs: number,
  inTray: boolean,
): UpdateReady | null {
  let best: string | null = null;
  for (const u of pcs ?? []) {
    const seen = u.lastSeenAt != null && nowMs - u.lastSeenAt <= SEEN_MS;
    if (!seen || !u.updateWaiting) continue;
    if (best == null || (compareVersions(u.updateWaiting, best) ?? 0) > 0)
      best = u.updateWaiting;
  }
  if (best == null) return null;
  return {
    version: best,
    line: inTray ? `Tray ${best} ready` : `Tray ${best} ready on the PC`,
    canRestart: inTray,
  };
}
