// The check that matters to the user (marshal #144 point 4, #147, apex #146):
// what the app's API shows. Read through the API with an ID token, never with
// Admin. A snapshot taken before the switch, and again after, must say the
// same thing about the sessions apart from their ids; and a copied track's
// surface must be readable through the API.
//
// fetch is injected so this runs against a stand-in server in the tests.
import {gunzipSync} from 'node:zlib';

// What a session list entry says apart from who it is: ids and anything
// derived from them are dropped, so a copy compares equal to its original.
const IDS = /^(id|sessionId|recordingId|recordingIds|bestLapId|ownerId)$/;
export function withoutIds(value) {
  if (Array.isArray(value)) return value.map(withoutIds);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([k]) => !IDS.test(k))
        .map(([k, v]) => [k, withoutIds(v)]),
    );
  return value;
}

async function getJson(fetch, api, path, token) {
  const res = await fetch(`${api}${path}`, {
    headers: token ? {authorization: `Bearer ${token}`} : {},
  });
  if (!res.ok) throw new Error(`GET ${path}: ${res.status}`);
  return res.json();
}

/**
 * The sessions as the API lists them (id plus the content without ids), sorted
 * so two snapshots compare. token: an ID token, or null for the anonymous read.
 */
export async function snapshotSessions(fetch, {api, token = null}) {
  const body = await getJson(fetch, api, '/sessions', token);
  const items = (body.items ?? []).map(item => ({
    id: item.id,
    content: withoutIds(item),
  }));
  items.sort((a, b) =>
    JSON.stringify(a.content).localeCompare(JSON.stringify(b.content)),
  );
  return {total: body.total ?? items.length, items};
}

/** The differences between a baseline and a later snapshot, as sentences. */
export function compareSnapshots(before, after) {
  const diffs = [];
  if (before.total !== after.total)
    diffs.push(`${before.total} sessions before, ${after.total} after`);
  const a = before.items.map(i => JSON.stringify(i.content));
  const b = after.items.map(i => JSON.stringify(i.content));
  for (const [i, text] of a.entries()) {
    if (b[i] !== text) {
      diffs.push(
        `session ${i + 1} (${
          before.items[i].id
        }) is not the same after, apart from ids`,
      );
      if (diffs.length > 10) break;
    }
  }
  return diffs;
}

/**
 * For each copied session (newIds: its new id), a first lap's telemetry and the
 * surface of its track are read through the API. A track with no surface file
 * may answer 404 in both worlds, so those are listed, not failed, unless
 * `requireSurface` names the sessions that must have one.
 */
export async function checkRead(
  fetch,
  {api, token, newIds, requireSurface = []},
) {
  const diffs = [];
  const notes = [];
  for (const id of newIds) {
    try {
      const laps = await getJson(fetch, api, `/sessions/${id}/laps`, token);
      const first = (laps.items ?? laps)[0];
      if (first) {
        const csv = await fetch(
          `${api}/laps/${encodeURIComponent(first.id)}/csv`,
          {
            headers: {authorization: `Bearer ${token}`},
          },
        );
        if (!csv.ok)
          diffs.push(`lap ${first.id}: telemetry answered ${csv.status}`);
      }
    } catch (e) {
      diffs.push(`session ${id}: ${e.message}`);
    }
    const res = await fetch(`${api}/sessions/${id}/surface`, {
      headers: {authorization: `Bearer ${token}`},
    });
    if (res.ok) {
      try {
        JSON.parse(gunzipSync(Buffer.from(await res.arrayBuffer())).toString());
      } catch {
        // The runtime may already have decompressed it.
      }
    } else if (requireSurface.includes(id)) {
      diffs.push(`session ${id}: its track's surface answered ${res.status}`);
    } else {
      notes.push(`session ${id}: surface answered ${res.status}`);
    }
  }
  return {diffs, notes};
}
