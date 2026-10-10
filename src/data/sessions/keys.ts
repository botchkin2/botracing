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
  map: (id: string) => [...sessionKeys.all, 'map', id] as const,
  surface: (id: string) => [...sessionKeys.all, 'surface', id] as const,
  /** One track and car's plan blocks (GET /plan). */
  plan: (sim: string, trackId: string, carModel: string) =>
    [...sessionKeys.all, 'plan', sim, trackId, carModel] as const,
};
