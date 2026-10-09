# src/features/trayLink

The tray's sign-in page, `/tray-sign-in?port&state&challenge`. The tray (Windows) has no Google client of its own: it opens this page in the browser, the person signs in here as on the rest of the site, confirms, and the page sends the browser to the tray's loopback address with a one-time code. The tray trades the code for a Firebase session (`functions/src/trayCodeCore.ts` has the rules; `desktop/src-tauri/src/auth.rs` is the tray side).

- `model.ts`: pure. `parseTrayLink` takes only an integer port 1024-65535 and a state and challenge of the right shape; `callbackUrl` builds `http://127.0.0.1:<port>/callback?code&state` itself. The page never takes a host or a URL from the address.
- `TrayLinkScreen.tsx`: the page. Shows the account and asks; a click is required (no auto-redirect), so a hostile page cannot silently connect a tray to another account. "Use another account" signs out; the app's gate then shows the login screen and the page returns here.
- The code is sent in the redirect; the custom token never is. The page URL holds only the port, state and challenge, none secret, and `Referrer-Policy: no-referrer` is set for it in `firebase.json`.
- Imports: `auth`, `data/tray`, `design`, `ui`.
