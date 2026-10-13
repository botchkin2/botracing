// A stored fill limit above the car's own tank cannot be true: sessions
// analysed before analysisVersion 16 could read the setup's VM_FUEL_LEVEL
// scale wrongly (pit-wall thread 1 #4555: 1980 L on a 105 L tank). The limit is
// left out, null, rather than shown or used; the tank stands, and a session
// analysed again on open stores the right one. Both fuel adapters (the session
// doc's and the plan block's) read it through here.

/** The 0.5 L the Plan's own fill-limit matching allows (features/plan/model.ts). */
const TOLERANCE_L = 0.5;

export function fillLimitWithinTank(
  fillLimitL: number | null,
  tankL: number | null,
): number | null {
  if (fillLimitL == null || tankL == null) return fillLimitL;
  return fillLimitL > tankL + TOLERANCE_L ? null : fillLimitL;
}
