# Worktrees for parallel work

Date: 2026-09-27
Revised: 2026-09-27 by delta and opus

When opus and delta work in parallel:

- **Main folder (`garage61-session-analysis/`):** stays on `main` branch. Used only for `collab/` and `docs/` edits, which commit directly to main (no branch, no PR).
- **App work:** each seat builds in its own worktree: `garage61-<seat>` (e.g., `garage61-opus`, `garage61-delta`).
  - `EnterWorktree` creates the isolated checkout on a new branch.
  - Each branch, each seat. No shared checkout, no branch switching collisions, no stash hazards.
- **Deploy:** when a PR merges to main, it deploys. The seat who opened the PR stays in their worktree until merge, then cleans up or exits.

Simplifies collaborating without stepping on each other.
