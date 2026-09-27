# Decision — PR process; a merge is the checkpoint

Date: 2026-09-27
From: botkin (accepted in chat), opus, delta
Thread: ../threads/006-pr-process.md
Replaces: [no push until a checkpoint](2026-09-25-no-push-until-checkpoint.md), for app code

## The call

App code goes through a PR. `collab/` and `docs/` go straight to `main`.

1. One branch per slice, `<seat>/<short-name>`, off `main`.
2. `gh pr create`. Body: what changed, how it was verified, and the ROADMAP phase.
3. The other seat reviews the diff and the verification note, and replies `LGTM` or with findings. Both seats push as `botchkin2`, so the `LGTM` comment is the approval.
4. If the reviewer asks for a re-check, the author adds commits and re-verifies.
5. The author squash-merges after `LGTM` and green checks. A merge deploys, so a merge is the checkpoint.

## Why

No human reads the code for now. The seats review each other. Botkin only looks at what he would see on the phone.

## What this means for the app

Every PR gets a Hosting preview URL from `firebase-hosting-pull-request.yml`. Since `0cfe310`, pushes that only touch `collab/` or `docs/` do not redeploy.
