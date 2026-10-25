import {
  type SessionSummary,
  useSession,
  useSessions,
} from '@/src/data/sessions';
import {carLabel, shortTrackName} from '@/src/design';
import {planComboKey} from '@/src/nav/routes';

import {defaultCombo, planCombos} from './model';
import {undrivenCombo} from './planState';

// Same window the Plan screen reads, so the two agree on what was driven last.
const PLAN_HISTORY_DAYS = 3650;

const comboKey = (s: Pick<SessionSummary, 'trackId' | 'car' | 'sim'>) =>
  planComboKey(s.trackId, carLabel(s.car).model, s.sim);

/** "Le Mans · 911 GT3 R", the same words as the Plan chip. */
const comboPair = (s: Pick<SessionSummary, 'track' | 'car'>) =>
  `${shortTrackName(s.track)} · ${carLabel(s.car).shortModel}`;

/**
 * The track and car the Plan link opens, and the pair the desktop bar shows.
 * An open session names its own pair. With no session: the Plan's own pick
 * (`planKey`, the URL's `combo` on /plan, driven or not), else the Track
 * page's pair (`trackId`), else the Plan's default (`defaultCombo`, the same
 * function the Plan opens on), named by the Plan chip's own label.
 */
export function planChoice({
  sessionOpen,
  session,
  trackId,
  planKey,
  driven,
}: {
  sessionOpen: boolean;
  session: SessionSummary | undefined;
  trackId: string | null;
  planKey?: string | null;
  driven: SessionSummary[];
}): {key: string | undefined; pair: string | null} {
  if (sessionOpen) {
    if (!session) return {key: undefined, pair: null};
    return {key: comboKey(session), pair: comboPair(session)};
  }
  const combos = planCombos(driven);
  const picked =
    planKey != null
      ? combos.find(c => c.key === planKey) ?? undrivenCombo(planKey)
      : null;
  if (picked) return {key: picked.key, pair: picked.label};
  const named =
    trackId != null ? combos.find(c => c.trackId === trackId) : undefined;
  const shown = named ?? defaultCombo(combos);
  return {key: named?.key, pair: shown?.label ?? null};
}

/** The Plan link's combo and pair for the open session, the Track page or the last drive. */
export function usePlanCombo(
  sessionId: string | null,
  trackId: string | null,
  planKey: string | null,
  wantPair: boolean,
): {key: string | undefined; pair: string | null} {
  const session = useSession(sessionId ?? '', sessionId != null);
  const sessions = useSessions(
    {ageDays: PLAN_HISTORY_DAYS},
    trackId != null || wantPair,
  );
  // Newest first, sessions with laps only, as the Plan chips are.
  const driven = (sessions.data?.items ?? []).filter(s => s.lapCount > 0);
  return planChoice({
    sessionOpen: sessionId != null,
    session: session.data,
    trackId,
    planKey,
    driven,
  });
}
