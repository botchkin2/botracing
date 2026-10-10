// Shared by the APK build (EAS) and `eas update` in CI: both compute the
// runtimeVersion with @expo/fingerprint from this repo's checkout plus
// `npm ci`, so they agree. Skipped: inputs that do not change the native
// build, so editing a script or a version string does not strand phones.
const {SourceSkips} = require('@expo/fingerprint');

/** @type {import('@expo/fingerprint').Config} */
module.exports = {
  sourceSkips:
    SourceSkips.PackageJsonScriptsAll |
    SourceSkips.GitIgnore |
    SourceSkips.ExpoConfigVersions,
};
