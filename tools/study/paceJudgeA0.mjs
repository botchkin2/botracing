// (a0): #577's rule exactly as shipped (src/analysis/consistency.ts paceResiduals / paceOutliers): per stint of 5+ candidate
// laps a robust straight trend (Theil-Sen slope kept only if it moves the stint's pace by more than 2 robust sigma,
// else flat; intercept = median of y - slope x), residuals pooled over the judged stints, limit = max(3 sigma, 0.3 s),
// slow only; a run of 3+ slow laps in a stint stays (MAX_OUTLIER_RUN 2); a session under 12 candidate laps drops nothing.
// Written from the rule's text (gasket), not copied from the app. Session level: {stints: [{laps: [{id, lapTime}]}]} -> Set of dropped laps.
const med = a => {
  const s = a.filter(Number.isFinite).sort((x, y) => x - y);
  const n = s.length;
  return n === 0 ? NaN : n % 2 ? s[n >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2;
};
const rsig = a => 1.4826 * med(a.map(v => Math.abs(v - med(a))));
const sen = ys => {
  const sl = [];
  for (let i = 0; i < ys.length; i++)
    for (let j = i + 1; j < ys.length; j++) sl.push((ys[j] - ys[i]) / (j - i));
  return sl.length ? med(sl) : 0;
};
export function judgeA0Session(
  session,
  {z = 3, guard = 0.3, minLaps = 12, minStint = 5, maxRun = 2} = {},
) {
  const dropped = new Set();
  if (session.stints.reduce((n, s) => n + s.laps.length, 0) < minLaps)
    return dropped;
  const res = new Map();
  for (const s of session.stints) {
    if (s.laps.length < minStint) continue;
    const ys = s.laps.map(l => l.lapTime),
      range = ys.length - 1;
    let slope = ys.length >= 6 && range >= 5 ? sen(ys) : 0;
    if (Math.abs(slope) * range < 2 * rsig(ys.map((y, i) => y - slope * i)))
      slope = 0;
    const ic = med(ys.map((y, i) => y - slope * i));
    s.laps.forEach((l, i) => res.set(l, ys[i] - (ic + slope * i)));
  }
  const limit = Math.max(z * (rsig([...res.values()]) || 0), guard);
  for (const s of session.stints) {
    const flags = s.laps.map(l => res.has(l) && res.get(l) >= limit);
    let i = 0;
    while (i < flags.length) {
      if (!flags[i]) {
        i++;
        continue;
      }
      let j = i;
      while (j + 1 < flags.length && flags[j + 1]) j++;
      if (j - i + 1 <= maxRun)
        for (let k = i; k <= j; k++) dropped.add(s.laps[k]);
      i = j + 1;
    }
  }
  return dropped;
}
/** paceSim's judge shape: one driver = one stint. */
export const judgeA0 = stint => {
  const d = judgeA0Session({stints: [stint]});
  return stint.laps.map(l => ({out: d.has(l)}));
};
export const judges = {'(a0) #577 as shipped': judgeA0};
