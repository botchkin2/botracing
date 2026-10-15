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
 * null. A version that is not newer than the PC's own tray is ignored, so a
 * stale report can never show a banner.
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
    const newer = compareVersions(u.updateWaiting, u.version);
    if (newer == null || newer <= 0) continue;
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
