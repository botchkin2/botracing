import assert from 'node:assert/strict';
import {test} from 'node:test';
import {audit, parseArgs} from './audit.mjs';
import {gatherState} from './gcloud.mjs';
import {
  CONFIG,
  evaluate,
  readFunctions,
  readPolicy,
  runtimeEmail,
} from './lib.mjs';

const NUMBER = '123456789';
const COMPUTE = `${NUMBER}-compute@developer.gserviceaccount.com`;
const APPENGINE = `${CONFIG.project}@appspot.gserviceaccount.com`;
const RUNTIME = runtimeEmail();
const DEPLOY = 'github-deploy@botracing-61.iam.gserviceaccount.com';
const sa = email => `serviceAccount:${email}`;

// What the roles carry. These are fixtures written to look like gcloud's
// answer; the real answer is what the first real run shows.
const PERMS = {
  'roles/owner': [
    'datastore.backups.delete',
    'datastore.databases.delete',
    'datastore.databases.update',
    'storage.buckets.update',
    'storage.buckets.delete',
    'storage.buckets.setIamPolicy',
    'resourcemanager.projects.setIamPolicy',
    'iam.serviceAccountKeys.create',
  ],
  'roles/editor': [
    'datastore.backups.delete',
    'datastore.databases.update',
    'storage.buckets.update',
    'iam.serviceAccountKeys.create',
  ],
  'roles/datastore.user': [
    'datastore.entities.get',
    'datastore.entities.update',
  ],
  'roles/logging.logWriter': ['logging.logEntries.create'],
  'roles/storage.objectAdmin': [
    'storage.objects.delete',
    'storage.objects.create',
  ],
  'roles/storage.admin': [
    'storage.buckets.update',
    'storage.buckets.delete',
    'storage.objects.delete',
  ],
  'roles/iam.serviceAccountUser': ['iam.serviceAccounts.actAs'],
  'roles/firebasehosting.admin': ['firebasehosting.sites.update'],
};

const policy = members => ({
  bindings: Object.entries(
    Object.entries(members).reduce((byRole, [member, roles]) => {
      for (const role of roles) (byRole[role] ??= []).push(member);
      return byRole;
    }, {}),
  ).map(([role, ms]) => ({role, members: ms})),
});

// Three moments of the same project.
const BEFORE = {
  'user:botkin@example.com': ['roles/owner'],
  [sa(COMPUTE)]: ['roles/editor'],
  [sa(APPENGINE)]: ['roles/editor'],
  [sa(DEPLOY)]: ['roles/editor'],
};
const MIDDLE = {
  ...BEFORE,
  [sa(RUNTIME)]: ['roles/datastore.user', 'roles/logging.logWriter'],
};
const AFTER = {
  'user:botkin@example.com': ['roles/owner'],
  [sa(COMPUTE)]: ['roles/logging.logWriter'],
  [sa(APPENGINE)]: ['roles/logging.logWriter'],
  [sa(RUNTIME)]: ['roles/datastore.user', 'roles/logging.logWriter'],
  [sa(DEPLOY)]: ['roles/firebasehosting.admin', 'roles/iam.serviceAccountUser'],
};

const fn = (name, email) => ({
  name: `projects/${CONFIG.project}/locations/us-central1/functions/${name}`,
  serviceConfig: {serviceAccountEmail: email},
});

function fakeRun({
  keys = {},
  bucketExtra = {},
  members,
  runAs,
  runtimeExists = true,
  bucketGrant = true,
  fail = [],
}) {
  const calls = [];
  const run = args => {
    calls.push(args);
    const key = args.slice(0, 3).join(' ');
    if (fail.includes(key)) throw new Error(`PERMISSION_DENIED: ${key}`);
    if (key === 'projects describe ' + CONFIG.project)
      return {projectNumber: NUMBER};
    if (key === 'projects get-iam-policy ' + CONFIG.project)
      return policy(members);
    if (args[0] === 'functions')
      return [
        fn('lmuApi', runAs.lmuApi),
        fn('uploadApi', runAs.uploadApi),
        fn('other', COMPUTE),
      ];
    if (
      args[0] === 'iam' &&
      args[1] === 'service-accounts' &&
      args[2] === 'keys'
    ) {
      const email = args
        .find(a => a.startsWith('--iam-account='))
        .split('=')[1];
      return keys[email] ?? [];
    }
    if (args[0] === 'iam' && args[1] === 'service-accounts')
      return runtimeExists
        ? [{email: RUNTIME}, {email: COMPUTE}]
        : [{email: COMPUTE}];
    if (args[0] === 'storage')
      return policy({
        ...(bucketGrant ? {[sa(RUNTIME)]: ['roles/storage.objectAdmin']} : {}),
        ...bucketExtra,
      });
    if (args[0] === 'iam' && args[1] === 'roles') {
      const role = args[3].startsWith('roles/')
        ? args[3]
        : `projects/x/roles/${args[3]}`;
      return PERMS[role]
        ? {includedPermissions: PERMS[role]}
        : (() => {
            throw new Error('NOT_FOUND');
          })();
    }
    throw new Error(`unexpected gcloud call: ${args.join(' ')}`);
  };
  return {run, calls};
}

const run = (opts, extra = {}) => {
  const f = fakeRun(opts);
  const lines = [];
  const result = audit({run: f.run, log: l => lines.push(l), ...extra});
  return {...f, result, text: lines.join('\n')};
};

test('before the split: Editor on the default accounts and the functions running as one fails, and says what to do', () => {
  const r = run({
    members: BEFORE,
    runAs: {lmuApi: COMPUTE, uploadApi: COMPUTE},
    runtimeExists: false,
  });
  assert.equal(r.result.ok, false);
  assert.match(
    r.text,
    new RegExp(
      `FAIL  ${COMPUTE.replace(
        /\./g,
        '\\.',
      )} \\(a default account\\) still has roles/editor`,
    ),
  );
  assert.match(
    r.text,
    /FAIL  .*APPENGINE|appspot\.gserviceaccount\.com \(a default account\) still has roles\/editor/,
  );
  assert.match(
    r.text,
    /lmuApi runs as .*, a default account \(Editor\): switch it to lap-runtime@/,
  );
  assert.match(
    r.text,
    /lap-runtime@botracing-61\.iam\.gserviceaccount\.com does not exist yet/,
  );
  assert.match(r.text, /can: delete Firestore backups/);
  assert.match(r.text, /result: NOT done/);
});

test('in the middle (account made and granted, functions switched, Editor still on) it still fails, on the Editor alone', () => {
  const r = run({
    members: MIDDLE,
    runAs: {lmuApi: RUNTIME, uploadApi: RUNTIME},
  });
  assert.equal(r.result.ok, false);
  assert.match(r.text, /lmuApi runs as lap-runtime@/);
  assert.match(r.text, /uploadApi runs as lap-runtime@/);
  assert.match(r.text, /roles\/datastore\.user: granted/);
  assert.match(
    r.text,
    /roles\/storage\.objectAdmin on gs:\/\/botracing-61-lmu: granted/,
  );
  assert.equal(
    r.result.lines.filter(l => l.level === 'FAIL').length >= 2,
    true,
  );
  assert.ok(
    !r.result.lines.some(l => l.level === 'FAIL' && /runs as/.test(l.text)),
    'no function-level failure',
  );
});

test('after the split it passes, and the deploy account is listed with its roles', () => {
  const r = run(
    {members: AFTER, runAs: {lmuApi: RUNTIME, uploadApi: RUNTIME}},
    {deployAccount: DEPLOY},
  );
  assert.equal(r.result.ok, true, r.text);
  assert.doesNotMatch(r.text, /FAIL/);
  assert.match(r.text, /result: the split is in place/);
  assert.match(
    r.text,
    /github-deploy@botracing-61\.iam\.gserviceaccount\.com: roles\/firebasehosting\.admin/,
  );
  assert.match(r.text, /botkin@example\.com can: .*\(a person\)/);
});

test('the deploy account while it still has Editor is a warning that step 6 narrows, and it can delete backups until then', () => {
  const r = run(
    {
      members: AFTER_WITH_DEPLOY_EDITOR(),
      runAs: {lmuApi: RUNTIME, uploadApi: RUNTIME},
    },
    {deployAccount: DEPLOY},
  );
  assert.match(
    r.text,
    /warn\s+github-deploy@.*: roles\/editor \(broad: runbook step 6 narrows it\)/,
  );
  assert.match(
    r.text,
    /warn\s+github-deploy@.* can: delete Firestore backups.*\(until step 6\)/,
  );
  assert.equal(
    r.result.ok,
    true,
    'the deploy account is step 6, not the exit code',
  );
});
function AFTER_WITH_DEPLOY_EDITOR() {
  return {...AFTER, [sa(DEPLOY)]: ['roles/editor']};
}

test('the runtime account holding Editor, or any role beyond the two, is a failure or a warning', () => {
  const members = {
    ...AFTER,
    [sa(RUNTIME)]: [
      'roles/datastore.user',
      'roles/logging.logWriter',
      'roles/editor',
    ],
  };
  const r = run({members, runAs: {lmuApi: RUNTIME, uploadApi: RUNTIME}});
  assert.equal(r.result.ok, false);
  assert.match(
    r.text,
    /FAIL\s+lap-runtime@.* also holds roles\/editor at project level/,
  );
  assert.match(r.text, /FAIL\s+lap-runtime@.* can: delete Firestore backups/);
});

test('what could not be read is said so, and an unreadable policy fails everything', () => {
  const noRole = run(
    {
      members: {...AFTER, [sa(DEPLOY)]: ['roles/custom.thing']},
      runAs: {lmuApi: RUNTIME, uploadApi: RUNTIME},
    },
    {deployAccount: DEPLOY},
  );
  assert.match(
    noRole.text,
    /\?\s+the permissions of roles\/custom\.thing could not be read/,
  );
  assert.match(
    noRole.text,
    /note: gcloud said: roles describe roles\/custom\.thing: NOT_FOUND/,
  );
  const noPolicy = run({
    members: AFTER,
    runAs: {lmuApi: RUNTIME, uploadApi: RUNTIME},
    fail: ['projects get-iam-policy botracing-61'],
  });
  assert.equal(noPolicy.result.ok, false);
  assert.match(noPolicy.text, /project IAM policy could not be read/);
  const noBucket = run({
    members: AFTER,
    runAs: {lmuApi: RUNTIME, uploadApi: RUNTIME},
    fail: ['storage buckets get-iam-policy'],
  });
  assert.match(
    noBucket.text,
    /\?\s+the bucket policy of botracing-61-lmu could not be read/,
  );
  const missing = run({
    members: AFTER,
    runAs: {lmuApi: RUNTIME, uploadApi: null},
  });
  assert.match(
    missing.text,
    /\?\s+uploadApi: no service account in the listing/,
  );
});

test('the audit only reads: every gcloud call is a get-iam-policy, describe or list', () => {
  const r = run(
    {members: AFTER, runAs: {lmuApi: RUNTIME, uploadApi: RUNTIME}},
    {deployAccount: DEPLOY},
  );
  assert.ok(r.calls.length > 5);
  for (const args of r.calls) {
    const verb = args.find(a =>
      ['describe', 'get-iam-policy', 'list'].includes(a),
    );
    assert.ok(verb, `a read verb in: ${args.join(' ')}`);
    assert.ok(
      !args.some(a =>
        /^(add|remove|create|delete|set|update|enable|disable|set-iam-policy|add-iam-policy-binding)/.test(
          a,
        ),
      ),
      args.join(' '),
    );
  }
});

test('the readers: a policy by member, second-generation function accounts, conditional bindings kept apart', () => {
  const p = readPolicy({
    bindings: [
      {role: 'roles/a', members: ['user:x', 'serviceAccount:y']},
      {role: 'roles/b', members: ['user:x'], condition: {title: 't'}},
    ],
  });
  assert.deepEqual([...p.roles.get('user:x')].sort(), ['roles/a', 'roles/b']);
  assert.equal(p.conditional.length, 1);
  assert.deepEqual(
    readFunctions([
      {
        name: 'projects/p/locations/europe-west1/functions/f',
        serviceConfig: {serviceAccountEmail: 'e@x'},
      },
    ]),
    [{name: 'f', region: 'europe-west1', serviceAccount: 'e@x'}],
  );
  assert.deepEqual(
    readFunctions([
      {
        name: 'projects/p/locations/l/functions/g',
        serviceAccountEmail: 'old@x',
      },
    ])[0].serviceAccount,
    'old@x',
  );
  const state = gatherState(
    fakeRun({members: AFTER, runAs: {lmuApi: RUNTIME, uploadApi: RUNTIME}}).run,
  );
  assert.equal(state.project.number, NUMBER);
  assert.equal(state.runtimeExists, true);
  assert.deepEqual(evaluate({policy: {known: false}}).ok, false);
});

test('arguments', () => {
  assert.deepEqual(parseArgs(['--deploy-account', 'a@b', '--json']), {
    deployAccount: 'a@b',
    json: true,
  });
  assert.throws(() => parseArgs(['--deploy-account']), /needs an email/);
  assert.throws(() => parseArgs(['--apply']), /unknown option/);
});

test('Google-managed service agents are ok, not warnings, and are never asked for keys', () => {
  const agent = `service-${NUMBER}@gcp-sa-firebase.iam.gserviceaccount.com`;
  const cloudservices = `${NUMBER}@cloudservices.gserviceaccount.com`;
  const members = {
    ...AFTER,
    [sa(agent)]: ['roles/editor'],
    [sa(cloudservices)]: ['roles/editor'],
  };
  const r = run({members, runAs: {lmuApi: RUNTIME, uploadApi: RUNTIME}});
  assert.equal(r.result.ok, true, r.text);
  assert.ok(
    r.text.includes(
      `${cloudservices} has roles/editor (Google-managed: leave alone)`,
    ),
    r.text,
  );
  assert.match(
    r.text,
    /ok +service-\d+@gcp-sa-firebase.* can: .*\(Google-managed: leave alone\)/,
  );
  assert.doesNotMatch(r.text, /warn +service-/);
  assert.ok(
    !r.calls.some(c => c.join(' ').includes(`--iam-account=${agent}`)),
    'no key listing for a Google agent',
  );
});

test('user-managed keys are listed: none is ok, one is a warning with its date, an unreadable listing says so', () => {
  const key = {validAfterTime: '2026-01-28T00:00:00Z'};
  const r = run({
    members: AFTER,
    runAs: {lmuApi: RUNTIME, uploadApi: RUNTIME},
    keys: {[DEPLOY]: [key]},
  });
  assert.match(
    r.text,
    /warn +github-deploy@.* has 1 user-managed key\(s\) \(created 2026-01-28T00:00:00Z\)/,
  );
  assert.ok(r.text.includes(`${RUNTIME} has no user-managed keys`), r.text);
  const base = fakeRun({
    members: AFTER,
    runAs: {lmuApi: RUNTIME, uploadApi: RUNTIME},
  });
  const flaky = args => {
    if (args.includes('keys')) throw new Error('PERMISSION_DENIED');
    return base.run(args);
  };
  const lines = [];
  audit({run: flaky, log: l => lines.push(l)});
  assert.match(lines.join('\n'), /\? +.*: its keys could not be listed/);
});

test('a storage.admin granted on the bucket alone shows up in who can change the bucket', () => {
  const other = 'extra@botracing-61.iam.gserviceaccount.com';
  const r = run({
    members: {...AFTER, [sa(other)]: ['roles/logging.logWriter']},
    runAs: {lmuApi: RUNTIME, uploadApi: RUNTIME},
    bucketExtra: {[sa(other)]: ['roles/storage.admin']},
  });
  assert.match(
    r.text,
    /warn +extra@.* can: delete the bucket; turn off the bucket's soft delete/,
  );
});
