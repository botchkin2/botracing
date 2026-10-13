import {judges as a0} from './paceJudgeA0.mjs';
import {judges as kp} from './paceJudgeSim.mjs';
export const judges = {...a0, '(f) 3.5σ': kp['(f) 3.5σ'] ?? Object.values(kp)[0]};
