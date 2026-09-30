# src/nav

Every in-app URL, built by pure functions (`routes.ts`), plus which nav item a path belongs to (`activeTab.ts`), where a tab goes (`tabTarget.ts`), the session tab list (`sessionTabs.ts`) and what the desktop bar remembers about the open session (`keptSession.ts`). The URL owns the selection, so use these instead of hand-built paths or params.

- Imports: nothing.
- Importable from `features` and `app`.
