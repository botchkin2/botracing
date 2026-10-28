// tools/track-fit/georef.json: the iRacing entries are identity georefs from the .ibt's own origin. A wrong
// one is not a bad fit, it is a map drawn in another place or squashed (mapPlace.ts reads fakeOrigin), so the
// file's shape is held here. It sits under tools/curate/ so CI's one node --test glob runs it.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

const fits = JSON.parse(
  readFileSync(new URL('../track-fit/georef.json', import.meta.url), 'utf8'),
);
const iracing = Object.entries(fits).filter(([id]) =>
  id.startsWith('iracing-'),
);

test('the iRacing entries are the identity georef at a real origin', () => {
  assert.ok(iracing.length >= 41, `${iracing.length} iRacing entries`);
  for (const [id, fit] of iracing) {
    const g = fit.georef;
    assert.match(id, /^iracing-\d+-[a-z0-9_]+$/, id);
    assert.equal(g.source, 'iracing-gps', id);
    assert.equal(g.rotationDeg, 0, id);
    assert.equal(g.mirror, 1, id);
    assert.deepEqual(g.fakeOrigin, {lat: g.originLat, lon: g.originLon}, id);
    assert.ok(Math.abs(g.originLat) <= 90 && Math.abs(g.originLon) <= 180, id);
    // (0, 0) or LMU's fake 60°N / 0°E is a missed read, not a track
    assert.ok(
      !(g.originLat === 0 && g.originLon === 0) &&
        !(g.originLat === 60 && g.originLon === 0),
      `${id} origin ${g.originLat}, ${g.originLon}`,
    );
    assert.equal(fit.quality, 'good', id);
    assert.ok(fit.location, id);
  }
});

test('one iRacing track id has one entry, and layouts of a venue sit within 1.5 km of each other', () => {
  const venue = new Map();
  for (const [id, fit] of iracing) {
    const key = fit.location;
    const g = fit.georef;
    const first = venue.get(key);
    if (!first) venue.set(key, g);
    else {
      const dLat = (g.originLat - first.originLat) * 110540;
      const dLon =
        (g.originLon - first.originLon) *
        111320 *
        Math.cos((g.originLat * Math.PI) / 180);
      assert.ok(Math.hypot(dLat, dLon) < 1500, `${id}: ${key} layouts drift`);
    }
  }
});
