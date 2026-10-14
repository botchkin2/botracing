import assert from 'node:assert/strict';
import {test} from 'node:test';
import {INVOKER, LIVE, RECEIVER, grants, planLiveAnalyze} from './liveAnalyzePlan.mjs';
import {main, readState} from './liveAnalyze.mjs';

const runtime = `serviceAccount:${LIVE.runtime}`;
const policy = (...roles) => ({bindings: roles.map(role => ({role, members: [runtime]}))});

test('before the first deploy: the project-level event receiver, and the invoker waits for the service', () => {
  const steps = planLiveAnalyze({receiver: false, serviceExists: false, invoker: false});
  assert.equal(steps.length, 2);
  assert.deepEqual(steps[0].run.slice(0, 3), ['projects', 'add-iam-policy-binding', LIVE.project]);
  assert.ok(steps[0].run.includes(`--role=${RECEIVER}`));
  assert.equal(steps[1].run, undefined, 'nothing to run until the service exists');
});

test('after the deploy: run.invoker on the liveanalyze service only, never the project', () => {
  const steps = planLiveAnalyze({receiver: true, serviceExists: true, invoker: false});
  assert.equal(steps.length, 1);
  assert.deepEqual(steps[0].run.slice(0, 4), ['run', 'services', 'add-iam-policy-binding', LIVE.service]);
  assert.ok(steps[0].run.includes(`--role=${INVOKER}`));
  assert.ok(!steps.some(s => s.run?.[0] === 'projects' && s.run.includes(`--role=${INVOKER}`)));
});

test('all granted: no steps', () => {
  assert.deepEqual(planLiveAnalyze({receiver: true, serviceExists: true, invoker: true}), []);
});

test('a conditioned or another member binding does not count', () => {
  assert.equal(grants(policy(RECEIVER), RECEIVER), true);
  assert.equal(grants({bindings: [{role: RECEIVER, members: [runtime], condition: {expression: 'x'}}]}, RECEIVER), false);
  assert.equal(grants({bindings: [{role: RECEIVER, members: ['serviceAccount:other@x']}]}, RECEIVER), false);
});

test('the dry run reads only and changes nothing', async () => {
  const calls = [];
  const run = args => {
    calls.push(args);
    if (args[0] === 'run' && args[2] === 'describe') throw new Error('not found');
    // As gcloud does for a missing service: an empty policy, exit 0.
    if (args[0] === 'run') return {etag: 'ACAB'};
    return policy();
  };
  assert.deepEqual(readState(run), {receiver: false, serviceExists: false, invoker: false});
  calls.length = 0;
  const log = console.log;
  console.log = () => {};
  try {
    await main([], {run});
  } finally {
    console.log = log;
  }
  assert.ok(calls.every(a => a.includes('get-iam-policy') || a.includes('describe')), 'only reads');
});
