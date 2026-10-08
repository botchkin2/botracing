// Who can do what in the project (pit wall thread 2 #266, #271, #294). Pure
// checking, no gcloud here, so the tests run anywhere; gcloud.mjs reads and
// audit.mjs prints.
//
// What the split is for: a bug in a function, or a leaked token, must not be
// able to delete the backups, turn off the bucket's soft delete, or change who
// has access. The functions run as one service account that holds exactly what
// they use; nobody but a person holds the permissions below.

export const CONFIG = {
  project: 'botracing-61',
  bucket: 'botracing-61-lmu',
  region: 'us-central1',
  /** The functions that must run as the runtime account. */
  functions: ['lmuApi', 'uploadApi'],
  runtimeName: 'lap-runtime',
};

export const runtimeEmail = (config = CONFIG) =>
  `${config.runtimeName}@${config.project}.iam.gserviceaccount.com`;

/** What the runtime account may hold at project level, and only this. */
export const RUNTIME_PROJECT_ROLES = [
  'roles/datastore.user',
  'roles/logging.logWriter',
];
/** ...and on the one bucket (objects, not the bucket's settings). */
export const RUNTIME_BUCKET_ROLES = ['roles/storage.objectAdmin'];

/** Permissions that nothing a function runs as may have, and why. */
export const FORBIDDEN = {
  'datastore.backups.delete': 'delete Firestore backups',
  'datastore.databases.delete': 'delete the Firestore database',
  'datastore.databases.update': 'turn off PITR and delete protection',
  'storage.buckets.update': "turn off the bucket's soft delete",
  'storage.buckets.delete': 'delete the bucket',
  'storage.buckets.setIamPolicy': 'change who can use the bucket',
  'resourcemanager.projects.setIamPolicy': 'change who can do anything',
  'iam.serviceAccounts.setIamPolicy': 'change who can act as an account',
  'iam.serviceAccountKeys.create': 'make a long-lived key',
};

/** The accounts every project starts with, which carry Editor unless it was taken off. */
export function defaultAccounts({projectNumber, project}) {
  return [
    `serviceAccount:${projectNumber}-compute@developer.gserviceaccount.com`,
    `serviceAccount:${project}@appspot.gserviceaccount.com`,
  ];
}

/** `gcloud projects get-iam-policy --format=json` -> Map(member -> Set(roles)), plus conditional bindings. */
export function readPolicy(json) {
  const roles = new Map();
  const conditional = [];
  for (const binding of json?.bindings ?? []) {
    if (binding.condition) conditional.push(binding);
    for (const member of binding.members ?? []) {
      if (!roles.has(member)) roles.set(member, new Set());
      roles.get(member).add(binding.role);
    }
  }
  return {roles, conditional, known: Boolean(json)};
}

/**
 * `gcloud functions list --v2 --format=json` -> [{name, region, serviceAccount}].
 * A second generation function keeps its account in serviceConfig.
 */
export function readFunctions(json) {
  return (json ?? []).map(f => {
    const parts = String(f.name ?? '').split('/');
    return {
      name: parts[parts.length - 1],
      region: parts[parts.indexOf('locations') + 1] ?? null,
      serviceAccount:
        f.serviceConfig?.serviceAccountEmail ?? f.serviceAccountEmail ?? null,
    };
  });
}

/** `gcloud iam roles describe <role> --format=json` -> Set of permissions, or null when unknown. */
export function permissionsOf(json) {
  return Array.isArray(json?.includedPermissions)
    ? new Set(json.includedPermissions)
    : null;
}

const isServiceAccount = member => member.startsWith('serviceAccount:');
/**
 * Google's own service agents (service-<number>@..., and the cloudservices
 * account): Google needs their roles, they have no keys, and nothing outside
 * Google can act as them. Listed as ok, not warned about, and never touched.
 */
export const isGoogleManaged = member =>
  /^serviceAccount:(service-\d+@|\d+@(cloudservices|cloudbuild)\.gserviceaccount\.com$)/.test(
    member,
  );
const emailOf = member => member.replace(/^[a-z]+:/i, '');
const broad = role => role === 'roles/owner' || role === 'roles/editor';

/**
 * state: {
 *   project: {number},
 *   policy: readPolicy(...),
 *   functions: readFunctions(...),
 *   rolePermissions: Map(role -> Set | null),
 *   runtimeExists: boolean | null,
 *   bucketPolicy: readPolicy(...),   // the bucket's own IAM
 *   deployAccount: email | null,
 * }
 * Returns {ok, lines: [{level: 'ok'|'FAIL'|'warn'|'?', text}]}. `ok` is false
 * when a default account still has Editor/Owner or a function still runs as
 * one (the exit code of audit.mjs).
 */
export function evaluate(state, config = CONFIG) {
  const lines = [];
  const add = (level, text) => lines.push({level, text});
  let ok = true;
  const fail = text => {
    ok = false;
    add('FAIL', text);
  };
  const runtime = `serviceAccount:${runtimeEmail(config)}`;
  const defaults = state.project?.number
    ? defaultAccounts({
        projectNumber: state.project.number,
        project: config.project,
      })
    : [];

  if (!state.policy?.known) {
    fail(
      'the project IAM policy could not be read: nothing below can be trusted',
    );
    return {ok, lines};
  }
  const {roles} = state.policy;
  const rolesOf = member => [...(roles.get(member) ?? [])].sort();

  // 1. Editor and Owner on accounts that are not people.
  add('ok', '-- project roles on service accounts --');
  for (const [member, held] of roles) {
    if (!isServiceAccount(member)) continue;
    const big = [...held].filter(broad);
    const isDefault = defaults.includes(member);
    if (big.length && isGoogleManaged(member))
      add(
        'ok',
        `${emailOf(member)} has ${big.join(
          ', ',
        )} (Google-managed: leave alone)`,
      );
    else if (big.length && isDefault)
      fail(
        `${emailOf(member)} (a default account) still has ${big.join(', ')}`,
      );
    else if (big.length)
      add('warn', `${emailOf(member)} has ${big.join(', ')}`);
  }
  if (!defaults.length)
    add(
      '?',
      'the project number is unknown, so the default accounts could not be named',
    );
  else
    for (const member of defaults)
      if (!roles.has(member))
        add('ok', `${emailOf(member)} holds no project role`);
      else if (![...roles.get(member)].some(broad))
        add(
          'ok',
          `${emailOf(member)} no longer has Editor/Owner (roles: ${rolesOf(
            member,
          ).join(', ')})`,
        );

  // 2. Which account each function runs as.
  add('ok', '-- functions --');
  for (const name of config.functions) {
    const fn = state.functions?.find(f => f.name === name);
    if (!fn) {
      add(
        '?',
        `${name}: not found in the function list (is it deployed in this project?)`,
      );
      continue;
    }
    const as = fn.serviceAccount ? `serviceAccount:${fn.serviceAccount}` : null;
    if (!as) add('?', `${name}: no service account in the listing`);
    else if (as === runtime) add('ok', `${name} runs as ${emailOf(as)}`);
    else if (defaults.includes(as))
      fail(
        `${name} runs as ${emailOf(
          as,
        )}, a default account (Editor): switch it to ${emailOf(runtime)}`,
      );
    else
      add(
        'warn',
        `${name} runs as ${emailOf(
          as,
        )}, which is neither the runtime account nor a default one`,
      );
  }

  // 3. The runtime account holds what the functions use, and nothing more.
  add('ok', '-- the runtime account --');
  if (state.runtimeExists === false)
    add('warn', `${emailOf(runtime)} does not exist yet (runbook step 1)`);
  else {
    const held = rolesOf(runtime);
    for (const role of RUNTIME_PROJECT_ROLES)
      add(
        held.includes(role) ? 'ok' : 'warn',
        `${role}: ${held.includes(role) ? 'granted' : 'not granted yet'}`,
      );
    for (const role of held.filter(r => !RUNTIME_PROJECT_ROLES.includes(r)))
      add(
        broad(role) ? 'FAIL' : 'warn',
        `${emailOf(runtime)} also holds ${role} at project level`,
      );
    if (held.some(broad)) ok = false;
    const bucketRoles = state.bucketPolicy?.roles?.get(runtime);
    if (!state.bucketPolicy?.known)
      add('?', `the bucket policy of ${config.bucket} could not be read`);
    else
      for (const role of RUNTIME_BUCKET_ROLES)
        add(
          bucketRoles?.has(role) ? 'ok' : 'warn',
          `${role} on gs://${config.bucket}: ${
            bucketRoles?.has(role) ? 'granted' : 'not granted yet'
          }`,
        );
  }

  // 4. Who can do what we must protect (from the roles' real permissions).
  add('ok', '-- who holds a permission that must stay with people --');
  const forbidden = Object.keys(FORBIDDEN);
  const unknownRoles = new Set();
  const holders = new Map();
  // Project roles and the bucket's own roles together: a storage.admin on the
  // bucket for anyone shows here too.
  const everyRole = new Map();
  for (const source of [roles, state.bucketPolicy?.roles ?? new Map()])
    for (const [member, held] of source)
      everyRole.set(
        member,
        new Set([...(everyRole.get(member) ?? []), ...held]),
      );
  for (const [member, held] of everyRole) {
    const found = new Set();
    for (const role of held) {
      const perms = state.rolePermissions?.get(role);
      if (!perms) {
        unknownRoles.add(role);
        continue;
      }
      for (const p of forbidden) if (perms.has(p)) found.add(p);
    }
    if (found.size) holders.set(member, [...found].sort());
  }
  for (const [member, perms] of holders) {
    // The bucket's legacy convenience members are groups, not people: every
    // project Owner / Editor / Viewer, which includes service accounts.
    const convenience = member.match(/^project(Owner|Editor|Viewer):/);
    const who = convenience
      ? `every project ${convenience[1]} (bucket convenience binding)`
      : emailOf(member);
    const text = `${who} can: ${perms.map(p => FORBIDDEN[p]).join('; ')}`;
    if (convenience)
      add(
        convenience[1] === 'Owner' ? 'ok' : 'warn',
        `${text}${
          convenience[1] === 'Owner'
            ? ''
            : ' (includes the compute and deploy accounts until step 5 and 6)'
        }`,
      );
    else if (isGoogleManaged(member))
      add('ok', `${text} (Google-managed: leave alone)`);
    else if (isServiceAccount(member)) {
      if (defaults.includes(member) || member === runtime) fail(text);
      else add('warn', text);
    } else add('ok', `${text} (a person)`);
  }
  if (!holders.size)
    add(
      'ok',
      'nobody holds those permissions (including the owners?), check the policy was read in full',
    );
  for (const role of unknownRoles)
    add(
      '?',
      `the permissions of ${role} could not be read, so who holds them through it is unknown`,
    );
  for (const binding of state.policy.conditional)
    add(
      'warn',
      `conditional binding ${binding.role} for ${binding.members.join(
        ', ',
      )}: conditions are not evaluated here`,
    );

  // Long-lived keys: a key is a password that works from anywhere.
  add('ok', '-- user-managed keys on service accounts --');
  for (const member of roles.keys()) {
    if (!isServiceAccount(member) || isGoogleManaged(member)) continue;
    const keys = state.keys?.get(emailOf(member));
    if (keys === undefined || keys === null)
      add('?', `${emailOf(member)}: its keys could not be listed`);
    else if (!keys.length)
      add('ok', `${emailOf(member)} has no user-managed keys`);
    else
      add(
        'warn',
        `${emailOf(member)} has ${keys.length} user-managed key(s)${keys
          .map(k => k.validAfterTime)
          .filter(Boolean)
          .map(t => ` (created ${t})`)
          .join('')}`,
      );
  }

  // 5. The CI deploy account, when named.
  if (state.deployAccount) {
    add('ok', '-- the CI deploy account --');
    const member = `serviceAccount:${state.deployAccount}`;
    const held = rolesOf(member);
    if (!held.length)
      add(
        '?',
        `${state.deployAccount} holds no project role (is that the right email?)`,
      );
    for (const role of held)
      add(
        broad(role) ? 'warn' : 'ok',
        `${state.deployAccount}: ${role}${
          broad(role) ? ' (broad: runbook step 6 narrows it)' : ''
        }`,
      );
    const found = holders.get(member);
    if (found)
      add(
        'warn',
        `${state.deployAccount} can: ${found
          .map(p => FORBIDDEN[p])
          .join('; ')} (until step 6)`,
      );
  }

  add(
    'ok',
    ok ? 'result: the split is in place' : 'result: NOT done (see FAIL above)',
  );
  return {ok, lines};
}

export const render = result =>
  result.lines
    .map(l =>
      l.level === 'ok'
        ? `  ok    ${l.text}`
        : `  ${l.level.padEnd(5)} ${l.text}`,
    )
    .join('\n');
