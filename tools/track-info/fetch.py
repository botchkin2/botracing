# /// script
# requires-python = ">=3.12"
# dependencies = ["duckdb==1.5.5"]
# ///
"""Facts for the track pages, one entry per trackId, into tracks.json (checked in).

    uv run tools/track-info/fetch.py

Sources, each kept with its attribution:
- Wikipedia REST summary: the lead paragraph, a thumbnail, the page link (CC BY-SA 4.0).
- Wikidata: opened, country, place, official length, website, image (CC0).
- OSM raceway way names from tools/track-fit's cache: named corners and sections,
  with a point on each, for matching to the corner map (ODbL).
- The recordings: the game's own lap length per layout, the number the app should show.
"""
import glob, json, os, re, time, urllib.error, urllib.parse, urllib.request

import duckdb

HERE = os.path.dirname(os.path.abspath(__file__))
FIT = os.path.join(HERE, "..", "track-fit")
TEL = os.environ.get("LMU_TELEMETRY", r"C:\Program Files (x86)\Steam\steamapps\common\Le Mans Ultimate\UserData\Telemetry")
UA = {"User-Agent": "garage61-session-analysis-track-info/0.1 (https://github.com/botchkin2/garage61-session-analysis)", "Api-User-Agent": "garage61-session-analysis-track-info/0.1"}

# Recording location -> English Wikipedia title.
WIKIPEDIA = {
    "Algarve International Circuit": "Algarve International Circuit",
    "Autodromo Enzo e Dino Ferrari": "Imola Circuit",
    "Autodromo Nazionale Monza": "Monza Circuit",
    "Aut\u00f3dromo Jos\u00e9 Carlos Pace": "Interlagos Circuit",
    "Bahrain International Circuit": "Bahrain International Circuit",
    "Circuit de Barcelona": "Circuit de Barcelona-Catalunya",
    "Circuit de Spa-Francorchamps": "Circuit de Spa-Francorchamps",
    "Circuit de la Sarthe": "Circuit de la Sarthe",
    "Circuit of the Americas": "Circuit of the Americas",
    "Daytona International Speedway": "Daytona International Speedway",
    "Fuji Speedway": "Fuji Speedway",
    "Lusail International Circuit": "Lusail International Circuit",
    "Michelin Raceway Road Atlanta": "Michelin Raceway Road Atlanta",
    "Sebring International Raceway": "Sebring International Raceway",
    "Silverstone Circuit": "Silverstone Circuit",
    "WeatherTech Raceway Laguna Seca": "WeatherTech Raceway Laguna Seca",
}

# Facts Wikidata lacks, filled by hand and marked as such in the output.
MANUAL = {
    "Bahrain International Circuit": {"openedYear": 2004},
    "Michelin Raceway Road Atlanta": {"openedYear": 1970},
    "Sebring International Raceway": {"openedYear": 1950},
}

# The circuit's official turn labels for corners the app numbers differently,
# by trackId, then by the app's corner number. Shown in place of "T{n}"; a
# corner not listed keeps its own number. Checked by hand against the
# official map, not fetched.
TURN_LABELS = {
    # The official map runs T1-T12 with T10a/T10b. Our 1-6 are T1-T6. Our 7
    # and 8 are two rights 170 m apart, both parts of the slow T7 onto the back
    # straight (8 is the slowest point). T8, T9 and T11 are kinks the corner
    # map does not detect. Our 9, 10 and 11 are the T10a/T10b chicane and T12.
    # A label goes in only where the app corner clearly is that official turn.
    "lmu-michelin_raceway_road_atlanta": {
        "7": "T7 entry",
        "8": "T7",
        "9": "T10a",
        "10": "T10b",
        "11": "T12",
    },
}


def slug(name):  # same as tools/sessions/lmu.mjs slug()
    s = re.sub(r"([a-z])([A-Z])", r"\1_\2", name).lower()
    return re.sub(r"^_|_$", "", re.sub(r"[^a-z0-9]+", "_", s))


def get(url):
    # Wikimedia rate-limits bursts: space requests out and back off on 429.
    for wait in (1, 5, 15, 45):
        time.sleep(wait)
        try:
            return json.load(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60))
        except urllib.error.HTTPError as e:
            if e.code != 429:
                raise
    raise SystemExit(f"rate-limited: {url}")


def claim(entity, prop):
    """First value of a Wikidata claim, or None."""
    for c in entity.get("claims", {}).get(prop, []):
        v = c["mainsnak"].get("datavalue", {}).get("value")
        if v is not None:
            return v
    return None


def wikidata(qid):
    e = get(f"https://www.wikidata.org/wiki/Special:EntityData/{qid}.json")["entities"][qid]
    opened = claim(e, "P1619") or claim(e, "P571")  # date of official opening, else inception
    length = claim(e, "P2043")
    units = {"Q11573": 1.0, "Q828224": 1000.0, "Q253276": 1609.344}  # metre, kilometre, mile
    lengthM = None
    if length and length.get("unit", "").rsplit("/", 1)[-1] in units:
        lengthM = round(float(length["amount"]) * units[length["unit"].rsplit("/", 1)[-1]])
    image = claim(e, "P18")
    return dict(
        qid=qid,
        openedYear=int(opened["time"][1:5]) if opened else None,
        countryQid=(claim(e, "P17") or {}).get("id"),
        placeQid=(claim(e, "P131") or {}).get("id"),
        officialLengthM=lengthM,
        website=claim(e, "P856"),
        image=f"https://commons.wikimedia.org/wiki/Special:FilePath/{urllib.parse.quote(image)}" if image else None,
    )


def labels(qids):
    qids = sorted({q for q in qids if q})
    out = {}
    for i in range(0, len(qids), 40):
        r = get("https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=labels&languages=en&ids=" + "|".join(qids[i:i + 40]))
        out.update({q: v.get("labels", {}).get("en", {}).get("value") for q, v in r["entities"].items()})
    return out


def osm_names(location):
    """Named raceway ways: corners and sections, with the way's middle point."""
    path = os.path.join(FIT, "out", "osm", slug(location) + ".json")
    if not os.path.exists(path):
        return []
    seen = {}
    for w in json.load(open(path, encoding="utf-8")):
        name = w["tags"].get("name")
        if w["tags"].get("highway") != "raceway" or not name or "pit" in name.lower() or not w["geometry"]:
            continue
        mid = w["geometry"][len(w["geometry"]) // 2]
        seen.setdefault(name, dict(name=name, lat=round(mid["lat"], 6), lon=round(mid["lon"], 6)))
    return sorted(seen.values(), key=lambda x: x["name"])


def lap_lengths(location):
    """Game lap length per layout: the longest Lap Dist across the location's recordings."""
    out = {}
    for f in glob.glob(os.path.join(TEL, glob.escape(location) + "_*.duckdb")):
        try:
            c = duckdb.connect(f, read_only=True)
            layout = dict(c.execute("select key, value from metadata").fetchall()).get("TrackLayout") or location
            m = c.execute('select max(value) from "Lap Dist"').fetchone()[0]
            c.close()
        except Exception:
            continue
        if m and m > out.get(layout, 0):
            out[layout] = m
    return {k: round(v) for k, v in out.items()}


def main():
    entries = {}
    for location, title in WIKIPEDIA.items():
        s = get("https://en.wikipedia.org/api/rest_v1/page/summary/" + urllib.parse.quote(title.replace(" ", "_")))
        wd = wikidata(s["wikibase_item"])
        manual = {k: v for k, v in MANUAL.get(location, {}).items() if wd.get(k) is None}
        wd.update(manual)
        wd["manualFields"] = sorted(manual)
        lengths = lap_lengths(location)
        names = osm_names(location)
        for layout, lengthM in lengths.items():
            track_id = f"lmu-{slug(layout)}"
            entries[track_id] = dict(
                layout=layout,
                location=location,
                lengthM=lengthM,
                **({"turnLabels": TURN_LABELS[track_id]} if track_id in TURN_LABELS else {}),
                **{k: v for k, v in wd.items()},
                summary=dict(
                    title=s["title"],
                    extract=s.get("extract"),
                    url=s["content_urls"]["desktop"]["page"],
                    thumbnail=(s.get("thumbnail") or {}).get("source"),
                    attribution="Wikipedia, CC BY-SA 4.0",
                ),
                osmNames=names,
            )
        print(f"{location}: {len(lengths)} layouts, {len(names)} OSM names, opened {wd['openedYear']}", flush=True)
    names = labels([e["countryQid"] for e in entries.values()] + [e["placeQid"] for e in entries.values()])
    for e in entries.values():
        e["country"] = names.get(e.pop("countryQid"))
        e["place"] = names.get(e.pop("placeQid"))
    json.dump(dict(sorted(entries.items())), open(os.path.join(HERE, "tracks.json"), "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    print(f"{len(entries)} track layouts -> tools/track-info/tracks.json")


if __name__ == "__main__":
    main()
