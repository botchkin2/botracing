# CI signs in as seat-test (design, not built)

Why: the tray end-to-end check (`.github/workflows/tray-e2e.yml`) cannot yet prove that the uploader starts and a heartbeat lands, because a CI job has no sign-in. This is how a job gets one without a long-lived secret. Nothing here is live: no grant has been made and no code written. Pit wall thread 1 #3501, #3466.

## The constraint

A tray check runs the PR's own code, so anything the job can reach, any branch can reach. What a job gets must therefore be worth nothing outside test data.

## Why not "OIDC to a service account that signs custom tokens"

The first idea (pit wall #3466): GitHub's OIDC token, exchanged through Workload Identity Federation for a service account with `roles/iam.serviceAccountTokenCreator` on itself, which then signs a custom token for `seat-test`. **IAM cannot enforce the last part.** Whoever can sign with that account can sign a custom token for *any* uid, including Botkin's. "Only seat-test" would live in a script the PR's code can bypass. Rejected.

## The design: a function that checks the caller and can only answer seat-test

A new HTTPS function `ciSeatToken` (in `functions/`, beside `trayApi`) that:

1. Takes `Authorization: Bearer <GitHub OIDC token>` from the job (the job asks GitHub for one with `permissions: id-token: write` and audience `botracing-seat-token`).
2. Verifies it itself: RS256 signature against GitHub's published keys (`https://token.actions.githubusercontent.com/.well-known/jwks`, cached), `iss`, `aud`, `exp`, and the claims: `repository == botchkin2/botracing`, `event_name` is `pull_request` or `workflow_dispatch`, and `repository_owner_id` matches. A fork's pull request gets no OIDC token at all, so it cannot call it.
3. Returns a custom token for the uid **`seat-test`, a constant in the function**. The request names no uid. There is nothing to ask for but seat-test.
4. Rate limits (one token per caller `sub` per 10 seconds) and logs the claims it accepted (repository, run id, ref), never the token.

The function signs with the runtime account it already runs as: the tray's viewer sign-in (`traySignInApi.ts`) already calls `admin.auth().createCustomToken(uid)` there. **No new IAM grant, no new service account, no secret.** The only deploy step is the usual function deploy on merge.

The job then (all inside `tray-e2e.yml`, the signed-in cells):

- gets the OIDC token, calls `ciSeatToken`, writes the custom token to a file;
- starts the installed tray with `BOTRACING_PROFILE=<name>` and `BOTRACING_SEAT_TOKEN_FILE=<file>` (the shipping installer honours both, #429);
- fails unless `uploader/watch.log` shows a start and a heartbeat for `seat-test` lands (read through the app's own `GET /api/lmu/uploaders` with seat-test's ID token, exchanged the way `mintTestToken.mjs` does), within a time limit;
- the same cell then forces a failure (a bad node path) and expects an `uploader-stopped` problem to appear (#436).

## What an attacker with a PR branch gets

A custom token for `seat-test`: the test user with a few fixed sessions. It reads and writes only seat-test's own data (owner-scoped rules and endpoints) and no other user's. That is the same power `mintTestToken.mjs` already gives every seat on Botkin's PC, now also to a same-repo PR job. Not given: any other uid, any secret, any grant, the deploy account.

Residual risks, stated:

- A same-repo PR can spam seat-test's data; the rate limit and seat-test's own quotas bound it, and seat-test's data is disposable.
- A bug in the verification code is the one thing standing between the internet and a seat-test token (no worse than the above). It needs a review that reads the verifier line by line, and tests with forged tokens (wrong signature, wrong `aud`, wrong repository, expired, `alg: none`).

## One-time steps for Botkin

None for the grant: there is no grant. After the function merges and deploys, nothing else. (If he would rather not have a public function that mints even seat-test tokens: keep the signed-in cells as a local run by damper on a real PC, the 0.1.3 gate, and leave CI at install/launch/quit/uninstall. That is the fallback and costs nothing.)

## If the function is refused and a service account is wanted anyway

Dry-run-able shape only; nothing here is to be run without Botkin. It cannot enforce seat-test (see above), so it needs the e2e job to be the only thing allowed to use it, i.e. the repository condition below plus a GitHub Environment with a required reviewer, which makes every run wait for him:

```
gcloud iam workload-identity-pools create github --project=botracing-61 --location=global
gcloud iam workload-identity-pools providers create-oidc github-oidc --project=botracing-61 --location=global --workload-identity-pool=github --issuer-uri=https://token.actions.githubusercontent.com --attribute-mapping=google.subject=assertion.sub,attribute.repository=assertion.repository --attribute-condition="assertion.repository=='botchkin2/botracing'"
```

Not recommended; listed so the choice is informed.

## Build order, when approved

1. `functions/src/ciSeatTokenCore.ts` (pure: verify claims and signature given the JWKS) with tests of every forged case; `ciSeatTokenApi.ts` (the HTTPS wrapper, rate limit); route and docs.
2. Rules/IAM audit unchanged (`ops/iam/audit.mjs` must still pass: no new account).
3. `tray-e2e.yml` signed-in cells on windows-2022 and 2025, standard user and admin.
