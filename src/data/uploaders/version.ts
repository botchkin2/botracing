// A tray version is x.y.z; the uploader of an older tray reports a build hash,
// which has no order.

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

/** How long a PC counts as reporting after its last heartbeat. */
export const SEEN_MS = 10 * 60_000;
