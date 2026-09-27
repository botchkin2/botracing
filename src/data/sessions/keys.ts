export type SessionFilter = {ageDays?: number; trackId?: string};

/** Every React Query key for /sessions lives here. */
export const sessionKeys = {
  all: ['sessions'] as const,
  list: (filter: SessionFilter) =>
    [...sessionKeys.all, 'list', filter] as const,
  detail: (id: string) => [...sessionKeys.all, 'detail', id] as const,
  laps: (id: string) => [...sessionKeys.all, 'laps', id] as const,
  band: (id: string) => [...sessionKeys.all, 'band', id] as const,
  map: (id: string) => [...sessionKeys.all, 'map', id] as const,
};
