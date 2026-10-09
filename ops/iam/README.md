# ops/iam

Who can do what in `botracing-61` (pit wall thread 2 #266, #271, #294; marshal #176.3, #267). Goal: **a bug in a function, or a leaked token, cannot delete the backups, turn off the bucket's soft delete, or change who has access.** Today both functions run as the default compute account, which has Editor, and Editor can do all of that.

The plan is chicane's (#271); this is its runbook, with the read-only audit that proves each step. **Nothing here is applied by a script.** The commands are for an owner (apex, with Botkin's credentials), one at a time, running the audit between steps. Each step says how to undo it.

```
gcloud auth login
node ops/iam/audit.mjs                          # step 0: read-only, prints what is true now; exit 1 until the split is in place
node ops/iam/audit.mjs --deploy-account <the email behind FIREBASE_SERVICE_ACCOUNT_BOTRACING_61>
```

The audit reads the project policy, the bucket policy, each function's runtime account, and the **permissions each held role really carries** (`gcloud iam roles describe`), so "who can delete a backup" comes from the roles, not from a list of names I guessed. It changes nothing. Where a call fails it prints `?` and the gcloud error instead of guessing.

## The order: grant, then switch, then prove, then revoke

A missing permission must never break production, so nothing is taken away until everything is moved and proven.

Set these once (PowerShell shown; `$env:NUM` is the project number, `gcloud projects describe botracing-61 --format="value(projectNumber)"`):

```
$P = "botracing-61"
$RT = "lap-runtime@$P.iam.gserviceaccount.com"
$NUM = gcloud projects describe $P --format="value(projectNumber)"
$COMPUTE = "$NUM-compute@developer.gserviceaccount.com"
$APPENGINE = "$P@appspot.gserviceaccount.com"
```

### Step 1: make the runtime account and give it only what the functions use

Nothing is moved yet, so nothing can break.

```
gcloud iam service-accounts create lap-runtime --project=$P --display-name="LAP functions runtime"

# Firestore documents (read and write). It carries no backup or database-settings permission.
gcloud projects add-iam-policy-binding $P --member="serviceAccount:$RT" --role="roles/datastore.user" --condition=None

# Logs.
gcloud projects add-iam-policy-binding $P --member="serviceAccount:$RT" --role="roles/logging.logWriter" --condition=None

# Objects in the one bucket, not the bucket's settings: it cannot turn soft delete off.
gcloud storage buckets add-iam-policy-binding gs://botracing-61-lmu --member="serviceAccount:$RT" --role="roles/storage.objectAdmin"

# The upload endpoint's signed upload URLs sign as the runtime account, on itself only.
gcloud iam service-accounts add-iam-policy-binding $RT --project=$P --member="serviceAccount:$RT" --role="roles/iam.serviceAccountTokenCreator"
```

Check: `node ops/iam/audit.mjs` shows `roles/datastore.user: granted`, `roles/logging.logWriter: granted`, `roles/storage.objectAdmin on gs://botracing-61-lmu: granted`, and nothing else for the account.
Undo: `gcloud iam service-accounts delete $RT` (nothing uses it yet).

### Step 2: let the CI deploy account use it

The deploy account needs permission to deploy a function **as** the runtime account, or the next deploy fails naming the missing `iam.serviceAccounts.actAs`. This is the step most likely to bite, so it comes before step 3.

```
gcloud iam service-accounts add-iam-policy-binding $RT --project=$P --member="serviceAccount:<the deploy account email>" --role="roles/iam.serviceAccountUser"
```

Check: the audit with `--deploy-account` lists it. Undo: the same with `remove-iam-policy-binding`.

### Step 3: the functions run as it (a code PR, after 1 and 2 are confirmed)

`serviceAccount: 'lap-runtime@botracing-61.iam.gserviceaccount.com'` in the options of `lmuApi` and `uploadApi` (and the curator function when it exists), in `functions/src`. Merged only after steps 1 and 2 are confirmed; the functions deploy workflow applies it. **Not in this PR.** Rollback: revert that one PR (the default account is untouched until step 5).

Check: `node ops/iam/audit.mjs` shows `lmuApi runs as lap-runtime@...` and `uploadApi runs as lap-runtime@...`.

### Step 4: prove it with a real signed-in session (no revoke before this)

- `GET /api/lmu/sessions` with Botkin's token: 200 and his sessions.
- A signed upload URL issued and used (a tray upload, or `ops`/smoke), a heartbeat accepted, a track read.
- Read the function logs for ten minutes after the switch: `gcloud logging read 'severity>=ERROR AND (textPayload:"PERMISSION_DENIED" OR jsonPayload.message:"PERMISSION_DENIED")' --project=$P --freshness=15m`. If a third grant is needed it shows here; add it, do not revoke.
- **Prove the restriction itself** without deleting anything: the audit reads each role's real permissions, and the policy troubleshooter answers the question for the runtime account directly (read-only):

```
gcloud policy-troubleshoot iam //cloudresourcemanager.googleapis.com/projects/$P --principal-email=$RT --permission=datastore.backups.delete
gcloud policy-troubleshoot iam //cloudresourcemanager.googleapis.com/projects/$P --principal-email=$RT --permission=resourcemanager.projects.setIamPolicy
gcloud policy-troubleshoot iam //storage.googleapis.com/projects/_/buckets/botracing-61-lmu --principal-email=$RT --permission=storage.buckets.update
```

Each must say `NOT_GRANTED`. (Unverified: the exact command form; do not test by really deleting a backup or changing the bucket.)

### Step 5: only now revoke Editor from the default accounts

Check first that nothing else relies on them: the audit's "who holds a permission" lists them, and **Cloud Build** and the functions' build step may run as the default compute account (Google moved new projects to that in 2024). Removing Editor from it can then make the _deploy_ fail, not the site. If a deploy builds as it, give it the build roles before taking Editor off:

```
gcloud projects add-iam-policy-binding $P --member="serviceAccount:$COMPUTE" --role="roles/cloudbuild.builds.builder" --condition=None
```

(unverified: whether this project's builds run as that account; the first deploy after step 5 shows it.)

Then, **last**:

```
gcloud projects remove-iam-policy-binding $P --member="serviceAccount:$COMPUTE" --role="roles/editor"
gcloud projects remove-iam-policy-binding $P --member="serviceAccount:$APPENGINE" --role="roles/editor"
node ops/iam/audit.mjs        # must now exit 0
```

Undo (if a deploy or a function fails on a missing permission): `gcloud projects add-iam-policy-binding $P --member="serviceAccount:$COMPUTE" --role="roles/editor" --condition=None`, then find the narrower role that was needed.

### Step 6 (separate, last): scope the CI deploy account

From whatever broad role it holds to what a deploy needs: Firebase Hosting admin, Cloud Functions developer, Firebase rules/indexes admin, and `serviceAccountUser` on the runtime account (step 2). The minimal set is not known in advance: add the narrow roles, remove the broad one, run a deploy from a throwaway branch; if it fails the error names the missing permission, add it, repeat. A failed CI deploy leaves production as it was. The audit's `--deploy-account` section shows what it holds and that it can still delete backups until this is done.

## What this does not do

- It does not stop an **owner** (Botkin's account, or whoever applies this) from deleting backups: that needs a second project holding an export (marshal #176.4, roadmap).
- Until step 6 the CI deploy account can still change IAM and delete backups.
- It does not check conditional IAM bindings (the audit lists them as a warning).

## Leave the Google-managed accounts alone

`<number>@cloudservices.gserviceaccount.com` (needs Editor: removing it breaks Google's own operations) and every `service-<number>@...` agent (`gcf-admin-robot`, `serverless-robot-prod`, `gcp-sa-firebase`, ...) are Google's. They have no keys and nothing outside Google can act as them. The audit prints them as `ok (Google-managed: leave alone)` and never lists keys for them; do not edit their roles.

## Admin SDK scripts run as a person, never with a key

`firebase-adminsdk-fbsvc@...` can delete the bucket and turn off soft delete, but it has **no user-managed keys** (steward's check), so nothing outside Google can act as it. Keep it that way: Admin SDK scripts (`tools/sessions/store.mjs`, `ops/*`) use `gcloud auth application-default login` as a person. The audit lists user-managed keys for every non-Google account (`gcloud iam service-accounts keys list --managed-by=user`, a read), so a new key shows up as a warning. Revoking Editor in step 5 does **not** stop an old Admin writer that uses a person's credentials: find any such writer (the PC's old logon-task uploader) before step 5.

## What was verified and what was not

The audit has run for real once, read-only, against `botracing-61` (apex, and steward in PR 305): the readers work (`serviceConfig.serviceAccountEmail`, `projectNumber`, `includedPermissions`, `functions list --v2` finds both functions), and the functions' source needs only Firestore, one bucket's objects and `getSignedUrl`, so step 1's four grants are the complete set. Its output today is NOT done: Editor on the default compute and App Engine accounts, both functions running as the compute account.

Not verified: the key listing and the bucket-policy fold-in (added after that run; tested on fixtures, 12 tests), the policy-troubleshoot command form in step 4, whether this project's builds run as the default compute account (step 5), and every grant, switch and revoke (nothing has been applied).

## The bucket's legacy convenience members

`projectOwner:botracing-61` and `projectEditor:botracing-61` on the bucket are groups, not people: every project Owner (people) and every project Editor, which includes the compute and App Engine accounts and the CI deploy account. They let any Editor reach the bucket's settings (soft delete, who can use it). The audit prints them as `every project Owner/Editor (bucket convenience binding)` and warns on the Editor one. Step 5 takes the default accounts out of that group; step 6 does the same for the deploy account.

## Step 6: the CI identities (`ciSplit.mjs`)

The one CI account (`github-action-1142179068@`) is behind the repo secret `FIREBASE_SERVICE_ACCOUNT_BOTRACING_61`. The PR preview workflow runs a branch's code with that secret. On 2026-10-09 it held `secretmanager.secretAccessor` at project level and `firebaseauth.admin`, so any PR branch could read every secret and mint a sign-in for any uid (thread 54 #2610). After this step:

| Who | Holds | Used by |
| --- | --- | --- |
| `hosting-preview@` (new) | `firebasehosting.admin`, `serviceusage.apiKeysViewer`, `serviceusage.serviceUsageConsumer`, `cloudfunctions.viewer`, `run.viewer` | PR previews and their cleanup (repo secret `HOSTING_PREVIEW_SERVICE_ACCOUNT`) |
| `github-action-…@` (existing) | what it has, minus `secretmanager.*` and `firebaseauth.admin` | functions and hosting deploys from main (secret in the `deploy` Environment, main only), and tray publish (a copy in `tray-release`) |
| nobody else | secret values readable at project level | only the owner |

Previews are checked signed in as `seat-test` (`#ct=`, docs/TESTING.md), which needs no Auth authorized domain. Without Auth admin, the CLI can't add a preview's domain to the authorized domains, so Google sign-in on a preview won't work. That's deliberate.

```
node ops/iam/ciSplit.mjs grant             # dry run: who can do what now, and the steps
node ops/iam/ciSplit.mjs grant --apply     # only adds: the account, its roles, keys into GitHub secrets, the deploy Environment
# merge the workflow PR; then prove: a PR preview deploys, and a push to main deploys functions and hosting
node ops/iam/ciSplit.mjs revoke            # dry run
node ops/iam/ciSplit.mjs revoke --apply    # only removes: the three roles, the repo-level secret, old keys, the dead Garage 61 secrets
```

Run `desktop/scripts/setup-release-env.ps1` before `grant`, so `tray-release` exists and gets its copy of the deploy key; otherwise `grant` skips it and says so. New keys go from a private temp folder into `gh secret set` on stdin and are deleted at once. Both phases print the before and after.

Undo: `grant` by deleting `hosting-preview@` and the `deploy` Environment. `revoke`'s role removals by `add-iam-policy-binding` with the same role. A deleted secret or key can't be undone, which is why `revoke` only runs after the proof.

Next, not in this step: Workload Identity Federation (GitHub OIDC) instead of keys, so no long-lived key exists at all.
