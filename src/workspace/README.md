# src/workspace

The connected navigation for the session workspace: `useWorkspaceGo` (where a tab goes, carrying the lap selection), `planCombo` (which track and car the Plan is about: the combos he has driven, the default, their labels; the Plan, the Track page and the bar all read it) and `usePlanCombo` (the track and car the Plan link opens and the pair the bar names), `chromeBox` (the bar's session box as finished values), `DesktopChrome` (the ≥900 bar) and `SessionNav` (the phone's Laps / Compare / Corner / Race row under a session screen's title). The pure pieces are in `nav`; the bars they feed are in `ui`.

- Imports: `nav`, `data`, `design`, `ui`, `analysis`. Not `features` or `state` (an ESLint zone enforces it).
- Importable from `features` and `app`.
