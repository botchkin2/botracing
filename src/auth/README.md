# src/auth

Who is signed in, and the sign-in itself. The API takes its owner from a Firebase ID token (`docs/API.md`, "Who is asking"); this folder gets that token and keeps the screens in step with it.

- `authState.ts`, `signInResult.ts`: pure (the state, labels, what the app shows for it, "did the person change", which errors mean "use the redirect" or "Google does not know this build"). Tested without the SDKs.
- `authStore.ts`: the current state and whether the API has refused a request (a 401). `applyAuthState` drops the React Query cache whenever the person changes, so one person's sessions are never shown to the next.
- `followFirebase.ts`: the part both builds share: keeps the store, the token provider (`data/tokenSource`) and the gate that holds API requests until Firebase has answered once in step with a Firebase Auth instance.
- Web: `authSession.web.ts` (also finishes a redirect sign-in), `signIn.web.ts` (Google popup, and a full-page redirect when the popup is blocked, common on phones), `firebase.web.ts` (the public web config).
- Android: `authSession.ts`, `signIn.ts` (the Google account picker, `@react-native-google-signin/google-signin`, the free MIT version, which uses Google's legacy sign-in on Android; its ID token goes to Firebase Auth with `signInWithCredential`, so it is the same user the web build and the tray sign in as), `firebase.ts` (the same config, with the sign-in kept in AsyncStorage, or it would be forgotten whenever the app closes), `googleClient.ts` (the web client id). Sign-in needs that id, and the app's package and signing key registered as an Android OAuth client in Google Cloud: without them Google answers DEVELOPER_ERROR and the screen says so.
- Both: only called from effects and handlers, because the web export renders in Node.
- `AuthGate.tsx` and `LoginScreen.tsx`: while the stored sign-in is read, a blank screen; signed out, the login screen REPLACES the app (nothing mounted or fetched); signed in, the app, with a sign-in prompt over it when the API answers 401. The app underneath stays mounted so the router keeps its navigator.
- `useSignIn.ts`: the handlers and the line to show, for the login screen, the prompt and the Settings Account row.

- `src/data` never imports this folder: `data/http.ts` asks `data/tokenSource.ts` for the header and reports a 401 there, and `followFirebase` fills it in.
- Imports: `data`, `design`, `ui`, `analysis`, `utils/queryClient`.
