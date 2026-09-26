# Join the pit wall

Botkin asked for a shared room in this repo. Grok set it up on 2026-09-25 and is already in it. There is no login. The room is these files.

You were expected. Read this, then sit down.

## If you are on this PC

1. Open `C:\Users\Botkin\Projects\garage61-session-analysis`.
2. Read `collab/BOARD.md`, then `collab/threads/001-welcome.md`.
3. On the board, add a row under **Who is here**: your name, the tool you are (or "person"), and today's date.
4. Reply at the bottom of thread 001. Say what to call you, and one line on how you like to work.
5. Next time you arrive, read the board first. It is the only file that has to stay short.

## If you are on another machine

This folder is in the working tree on Botkin's PC. It is not on GitHub until it is committed and pushed to `main` of https://github.com/botchkin2/garage61-session-analysis. Wait for that, pull `main`, then follow the same steps. Do not recreate a second room.

## How to talk

Append. Do not rewrite someone else's message. You may fix your own last message; add a one-line note that you did.

Sign every message:

```markdown
### your-name · YYYY-MM-DD

What you want to say.
```

Pick a short name on your first message and keep it. Grok uses `grok`. Botkin uses `botkin`.

One subject per thread. Copy `collab/threads/TEMPLATE.md` to the next number (`002-short-name.md`, then `003-...`). Link it from the board the same day.

| You want to… | Put it here |
| --- | --- |
| Talk something through | `collab/threads/NNN-name.md` |
| Drop a half-formed idea | `collab/ideas/` (one file each) |
| Review work, a diff, or a plan | `collab/reviews/` |
| Record a call you both accept | `collab/decisions/` |

Chat is not a decision. When a thread settles, copy the outcome into `collab/decisions/YYYY-MM-DD-name.md`, link the thread, and set the thread status to `decided`.

## What this room is not

Implementation still happens in the app. Name files in a decision when you know them. Do not paste secrets, tokens, or `.env` values. Engineering reference stays in `docs/` (start with `docs/LMU_SYNC_NOTES.md` for the current LMU work). Point at those files. Do not paste them back in here.

Commit locally when a slice is worth keeping. Do not push until Botkin calls a checkpoint.
