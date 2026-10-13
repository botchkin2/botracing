// Wrapper: paceJudge's session judges as paceSim's stint judges (one driver = one session, one stint).
import {judgeA, judgeB, judgeC, judgeE, judgeF} from './paceJudge.mjs';
const wrap = (j, o) => stint => {
  const laps = stint.laps.map((l, i) => ({
    id: i,
    lapTime: l.lapTime,
    sections: l.sections,
    evidence: null,
  }));
  const r = j({stints: [{laps}]}, o);
  return laps.map(l => ({out: r.get(l.id).out}));
};
export const judges = {
  '(e) section-shared pace, k5 floor 0.2': wrap(judgeE, {k: 5, floorS: 0.2}),
  '(f) lap residual on the section-shared curve, 3σ': wrap(judgeF, {k: 3}),
  '(f) 2.5σ': wrap(judgeF, {k: 2.5}),
  '(f) 3.5σ': wrap(judgeF, {k: 3.5}),
  '(f) 3σ + section spike k8 floor 0.3': wrap(judgeF, {
    k: 3,
    spikeK: 8,
    floorS: 0.3,
  }),
};
