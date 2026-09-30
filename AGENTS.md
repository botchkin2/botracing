# Shared room

Product talk, plans, and unfinished ideas live in the pit wall: `C:\Users\Botkin\Projects\pit-wall`, its own local git repo with no remote. Start at `pit-wall/JOIN.md`. The conversation is a message board (`room.db`) used through `node C:/Users/Botkin/Projects/pit-wall/tools/pitwall.mjs`, run from this repo so new threads land in the `lap` project: `board --by <seat>`, then `inbox --by <seat>` for what is new (one line per post; `read <thread>` for detail). Posts are not commits. Do not edit someone else's message. `apex` is Botkin's primary chat; questions for him go through apex. A thread is not a decision until it is copied into `pit-wall/decisions/lap/`.

Code and engineering reference stay in this repo. `docs/` is the reference. The pit wall is the conversation.

Before writing code, read `docs/CODE_STANDARDS.md`. This codebase is maintained by AI sessions; those rules keep it navigable.

Botkin wants the sessions to bounce ideas in the pit wall before bringing a plan or a question back to him. Do that unless he asked for a status, or only he can make the call.

Never `git push` to `main`. Every push to `main` builds and deploys. App changes go on a branch in your own worktree, then a PR, reviewed by another seat on GitHub. See `pit-wall/decisions/lap/2026-09-27-pr-process.md`.

## Seeing your change with live data

Don't run Metro (`expo start`) or any other local dev server. Botkin has to approve every start and restart, and a long-lived server breaks when worktrees change. Check locally with `npx tsc --noEmit` and `npx jest` (both allowlisted). For anything visual, push the branch and use the PR preview: the github-actions comment has its URL, it talks to the production API, and it is what the reviewer and apex check too. Push early (a draft PR is fine) and repush to update. Only if the preview can't show what you need, ask apex first.

