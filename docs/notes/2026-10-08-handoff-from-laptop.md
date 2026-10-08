# Handoff from the temporary laptop (2026-10-08)

For the gaming PC. Nothing here is built yet; it's the work to pick up.

## 1. Track data should not list sessions

Track files (layout boundaries, surface) keep a list of the session ids already folded into them. That list exists because tracks used to be built automatically from many sessions. Tracks are now curated by Botkin only, so sessions never fold into tracks automatically anymore.

Proposal: drop the session lists from track data entirely. A track version keeps only its version, the curation reason and the diff (the curate command's history already holds these). Nothing in shared track data refers to any user's session ids.

Why now: moving Botkin's data from `botkin` to his uid changed every session id, so 308 sessions are still listed in track files by their old ids. Removing the lists makes that moot.

## 2. Gaming PC: replace the old uploader with the tray app

- Remove the old Admin logon-task uploader (it writes as `botkin` with Botkin's gcloud credentials, and would recreate old-style data).
- Build and install the tray app from main: `desktop\scripts\build.ps1 -Release -FirebaseApiKey <web key in src/auth/firebase.web.ts>`. It needs the Google OAuth desktop client JSON at `~\.botracing\oauth-desktop.json`; download it again from the Google Cloud console (APIs & Services, Credentials, "BotRacing tray").
- Sign in from the tray, check the menu says the owner is Botkin's uid, then un-pause.

## 3. State of Botkin's data

- Copied from `botkin` to his uid and verified (all 377 sessions, files byte-equal). His account now points at the copy; the app's view matched the before snapshot.
- The originals under `botkin` are still there. Delete them only after a few days of normal use and after step 2 is done.

## 4. Permissions

Functions run as `lap-runtime`; Editor is off the default accounts; deploys verified. Left: trim the GitHub deploy account (ops/iam/README.md, step 6).
