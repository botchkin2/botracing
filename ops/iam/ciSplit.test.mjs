import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  CI,
  DEAD_SECRETS,
  DEPLOY_ROLES_REMOVED,
  PREVIEW_ROLES,
  planCiSplit,
  previewEmail,
  secretReaders,
} from './ciSplitPlan.mjs';

const deploy = `serviceAccount:${CI.deployEmail}`;
const preview = `serviceAccount:${previewEmail()}`;

// The project as it was read on 2026-10-09 (thread 54 #2610).
function today() {
  return {
    policy: new Map([
      ['user:botchkin@gmail.com', new Set(['roles/owner'])],
      [deploy, new Set([
        'roles/datastore.indexAdmin', 'roles/firebaseauth.admin',
        'roles/firebasehosting.admin', 'roles/firebaserules.admin',
        'roles/secretmanager.secretAccessor', 'roles/secretmanager.viewer',
      ])],
    ]),
    previewExists: false,
    deployKeys: ['old1', 'old2'],
    envs: new Set(['tray-release']),
    envSecrets: {deploy: new Set(), 'tray-release': new Set(['TAURI_SIGNING_PRIVATE_KEY'])},
    repoSecrets: new Set([CI.deploySecret]),
    secrets: [...DEAD_SECRETS],
  };
}

const whats = steps => steps.map(s => s.what);

test('grant only adds: the preview account, its three roles, its key, the deploy Environment and two deploy keys', () => {
  const steps = planCiSplit(today(), 'grant');
  assert.equal(steps.filter(s => s.run?.[1] === 'remove-iam-policy-binding').length, 0);
  assert.equal(steps.filter(s => s.gh?.[1] === 'delete' || s.run?.includes('delete')).length, 0);
  assert.deepEqual(
    steps.filter(s => s.run?.[1] === 'add-iam-policy-binding').map(s => s.run.at(-2)),
    PREVIEW_ROLES.map(r => `--role=${r}`),
  );
  assert.ok(whats(steps).some(w => w.startsWith('create the hosting-preview account')));
  assert.deepEqual(
    steps.filter(s => s.keyTo).map(s => [s.keyTo.secret, s.keyTo.env]),
    [[CI.previewSecret, null], [CI.deploySecret, 'deploy'], [CI.deploySecret, 'tray-release']],
  );
  assert.ok(steps.some(s => s.then?.includes('name=main')), 'deploy Environment is main only');
});

test('no preview role is an Auth admin, a secret reader or a rules admin', () => {
  for (const role of PREVIEW_ROLES)
    assert.doesNotMatch(role, /firebaseauth|secretmanager|firebaserules|owner|editor/);
});

test('grant run again after it worked has nothing left to do', () => {
  const s = today();
  s.previewExists = true;
  s.policy.set(preview, new Set(PREVIEW_ROLES));
  s.repoSecrets.add(CI.previewSecret);
  s.envs.add('deploy');
  s.envSecrets.deploy.add(CI.deploySecret);
  s.envSecrets['tray-release'].add(CI.deploySecret);
  assert.deepEqual(planCiSplit(s, 'grant'), []);
});

test('revoke only removes: the three roles, the repo-level secret, the old keys and the dead secrets', () => {
  const s = today();
  s.deployKeys = ['old1', 'old2', 'newDeploy', 'newRelease'];
  const steps = planCiSplit(s, 'revoke');
  assert.equal(steps.filter(s2 => s2.run?.[1] === 'add-iam-policy-binding' || s2.keyTo).length, 0);
  assert.deepEqual(
    steps.filter(x => x.run?.[1] === 'remove-iam-policy-binding').map(x => x.run.at(-2)),
    DEPLOY_ROLES_REMOVED.map(r => `--role=${r}`),
  );
  assert.ok(steps.some(x => x.gh?.join(' ') === `secret delete ${CI.deploySecret} --repo ${CI.repo}`));
  const keyDeletes = steps.filter(x => x.run?.includes('keys')).map(x => x.run[4]);
  assert.deepEqual(keyDeletes, ['old1', 'old2'], 'the two newest keys (made by grant) stay');
  assert.deepEqual(
    steps.filter(x => x.run?.[0] === 'secrets').map(x => x.run[2]),
    DEAD_SECRETS,
  );
});

test('the deploy account keeps what a deploy uses: hosting, rules and indexes', () => {
  for (const kept of ['roles/firebasehosting.admin', 'roles/firebaserules.admin', 'roles/datastore.indexAdmin'])
    assert.ok(!DEPLOY_ROLES_REMOVED.includes(kept));
});

test('after both phases only the owner can read secret values at project level', () => {
  const s = today();
  for (const role of DEPLOY_ROLES_REMOVED) s.policy.get(deploy).delete(role);
  assert.deepEqual(secretReaders(s.policy), ['user:botchkin@gmail.com (roles/owner)']);
  assert.deepEqual(
    secretReaders(today().policy),
    [`${deploy} (roles/secretmanager.secretAccessor)`, 'user:botchkin@gmail.com (roles/owner)'],
  );
});

test('an unknown phase stops', () => {
  assert.throws(() => planCiSplit(today(), 'all'), /grant or revoke/);
});

test('without the tray-release Environment, grant sets the deploy key only there and skips it', () => {
  const s = today();
  s.envs.delete('tray-release');
  const envs = planCiSplit(s, 'grant').filter(x => x.keyTo?.secret === CI.deploySecret).map(x => x.keyTo.env);
  assert.deepEqual(envs, ['deploy']);
});

test('revoke deletes the dead repo secret GARAGE61_API_TOKEN', () => {
  const s = today();
  s.repoSecrets.add('GARAGE61_API_TOKEN');
  assert.ok(planCiSplit(s, 'revoke').some(x => x.gh?.join(' ') === `secret delete GARAGE61_API_TOKEN --repo ${CI.repo}`));
});
