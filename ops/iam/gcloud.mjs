// Reads the project's IAM with gcloud, read-only. The only file here that runs
// a process (through the runner ops/backups/gcloud.mjs already has); what it
// finds is judged in lib.mjs.
import {gcloudRunner} from '../backups/gcloud.mjs';
import {
  CONFIG,
  permissionsOf,
  readFunctions,
  readPolicy,
  runtimeEmail,
} from './lib.mjs';

export {gcloudRunner};

const attempt = (fn, fallback) => {
  try {
    return fn();
  } catch (error) {
    return typeof fallback === 'function'
      ? fallback(String(error.message ?? error).split('\n')[0])
      : fallback;
  }
};

/** Everything evaluate() needs. Every call here only reads. */
export function gatherState(run, config = CONFIG, {deployAccount = null} = {}) {
  const {project, bucket} = config;
  const notes = [];
  const note = (what, message) => notes.push(`${what}: ${message}`);

  const describe = attempt(
    () => run(['projects', 'describe', project, '--format=json']),
    message => (note('projects describe', message), null),
  );
  const policy = readPolicy(
    attempt(
      () => run(['projects', 'get-iam-policy', project, '--format=json']),
      message => (note('projects get-iam-policy', message), null),
    ),
  );
  const functions = readFunctions(
    attempt(
      () =>
        run([
          'functions',
          'list',
          '--v2',
          `--project=${project}`,
          '--format=json',
        ]),
      message => (note('functions list', message), []),
    ),
  );
  const accounts = attempt(
    () =>
      run([
        'iam',
        'service-accounts',
        'list',
        `--project=${project}`,
        '--format=json',
      ]),
    message => (note('service-accounts list', message), null),
  );
  const runtimeExists = Array.isArray(accounts)
    ? accounts.some(a => a.email === runtimeEmail(config))
    : null;
  const bucketPolicy = readPolicy(
    attempt(
      () =>
        run([
          'storage',
          'buckets',
          'get-iam-policy',
          `gs://${bucket}`,
          `--project=${project}`,
          '--format=json',
        ]),
      message => (note('buckets get-iam-policy', message), null),
    ),
  );

  // The real permissions of every role anyone holds, so "who can delete a
  // backup" is read from the roles themselves, not from a list of names.
  const rolesHeld = new Set();
  for (const held of policy.roles.values())
    for (const r of held) rolesHeld.add(r);
  const rolePermissions = new Map();
  for (const role of rolesHeld) {
    const args = role.startsWith('projects/')
      ? [
          'iam',
          'roles',
          'describe',
          role.split('/').pop(),
          `--project=${project}`,
        ]
      : ['iam', 'roles', 'describe', role];
    rolePermissions.set(
      role,
      attempt(
        () => permissionsOf(run([...args, '--format=json'])),
        message => (note(`roles describe ${role}`, message), null),
      ),
    );
  }

  return {
    project: {number: describe?.projectNumber ?? null},
    policy,
    functions,
    rolePermissions,
    runtimeExists,
    bucketPolicy,
    deployAccount,
    notes,
  };
}
