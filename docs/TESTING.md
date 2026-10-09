# Testing signed in

The app needs a sign-in, and a coding seat never uses Botkin's Google account. Seats test as the user `seat-test`: a real Firebase user with no email or password, holding a small fixed set of sessions. Live slots and previews run against the real backend (production API), so this tests what a user gets.

**Rule: seats test only as `seat-test`, never with Botkin's account.** His account is for the final walk he does himself.

## One-time setup (Botkin, once)

The same Token Creator grant as `functions/scripts/smokeTokens.mjs` (its header has the gcloud commands), then, in PowerShell from the repo root:

```powershell
$env:SMOKE_SERVICE_ACCOUNT = "<firebase-adminsdk service account email>"
node functions/scripts/mintTestToken.mjs --create
```

`--create` makes the `seat-test` user. Nothing else does.

## Live slots sign in by themselves

A pane on a live slot (`live-1` to `live-6`) signs in as `seat-test` with no link: `tools/dev/live.mjs` sets `LIVE_SEAT_SIGNIN_PORT`, `metro.config.js` then serves `GET /__seat-token` (`tools/dev/seatToken.mjs`), and the dev build (`src/auth/devSeatSignIn.ts`) picks it up when the pane is signed out. It needs `SMOKE_SERVICE_ACCOUNT` in the environment Metro starts from (the same setup as above); without it the pane shows the login screen and the Metro log says why.

- The endpoint answers only `Host: localhost:<port>` or `127.0.0.1:<port>`, sends no CORS headers, and is `no-store`. A plain `expo start` and every export have no endpoint.
- It mints only `seat-test`; the app checks the token's `uid` before using it and `currentUser.uid` after.
- The token is never logged. CI greps the web export (`tools/ci/assertNoSeatSignIn.mjs`) and fails if the endpoint path or marker is in it.
- A pane on a live slot is `seat-test` by design. Botkin never signs in there with his own account.

## Signing a pane in

```bash
node functions/scripts/mintTestToken.mjs --origin http://localhost:19101 --origin https://<preview-channel>.web.app
```

It prints one link per origin. Open a link once in the browser pane: the app signs in with the token in the address fragment and removes it from the address (`src/auth/customTokenFragment.ts`). The fragment never reaches a server or a log. The token lasts an hour, and the sign-in it makes then renews itself, so each live slot port and each preview channel needs a link once. A link is a credential for `seat-test` only: do not paste it into a shared place. The script refuses any uid that is not `seat-test`.

Never add a path that accepts a uid from the URL or skips sign-in when local: that would be a real bypass. A custom token is not one; only the service account (or Token Creator) can mint it.

## Test data

`seat-test` has no sessions until some are uploaded through the real pipeline (LMU only; no iRacing until the sessions game filter exists): one race, one practice, one with several files.

```powershell
node functions/scripts/mintTestToken.mjs --id-token-file $env:TEMP\seat-test.token   # writes an hour-long ID token
$env:LAP_TOKEN_FILE = "$env:TEMP\seat-test.token"
node tools/sessions/sync.mjs --remote --only "<session name>"
```

Ids derive from the uid, so they never clash with Botkin's. A re-seed is the same command.
