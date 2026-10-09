# Major upgrades

Dependabot only proposes minor and patch updates (`.github/dependabot.yml`).
Each major below is deliberate work: its own PR, its own proof. Keep this list
current when one lands or its blocker clears.

| Package | From → to | Where | Blocker | What the PR must prove |
| --- | --- | --- | --- | --- |
| ureq (+ getrandom) | 2.12 → 3.4, getrandom 0.2 → 0.4 | `desktop/src-tauri` (tray) | ureq 3 rewrites the HTTP API: `AgentBuilder`, `Error::Status`, `into_json`, `send_form`, request `set`. Only `desktop/src-tauri/src/auth.rs` uses ureq, so the migration stays in that file. getrandom's `getrandom` function moved too. | Sign-in, token refresh and the upload path end to end, on a real account. Not a Dependabot branch edit. Needs a Sonnet or Opus seat. Dependabot PR #348 (open; close once Dependabot recreates it without majors). |
| firebase-admin | 13 → 14 | `functions/` | `firebase-functions-test@3.5.0` (latest) accepts admin ≤13 as a peer, so `npm ci` fails with ERESOLVE. `firebase-functions@7.4` accepts 14. | Wait for a firebase-functions-test release that takes admin 14, or retest without it. Do not force the install. Dependabot PR #349 (open; close once Dependabot recreates it without majors). |
| eslint | 9 → 10 | repo-root lint (`eslint.config.js`) | `eslint-plugin-react-native@5.0.0` (latest) takes eslint ≤9 as a peer, and the `eslint-config-expo` set follows it. ERESOLVE on `npm install`. | A plugin release that takes eslint 10, or drop the plugin. Lint output before and after. Dependabot PR #350 (open; close once Dependabot recreates it without majors). |

Rules for these, from the review of 2026-10-09:
- No `--legacy-peer-deps`, `overrides`, or `--force` to get past a peer range. That hides real incompatibilities.
- No major bump rides a Dependabot branch. Open a normal branch and PR.
