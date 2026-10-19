import standIn from './standin.json';

// TEMPORARY, so the PR preview shows height before the API deploys the field (production's /map drops it until this PR's functions change ships). Delete this folder and the devElevation call in useRaceData.ts once /map returns `elevation`.
// DEV ONLY. The curated `elevation` track field (pit wall thread 86, atlas) is the one source of height. The track
// map API does not return it yet, so on this branch Portimao alone has a copy of the same measurement (the game's own
// height, median over the cars of one capture, by lap fraction). Every other track has no height: the road is flat.
type Profile = {track: string; lengthM: number; stepM: number; heightM: number[]};
const profiles = standIn as Record<string, Profile>;

export function devElevation(trackId: string | null | undefined): number[] | null {
  return (trackId && profiles[trackId]?.heightM) || null;
}
