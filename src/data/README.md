# src/data

Everything that talks to the lap API (`docs/API.md`), one folder per resource: `client.ts` (fetch), `keys.ts` (React Query keys), `queries.ts` (hooks), `adapters.ts` (raw doc → typed shape, seconds as numbers).

- Screens get server data only through these hooks.
- Imports: `analysis`.
