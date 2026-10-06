# src/auth

Who is signed in, and the sign-in itself. The API takes its owner from a Firebase ID token (`docs/API.md`, "Who is asking"); this folder gets that token and keeps the screens in step with it.

- `authState.ts`, `signInResult.ts`: pure (the state, labels, "did the person change", which Firebase errors mean "use the redirect"). Tested without the SDK.
- `authStore.ts`: the current state and whether the API has refused a request (a 401). `applyAuthState` drops the React Query cache whenever the person changes, so one person's sessions are never shown to the next.
- `authSession.web.ts`: follows Firebase (`onAuthStateChanged`) and hands `data/tokenSource` a function that returns the current, refreshed token. `authSession.ts` is the Android build: signed out, no sign-in yet. `signIn.web.ts` is Google popup, with a full-page redirect when the popup is blocked (common on phones); `signIn.ts` says the Android build has none yet.
- `firebase.ts`: the public web config. Only called from effects and handlers, because the web export renders in Node.
- `AuthGate.tsx`: a cover over the app while the stored sign-in is being read, and a sign-in prompt over it when the API answers 401. The app underneath stays mounted so the router keeps its navigator.
- `useSignIn.ts`: the handlers and the line to show, for the gate and the Settings Account row.

- `src/data` never imports this folder: `data/http.ts` asks `data/tokenSource.ts` for the header and reports a 401 there, and `authSession` fills it in.
- Imports: `data`, `design`, `ui`, `analysis`, `utils/queryClient`.
