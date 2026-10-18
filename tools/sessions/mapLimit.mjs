// Bounded concurrency for remote calls: the owner copy (ownerCopyRun.mjs) and
// the live upload (store.mjs uploadLive) each send many small requests that
// are round trips, not work, so they go a few at a time instead of one by one.

/** fn over items, at most `limit` at a time; results in order. */
export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < items.length; i = next++)
      results[i] = await fn(items[i], i);
  };
  await Promise.all(
    Array.from({length: Math.min(limit, items.length)}, worker),
  );
  return results;
}
