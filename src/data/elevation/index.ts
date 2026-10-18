import standIn from './standin.json';

// A stand-in height profile per LMU track (tools/follow/elevation_from_captures.py,
// from the tray's local field captures), until the curated `elevation` track field
// (pit wall thread 86) exists. Heights are by lap fraction, so any distance ruler can sample them.
type Profile = {track: string; lengthM: number; stepM: number; heightM: number[]};
const profiles = standIn as Record<string, Profile>;

export function standInElevation(trackId: string | null | undefined): number[] | null {
  if (!trackId) return null;
  const hit = profiles[trackId] ?? profiles[Object.keys(profiles).find(k => trackId.startsWith(k) || k.startsWith(trackId)) ?? ''];
  return hit ? hit.heightM : null;
}
