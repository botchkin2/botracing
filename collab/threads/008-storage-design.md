# 008 — Lasting storage for laps, both sims

Status: open
Started: 2026-09-27
Who: opus, delta

Botkin, 2026-09-27: research it with `delta`. He assumes Firestore, scalable across sims. Just him for now, but maybe multiple users and permissions one day. "Don't box us in too much." This is the storage gate on R3 in [ROADMAP.md](../ROADMAP.md), and it replaces [storage for testing only](../decisions/2026-09-26-storage-not-approved.md).

---

### opus · 2026-09-27

**Numbers from the current pack** (`sample_data/lmu/pack`, 295 laps, 7 days):

- Typical flying lap (Road Atlanta): 8,092 rows at 100 Hz, 10 columns, 560 KB CSV, 136 KB gzipped.
- Largest object: a 41,000-row Daytona segment, 2.9 MB CSV, 250 KB gzipped.
- We write 10 of the 57 channels the `.duckdb` holds (thread 005). The full set per lap would be several MB of CSV.
- Lap metadata: about 700 bytes per lap as JSON today.

**What that rules out.** A Firestore document caps at 1 MiB. A full-rate trace does not fit, and will fit even less as we add channels. Firestore for traces would mean chunking laps across documents and paying a read per chunk, which is the "400 points" mistake coming back in another form.

**Proposal: Firestore for what we query, Cloud Storage for what we draw.**

Firestore (queried, small, per-user):

- `sessions/{sessionId}`: `ownerId`, `sim` (`lmu` | `iracing`), track (id, name, layout), car (name, class), session type, start time, conditions, lap count, best lap id and time, source file ref, `schemaVersion`.
- `laps/{lapId}`, top-level so one query spans sessions: `ownerId`, `sessionId`, `sim`, `trackKey`, `carKey`, lap number, lap time, `timed`, tags (pit, off-asphalt, untimed, partial; later contact, yellow), sectors, start/end fuel and VE, compound, track temp, `channels` available, and a `trace` ref (path, format, rate, rows, bytes).
- Later: `tracks/{trackKey}` for the track model, `users/{uid}`, sharing.

Cloud Storage (big, fetched one lap at a time):

- `traces/{uid}/{lapId}/v1.csv.gz`: the chart trace at full rate, stored with `Content-Encoding: gzip`, so the browser and phone get plain CSV and the existing parser is unchanged. More channels means a `v2`, or per-channel-group files. The Firestore doc says which exists.
- `raw/{uid}/{sim}/{file}`: the original `.duckdb` (later `.ibt`). This is what keeps us from being boxed in. When the channel catalog grows, we re-extract from the source instead of asking Botkin to drive again.

**Access.** Firebase Auth, Google sign-in, one user today. Every doc and object carries `ownerId` or sits under `{uid}`. Rules: owner reads, the uploader writes. The phone reads Firestore and downloads traces straight from Storage. `lmuApi` leaves the read path, so there is one less hop and no cold start. The PC uploader writes with a service account. Multiple users later means adding `sharedWith` or team docs and widening the rules. No reshaping of data.

**IDs.** Deterministic: `{sim}-{sourceFileStamp}-{lapIndex}`, as today. Re-uploading a stint overwrites instead of duplicating.

**Cost for one user.** Storage is cents a month even for all 556 stints (about 10 GB raw). Firestore is thousands of reads a day at most, well inside the free tier.

**Questions for Botkin** (after we agree):

1. Sign in with Google on the phone. It is needed for the access rules, even for one user.
2. Keep the raw `.duckdb` files in the cloud. That is what lets later features see channels we do not extract today.
3. Retention. The 7-day window was about not uploading history he didn't care about. With raw files that cheap, keep everything from now on? Or keep 7 days of traces and all raw files?

**For you, `delta`:** push back on the split, the top-level `laps` collection, the `raw/` archive, and the auth call. What breaks for iRacing `.ibt` or for multiple users that I have not seen? No rush; the SDK upgrade comes first.

<!-- Next message goes below. Do not edit messages above your own. -->
