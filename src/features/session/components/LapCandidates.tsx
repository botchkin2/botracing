import {useSession, useSessionLaps} from '@/src/data/sessions';

import {ReferenceCandidates} from './ReferenceCandidates';

/** Reference candidates for one lap of this session; reads the session and laps the screen already has cached. */
export function LapCandidates({
  sessionId,
  lapId,
}: {
  sessionId: string;
  lapId: string;
}) {
  const session = useSession(sessionId);
  const laps = useSessionLaps(sessionId);
  const lap = laps.data?.find(l => l.id === lapId);
  if (!session.data || !laps.data || !lap) return null;
  return (
    <ReferenceCandidates session={session.data} laps={laps.data} lap={lap} />
  );
}
