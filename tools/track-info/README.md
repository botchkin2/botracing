# Track info

Facts for the track pages, one entry per `trackId` (`lmu-{slug(TrackLayout)}`), in `tracks.json`. The file is checked in so the facts get reviewed.

```bash
uv run tools/track-info/fetch.py
```

| Field | Source | Licence |
| --- | --- | --- |
| `lengthM` | The game's own lap length: the longest `Lap Dist` in the recordings for that layout. Show this one. | ours |
| `officialLengthM`, `openedYear`, `country`, `place`, `website`, `image`, `qid` | Wikidata | CC0 |
| `summary {title, extract, url, thumbnail}` | Wikipedia lead paragraph | CC BY-SA 4.0. The page must **display** `attribution` next to the text and link `url`. Storing it is not enough. |
| `osmNames [{name, lat, lon}]` | Named OSM `raceway` ways (from `tools/track-fit/out/osm/`, so run fit.py first) | ODbL |
| `manualFields` | Facts Wikidata lacks, filled by hand in `MANUAL` | ours |
| `turnLabels {n: label}` | The circuit's official label for a corner the app numbers differently (`"10": "T10a"`), by the app's corner number. Filled by hand in `TURN_LABELS` in `fetch.py`, checked against the official map and the corner positions. The app shows it in place of `T{n}`; corners not listed keep their number. | ours |

`osmNames` mixes corner names ("Eau Rouge") with section and layout names ("Club Course"). To name a corner, match a name to the corner map by position: apply the track's georef to the corner's apex, and take the nearest name within about 60 m. Leave everything else unnamed.

`officialLengthM` is the real-world length, and it can describe another configuration (Daytona's is the oval). The page shows `lengthM`.
