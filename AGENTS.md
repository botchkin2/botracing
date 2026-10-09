# Shared room

Product talk, plans, and unfinished ideas live in the pit wall: `C:\Users\Botkin\Projects\pit-wall`, its own local git repo with no remote. Start at `pit-wall/JOIN.md`. The conversation is a message board (`room.db`) used through `node C:/Users/Botkin/Projects/pit-wall/tools/pitwall.mjs`, run from this repo so new threads land in the `lap` project: `board --by <seat>`, then `inbox --by <seat>` for what is new (one line per post; `read <thread>` for detail). Posts are not commits. Do not edit someone else's message. `apex` is Botkin's primary chat; questions for him go through apex. A thread is not a decision until it is copied into `pit-wall/decisions/lap/`.

Code and engineering reference stay in this repo. `docs/` is the reference. The pit wall is the conversation.

Before writing code, read `docs/CODE_STANDARDS.md`. This codebase is maintained by AI sessions; those rules keep it navigable.

Botkin wants the sessions to bounce ideas in the pit wall before bringing a plan or a question back to him. Do that unless he asked for a status, or only he can make the call.

Never `git push` to `main`. Every push to `main` builds and deploys. App changes go on a branch in your own worktree, then a PR, reviewed by another seat on GitHub. See `pit-wall/decisions/lap/2026-09-27-pr-process.md`.

## Seeing your change with live data

Check logic with `npx tsc --noEmit`, `npx jest` and `node --test` first; they take seconds.

For anything visual, run your own live dev server. `.claude/launch.json` has six slots, `live-1` to `live-6` (ports 19101 to 19106). Each one runs Metro with hot reload against the production API.
- Claim a free slot in your board Now note, and point it at your worktree: with the Write tool, set one key in `<main checkout>/.claude/live-slots.local.json` (gitignored), e.g. `{"1": "C:/Users/Botkin/Projects/garage61-session-analysis/.claude/worktrees/<seat>-<task>"}`. Keep the other slots' keys. An unclaimed slot serves the main checkout.
- Start it with `preview_start {name: "live-N"}`. `preview_start` always reads the main checkout's `launch.json`; `tools/dev/live.mjs N` there starts Metro with cwd = the folder your slot is claimed for, and the log's first line says which folder it serves.
- Your worktree needs `node_modules` (run `npm ci` there, or link the main checkout's); the launcher says so and installs nothing.
- Stop it with `preview_stop` when you finish or hand off, and delete your key.
- A live run in a worktree writes `.expo/types/router.d.ts`, which can make `npx tsc --noEmit` fail on `Href` there; delete that folder (`.expo/types`) and rerun.
- Never start a server any other way: no `expo start` in a shell, no static server on a port. Never kill processes by hand (`Stop-Process`, `taskkill`). Those are what produced Botkin's approval prompts.

The app needs a sign-in. Seats test only as `seat-test`, never with Botkin's account: sign a pane in with a link from `functions/scripts/mintTestToken.mjs` (`docs/TESTING.md`).

The PR preview (its URL is in the github-actions comment) is still what the reviewer and apex check before a merge. Push early (a draft PR is fine).

`.claude/settings.json` allowlists the everyday commands: git on your own branch, `gh pr create`/`comment`, tests, lint, the board, and the preview tools. Pushing to `main`, force pushes, and `gh pr merge` are denied: apex merges. If something you need still prompts, tell apex rather than working around it.

