// Applying a plan to the catalog (pit wall thread 2 #204 to #210), over a
// backend. The backend does the one thing that has to be atomic, `commit`; this
// file decides what goes into it.
//
//   commit({trackId, expectedRev, newRev, history, set, deleteFields, boundaries})
//     in ONE transaction: read the track's catalogRev; if it is not
//     expectedRev, throw an Error with code 'STALE_PLAN'; write the history
//     document (create only: it must not exist); patch the track document
//     (merge: set the fields, remove deleteFields, everything else on it
//     survives); set or delete the boundaries document.
//   regenerateCatalogFile()  optional: the versioned catalog file the trays
//     read their stamps from (marshal #207). After the commit, never inside it.
//
// History is append-only: nothing here updates or deletes a history document.
import {summaryOf} from './plan.mjs';

export class PlanRefused extends Error {}

/**
 * Writes the plan. Refuses a plan with refusals, and a change with no reason.
 * Returns {rev, regenerated}.
 */
export async function applyPlan(
  backend,
  plan,
  {reason, by, now = () => new Date().toISOString()} = {},
) {
  if (plan.refusals.length)
    throw new PlanRefused(`the plan is refused: ${plan.refusals.join('; ')}`);
  if (!reason || !reason.trim())
    throw new PlanRefused(
      '--apply needs --reason "<why>", it is kept in the history',
    );
  if (!by) throw new PlanRefused('who is applying this? (by)');
  const at = now();

  const set = {
    ...plan.set,
    catalogRev: plan.newRev,
    curatedAt: at,
    curatedBy: by,
  };
  // A new map records when it was built from the session.
  if ((plan.kind === 'add' || plan.kind === 'replace') && set.source)
    set.source = {...set.source, builtAt: at};

  const history = {
    trackId: plan.trackId,
    // The state being replaced is saved as rev `expectedRev`: undoing to that
    // rev restores exactly this.
    rev: plan.expectedRev,
    kind: plan.kind,
    reason: reason.trim(),
    by,
    at,
    summary: summaryOf(plan),
    snapshot: plan.before,
  };

  try {
    await backend.commit({
      trackId: plan.trackId,
      expectedRev: plan.expectedRev,
      newRev: plan.newRev,
      history,
      set,
      deleteFields: plan.deleteFields,
      boundaries: plan.boundaries,
    });
  } catch (error) {
    if (error?.code === 'STALE_PLAN')
      throw new PlanRefused(
        `the track changed since this plan (it is at catalogRev ${error.currentRev}, the plan was made at ${plan.expectedRev}): run the dry run again`,
      );
    throw error;
  }
  const regenerated = backend.regenerateCatalogFile
    ? (await backend.regenerateCatalogFile(), true)
    : false;
  return {rev: plan.newRev, regenerated};
}
