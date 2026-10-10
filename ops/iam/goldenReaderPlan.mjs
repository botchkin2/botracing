// What the golden set's CI reader needs (tools/golden/README.md): one service
// account that can READ the objects under golden/ in the lmu bucket and nothing
// else. The slices are real laps in a private bucket; CI fetches them with
// this account's key, which is a repo secret. Pure: ciSplit-style, state in,
// steps out; goldenReader.mjs reads the state and runs the steps.
//
// Why objectViewer on a prefix: viewer is get/list on objects, no write and no
// delete, so a leaked key cannot change a slice. The condition limits it to
// golden/. A condition on object names cannot cover `storage.objects.list`, so
// fetch.mjs asks for each file by the name the manifest pins instead of a
// wildcard (no listing).

export const GOLDEN = {
  project: 'botracing-61',
  repo: 'botchkin2/botracing',
  bucket: 'botracing-61-lmu',
  prefix: 'golden',
  account: 'golden-reader',
  secret: 'GOLDEN_READER_SERVICE_ACCOUNT',
  title: 'golden-only',
};

export const GOLDEN_ROLE = 'roles/storage.objectViewer';

export const goldenEmail = (g = GOLDEN) =>
  `${g.account}@${g.project}.iam.gserviceaccount.com`;

export const goldenCondition = (g = GOLDEN) =>
  `resource.name.startsWith('projects/_/buckets/${g.bucket}/objects/${g.prefix}/')`;

/** Whether the bucket policy (gcloud JSON) already has the account's conditioned binding. */
export function hasGoldenBinding(bucketPolicyJson, g = GOLDEN) {
  return (bucketPolicyJson?.bindings ?? []).some(
    b =>
      b.role === GOLDEN_ROLE &&
      (b.members ?? []).includes(`serviceAccount:${goldenEmail(g)}`) &&
      b.condition?.expression === goldenCondition(g),
  );
}

/**
 * The steps still to take. state: {exists, bound, secretSet}. Only adds: it
 * never removes a role, a key or a secret, and it grants nothing at the
 * project level.
 */
export function planGoldenReader(state, g = GOLDEN) {
  const steps = [];
  if (!state.exists)
    steps.push({
      what: `create the ${g.account} account`,
      run: ['iam', 'service-accounts', 'create', g.account, `--project=${g.project}`,
        `--display-name=Golden set CI: read ${g.prefix}/ in the lmu bucket only`],
    });
  if (!state.bound)
    steps.push({
      what: `${g.account}: ${GOLDEN_ROLE} on gs://${g.bucket}, only under ${g.prefix}/`,
      run: ['storage', 'buckets', 'add-iam-policy-binding', `gs://${g.bucket}`,
        `--member=serviceAccount:${goldenEmail(g)}`, `--role=${GOLDEN_ROLE}`,
        `--condition=expression=${goldenCondition(g)},title=${g.title}`,
        `--project=${g.project}`],
    });
  if (!state.secretSet)
    steps.push({
      what: `a key for ${g.account} into repo secret ${g.secret} (written to a private temp file, piped to gh, deleted)`,
      keyTo: {account: goldenEmail(g), secret: g.secret, env: null},
    });
  return steps;
}
