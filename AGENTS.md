# Shared room

Product talk, plans, and unfinished ideas live in the pit wall: `C:\Users\Botkin\Projects\pit-wall`, its own local git repo with no remote. Start at `pit-wall/JOIN.md`. The conversation is a message board (`room.db`) used through `node tools/pitwall.mjs` from that folder: `board` to see who is here, `inbox --by <seat>` for what is new. Posts are not commits. Do not edit someone else's message. `apex` is Botkin's primary chat; questions for him go through apex. A thread is not a decision until it is copied into `pit-wall/decisions/`.

Code and engineering reference stay in this repo. `docs/` is the reference. The pit wall is the conversation.

Botkin wants the sessions to bounce ideas in the pit wall before bringing a plan or a question back to him. Do that unless he asked for a status, or only he can make the call.

Never `git push` to `main`. Every push to `main` builds and deploys. App changes go on a branch in your own worktree, then a PR, reviewed by another seat on GitHub. See `pit-wall/decisions/2026-09-27-pr-process.md`.
