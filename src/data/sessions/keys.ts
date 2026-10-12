export type SessionFilter = {
  ageDays?: number;
  trackId?: string;
  /** One game's whole history, as `trackId` does for a track. */
  sim?: string;
};

/** Every React Query key for /sessions lives here. */
export const sessionKeys = {
  all: ['sessions'] as const,
  list: (filter: SessionFilter) =>
    [...sessionKeys.all, 'list', filter] as const,
  facets: [...['sessions'], 'facets'] as const,
  detail: (id: string) => [...sessionKeys.all, 'detail', id] as const,
  laps: (id: string) => [...sessionKeys.all, 'laps', id] as const,
  band: (id: string) => [...sessionKeys.all, 'band', id] as const,
  // A track layout's map and measured surface, by track id: shared by every
  // session at that layout, so one cached copy serves them all (thread 1 #3479).
  trackMap: (trackId: string) => ['tracks', trackId, 'map'] as const,
  trackSurface: (trackId: string) => ['tracks', trackId, 'surface'] as const,
  /** One track and car's plan blocks (GET /plan). */
  plan: (sim: string, trackId: string, carModel: string) =>
    [...sessionKeys.all, 'plan', sim, trackId, carModel] as const,
};
