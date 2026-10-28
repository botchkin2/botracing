import {type TrayRelease} from '@/src/data/tray';
import {SEEN_MS, type Uploader, compareVersions} from '@/src/data/uploaders';

// The Windows app card on Settings (pit-wall thread 54): what the Download
// button says, from the state of the release query. Pure, so each state is
// tested. Settings is behind the sign-in, so the card is signed-in only.

export type TrayCard = {
  /** "v0.2.0", or why there is nothing to download. */
  status: string;
  /** The version a download offers; null when there is none. */
  version: string | null;
  /** One line per PC: its tray version against the latest, or not reporting. */
  pcs: string[];
  /** The Download button shows: a release exists and this user has no tray running (not seen in 10 minutes) and is not inside one. */
  canDownload: boolean;
};

/**
 * A newer release than this PC's tray runs. Until its tray has downloaded it
 * (`updateWaiting`) nothing here can be pressed: the tray fetches the
 * installer by itself at launch and every 30 minutes (desktop/src-tauri/src/
 * update.rs CHECK_EVERY), so the line says what happens next (thread 118
 * #8034, ticket 22). Once it is downloaded the "ready" row and the banner
 * take over, with Restart inside the tray's own window.
 */
function availableText(u: Uploader, latest: string, inTray: boolean): string {
  if (u.updateWaiting) return `v${u.updateWaiting} ready`;
  return inTray
    ? `v${latest} available · fetched within 30 min, then Restart appears here`
    : `v${latest} available · the PC fetches it within 30 min`;
}

/**
 * What one PC's tray says about itself: its version, then 'not reporting' when
 * it has not been seen for 10 minutes, else whether a newer release exists.
 * The version the uploader reports is the tray's (LAP_VERSION); an older
 * uploader reports a build hash, which is shown as it is without a verdict.
 */
export function pcLine(
  u: Uploader,
  latest: string | null,
  nowMs: number,
  withName: boolean,
  inTray = false,
): string {
  const seen = u.lastSeenAt != null && nowMs - u.lastSeenAt <= SEEN_MS;
  const cmp = latest && u.version ? compareVersions(u.version, latest) : null;
  const verdict = !seen
    ? 'not reporting'
    : cmp == null
    ? ''
    : cmp < 0
    ? availableText(u, latest as string, inTray)
    : 'latest';
  return [withName ? u.host : '', u.version ? `v${u.version}` : '', verdict]
    .filter(Boolean)
    .join(' · ');
}

export function trayCard(q: {
  isPending: boolean;
  isError: boolean;
  /** The check failed for want of a network (src/data/queryState.ts). */
  offline?: boolean;
  data: TrayRelease | null | undefined;
  /** Every PC's uploader status; undefined while it loads or when it failed. */
  pcs?: Uploader[];
  nowMs?: number;
  /** Inside the tray's own window. */
  inTray?: boolean;
}): TrayCard {
  const latest = q.data?.version ?? null;
  const nowMs = q.nowMs ?? Date.now();
  const pcs = q.pcs
    ? q.pcs.length === 0
      ? ['No PC reporting']
      : [...q.pcs]
          .sort((a, b) => (b.lastSeenAt ?? 0) - (a.lastSeenAt ?? 0))
          .map(u =>
            pcLine(u, latest, nowMs, q.pcs!.length > 1, q.inTray === true),
          )
    : [];
  const hasTray =
    q.inTray === true ||
    (q.pcs ?? []).some(
      u => u.lastSeenAt != null && nowMs - u.lastSeenAt <= SEEN_MS,
    );
  const none = {version: null, pcs, canDownload: false};
  if (q.data)
    return {
      status: `Latest v${q.data.version}`,
      version: q.data.version,
      pcs,
      canDownload: !hasTray,
    };
  if (q.isPending) return {status: 'Checking…', ...none};
  if (q.isError)
    return {
      status: q.offline ? 'Offline' : 'Couldn’t check for the Windows app',
      ...none,
    };
  return {status: 'Not released yet', ...none};
}
