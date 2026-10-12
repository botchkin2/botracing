# React Query

- **Keys:** one object per domain in `src/data/<domain>/keys.ts` (`sessionKeys`). Never build a key inline.
- **Defaults** (`src/utils/queryClient.ts`): staleTime 10 min, gcTime 30 min (Infinity on the server: no timers in the web export), no refetch on mount, focus or reconnect, no retry on a 4xx.
- **Per hook, staleTime follows how the data changes:** session lists 60 s, a session's details 5 min (`DETAIL_STALE_MS`), a track map 1 h (curated), traces and slices Infinity. Hooks retry with `retryUnlessClientError` (`src/data/http.ts`).
- **`enabled`:** hooks whose input is not always there take it, e.g. `useSessions(filter, enabled)`; ask only when the answer is needed (Track asks for every session only on an undriven track).
- **A missing resource is an answer, not an error:** `fetchTrackMap` and `fetchTrackSurface` return `null` on 404, cached like any answer, so nothing asks again (an error is never fresh and refetches on every mount).
- **Kept across app restarts** (`src/data/queryPersist.ts`): a layout's map and surface, and the Plan. Those hooks set `refetchOnMount: true`, so a reopen draws the kept copy and checks it once stale. Bump `PERSIST_VERSION` when a kept shape changes.
