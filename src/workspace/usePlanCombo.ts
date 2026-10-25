import {
  type SessionSummary,
  useSession,
  useSessions,
} from '@/src/data/sessions';
import {carLabel} from '@/src/design';
import {planComboKey} from '@/src/nav/routes';

import {
  defaultCombo,
  PLAN_HISTORY_DAYS,
  planCombos,
  resolveCombo,
} from './planCombo';

/**
 * The track and car the Plan link opens, and the pair the desktop bar shows,
 * named by the Plan chip's own label. An open session names its own. With no
 * session: the Plan's own pick (`planKey`, the URL's `combo` on /plan, driven
 * or not), else the Track page's pair (`trackId`), else the Plan's default
 * (`defaultCombo`, the function the Plan opens on).
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
    // The open session is named by the combos as the Plan lists them, itself included when the list lacks it.
    const combos = planCombos(
      driven.some(s => s.id === session.id) ? driven : [session, ...driven],
    );
    const key = planComboKey(
      session.trackId,
      carLabel(session.car).model,
      session.sim,
    );
    return {key, pair: resolveCombo(combos, key, null)?.label ?? null};
  }
  const combos = planCombos(driven);
  const picked = planKey != null ? resolveCombo(combos, planKey, null) : null;
  if (picked) return {key: picked.key, pair: picked.label};
  const named =
    trackId != null ? combos.find(c => c.trackId === trackId) : undefined;
  const shown = named ?? defaultCombo(combos);
  return {key: named?.key, pair: shown?.label ?? null};
}

/** The Plan link's combo and pair for the open session, the Plan's own pick, the Track page or the last drive. */
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
  // Newest first, as the Plan chips are.
  const driven = sessions.data?.items ?? [];
  return planChoice({
    sessionOpen: sessionId != null,
    session: session.data,
    trackId,
    planKey,
    driven,
  });
}
