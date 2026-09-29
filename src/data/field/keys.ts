/** Every React Query key for /sessions/{id}/field lives here. */
export const fieldKeys = {
  // The hash is content-addressed, so a key never holds stale data.
  detail: (sessionId: string, hash: string) =>
    ['sessions', 'field', sessionId, hash] as const,
};
