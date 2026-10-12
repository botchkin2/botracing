import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  GOLDEN,
  GOLDEN_ROLE,
  goldenCondition,
  goldenEmail,
  hasGoldenBinding,
  planGoldenReader,
} from './goldenReaderPlan.mjs';
import {main, readState} from './goldenReader.mjs';

const policyWith = condition => ({
  bindings: [
    {
      role: GOLDEN_ROLE,
      members: [`serviceAccount:${goldenEmail()}`],
      condition: condition && {expression: condition, title: GOLDEN.title},
    },
  ],
});

test('a fresh project gets the account, a prefix-only read binding and a key into the repo secret, in that order', () => {
  const steps = planGoldenReader({exists: false, bound: false, secretSet: false});
  assert.equal(steps.length, 3);
  assert.deepEqual(steps[0].run.slice(0, 3), ['iam', 'service-accounts', 'create']);
  assert.deepEqual(steps[1].run.slice(0, 3), [
    'storage',
    'buckets',
    'add-iam-policy-binding',
  ]);
  assert.deepEqual(steps[2].keyTo, {
    account: goldenEmail(),
    secret: 'GOLDEN_READER_SERVICE_ACCOUNT',
    env: null,
  });
});

test('the binding is read-only, bound to golden/ with a trailing slash, on the one bucket', () => {
  const [, bind] = planGoldenReader({exists: false, bound: false, secretSet: false});
  assert.ok(bind.run.includes('--role=roles/storage.objectViewer'));
  assert.ok(
    !bind.run.some(a => /objectUser|objectAdmin|storage\.admin|owner|editor/i.test(a)),
  );
  assert.ok(bind.run.includes('gs://botracing-61-lmu'));
  const cond = bind.run.find(a => a.startsWith('--condition='));
  // The prefix ends in a slash: a sibling prefix such as golden2/ must not match.
  assert.ok(cond.includes("/objects/golden/')"), cond);
});

test('it only adds: nothing is removed or deleted, nothing is granted on the project', () => {
  const steps = planGoldenReader({exists: false, bound: false, secretSet: false});
  for (const s of steps) {
    const words = (s.run ?? []).join(' ');
    assert.ok(!/remove|delete/.test(words), words);
  }
  assert.ok(!steps.some(s => s.run?.[0] === 'projects'));
});

test('what exists is not done again, and a finished setup is zero steps', () => {
  assert.deepEqual(planGoldenReader({exists: true, bound: true, secretSet: true}), []);
  assert.deepEqual(
    planGoldenReader({exists: true, bound: false, secretSet: true}).map(s => s.run[0]),
    ['storage'],
  );
  assert.deepEqual(
    planGoldenReader({exists: true, bound: true, secretSet: false}).map(s =>
      Object.keys(s).includes('keyTo'),
    ),
    [true],
  );
});

test('a binding counts only with the role, the member and the exact condition', () => {
  assert.equal(hasGoldenBinding(policyWith(goldenCondition())), true);
  assert.equal(hasGoldenBinding(policyWith(null)), false);
  assert.equal(
    hasGoldenBinding(policyWith(goldenCondition().replace('golden/', 'golden'))),
    false,
  );
  assert.equal(hasGoldenBinding(null), false);
});

test('the dry run only reads, and the state it reads names what is missing', async () => {
  const calls = [];
  const run = args => {
    calls.push(args.slice(0, 3).join(' '));
    if (args[1] === 'service-accounts' && args[2] === 'describe') throw new Error('NOT_FOUND');
    if (args[1] === 'buckets' && args[2] === 'get-iam-policy') return {bindings: []};
    return {};
  };
  const log = console.log;
  console.log = () => {};
  try {
    await main([], {run, ghRun: () => ''});
  } finally {
    console.log = log;
  }
  assert.ok(
    calls.every(c => /describe|get-iam-policy/.test(c)),
    calls.join(' | '),
  );
  const state = readState(run, GOLDEN, () => 'OTHER_SECRET	2026-01-01');
  assert.equal(state.exists, false);
  assert.equal(state.bound, false);
  assert.equal(state.secretSet, false);
  assert.equal(readState(run, GOLDEN, () => `${GOLDEN.secret}	2026-10-10`).secretSet, true);
});
