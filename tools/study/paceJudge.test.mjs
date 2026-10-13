import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JUDGES} from './paceJudge.mjs';

// One stint of 24 laps, 6 sections (base 10..15 s), seeded noise 0.03 s per
// section; a fade from lap 16 (+0.15 s a lap over the whole lap, spread over
// every section); lap 5 loses 2 s in S3 only; lap 9 loses 0.6 s in each of
// S1 and S2 (traffic); laps 12-14 are 2 % slower everywhere (a run).
function session() {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.06;
  const base = [10, 11, 12, 13, 14, 15];
  const total = base.reduce((a, b) => a + b, 0);
  const laps = Array.from({length: 24}, (_, i) => {
    const fade = i >= 16 ? 0.15 * (i - 15) : 0;
    const sections = base.map(b => b + rnd() + (fade * b) / total);
    if (i === 5) sections[3] += 2;
    if (i === 9) (sections[1] += 0.6), (sections[2] += 0.6);
    if (i >= 12 && i <= 14) sections.forEach((t, s) => (sections[s] = t * 1.02));
    return {id: `L${i}`, lapTime: sections.reduce((a, b) => a + b, 0), sections, evidence: null};
  });
  return {stints: [{laps}]};
}

const outs = j => [...JUDGES[j](session())].filter(([, v]) => v.out).map(([id]) => id);

test('(e) drops the one-section mistake and the 2-section loss, keeps the fade and the run', () => {
  const o = outs('e');
  assert.ok(o.includes('L5'), o.join(' '));
  assert.ok(o.includes('L9'), o.join(' '));
  for (const id of ['L12', 'L13', 'L14', 'L18', 'L20', 'L22', 'L23']) assert.ok(!o.includes(id), `${id} in ${o.join(' ')}`);
});

test('(a) on the same stint: what the straight line does with the fade', () => {
  console.log('a:', outs('a').join(' '), '| b:', outs('b').join(' '), '| c:', outs('c').join(' '), '| e:', outs('e').join(' '));
});
