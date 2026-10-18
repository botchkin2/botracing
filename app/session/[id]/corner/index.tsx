import {Redirect, useLocalSearchParams} from 'expo-router';

import {
  trackCorners,
  useTopSpreadCorner,
  useTrackMapOfSession,
} from '@/src/data/sessions';
import {cornerHref, parseSelection, sessionHref} from '@/src/nav/routes';

// /session/[id]/corner with no corner picked: open the section holding the most
// of the set's spread, else the track's first corner.
// Waits for the track map; a track with no corners goes back to the session.
export default function CornerIndex() {
  const {id} = useLocalSearchParams<{id: string}>();
  const map = useTrackMapOfSession(id);
  const {laps} = useLocalSearchParams<{laps?: string}>();
  const landing = useTopSpreadCorner(id, parseSelection({laps}).laps);
  if (map.isError) return <Redirect href={sessionHref(id)} />;
  if (!map.data) return null;
  const first = landing ?? trackCorners(map.data)[0]?.n;
  return first == null ? (
    <Redirect href={sessionHref(id)} />
  ) : (
    <Redirect href={cornerHref(id, first)} />
  );
}
