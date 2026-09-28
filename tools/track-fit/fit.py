# /// script
# requires-python = ">=3.12"
# dependencies = ["duckdb==1.5.5", "numpy", "scipy", "matplotlib"]
# ///
"""Pin LMU laps onto real OpenStreetMap track outlines.

LMU's "GPS" is game-world metres projected around a dummy origin at (60N, 0E).
Game units are true metres, so a rigid fit (rotation + translation, scale 1)
onto the OSM `highway=raceway` ways places a lap on the real map.

One fit per location (all layouts at a location share game coordinates).
Writes georef.json (reviewed, checked in) and out/{trackId}.geojson (outline,
uploaded by seed.mjs), plus out/{trackId}.png to eyeball each fit.

    uv run tools/track-fit/fit.py              # every location with recordings
    uv run tools/track-fit/fit.py Sebring Spa  # only names containing these
"""
import glob, json, math, os, re, sys, time, urllib.parse, urllib.request

import duckdb
import numpy as np
from scipy.spatial import cKDTree

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
CACHE = os.path.join(OUT, "osm")
TEL = os.environ.get("LMU_TELEMETRY", r"C:\Program Files (x86)\Steam\steamapps\common\Le Mans Ultimate\UserData\Telemetry")
UA = {"User-Agent": "garage61-session-analysis track-fit (github.com/botchkin2)"}
FAKE_ORIGIN = (60.0, 0.0)

# Recording name prefix -> circuit centre (lat, lon) and half-size of the OSM box in metres.
LOCATIONS = {
    "Algarve International Circuit": (37.2270, -8.6267, 2000),
    "Autodromo Enzo e Dino Ferrari": (44.3439, 11.7167, 2000),
    "Autodromo Nazionale Monza": (45.6156, 9.2811, 2500),
    "Aut\u00f3dromo Jos\u00e9 Carlos Pace": (-23.7036, -46.6997, 1800),
    "Bahrain International Circuit": (26.0325, 50.5106, 2500),
    "Circuit de Barcelona": (41.5700, 2.2611, 2000),
    "Circuit de Spa-Francorchamps": (50.4372, 5.9714, 3500),
    "Circuit de la Sarthe": (47.9300, 0.2100, 7500),
    "Circuit of the Americas": (30.1328, -97.6411, 2000),
    "Daytona International Speedway": (29.1852, -81.0705, 2500),
    "Fuji Speedway": (35.3717, 138.9275, 2000),
    "Lusail International Circuit": (25.4900, 51.4542, 2000),
    "Michelin Raceway Road Atlanta": (34.148, -83.815, 2000),
    "Sebring International Raceway": (27.4545, -81.3483, 2500),
    "Silverstone Circuit": (52.0733, -1.0147, 2500),
    "WeatherTech Raceway Laguna Seca": (36.5842, -121.7535, 1500),
}
# Circuits that run on public roads. OSM tags those stretches as ordinary
# highways (Le Mans: D338 Mulsanne, D140, D139), so they are fitted against
# main roads too, and the outline keeps only the roads the lap drives on.
PUBLIC_ROADS = {"Circuit de la Sarthe"}
ROAD_CLASSES = {"raceway", "trunk", "primary", "secondary", "tertiary"}
NOTES: dict[str, str] = {}  # known gaps, kept with the rating
OVERPASS = ["https://overpass.kumi.systems/api/interpreter", "https://overpass-api.de/api/interpreter"]


def slug(name):  # same as tools/sessions/lmu.mjs slug()
    s = re.sub(r"([a-z])([A-Z])", r"\1_\2", name).lower()
    return re.sub(r"^_|_$", "", re.sub(r"[^a-z0-9]+", "_", s))


def enu(lat, lon, lat0, lon0):
    return np.c_[(lon - lon0) * 111320 * math.cos(math.radians(lat0)), (lat - lat0) * 110540]


def osm_ways(key, lat, lon, half, roads=False):
    """OSM ways to fit against, from Overpass (the read-only service meant for this; the
    main OSM API is for editing and must not be used for bulk download). Cached in out/osm."""
    path = os.path.join(CACHE, key + ".json")
    if os.path.exists(path):
        return json.load(open(path, encoding="utf-8"))
    dl, dn = half / 110540, half / (111320 * math.cos(math.radians(lat)))
    classes = "|".join(sorted(ROAD_CLASSES)) if roads else "raceway"
    q = f'[out:json][timeout:180];way["highway"~"^({classes})$"]({lat-dl},{lon-dn},{lat+dl},{lon+dn});out tags geom;'
    ways = None
    for u in OVERPASS * 3:
        try:
            req = urllib.request.Request(u, urllib.parse.urlencode({"data": q}).encode(), UA)
            ways = json.load(urllib.request.urlopen(req, timeout=240))["elements"]
            break
        except Exception as e:
            print(f"  overpass {u}: {e}"); time.sleep(10)
    if ways is None:
        raise SystemExit(f"no OSM data for {key}")
    os.makedirs(CACHE, exist_ok=True)
    json.dump(ways, open(path, "w", encoding="utf-8"))
    return ways


def fit(P, dst):
    """Rigid ICP from many starting angles, both handednesses. Returns (median, mirror, R, t, dists)."""
    tree = cKDTree(dst)
    best = None
    for mirror in (1, -1):
        Q = P * [mirror, 1]
        for th in np.radians(np.arange(0, 360, 10)):
            R0 = np.array([[math.cos(th), -math.sin(th)], [math.sin(th), math.cos(th)]])
            A = (Q - Q.mean(0)) @ R0.T + dst.mean(0)
            for _ in range(60):
                _, i = tree.query(A)
                Y = dst[i]
                ma, my = A.mean(0), Y.mean(0)
                U, _, Vt = np.linalg.svd((A - ma).T @ (Y - my))
                R = Vt.T @ U.T
                if np.linalg.det(R) < 0:
                    Vt[1] *= -1; R = Vt.T @ U.T
                A = (A - ma) @ R.T + my
            d, _ = tree.query(A)
            if best is None or np.median(d) < best[0]:
                best = (np.median(d), mirror, A, d)
    m, mirror, A, d = best
    Q = P * [mirror, 1]  # recover the single transform Q -> A
    mq, ma = Q.mean(0), A.mean(0)
    U, _, Vt = np.linalg.svd((Q - mq).T @ (A - ma))
    R = Vt.T @ U.T
    return m, mirror, R, ma - mq @ R.T, A, d


def driven_stretches(ways, lap, lat, lon, near_m=25):
    """Raceway ways whole; road ways cut to the runs of nodes within near_m of the fitted lap,
    so a public-road circuit's outline is the circuit, not the town."""
    tree = cKDTree(lap)
    out = []
    for w in ways:
        if w["tags"].get("highway") == "raceway":
            out.append(w); continue
        q = enu(np.array([p["lat"] for p in w["geometry"]]), np.array([p["lon"] for p in w["geometry"]]), lat, lon)
        near = tree.query(q)[0] <= near_m
        run = []
        for p, ok in zip(w["geometry"], near):
            if ok:
                run.append(p)
            elif len(run) >= 2:
                out.append({**w, "geometry": run}); run = []
            else:
                run = []
        if len(run) >= 2:
            out.append({**w, "geometry": run})
    return out


def rate(median, p90):
    if median <= 5 and p90 <= 10: return "good"
    if median <= 10 and p90 <= 25: return "fair"
    return "poor"


def main():
    os.makedirs(OUT, exist_ok=True)
    gpath = os.path.join(HERE, "georef.json")
    georef = json.load(open(gpath, encoding="utf-8")) if os.path.exists(gpath) else {}
    pick = sys.argv[1:]
    for name, (lat, lon, half) in LOCATIONS.items():
        if pick and not any(p.lower() in name.lower() for p in pick):
            continue
        files = glob.glob(os.path.join(TEL, glob.escape(name) + "_*.duckdb"))
        if not files:
            continue
        layouts, biggest = set(), max(files, key=os.path.getsize)
        for f in files:
            try:
                c = duckdb.connect(f, read_only=True)
                meta = dict(c.execute("select key, value from metadata").fetchall())
                layouts.add(meta.get("TrackLayout") or meta.get("TrackName") or name)
                c.close()
            except Exception:
                pass
        c = duckdb.connect(biggest, read_only=True)
        la = np.array([r[0] for r in c.execute('select value from "GPS Latitude"').fetchall()])
        lo = np.array([r[0] for r in c.execute('select value from "GPS Longitude"').fetchall()])
        c.close()
        ok = la != 0
        src = enu(la[ok], lo[ok], *FAKE_ORIGIN)[::5]

        key = slug(name)
        ways = osm_ways(key, lat, lon, half, roads=name in PUBLIC_ROADS)
        dst = []
        for w in ways:
            q = enu(np.array([p["lat"] for p in w["geometry"]]), np.array([p["lon"] for p in w["geometry"]]), lat, lon)
            for a, b in zip(q[:-1], q[1:]):  # densify to ~2 m
                n = max(1, int(np.linalg.norm(b - a) / 2))
                dst += [a + (b - a) * t for t in np.linspace(0, 1, n, endpoint=False)]
        m, mirror, R, t, A, d = fit(src, np.array(dst))
        p90 = float(np.percentile(d, 90))
        quality = rate(m, p90)
        entry = dict(
            georef=dict(
                fakeOrigin=dict(lat=FAKE_ORIGIN[0], lon=FAKE_ORIGIN[1]),
                rotationDeg=round(math.degrees(math.atan2(R[1, 0], R[0, 0])), 4),
                mirror=int(mirror),
                originLat=round(lat + t[1] / 110540, 7),
                originLon=round(lon + t[0] / (111320 * math.cos(math.radians(lat))), 7),
                fitMedianM=round(float(m), 2),
                fitP90M=round(p90, 2),
                source="osm-raceway",
                fittedOn=os.path.basename(biggest),
                fittedAt=time.strftime("%Y-%m-%d"),
            ),
            quality=quality,
            qualityNote=NOTES.get(name, {"good": "Best effort OSM fit.", "fair": "Usable; check visually.", "poor": "Do not draw on a real basemap."}[quality]),
            location=name,
            outline=f"trackmaps/{{trackId}}/v1.geojson.gz",
        )
        if name in PUBLIC_ROADS:
            ways = driven_stretches(ways, A, lat, lon)
        feats = [dict(type="Feature", properties=dict(osmId=w["id"], name=w["tags"].get("name"), kind="pit" if "pit" in (w["tags"].get("name") or "").lower() else "track"),
                      geometry=dict(type="LineString", coordinates=[[p["lon"], p["lat"]] for p in w["geometry"]])) for w in ways]
        for layout in sorted(layouts):
            tid = f"lmu-{slug(layout)}"
            georef[tid] = {**entry, "outline": f"trackmaps/{tid}/v1.geojson.gz"}
            json.dump(dict(type="FeatureCollection", attribution="© OpenStreetMap contributors, ODbL 1.0", features=feats),
                      open(os.path.join(OUT, tid + ".geojson"), "w", encoding="utf-8"))
        print(f"{quality:5} median {m:5.1f} m  p90 {p90:6.1f} m  {name}  ({', '.join(sorted(layouts))})", flush=True)
        try:
            import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
            fig, ax = plt.subplots(figsize=(7, 7))
            for w in ways:
                q = enu(np.array([p["lat"] for p in w["geometry"]]), np.array([p["lon"] for p in w["geometry"]]), lat, lon)
                ax.plot(q[:, 0], q[:, 1], color="#bbb", lw=4)
            sc = ax.scatter(A[:, 0], A[:, 1], c=np.minimum(d, 20), cmap="plasma", s=2, zorder=3)
            pad = 200
            ax.set_xlim(A[:, 0].min() - pad, A[:, 0].max() + pad); ax.set_ylim(A[:, 1].min() - pad, A[:, 1].max() + pad)
            plt.colorbar(sc, label="m from OSM"); ax.set_aspect("equal")
            ax.set_title(f"{name}: {quality}, median {m:.1f} m, p90 {p90:.1f} m")
            fig.savefig(os.path.join(OUT, key + ".png"), dpi=90, bbox_inches="tight"); plt.close(fig)
        except Exception as e:
            print(f"  plot skipped: {e}")
        json.dump(dict(sorted(georef.items())), open(gpath, "w", encoding="utf-8"), indent=1, ensure_ascii=False)


if __name__ == "__main__":
    main()
