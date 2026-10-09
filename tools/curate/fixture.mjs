// An in-memory catalog for the curator tests. `commit` has the semantics apply.mjs
// documents: one atomic step that checks catalogRev, creates the history
// document (it must not exist), patches the track document and sets or
// deletes the boundaries document.
export function memoryCatalog({
  tracks = {},
  boundaries = {},
  history = {},
  lengths = {},
  counts = {},
} = {}) {
  const state = {
    tracks: new Map(Object.entries(structuredClone(tracks))),
    boundaries: new Map(Object.entries(structuredClone(boundaries))),
    history: new Map(Object.entries(structuredClone(history))),
  };
  const catalog = {
    state,
    commits: 0,
    regenerated: 0,
    async readCatalog(trackId) {
      const track = state.tracks.get(trackId) ?? null;
      return {
        track: track && structuredClone(track),
        boundaries: state.boundaries.has(trackId)
          ? structuredClone(state.boundaries.get(trackId))
          : null,
        catalogRev: track?.catalogRev ?? 0,
      };
    },
    async readHistory(trackId) {
      const out = new Map();
      for (const doc of state.history.values())
        if (doc.trackId === trackId) out.set(doc.rev, structuredClone(doc));
      return out;
    },
    async sessionLengths(trackId) {
      return lengths[trackId] ?? [];
    },
    async sessionCount(trackId) {
      return counts[trackId] ?? 0;
    },
    async commit({
      trackId,
      expectedRev,
      newRev,
      history: entry,
      set,
      deleteFields,
      boundaries: b,
    }) {
      const current = state.tracks.get(trackId)?.catalogRev ?? 0;
      if (current !== expectedRev) {
        throw Object.assign(new Error('stale plan'), {
          code: 'STALE_PLAN',
          currentRev: current,
        });
      }
      const key = `${trackId}__${entry.rev}`;
      if (state.history.has(key))
        throw new Error(`history ${key} already exists`);
      // Nothing is written before every check has passed.
      state.history.set(key, structuredClone(entry));
      const doc = {...(state.tracks.get(trackId) ?? {})};
      for (const k of deleteFields) delete doc[k];
      Object.assign(doc, structuredClone(set));
      state.tracks.set(trackId, doc);
      if (b.action === 'set')
        state.boundaries.set(trackId, structuredClone(b.doc));
      else if (b.action === 'delete') state.boundaries.delete(trackId);
      catalog.commits++;
      void newRev;
    },
    async regenerateCatalogFile() {
      catalog.regenerated++;
    },
  };
  return catalog;
}
