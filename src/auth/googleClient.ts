// The OAuth client ids the Android sign-in needs. Public by design (they name
// the app to Google; they are not secrets), but they come from the Google Cloud
// console of project botracing-61, so they are set here once someone has made
// them, not guessed.
//
// WEB (set, apex #242): the project's "Web client" (APIs & Services > Credentials; Firebase
// creates one named "Web client (auto created by Google Service)" when Google
// sign-in is turned on), of the form
//   702873435846-xxxxxxxxxxxxxxxx.apps.googleusercontent.com
// The Google sign-in library asks for an ID token for THIS client, which is
// what Firebase Auth accepts.
//
// The Android client (package app.botracing.android plus the SHA-1 of the
// key the APK is signed with, `eas credentials -p android`) is created in the
// same console; it has no id to put here, but without it Google answers
// DEVELOPER_ERROR and sign-in cannot work.
export const GOOGLE_WEB_CLIENT_ID =
  '702873435846-tjos2tvit21oah6urp0frli01uedpgu4.apps.googleusercontent.com';
