// The CI identity split (IAM step 6, pit-wall thread 54 #2610, #2611). Pure:
// state in, a list of steps out, so the tests run anywhere; ciSplit.mjs reads
// the state with gcloud and gh and runs the steps.
//
// Why: the one CI account (github-action-...) is used by the PR preview
// workflow, which runs whatever a branch's code does. That account could read
// every Secret Manager secret, act as Firebase Auth admin (mint a sign-in for
// any uid) and change the security rules. After the split:
//   - PR previews and their cleanup use `hosting-preview`, which can deploy
//     preview channels and nothing else (repo secret HOSTING_PREVIEW_SERVICE_ACCOUNT).
//   - Deploys from main use the existing account, through the `deploy`
//     Environment (main only), with no Secret Manager or Auth admin role.
//   - Each release Environment gets its own account, which can write only
//     under its own prefix in the lmu bucket (an IAM condition): tray-release
//     under tray/, android-release under android/. The deploy key is not
//     copied there.
//   - Nothing at project level can read secrets except the owner.
//
// Grant, switch, prove, then revoke (ops/iam/README.md): phase `grant` only
// adds; phase `revoke` only removes, and runs after a preview and a main
// deploy have both worked on the new identities.

export const CI = {
  project: 'botracing-61',
  repo: 'botchkin2/botracing',
  previewName: 'hosting-preview',
  /** The existing CI account, the one behind FIREBASE_SERVICE_ACCOUNT_BOTRACING_61. */
  deployEmail: 'github-action-1142179068@botracing-61.iam.gserviceaccount.com',
  previewSecret: 'HOSTING_PREVIEW_SERVICE_ACCOUNT',
  deploySecret: 'FIREBASE_SERVICE_ACCOUNT_BOTRACING_61',
  deployEnv: 'deploy',
  /**
   * Each release job's own account, in its own Environment: its prefix in the
   * bucket and nothing else. Each Environment is made by its kind's setup
   * script (desktop/scripts/setup-release-env.ps1, scripts/setup-android-release.ps1).
   * `secret` is the key's name in that Environment: a name no repo-level or
   * other Environment's secret has, so a missing Environment secret fails the
   * job instead of falling back to another key (rake #3302, #3304). Until
   * 2026-10-09 the tray's key sat in tray-release under the deploy key's name
   * (FIREBASE_SERVICE_ACCOUNT_BOTRACING_61); grant puts it under its own name
   * and revoke deletes the old one and the old key.
   */
  releases: [
    {name: 'tray-release', env: 'tray-release', prefix: 'tray', title: 'tray-only', label: 'Tray release',
      secret: 'TRAY_RELEASE_SERVICE_ACCOUNT'},
    {name: 'android-release', env: 'android-release', prefix: 'android', title: 'android-only', label: 'Android release',
      secret: 'ANDROID_RELEASE_SERVICE_ACCOUNT'},
  ],
  bucket: 'botracing-61-lmu',
};

export const release = (name, c = CI) => c.releases.find(r => r.name === name);

export const releaseEmail = (r, c = CI) =>
  `${r.name}@${c.project}.iam.gserviceaccount.com`;

/**
 * objectUser = create, get, overwrite and delete objects (latest.json is
 * overwritten by every release). The condition limits it to its prefix. A condition
 * on object names can't cover `storage.objects.list` (checked on the bucket),
 * so the workflow checks for an existing version with `objects describe`.
 * Needs uniform bucket-level access, which the bucket has.
 */
export const RELEASE_ROLE = 'roles/storage.objectUser';
export const releaseCondition = (r, c = CI) =>
  `resource.name.startsWith('projects/_/buckets/${c.bucket}/objects/${r.prefix}/')`;

/** Whether the bucket policy (gcloud JSON) already has this release account's conditioned binding. */
export function hasReleaseBinding(bucketPolicyJson, r, c = CI) {
  return (bucketPolicyJson?.bindings ?? []).some(
    b =>
      b.role === RELEASE_ROLE &&
      (b.members ?? []).includes(`serviceAccount:${releaseEmail(r, c)}`) &&
      b.condition?.expression === releaseCondition(r, c),
  );
}

export const previewEmail = (c = CI) =>
  `${c.previewName}@${c.project}.iam.gserviceaccount.com`;

/**
 * What a preview channel deploy needs: the same read-only helpers the deploy
 * account holds today (firebase-tools reads the web app's key, checks the
 * function rewrites, which are Cloud Run services in v2, and bills API calls
 * to the project), plus Hosting admin for the channel itself. No Auth admin: the CLI's step that adds the channel's domain to
 * Auth's authorized domains then fails and is skipped. Previews are checked
 * signed in as seat-test (#ct= custom token), which needs no authorized
 * domain, never with Google sign-in.
 */
export const PREVIEW_ROLES = [
  'roles/firebasehosting.admin',
  'roles/serviceusage.apiKeysViewer',
  'roles/cloudfunctions.viewer',
  'roles/run.viewer',
  'roles/serviceusage.serviceUsageConsumer',
];

/**
 * Added to the deploy account: a new public HTTPS function needs its invoker
 * policy set (cloudfunctions.functions.setIamPolicy), which
 * cloudfunctions.developer lacks (the #326 deploy failed on it). Acceptable
 * because the key lives only in the main-only `deploy` Environment.
 */
export const DEPLOY_ROLES_ADDED = ['roles/cloudfunctions.admin'];

/** Taken off the deploy account: nothing a deploy does reads a secret or acts as Auth admin. */
export const DEPLOY_ROLES_REMOVED = [
  'roles/secretmanager.secretAccessor',
  'roles/secretmanager.viewer',
  'roles/firebaseauth.admin',
];

/** A repo-level GitHub secret left from the same integration; no workflow reads it. */
export const DEAD_REPO_SECRETS = ['GARAGE61_API_TOKEN'];

/** Left from the Garage 61 integration; nothing in functions/ or src/ reads them. */
export const DEAD_SECRETS = [
  'GARAGE61_API_KEY',
  'GARAGE61_API_TOKEN',
  'GARAGE61_OAUTH_CLIENT_ID',
  'GARAGE61_OAUTH_CLIENT_SECRET',
  'SESSION_ENCRYPTION_KEY',
];

/** Roles that read a secret's value when held at project level. */
const SECRET_READERS = new Set([
  'roles/owner',
  'roles/secretmanager.admin',
  'roles/secretmanager.secretAccessor',
]);

/**
 * `state`: {
 *   policy: Map(member -> Set(role)),             the project policy
 *   previewExists: boolean,                        the hosting-preview account
 *   releases: {[name]: {exists, bound, keys}},     each release account, whether it has
 *                                                  its prefix-only bucket binding, and
 *                                                  its user-managed key ids, oldest first
 *   deployKeys: string[],                          user-managed key ids of the deploy account
 *   envs: Set(name),                               GitHub Environments that exist
 *   repoSecrets: Set(name), envSecrets: {env: Set(name)},
 *   secrets: string[],                             Secret Manager secret names
 * }
 * A step: {what, run?: string[] (gcloud args), gh?: string[] (gh args),
 *          keyTo?: {account, secret, env|null}} (a new key piped to a GitHub secret).
 */
export function planCiSplit(state, phase, c = CI) {
  const steps = [];
  const preview = previewEmail(c);
  const has = (member, role) => state.policy.get(member)?.has(role) ?? false;

  if (phase === 'grant') {
    if (!state.previewExists)
      steps.push({
        what: `create the ${c.previewName} account`,
        run: ['iam', 'service-accounts', 'create', c.previewName,
          `--project=${c.project}`, '--display-name=PR preview channels only'],
      });
    for (const role of PREVIEW_ROLES)
      if (!has(`serviceAccount:${preview}`, role))
        steps.push({
          what: `${c.previewName}: ${role}`,
          run: ['projects', 'add-iam-policy-binding', c.project,
            `--member=serviceAccount:${preview}`, `--role=${role}`, '--condition=None'],
        });
    for (const role of DEPLOY_ROLES_ADDED)
      if (!has(`serviceAccount:${c.deployEmail}`, role))
        steps.push({
          what: `deploy account: ${role}`,
          run: ['projects', 'add-iam-policy-binding', c.project,
            `--member=serviceAccount:${c.deployEmail}`, `--role=${role}`, '--condition=None'],
        });
    if (!state.repoSecrets.has(c.previewSecret))
      steps.push({
        what: `a key for ${c.previewName} into repo secret ${c.previewSecret}`,
        keyTo: {account: preview, secret: c.previewSecret, env: null},
      });
    if (!state.envs.has(c.deployEnv))
      steps.push({
        what: `Environment ${c.deployEnv}, deployable from main only`,
        gh: ['api', '-X', 'PUT', `repos/${c.repo}/environments/${c.deployEnv}`,
          '-F', 'deployment_branch_policy[protected_branches]=false',
          '-F', 'deployment_branch_policy[custom_branch_policies]=true'],
        then: ['api', '-X', 'POST',
          `repos/${c.repo}/environments/${c.deployEnv}/deployment-branch-policies`,
          '-f', 'name=main', '-f', 'type=branch'],
      });
    if (!state.envSecrets[c.deployEnv]?.has(c.deploySecret))
      steps.push({
        what: `a new key for the deploy account into ${c.deployEnv} secret ${c.deploySecret}`,
        keyTo: {account: c.deployEmail, secret: c.deploySecret, env: c.deployEnv},
      });
    // Each release account: its prefix in the bucket, nothing else.
    for (const r of c.releases) {
      const now = state.releases[r.name] ?? {};
      if (!now.exists)
        steps.push({
          what: `create the ${r.name} account`,
          run: ['iam', 'service-accounts', 'create', r.name, `--project=${c.project}`,
            `--display-name=${r.label}: ${r.prefix}/ in the lmu bucket only`],
        });
      if (!now.bound)
        steps.push({
          what: `${r.name}: ${RELEASE_ROLE} on gs://${c.bucket}, only under ${r.prefix}/`,
          run: ['storage', 'buckets', 'add-iam-policy-binding', `gs://${c.bucket}`,
            `--member=serviceAccount:${releaseEmail(r, c)}`, `--role=${RELEASE_ROLE}`,
            `--condition=expression=${releaseCondition(r, c)},title=${r.title}`,
            `--project=${c.project}`],
        });
      // The Environment is made by its kind's setup script; run that first,
      // or this run skips the key and says so.
      if (state.envs.has(r.env) && !state.envSecrets[r.env]?.has(r.secret))
        steps.push({
          what: `a key for ${r.name} into ${r.env} secret ${r.secret}`,
          keyTo: {account: releaseEmail(r, c), secret: r.secret, env: r.env},
        });
    }
    return steps;
  }

  if (phase === 'revoke') {
    for (const role of DEPLOY_ROLES_REMOVED)
      if (has(`serviceAccount:${c.deployEmail}`, role))
        steps.push({
          what: `deploy account: remove ${role}`,
          run: ['projects', 'remove-iam-policy-binding', c.project,
            `--member=serviceAccount:${c.deployEmail}`, `--role=${role}`, '--condition=None'],
        });
    if (state.repoSecrets.has(c.deploySecret))
      steps.push({
        what: `delete repo-level secret ${c.deploySecret} (every workflow could read it)`,
        gh: ['secret', 'delete', c.deploySecret, '--repo', c.repo],
      });
    // `grant` made one deploy-account key, for the `deploy` Environment (the
    // tray release has its own account), so keep the newest. Every older
    // user-managed key was readable by PR branches and goes. No Environment
    // holding the secret yet: nothing is deleted.
    const kept = state.envSecrets[c.deployEnv]?.has(c.deploySecret) ? 1 : 0;
    for (const id of kept ? state.deployKeys.slice(0, -kept) : [])
      steps.push({
        what: `delete old deploy-account key ${id.slice(0, 8)}…`,
        run: ['iam', 'service-accounts', 'keys', 'delete', id,
          `--iam-account=${c.deployEmail}`, `--project=${c.project}`, '--quiet'],
      });
    // A release Environment holding its key under its own name: the copy
    // under the deploy key's name goes, and every older key of the account
    // (the one in that copy) with it. Run after a release has published on
    // the new secret.
    for (const r of c.releases) {
      const held = state.envSecrets[r.env];
      if (!held?.has(r.secret)) continue;
      if (r.secret !== c.deploySecret && held.has(c.deploySecret))
        steps.push({
          what: `delete ${r.env} secret ${c.deploySecret} (${r.name}'s key is now ${r.secret})`,
          gh: ['secret', 'delete', c.deploySecret, '--env', r.env, '--repo', c.repo],
        });
      for (const id of (state.releases[r.name]?.keys ?? []).slice(0, -1))
        steps.push({
          what: `delete old ${r.name} key ${id.slice(0, 8)}…`,
          run: ['iam', 'service-accounts', 'keys', 'delete', id,
            `--iam-account=${releaseEmail(r, c)}`, `--project=${c.project}`, '--quiet'],
        });
    }
    for (const name of DEAD_REPO_SECRETS)
      if (state.repoSecrets.has(name))
        steps.push({
          what: `delete dead repo secret ${name}`,
          gh: ['secret', 'delete', name, '--repo', c.repo],
        });
    for (const name of DEAD_SECRETS)
      if (state.secrets.includes(name))
        steps.push({
          what: `delete dead secret ${name}`,
          run: ['secrets', 'delete', name, `--project=${c.project}`, '--quiet'],
        });
    return steps;
  }
  throw new Error(`unknown phase: ${phase} (grant or revoke)`);
}

/** Who can read secret values: project-level readers (secret-level grants are listed per secret by the caller). */
export function secretReaders(policy) {
  const out = [];
  for (const [member, roles] of policy)
    for (const role of roles) if (SECRET_READERS.has(role)) out.push(`${member} (${role})`);
  return out.sort();
}

/** The deploy and preview accounts' project roles, for the before/after print. */
export function ciRoles(policy, c = CI) {
  const of = email => [...(policy.get(`serviceAccount:${email}`) ?? [])].sort();
  return {[c.deployEmail]: of(c.deployEmail), [previewEmail(c)]: of(previewEmail(c))};
}
