import {
  type SessionSummary,
  useSession,
  useSessions,
} from '@/src/data/sessions';
import {carLabel, shortTrackName} from '@/src/design';
import {planComboKey} from '@/src/nav/routes';

// Same window the Plan screen reads, so the two agree on what was driven last.
const PLAN_HISTORY_DAYS = 3650;

const comboKey = (s: Pick<SessionSummary, 'trackId' | 'car'>) =>
  planComboKey(s.trackId, carLabel(s.car).model);

/** "Le Mans · 911 GT3 R", the same words as the Plan chip. */
const comboPair = (s: Pick<SessionSummary, 'track' | 'car'>) =>
  `${shortTrackName(s.track)} · ${carLabel(s.car).shortModel}`;

/**
 * The track and car the Plan link opens. With a session open it is that
 * session's pair; on a Track page (`trackId`) the pair last driven there; otherwise the
 * pair driven last (Plan's own default), which the desktop bar shows beside
 * the label. `key` is undefined when nothing names a pair yet.
 */
export function usePlanCombo(
  sessionId: string | null,
  trackId: string | null,
  wantPair: boolean,
): {key: string | undefined; pair: string | null} {
  const session = useSession(sessionId ?? '', sessionId != null);
  const sessions = useSessions(
    {ageDays: PLAN_HISTORY_DAYS},
    trackId != null || wantPair,
  );
  // Newest first, LMU sessions with laps only, as the Plan chips are.
  const driven = (sessions.data?.items ?? []).filter(
    s => s.sim === 'lmu' && s.lapCount > 0,
  );
  // A session of another sim has no plan: Plan reads LMU's rules, so the link
  // and the label stay on what was driven in LMU.
  const named =
    sessionId != null && session.data
      ? session.data.sim === 'lmu'
        ? session.data
        : undefined
      : trackId != null
      ? driven.find(s => s.trackId === trackId)
      : undefined;
  const shown = named ?? driven[0];
  return {
    key: named ? comboKey(named) : undefined,
    pair: shown ? comboPair(shown) : null,
  };
}
