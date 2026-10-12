import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  CI,
  DEAD_SECRETS,
  DEPLOY_ROLES_REMOVED,
  PREVIEW_ROLES,
  RELEASE_ROLE,
  hasReleaseBinding,
  planCiSplit,
  previewEmail,
  release,
  releaseCondition,
  releaseEmail,
  secretReaders,
} from './ciSplitPlan.mjs';

const deploy = `serviceAccount:${CI.deployEmail}`;
const preview = `serviceAccount:${previewEmail()}`;
const tray = release('tray-release');
const android = release('android-release');

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
    releases: {
      'tray-release': {exists: false, bound: false, keys: []},
      'android-release': {exists: false, bound: false, keys: []},
    },
    deployKeys: ['old1', 'old2'],
    envs: new Set(['tray-release']),
    envSecrets: {deploy: new Set(), 'tray-release': new Set(['TAURI_SIGNING_PRIVATE_KEY'])},
    repoSecrets: new Set([CI.deploySecret]),
    secrets: [...DEAD_SECRETS],
  };
}

const whats = steps => steps.map(s => s.what);

test('grant only adds: the preview account, its roles and key, the deploy Environment and key, and the tray-release account', () => {
  const steps = planCiSplit(today(), 'grant');
  assert.equal(steps.filter(s => s.run?.[1] === 'remove-iam-policy-binding').length, 0);
  assert.equal(steps.filter(s => s.gh?.[1] === 'delete' || s.run?.includes('delete')).length, 0);
  assert.deepEqual(
    steps.filter(s => s.run?.[1] === 'add-iam-policy-binding').map(s => s.run.at(-2)),
    [...PREVIEW_ROLES, 'roles/cloudfunctions.admin'].map(r => `--role=${r}`),
  );
  assert.ok(whats(steps).some(w => w.startsWith('create the hosting-preview account')));
  assert.deepEqual(
    steps.filter(s => s.keyTo).map(s => [s.keyTo.secret, s.keyTo.env]),
    [[CI.previewSecret, null], [CI.deploySecret, 'deploy'], [tray.secret, 'tray-release']],
  );
  assert.deepEqual(
    steps.filter(s => s.keyTo).map(s => s.keyTo.account),
    [previewEmail(), CI.deployEmail, releaseEmail(tray)],
    'the deploy key is not copied into tray-release: it has its own account',
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
  s.envSecrets['tray-release'].add(tray.secret);
  s.envs.add('android-release');
  s.envSecrets['android-release'] = new Set([android.secret]);
  for (const r of CI.releases) s.releases[r.name] = {exists: true, bound: true, keys: ['k']};
  s.policy.get(deploy).add('roles/cloudfunctions.admin');
  assert.deepEqual(planCiSplit(s, 'grant'), []);
});

test('revoke only removes: the three roles, the repo-level secret, the old keys and the dead secrets', () => {
  const s = today();
  s.deployKeys = ['old1', 'old2', 'newDeploy'];
  s.envSecrets.deploy.add(CI.deploySecret);
  s.envSecrets['tray-release'].add(tray.secret);
  const steps = planCiSplit(s, 'revoke');
  assert.equal(steps.filter(s2 => s2.run?.[1] === 'add-iam-policy-binding' || s2.keyTo).length, 0);
  assert.deepEqual(
    steps.filter(x => x.run?.[1] === 'remove-iam-policy-binding').map(x => x.run.at(-2)),
    DEPLOY_ROLES_REMOVED.map(r => `--role=${r}`),
  );
  assert.ok(steps.some(x => x.gh?.join(' ') === `secret delete ${CI.deploySecret} --repo ${CI.repo}`));
  const keyDeletes = steps.filter(x => x.run?.includes('keys')).map(x => x.run[4]);
  assert.deepEqual(keyDeletes, ['old1', 'old2'], 'the newest key (made by grant) stays');
  assert.deepEqual(
    steps.filter(x => x.run?.[0] === 'secrets').map(x => x.run[2]),
    DEAD_SECRETS,
  );
});

// 2026-10-09: tray-release did not exist at grant, so grant made one key and
// the old PR-readable key survived a revoke that kept the newest two (#2653).
test('revoke keeps one deploy-account key (for the deploy Environment), and deletes the rest', () => {
  const s = today();
  s.envSecrets.deploy.add(CI.deploySecret);
  s.deployKeys = ['oldPrReadable', 'newDeploy'];
  const keyDeletes = planCiSplit(s, 'revoke').filter(x => x.run?.includes('keys')).map(x => x.run[4]);
  assert.deepEqual(keyDeletes, ['oldPrReadable']);
});

test('revoke deletes no key while no Environment holds the deploy secret', () => {
  const s = today();
  const keyDeletes = planCiSplit(s, 'revoke').filter(x => x.run?.includes('keys'));
  assert.deepEqual(keyDeletes, []);
});

test('the deploy account keeps what a deploy uses: hosting, rules and indexes', () => {
  for (const kept of ['roles/cloudfunctions.admin', 'roles/firebasehosting.admin', 'roles/firebaserules.admin', 'roles/datastore.indexAdmin'])
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

test('without the tray-release Environment, grant makes the account and binding but skips its key', () => {
  const s = today();
  s.envs.delete('tray-release');
  const steps = planCiSplit(s, 'grant');
  assert.ok(whats(steps).some(w => w.startsWith('create the tray-release account')));
  assert.ok(steps.some(x => x.run?.[1] === 'buckets'));
  assert.deepEqual(steps.filter(x => x.keyTo && x.keyTo.env === 'tray-release'), []);
});

test('each release account may use only its own prefix: one conditioned objectUser binding on the bucket, no project role', () => {
  const steps = planCiSplit(today(), 'grant');
  assert.equal(RELEASE_ROLE, 'roles/storage.objectUser');
  for (const [r, prefix, title] of [[tray, 'tray', 'tray-only'], [android, 'android', 'android-only']]) {
    const bindings = steps.filter(x => x.run?.[1] === 'buckets' && x.run.includes(`--member=serviceAccount:${releaseEmail(r)}`));
    assert.equal(bindings.length, 1, r.name);
    const {run} = bindings[0];
    assert.deepEqual(run.slice(0, 4), ['storage', 'buckets', 'add-iam-policy-binding', `gs://${CI.bucket}`]);
    assert.ok(run.includes(`--role=${RELEASE_ROLE}`));
    assert.ok(run.includes(`--condition=expression=${releaseCondition(r)},title=${title}`));
    assert.ok(releaseCondition(r).endsWith(`/objects/${prefix}/')`));
    assert.equal(
      steps.filter(x => x.run?.[0] === 'projects' && x.run.some(a => a.includes(releaseEmail(r)))).length,
      0,
      `no project-level role for ${r.name}`,
    );
  }
});

test('with the android-release Environment, grant puts the android account key there, not the tray or deploy key', () => {
  const s = today();
  s.envs.add('android-release');
  s.envSecrets['android-release'] = new Set();
  const keys = planCiSplit(s, 'grant').filter(x => x.keyTo?.env === 'android-release');
  assert.deepEqual(keys.map(x => [x.keyTo.account, x.keyTo.secret]), [[releaseEmail(android), 'ANDROID_RELEASE_SERVICE_ACCOUNT']]);
});

test("each release key has its own name, not the deploy, preview or another release's, so it can't fall back to another key", () => {
  const names = CI.releases.map(r => r.secret);
  assert.deepEqual(names, ['TRAY_RELEASE_SERVICE_ACCOUNT', 'ANDROID_RELEASE_SERVICE_ACCOUNT']);
  assert.equal(new Set(names).size, names.length);
  for (const name of names)
    assert.ok(![CI.deploySecret, CI.previewSecret, ...today().repoSecrets].includes(name), name);
});

// 2026-10-09: tray-release holds the tray account's key under the deploy
// key's name (rake #3304). grant adds it under its own name; revoke, after a
// release has published on it, deletes the old copy and the old key.
function trayOnOldName() {
  const s = today();
  s.releases['tray-release'] = {exists: true, bound: true, keys: ['oldTray']};
  s.envSecrets['tray-release'].add(CI.deploySecret);
  return s;
}

test('grant puts the tray key under its own name while the old copy is still there', () => {
  const keys = planCiSplit(trayOnOldName(), 'grant').filter(x => x.keyTo?.env === 'tray-release');
  assert.deepEqual(keys.map(x => [x.keyTo.account, x.keyTo.secret]), [[releaseEmail(tray), 'TRAY_RELEASE_SERVICE_ACCOUNT']]);
});

test('revoke leaves the tray alone until its key is under its own name', () => {
  const steps = planCiSplit(trayOnOldName(), 'revoke');
  assert.deepEqual(steps.filter(x => x.gh?.includes('tray-release') || x.run?.some(a => a.includes(releaseEmail(tray)))), []);
});

test('after the move, revoke deletes the old tray-release copy and every older tray key, keeping the newest', () => {
  const s = trayOnOldName();
  s.envSecrets['tray-release'].add(tray.secret);
  s.releases['tray-release'].keys = ['oldTray', 'newTray'];
  const steps = planCiSplit(s, 'revoke');
  assert.ok(steps.some(x => x.gh?.join(' ') === `secret delete ${CI.deploySecret} --env tray-release --repo ${CI.repo}`));
  assert.deepEqual(
    steps.filter(x => x.run?.includes(`--iam-account=${releaseEmail(tray)}`)).map(x => x.run[4]),
    ['oldTray'],
  );
  assert.ok(!steps.some(x => x.gh?.join(' ') === `secret delete ${tray.secret} --env tray-release --repo ${CI.repo}`));
});

test('hasReleaseBinding is true only for the conditioned binding for that account', () => {
  const good = {bindings: [{role: RELEASE_ROLE, members: [`serviceAccount:${releaseEmail(tray)}`], condition: {expression: releaseCondition(tray), title: 'tray-only'}}]};
  assert.equal(hasReleaseBinding(good, tray), true);
  assert.equal(hasReleaseBinding(good, android), false, "the tray's binding is not android's");
  assert.equal(hasReleaseBinding({bindings: [{role: RELEASE_ROLE, members: [`serviceAccount:${releaseEmail(tray)}`]}]}, tray), false, 'an unconditioned grant does not count');
  assert.equal(hasReleaseBinding({bindings: [{...good.bindings[0], condition: {expression: "resource.name.startsWith('x')"}}]}, tray), false);
  assert.equal(
    hasReleaseBinding({bindings: [{...good.bindings[0], members: [`serviceAccount:${releaseEmail(android)}`]}]}, android),
    false,
    'the android account bound under tray/ does not count',
  );
  assert.equal(hasReleaseBinding(null, tray), false);
});

test('revoke deletes the dead repo secret GARAGE61_API_TOKEN', () => {
  const s = today();
  s.repoSecrets.add('GARAGE61_API_TOKEN');
  assert.ok(planCiSplit(s, 'revoke').some(x => x.gh?.join(' ') === `secret delete GARAGE61_API_TOKEN --repo ${CI.repo}`));
});

// 2026-10-09: the android-release account was created, then the bucket binding
// right after it failed with "does not exist": IAM had not caught up yet.
test('runWithRetry retries "does not exist" until the new account is visible', async () => {
  const {runWithRetry} = await import('./ciSplit.mjs');
  let calls = 0;
  const waits = [];
  const run = () => {
    calls++;
    if (calls < 3) throw new Error('Service account android-release@x does not exist.');
    return 'bound';
  };
  const out = await runWithRetry(run, ['storage'], {delayMs: 5, sleep: async ms => waits.push(ms)});
  assert.equal(out, 'bound');
  assert.deepEqual([calls, waits], [3, [5, 5]]);
});

test('runWithRetry gives up after its tries and passes other errors straight through', async () => {
  const {runWithRetry} = await import('./ciSplit.mjs');
  let calls = 0;
  const never = () => { calls++; throw new Error('does not exist'); };
  await assert.rejects(runWithRetry(never, [], {tries: 3, sleep: async () => {}}), /does not exist/);
  assert.equal(calls, 3);
  calls = 0;
  const denied = () => { calls++; throw new Error('PERMISSION_DENIED'); };
  await assert.rejects(runWithRetry(denied, [], {sleep: async () => {}}), /PERMISSION_DENIED/);
  assert.equal(calls, 1);
});
