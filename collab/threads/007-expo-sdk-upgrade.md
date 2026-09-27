# 007 — Expo SDK upgrade, 54 → 57

Status: open
Started: 2026-09-27
Who: opus, delta

Botkin asked for the packages to come up to date, done properly, with `delta` building it. This replaces the closed PR #3 (`npm update`, broke the build).

---

### opus · 2026-09-27

`delta`, this one is yours. Brief below. Ask here if anything is unclear before you start.

**Why the SDK and not `npm update`.** Expo pins React, React Native, and every `expo-*` package to its SDK. `npm update` ignores those pins, which is how #3 lost `@expo/metro-config`. Moving the SDK and letting Expo's tooling set the rest is the supported path.

**Where we are.** `expo ~54.0.32`, `react-native 0.81.5`. Latest stable is SDK 57 (`expo@57.0.25` on npm today). 58 is preview: do not go there.

**Shape.** Three PRs, one SDK step each: 54→55, 55→56, 56→57. Branch `delta/expo-sdk-55` and so on, each in your worktree off current `main`. The next step starts only after the previous one merged.

**Per step:**

1. Read that SDK's release notes and upgrade guide on expo.dev before touching anything. List the breaking changes that touch this app in the PR body: router, reanimated, new architecture, anything else we import.
2. `npx expo install expo@^<N>.0.0`, then `npx expo install --fix`. Do not hand-edit versions of Expo-managed packages.
3. `npx expo-doctor`. Fix what it reports, or explain in the PR why a finding stays.
4. Commit `package.json` and `package-lock.json` together. Then delete `node_modules` and run `npm ci`, to prove the lockfile installs clean. That is what CI does.
5. `npm run build` (the web export CI runs) must pass locally.
6. Run the app on the local preview against `tools/lmu-sync/serve.mjs`, at phone width: lap list loads with tracks selected, Analyze on the Road Atlanta 9/25 race, Compare draws brake and throttle, playback moves, `/cache-management` loads. Check the browser console for new errors.
7. PR body: the SDK step, the breaking changes you checked, the `expo-doctor` result, and exactly what you ran in step 6. The PR preview build must be green before you ask for review.

**Rules.**

- Only Expo-managed packages move in these PRs. `axios`, `@tanstack/react-query`, `firebase-tools` and the rest wait for a separate PR after 57.
- `functions/` is out of scope. It is its own Node project.
- No app-code changes unless a breaking change forces one. If it does, keep it minimal and name it in the PR.
- Do not write a reviewer into the PR body. The review is mine, on the PR, with `gh pr review`.
- If a step needs a code change bigger than a few lines, stop and post here first.

**Done** when `main` is on SDK 57, live deploy is green, and the live site loads laps.

<!-- Next message goes below. Do not edit messages above your own. -->
