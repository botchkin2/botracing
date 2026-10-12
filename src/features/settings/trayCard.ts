import {type TrayRelease} from '@/src/data/tray';
import {type Uploader} from '@/src/data/uploaders';

import {SEEN_MS} from './model';

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
};

/** [major, minor, patch] of 'x.y.z' (a pre-release suffix is ignored), else null. */
function semver(v: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Negative when a is older than b; null when either is not a x.y.z version. */
export function compareVersions(a: string, b: string): number | null {
  const x = semver(a);
  const y = semver(b);
  if (!x || !y) return null;
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
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
): string {
  const seen = u.lastSeenAt != null && nowMs - u.lastSeenAt <= SEEN_MS;
  const cmp = latest && u.version ? compareVersions(u.version, latest) : null;
  const verdict = !seen
    ? 'not reporting'
    : cmp == null
    ? ''
    : cmp < 0
    ? `v${latest} available`
    : 'latest';
  return [withName ? u.host : '', u.version ? `v${u.version}` : '', verdict]
    .filter(Boolean)
    .join(' · ');
}

export function trayCard(q: {
  isPending: boolean;
  isError: boolean;
  data: TrayRelease | null | undefined;
  /** Every PC's uploader status; undefined while it loads or when it failed. */
  pcs?: Uploader[];
  nowMs?: number;
}): TrayCard {
  const latest = q.data?.version ?? null;
  const nowMs = q.nowMs ?? Date.now();
  const pcs = q.pcs
    ? q.pcs.length === 0
      ? ['No PC reporting']
      : [...q.pcs]
          .sort((a, b) => (b.lastSeenAt ?? 0) - (a.lastSeenAt ?? 0))
          .map(u => pcLine(u, latest, nowMs, q.pcs!.length > 1))
    : [];
  if (q.data)
    return {status: `Latest v${q.data.version}`, version: q.data.version, pcs};
  if (q.isPending) return {status: 'Checking…', version: null, pcs};
  if (q.isError)
    return {status: 'Couldn’t check for the Windows app', version: null, pcs};
  return {status: 'Not released yet', version: null, pcs};
}
