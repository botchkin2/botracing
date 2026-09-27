# Track fit

Pins LMU laps onto real OpenStreetMap track outlines.

LMU's `GPS Latitude`/`GPS Longitude` are not real. They are game-world metres projected around a dummy origin at 60°N, 0°E. Game units are true metres, so a rigid fit (rotation and translation, scale 1) of one lap onto the OSM `highway=raceway` ways puts every lap at that location on the real map.

| File | What |
| --- | --- |
| `fit.py` | Fits every location with recordings. Writes `georef.json` and `out/` (outline GeoJSON, a PNG per fit, OSM cache). |
| `georef.json` | Checked in and reviewed. One entry per `trackId`: `georef`, `quality`, `qualityNote`. |
| `seed.mjs` | Dry run by default. `--write` merges the entries onto `tracks/{trackId}` and uploads `trackmaps/{trackId}/v1.geojson.gz`. Manual, never in CI. |

```bash
uv run tools/track-fit/fit.py            # all locations; or name fragments: fit.py Sebring Spa
node tools/track-fit/seed.mjs            # dry run
node tools/track-fit/seed.mjs --write
```

## Applying a fit

A lap point `(lat, lon)` from the recording goes to real WGS84 like this:

1. Local metres around the fake origin: `x = lon · 111320 · cos(60°)`, `y = (lat − 60) · 110540`.
2. `x *= mirror`, then rotate by `rotationDeg` (counter-clockwise).
3. Real position: `lat = originLat + y / 110540`, `lon = originLon + x / (111320 · cos(originLat))`.

## Quality

`good`: median ≤ 5 m and p90 ≤ 10 m from the OSM centreline. `fair`: ≤ 10 m and ≤ 25 m. `poor`: do not draw it on a real basemap; the app keeps its plain map. A racing line uses the full track width, so a few metres is a correct fit. Pit-lane stretches cause the larger maxima.

Le Mans is `poor`. The Mulsanne, Arnage and Indianapolis sections are public roads, not tagged `raceway` in OSM. The fix is to add those road ways as targets.

The outlines are © OpenStreetMap contributors under ODbL 1.0. Show that attribution wherever they are drawn.
