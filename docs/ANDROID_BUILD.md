# Android Build Setup and Commands

## Overview

Two build paths are available:

1. **EAS Cloud Build** (primary, recommended): Build on Expo's servers, download APK.
2. **Local Build** (offline fallback): Build locally with Android Studio and the SDK.

## Prerequisites

- Node 24+
- npm 11+
- JDK 17 (Microsoft OpenJDK)
- Android Studio (with platform and build-tools for your Expo SDK version)

## Environment Setup (Local Build Only)

Set these user environment variables (persist across sessions):

- `JAVA_HOME`: Point to your JDK 17 installation (e.g., `C:\Program Files\Microsoft\jdk-17.*-hotspot`)
- `ANDROID_HOME`: `C:\Users\<YourUsername>\AppData\Local\Android\Sdk`

Add to PATH: `%ANDROID_HOME%\platform-tools`

## Android SDK Installation

Through Android Studio's SDK Manager, install the platform and build-tools that match your Expo SDK version:

- Expo 57 / React Native 0.86: Android SDK Platform **36**, Build-Tools 36.0.0 (`react-native/gradle/libs.versions.toml`)
- **Android SDK Platform-Tools** (adb, fastboot)

Minimum SDK is API 24.

## Build Commands

### EAS Cloud Build (Recommended)

First time only: authenticate with your Expo account.

```powershell
npx eas-cli login
```

Build the development APK:

```powershell
npm run build:android:development
```

This runs `npx eas build --platform android --profile development`. The build happens on Expo's servers. Check your email or the EAS dashboard for the download link or QR code.

Note: use `npx eas-cli@24.8.0` (the version CI pins) for individual commands, e.g. `npx eas-cli@24.8.0 whoami`. A global `npm install -g` does not work under the MSIX sandbox.

### Local Build (Offline)

Requires local Android setup (JDK, Android Studio, SDK, environment variables).

Build and install on a connected USB phone (Developer options and USB debugging enabled):

```powershell
npx expo run:android --variant release
```

The APK is built locally and installed directly to your phone via adb.

## ABIs

Builds target arm64-v8a only (`expo-build-properties` in app.json), which is enough for a Pixel phone and cuts native C++ compile time (unmeasured; the last all-ABI EAS build took 13m31s). x86 emulators and 32-bit ARM devices will not run these builds; add the ABIs back to `buildArchs` if you need them.

## Troubleshooting

### Long Paths on Windows

Gradle can fail on long file paths. If the build fails with path-length errors, enable Windows long paths or keep the repo path short.

To enable long paths globally (requires admin):

```powershell
New-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" -Name "LongPathsEnabled" -Value 1 -PropertyType DWORD -Force
```

### adb not found

Ensure `%ANDROID_HOME%\platform-tools` is on PATH and the platform-tools SDK is installed.

```powershell
adb devices
```

Should list connected Android devices.

### Package Name

The package is `app.botracing.android` (apex #225; it was Expo's placeholder `com.anonymous.botracing61`). The package is the app's identity: the Google OAuth client for sign-in, the signing key and every install are tied to it, so a different package is a different app. The old APK does not update to it: it installs beside it with its own data, and is uninstalled once by hand. The first EAS build under this package creates its own signing key; Google sign-in needs an Android OAuth client for this package and that key's SHA-1 (`eas credentials -p android`). The URL scheme in `app.json` (`botracing61`) is separate and unchanged.

## Phone Setup

1. Connect Android phone via USB
2. Enable Developer options (tap Build Number 7 times in Settings > About Phone)
3. Enable USB Debugging in Developer options
4. Accept the RSA fingerprint prompt on the phone when adb connects
5. Verify connection: `adb devices`

## Verification

After build setup, verify everything works:

```powershell
java -version
adb devices
npx eas-cli whoami
```

All three should succeed without errors.

## Release download (server side)

Released APKs are served like the tray installer (pit-wall thread 1 #3270 to #3272). The release workflow writes, under `gs://botracing-61-lmu/android/`, the APK at `<version>/BotRacing-<version>.apk` and then `latest.json`, last. The manifest is written only by `scripts/android-release.mjs` (`buildLatest`): `{version, versionCode, apk, sha256, cert_sha256, published_at}`, where `versionCode` is the one EAS built. `functions/src/androidCore.ts` serves it, anonymously: `GET /api/android/latest` gives `{version, versionCode, sha256, published_at, url}` with an hour's signed URL, and `GET /api/android/download` redirects to it. Both answer 404 until a release exists. The serving rules are shared with the tray (`functions/src/releaseCore.ts`), and the functions test builds its fixture with the same `buildLatest`, so the writer and the endpoint can't drift apart. `node scripts/android-release.mjs check android-v1.2.0` fails unless the tag matches `app.json`'s `expo.version`.

## Release (tag workflow)

A release is an `android-v<version>` tag on main; nothing builds on merge. `.github/workflows/android-release.yml`:

1. **check**: the tagged commit is on main, the tag is `android-v` + `app.json`'s `expo.version`, and the types, jest and `scripts/` tests pass.
2. **build** (Environment `android-build`, holds `EXPO_TOKEN`, no reviewer): `eas build --profile release --wait --json` (eas-cli pinned in the workflow). The `release` profile in `eas.json` builds an APK; `autoIncrement` with `appVersionSource: remote` means EAS owns `versionCode`, and a failed build still uses one up. `scripts/android-release.mjs build` reads the finished build from EAS's JSON (id, `appBuildVersion` as versionCode, the APK URL); `verify` checks the downloaded APK with `apksigner` and `aapt2`: signed by the certificate pinned in `scripts/android-signer.json`, package `app.botracing.android`, `versionName` = the tag, `versionCode` = EAS's. Any mismatch stops the run before anyone is asked to approve. If EAS fails, the run fails; there is no local-build fallback. No workflow artifact carries the APK: the repo is public, so anyone could download it before the approval.
3. **publish** (Environment `android-release`, Botkin approves each run; `EXPO_TOKEN` and `ANDROID_RELEASE_SERVICE_ACCOUNT`): fetches the same build from EAS by id (`eas build:view`, same id and versionCode), `latest` checks the APK again and lays out `android/<version>/BotRacing-<version>.apk` and `android/latest.json`; `scripts/publish-release.sh` uploads the APK create-only (a version is never overwritten), then `latest.json`, as the `android-release` account, which can write only under `android/` (`ops/iam/ciSplitPlan.mjs`).

To release: raise `expo.version` in `app.json` in a PR; after it merges, an admin tags main:

```powershell
git fetch origin
git tag android-v1.0.1 origin/main
git push origin android-v1.0.1
```

then approves the publish job in Actions once the build is green. Only admins may create, move or delete `android-v*` and `tray-v*` tags (the repo ruleset `Release tags`).

### One-time setup

`scripts/setup-android-release.ps1` (run `-DryRun` first): the two Environments, `EXPO_TOKEN` in both (a robot token from expo.dev > botventure > Settings > Access tokens, passed as `-ExpoToken` or `$env:EXPO_TOKEN`), the `Release tags` ruleset, and `node ops/iam/ciSplit.mjs grant --apply` for the `android-release` account and its key. It prints names, never values.

By hand, once:

- **Back up the signing key.** EAS holds it (never the repo or GitHub). `npx eas-cli@24.8.0 credentials -p android`, profile `release`, then Keystore > Download existing keystore: it saves the `.jks` and prints its passwords. Keep both in the password manager. Lose the key and installed apps can't update; every user reinstalls.
- **Pin its certificate.** The same `credentials` screen prints the keystore's SHA-256 fingerprint. Put it, lowercase without colons, in `scripts/android-signer.json` (`certSha256`) in a PR. Until it is pinned, the build job stops and prints the APK's certificate SHA-256, which is the same value.
- **Google sign-in.** Google Cloud console (project botracing-61) > APIs & Services > Credentials > the Android OAuth client for `app.botracing.android`: add the keystore's SHA-1 (also on the `credentials` screen). Without it, Google sign-in on the installed APK answers DEVELOPER_ERROR (`src/auth/googleClient.ts`).

Settings shows an **Android app** card (`src/features/settings/androidCard.ts`). In the installed app it appears only when `/api/android/latest` has a higher `versionCode` than the installed one (`expo-application`'s `nativeBuildVersion`), with an Update button. In a browser on an Android phone it offers the APK, like the Windows card. Anywhere else there is no card. Both open `/api/android/download` in the browser, so the first install asks to allow installs from the browser; the card says so in one line.

In the installed app the card's first line is the running build: `App <version> · update <first 8 of expo-updates' updateId>`, or `built-in` when the app runs its own bundle (`Updates.isEmbeddedLaunch`; `runningLine` in `androidCard.ts`), and the line is only on the installed app, never a phone browser. It shows even when no update does.

## Over-the-air updates (EAS Update)

`expo-updates` checks the `production` channel. `app.json`'s ON_LOAD check with no fallback only downloads, so `src/setup/ota.ts` also fetches on launch and on every return to the foreground. It reloads only where nothing is being read (`src/setup/otaPolicy.ts`; `reloadAsync` restarts at the first screen): at launch before the first screen (the splash is held up to 3 s for the check), or on a return after 30 min or more in the background. Any other fetched update waits as pending and applies at the next such moment, or the next launch. Off in development and on web. Settings > Android app shows what the phone runs in one line: `App 1.0.2 (8) · runtime cdf505f5 · production · update d83c26a3 · 12 Oct 14:05` (version, versionCode, runtime version, channel, update id and publish date from expo-updates; `built-in` for the build's own bundle). Read a phone's state there instead of assuming it matches an EAS build; the update id matches an `eas update:list` group.

`.github/workflows/ota-update.yml` runs `tsc` and `jest` on the pushed commit (the Tests workflow runs on pull requests only), then `eas update --channel production --platform android`, on a push to main unless the push touches only docs, `*.md`, `desktop/`, `functions/`, `ops/`, `scripts/`, `tools/` (except `tools/track-info/`, which `catalog.ts` imports), `.claude/`, `.github/` (except this workflow) or the Firebase files. It is a deny-list, so `tsconfig.json`, `eas.json`, package files and any new top-level code run it.

- **By update:** screens, logic, styles, JS-only dependencies, images and other assets.
- **Needs an APK (new `android-v*` tag):** a native module or SDK change, `app.json` plugins, permissions, icon or splash, package name. These change the fingerprint; an update published for the new fingerprint reaches phones only after they install that APK.
- **Roll back:** `npx eas-cli@24.8.0 update:republish --group <group id of the last good update> --platform android --message rollback` (`--channel` and `--group` are mutually exclusive; the group goes back onto its own branch, `production`). `npx eas-cli@24.8.0 update:list --branch production` shows the groups. Phones take it on their next launch.
- **Same runtime version as the APK:** the build and the update both compute it with `@expo/fingerprint` over the same commit after `npm ci` (tracked files, `node_modules`, `app.json`, `eas.json`; no local-only files). `fingerprint.config.js` skips package.json scripts, `.gitignore` and version strings, so editing those does not strand phones. Check locally: `npx expo-updates fingerprint:generate --platform android`; the hash must equal the `Runtime version` in the OTA job summary (which also lists the update group id and message).
- **APK updates are unchanged:** the Settings Android card still offers a new APK by `versionCode`.

One-time setup: none. `android-build` allows branch `main` for OTA, same `EXPO_TOKEN` (done 2026-10-10). Updates start with the 1.0.2 APK: older installs have no updater.
