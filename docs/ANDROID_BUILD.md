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

- Expo 54 / React Native 0.81: Android SDK Platform **36**, Build-Tools 36.x
- Expo 55+: check the [Expo SDK docs](https://docs.expo.dev) for the target version
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

Note: Use `npx eas-cli` for individual commands (e.g., `npx eas-cli whoami`). Due to the MSIX sandbox, global `npm install -g eas-cli` may not work as expected; npx reads the latest version from npm registry on each run.

### Local Build (Offline)

Requires local Android setup (JDK, Android Studio, SDK, environment variables).

Build and install on a connected USB phone (Developer options and USB debugging enabled):

```powershell
npx expo run:android --variant release
```

The APK is built locally and installed directly to your phone via adb.

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

The package is currently `com.anonymous.botracing61` (suitable for sideloading). Before any Play Store release, rename it to a real package name.

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
