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

Start (or restart) the slot after you merge main into your branch: the endpoint is added from `metro.config.js` when Metro starts, and a reload does not re-read it. Check from the pane's console: `fetch('/__seat-token?platform=seat').then(r => r.status)` must print 200 (404 or an HTML body means the running Metro has no endpoint).

A pane on a live slot (`live-1` to `live-6`) signs in as `seat-test` with no link: `tools/dev/live.mjs` sets `LIVE_SEAT_SIGNIN_PORT`, `metro.config.js` then serves `GET /__seat-token` (`tools/dev/seatToken.mjs`), and the dev build (`src/auth/devSeatSignIn.ts`) picks it up when the pane is signed out. `live.mjs` passes the service account's email (not a secret) and the mint impersonates it with Botkin's gcloud login on this PC (a seat never runs `gcloud auth` itself). The worktree needs `npm ci --prefix functions` for `firebase-admin`. If the mint fails the pane shows the login screen and the Metro log says why (never the token).

- Metro runs with `--localhost` (loopback only), and the endpoint answers only a loopback peer with `Host: localhost:<port>` or `127.0.0.1:<port>` (a LAN client can forge Host, so both are checked), sends no CORS headers, and is `no-store`. A plain `expo start` and every export have no endpoint.
- It mints only `seat-test`; the app checks the token's `uid` before using it and `currentUser.uid` after.
- The token is never logged. CI greps the web export (`tools/ci/assertNoSeatSignIn.mjs`) and fails if the endpoint path or marker is in it.
- A pane on a live slot is `seat-test` by design. Botkin never signs in there with his own account.

## Signing a pane in

```bash
node functions/scripts/mintTestToken.mjs --origin http://localhost:19101 --origin https://<preview-channel>.web.app
```

It prints one link per origin. Open a link once in the browser pane: the app signs in with the token in the address fragment and removes it from the address (`src/auth/customTokenFragment.ts`). The fragment never reaches a server or a log. The token lasts an hour, and the sign-in it makes then renews itself, so each live slot port and each preview channel needs a link once. A link is a credential for `seat-test` only: do not paste it into a shared place. The script refuses any uid that is not `seat-test`.

Never add a path that accepts a uid from the URL or skips sign-in when local: that would be a real bypass. A custom token is not one; only the service account (or Token Creator) can mint it.

## Measuring a width in the browser pane

The pane's viewport presets and `resize_window` change the size but fire no `resize` event, neither on `window` nor on `window.visualViewport`. React Native web's `Dimensions` (behind `useWindowDimensions`, behind `useLayout`) listens to the second, so a page that was already loaded keeps laying itself out at the width it had, and a screen that sizes charts or cards in JS (Plan's cards, timeline and slider) reads wider than the new viewport: at 375 after a load at 440, the Plan column was 408 wide and nine elements sat past the edge. Real rotations and window resizes fire the event and re-lay the page at once; the app needs no fix for this.

So set the size first and then **reload**, or, to keep the page, run `visualViewport.dispatchEvent(new Event('resize'))` in the pane and wait a moment. Measure after that (0 elements with `getBoundingClientRect().right` past `innerWidth` is the check). A measurement taken straight after a resize is of the old width (pit-wall, Plan at 375, #4495 and #4498).

## Test data

`seat-test` has no sessions until some are uploaded through the real pipeline (LMU only; no iRacing until the sessions game filter exists): one race, one practice, one with several files.

```powershell
node functions/scripts/mintTestToken.mjs --id-token-file $env:TEMP\seat-test.token   # writes an hour-long ID token
$env:LAP_TOKEN_FILE = "$env:TEMP\seat-test.token"
node tools/sessions/sync.mjs --remote --only "<session name>"
```

Ids derive from the uid, so they never clash with Botkin's. A re-seed is the same command.

## A local tray as seat-test

A tray built from a branch runs beside the installed one, signed in as `seat-test`, with no browser and nothing of Botkin's touched. It needs a profile (`desktop/README.md`; debug or release build alike, so CI can sign in the installer it ships): its own data folder `%LOCALAPPDATA%\BotRacing-<profile>`, Credential Manager entry and watcher lock.

```powershell
node functions/scripts/mintTestToken.mjs --custom-token-file $env:TEMP\seat-test.custom   # good for an hour
$env:BOTRACING_PROFILE = "seat"
$env:BOTRACING_SEAT_TOKEN_FILE = "$env:TEMP\seat-test.custom"
$env:BOTRACING_FIREBASE_API_KEY = "<the public web key in src/auth/firebase.web.ts>"   # a build without it cannot sign in
cd desktop\src-tauri; cargo build; .\target\debug\botracing.exe
```

At start, a signed-out test tray signs in from the file (`seat_token_file` in `main.rs`, `auth::seat_test_sign_in`); after that it keeps itself signed in like the real one. Any uid but `seat-test` is refused before a request is sent, and the default profile (the real tray) ignores the variable. The proof for a tray change is then: the menu, `%LOCALAPPDATA%\BotRacing-seat\uploader\watch.log` starting, `sidecar.log`, and a `seat-test` heartbeat.

Stop it the same way the installer stops the real tray, with the same profile set: `$env:BOTRACING_PROFILE = "seat"; .\target\debug\botracing.exe --quit`. The quit reaches only that profile's tray (its own single-instance hold), stops its watcher and recorder, and exits. Never `taskkill`. One test tray per seat at a time, quit once the proof is captured.

## The tray installer matrix (CI)

`.github/workflows/tray-e2e.yml` builds the unsigned installer and runs `desktop/scripts/e2e-install.ps1` in 12 cells: Windows Server 2022 and 2025, an admin runner or a new standard user (`e2e-as-user.ps1`, a scheduled task so the profile is a real logon; the name is `Test Ünïcode` or, in two cells, plain `e2euser`), and node as on the runner, none on PATH, or a decoy that records if it runs. Each cell proves: the per-user silent install lands where the Uninstall entry says; the tray starts and stays up; a second launch by path, 8.3 name and extended-length (`\\?\`) form ends at once and leaves the first tray (same pid); the Run entry's command line starts one tray with no visible window (interactive cells only: session 0 shows no window to the check, and the log says so; a self-test shows the check still sees a plain form elsewhere); `--quit` ends the tray, with `quit.log` free of `exit forced` in an interactive cell (`desktop/README.md`); the uninstaller removes the install folder, Run entry and token. It does not sign in (the seat-test token for CI is #449's design); the local tray above is that proof.

The `update` job, "Tray update rehearsal (N-1 to N)", builds 0.0.1 and 0.0.2 with a throwaway updater key made in the run, installs N-1 on the clean runner, lets it download N from a local endpoint, runs `botracing.exe --update` (the menu's "Restart to update") and checks that N runs, the old tray exited and exactly one tray is left (`desktop/scripts/e2e-update.ps1`). Never on this PC: the installer would quit and uninstall the real tray. Signed out, so the watcher-restart case (#511) is a unit test. Green before a tray tag (`desktop/README.md`).

## Golden set (CI)

`tools/golden/README.md`: four real sessions, cut to a few laps, run through the real analysis. `node tools/golden/gate.mjs origin/main` fails when an expected number changes without a line in `tools/golden/CHANGES.md` saying why.

## Performance tests

`src/features/compare/model.perf.test.ts` times a Compare rebuild and a cursor step at 60 laps against a plain pass over the same traces, measured in the same run, so a slower runner moves both. It prints the two ratios; ceilings 2 and 1 sit about 3x above what both the 7900X and CI read.

## The API in the emulators

`functions/test/emulator/*.test.mjs` send real requests to the read API in the Firebase emulators (functions, Firestore, Auth, Storage; config `firebase.emulator.json`, a demo project, nothing reaches production). Run them with `npm run test:emulator` in `functions/`: it builds the functions, starts the emulators, seeds what each test needs and signs a user in through the Auth emulator. firebase-tools needs **Java 21+** (`JAVA_HOME`; on this PC Android Studio's `jbr` qualifies, the system JDK 17 does not). CI runs them in the `functions` job.

## The Android app on an emulator

Nothing ships to the phone without a run of the real app where it will be used. The emulator `tyre_pixel` (android-35 google_apis x86_64) runs the real app; the SDK pieces are `cmdline-tools` and `system-images;android-35;google_apis;x86_64`.

1. Build an x86_64 release variant that bundles its JS and has the seat-test sign-in switched on (`android/` is prebuild output and stays out of git):
   `npx expo prebuild --platform android`, then in `android/` with JDK 17 and `ANDROID_HOME` set: `EXPO_PUBLIC_SEAT_LINK=1 ./gradlew.bat assembleRelease -PreactNativeArchitectures=x86_64`. Only a seat building by hand sets that variable; a test fails if a workflow, `eas.json` or the app config does, and `ota-update.yml` fails if the exported bundle has the sign-in.
2. Boot `emulator -avd tyre_pixel -no-snapshot -gpu angle_indirect`, `adb install -r android/app/build/outputs/apk/release/app-release.apk`.
3. Sign in as seat-test: mint a custom token (`node functions/scripts/mintTestToken.mjs --custom-token-file <file outside the repo>`), then `adb shell am start -a android.intent.action.VIEW -d "botracing61://dev-seat?ct=<token>" app.botracing.android`. Open the screen to prove after that: `botracing61://session/<id>/race` works the same way.
4. **Capture only after signing in, and clear the token first.** The link carries a credential (seat-test only, an hour): `adb logcat -c` right after the sign-in so the log has no token, and delete the token file. Never attach a screenshot taken while the link was on screen; take images after the sign-in, from `adb exec-out screencap -p`, and look at each before attaching it.
5. Shut the emulator when done: `adb emu kill`.

The page the WebView shows is the hosted web app, so a change to the web page is proved on the emulator only after it is deployed (or against a preview origin).
