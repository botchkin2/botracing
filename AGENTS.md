# Shared room

Product talk, plans, and unfinished ideas live in the pit wall: `C:\Users\Botkin\Projects\pit-wall`, its own git repo (private remote botchkin2/pit-wall). Sessions here read and edit it, and read Botkin's feedback notes in `C:\Users\Botkin\Projects\Obsidian\Race analytics feedback`, without prompts (`additionalDirectories` in `.claude/settings.json`). Start at `pit-wall/JOIN.md`. The conversation is a message board (`room.db`) used through `node C:/Users/Botkin/Projects/pit-wall/tools/pitwall.mjs`, run from this repo so new threads land in the `lap` project: `board --by <seat>`, then `inbox --by <seat>` for what is new (one line per post; `read <thread>` for detail). Posts are not commits. Do not edit someone else's message. `apex` is Botkin's primary chat; questions for him go through apex. A thread is not a decision until it is copied into `pit-wall/decisions/lap/`.

Code and engineering reference stay in this repo. `docs/` is the reference. The pit wall is the conversation.

Before writing code, read `docs/CODE_STANDARDS.md`. This codebase is maintained by AI sessions; those rules keep it navigable.

Botkin wants the sessions to bounce ideas in the pit wall before bringing a plan or a question back to him. Do that unless he asked for a status, or only he can make the call.

Never `git push` to `main`. Every push to `main` builds and deploys. App changes go on a branch in your own worktree, then a PR, reviewed by another seat on GitHub. See `pit-wall/decisions/lap/2026-09-27-pr-process.md`.

## Seeing your change with live data

Check logic with `npx tsc --noEmit`, `npx jest` and `node --test` first; they take seconds.

For anything visual, run your own live dev server. `.claude/launch.json` has six slots, `live-1` to `live-6` (ports 19101 to 19106). Each one runs Metro with hot reload against the production API.
- Claim a free slot in your board Now note, and point it at your worktree: with the Write tool, set one key in `<main checkout>/.claude/live-slots.local.json` (gitignored), e.g. `{"1": "C:/Users/Botkin/Projects/garage61-session-analysis/.claude/worktrees/<seat>-<task>"}`. Keep the other slots' keys. An unclaimed slot serves the main checkout.
- Start it with `preview_start {name: "live-N"}`. `preview_start` always reads the main checkout's `launch.json`; `tools/dev/live.mjs N` there starts Metro with cwd = the folder your slot is claimed for, and the log's first line says which folder it serves.
- Worktrees need nothing installed: the launcher and Metro use the main checkout's `node_modules`. Never link it. Exception: a branch whose `package-lock.json` differs from the main checkout's runs `npm ci` in its own worktree (the launcher refuses it otherwise, and says so). `functions/` is the same: `npm ci --prefix functions` only in a worktree that needs it. The launcher installs nothing.
- The main checkout belongs to apex alone. Nobody else pulls, switches or installs there; to read a file on main, use `git show origin/main:<path>`. After a merge that changes a lockfile, apex runs `git pull --ff-only`, `npm ci` and `npm ci --prefix functions` there, with no live slot serving the main checkout. The launcher refuses any slot whose packages don't match their lockfile (`node_modules/.package-lock.json`), so an out-of-date main checkout can't serve silently.
- Stop it with `preview_stop` when you finish or hand off, and delete your key.
- A live run in a worktree writes `.expo/types/router.d.ts`, which can make `npx tsc --noEmit` fail on `Href` there; delete that folder (`.expo/types`) and rerun.
- Never start a server any other way: no `expo start` in a shell, no static server on a port. Never kill processes by hand (`Stop-Process`, `taskkill`). Those are what produced Botkin's approval prompts.

The app needs a sign-in. Seats test only as `seat-test`, never with Botkin's account: sign a pane in with a link from `functions/scripts/mintTestToken.mjs` (`docs/TESTING.md`).

## Push when you are confident (`pit-wall/decisions/lap/2026-10-24-push-when-confident.md`)

Work in progress stays local: no draft PRs, no pushing to see what CI says. Before the first push:
1. The design is agreed on the board.
2. `npm run check` is green (`tools/ci/check.mjs`: every command of CI's app and functions jobs, plus the capture and desktop jobs when those paths changed, the tray/API parity gate when that line changed). It prints one PASS/FAIL table.
3. The phone-width proof is taken from your own live slot (above), not from the PR preview.
4. The PR body passes `npm run check -- --body <file>` (the `## Proof where he uses it` section, a sha of this branch).

Then one push, and open the PR ready, with the check table and the proof in the body. The reviewer does not read a draft or a red PR. The PR preview (its URL is in the github-actions comment) is what the reviewer and apex check before a merge. A red CI run is a miss you report on the board.

`.claude/settings.json` allowlists the everyday commands: git on your own branch, `gh pr create`/`comment`, tests, lint, the board, and the preview tools. Pushing to `main`, force pushes, and `gh pr merge` are denied: apex merges. If something you need still prompts, tell apex rather than working around it.

