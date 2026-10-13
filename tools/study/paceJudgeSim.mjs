// Wrapper: paceJudge's session judges as paceSim's stint judges (one driver = one session, one stint).
import {judgeA0, judgeF} from './paceJudge.mjs';
const wrap = (j, o) => stint => {
  const laps = stint.laps.map((l, i) => ({id: i, lapTime: l.lapTime, sections: l.sections, evidence: null}));
  const r = j({stints: [{laps}]}, o);
  return laps.map(l => ({out: r.get(l.id).out}));
};
export const judges = {
  '(a0) #577 as shipped': wrap(judgeA0),
  '(f) 3.5σ section-shared curve': wrap(judgeF, {k: 3.5}),
};
