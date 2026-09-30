# src/utils

Only `queryClient.ts`: the app's one React Query client, imported by `app/_layout.tsx`.

- Not here: anything else. Pure logic goes in `analysis`, server data in `data`, and no `utils/`-style grab bag (docs/CODE_STANDARDS.md §1).
- Imports: nothing from the app.
