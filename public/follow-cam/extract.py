"""Build data.js for the follow-cam prototype from one LMU recording + a DEM.

usage: uv run --with numpy extract.py <recording.duckdb> <trackId> <dem> <out.js>
Reads channels through the DuckDB CLI, builds the measured road (centre + edges
per 5 m, same method as src/analysis/trackSurface.ts), fetches real-world
elevation along the centre from opentopodata, and writes laps to replay.
"""
import json, math, subprocess, sys, tempfile, time, urllib.request
from pathlib import Path
import numpy as np

rec, track_id, dem, out = sys.argv[1:5]
DK = r"C:\Users\Botkin\AppData\Local\Temp\duckdb-cli\duckdb.exe"
here = Path(__file__).resolve().parent
georef = json.load(open(here / "../../tools/track-fit/georef.json"))[track_id]["georef"]
tmp = Path(tempfile.mkdtemp())

def col(name):
    f = (tmp / (name.replace(" ", "_") + ".csv")).as_posix()
    subprocess.run([DK, "-readonly", rec, "-csv", "-c",
        f"copy (select value from \"{name}\" order by rowid) to '{f}' (header false)"], check=True)
    return np.loadtxt(f, delimiter=",")

def events(name):
    f = (tmp / ("ev_" + name.replace(" ", "_") + ".csv")).as_posix()
    subprocess.run([DK, "-readonly", rec, "-csv", "-c",
        f"copy (select ts, value from \"{name}\" order by ts) to '{f}' (header false)"], check=True)
    a = np.loadtxt(f, delimiter=",", ndmin=2)
    return a[:, 0], a[:, 1]

HZ = 10
ch = {n: col(n) for n in ["GPS Latitude", "GPS Longitude", "Lap Dist", "Path Lateral", "Track Edge",
                           "G Force Lat", "G Force Long"]}
fast = {n: col(n) for n in ["Ground Speed", "Throttle Pos", "Brake Pos", "Steering Pos", "Engine RPM"]}
rate = {"Ground Speed": 100, "Throttle Pos": 50, "Brake Pos": 50, "Steering Pos": 100, "Engine RPM": 100}
lap_ts, lap_no = events("Lap")
gear_ts, gear_v = events("Gear")
pit_ts, pit_v = events("In Pits")
lt_ts, lt_v = events("Lap Time")

n10 = len(ch["GPS Latitude"])
x = (ch["GPS Longitude"]) * 111319.49 * math.cos(math.radians(60))
y = (ch["GPS Latitude"] - 60) * 111194.9  # same flat projection as src/analysis/geo.ts
t10 = np.arange(n10) / HZ

def at(arr, hz, t):
    i = np.clip(np.round(t * hz).astype(int), 0, len(arr) - 1)
    return arr[i]

def step(ts, v, t):
    i = np.clip(np.searchsorted(ts, t, side="right") - 1, 0, len(v) - 1)
    return v[i]

# laps: a lap spans [lap_ts[k], lap_ts[k+1]); keep complete, non-pit laps
laps = []
for k in range(len(lap_ts) - 1):
    a, b = lap_ts[k], lap_ts[k + 1]
    sel = (t10 >= a) & (t10 < b)
    if sel.sum() < 600: continue
    inpit = step(pit_ts, pit_v, np.array([a + 1, (a + b) / 2, b - 1]))
    if inpit.any(): continue
    ltm = lt_v[(lt_ts >= b - 1) & (lt_ts <= b + 3)]
    laps.append(dict(no=int(lap_no[k]), a=a, b=b, sel=sel, time=float(ltm[0]) if len(ltm) else b - a))
print("clean laps", [(l["no"], round(l["time"], 2)) for l in laps])

# --- measured road from every clean lap -------------------------------------------------
LEN = float(np.max(ch["Lap Dist"]))
BIN = 5.0
nb = int(LEN // BIN)
cs = [[] for _ in range(nb)]; le = [[] for _ in range(nb)]; ri = [[] for _ in range(nb)]
for L in laps:
    s = np.where(L["sel"])[0]
    px, py, pl, te, ld = x[s], y[s], ch["Path Lateral"][s], ch["Track Edge"][s], ch["Lap Dist"][s]
    hd = np.unwrap(np.arctan2(np.gradient(py), np.gradient(px)))
    rnx, rny = np.sin(hd), -np.cos(hd)       # right of travel
    cx, cy = px - pl * rnx, py - pl * rny    # PathLateral > 0 is right of the centre
    for i in range(len(s)):
        bi = int(ld[i] // BIN)
        if 0 <= bi < nb:
            cs[bi].append((cx[i], cy[i]))
            if te[i] < -0.5 and te[i] > -40: le[bi].append(-te[i])
            elif te[i] > 0.5 and te[i] < 40: ri[bi].append(te[i])
cx = np.array([np.median(np.array(c), axis=0)[0] if c else np.nan for c in cs])
cy = np.array([np.median(np.array(c), axis=0)[1] if c else np.nan for c in cs])
def fill(a):
    idx = np.arange(len(a)); ok = ~np.isnan(a)
    return np.interp(idx, idx[ok], a[ok])
cx, cy = fill(cx), fill(cy)
def width(lists):
    w = np.array([np.median(l) if len(l) >= 2 else np.nan for l in lists])
    med = np.nanmedian(w)
    w = np.where(np.isnan(w), med, w)
    k = np.ones(7) / 7
    return np.convolve(np.pad(w, 3, mode="wrap"), k, mode="valid")
hl, hr = width(le), width(ri)
print("half widths L/R median", np.median(hl), np.median(hr), "bins", nb)

# --- real elevation along the centre ----------------------------------------------------
r = math.radians(georef["rotationDeg"])
mx = cx * georef["mirror"]
rx = mx * math.cos(r) - cy * math.sin(r)
ry = mx * math.sin(r) + cy * math.cos(r)
lat = georef["originLat"] + ry / 110540.0
lon = georef["originLon"] + rx / (111320.0 * math.cos(math.radians(georef["originLat"])))
STEP = 4  # a DEM sample every 20 m
idx = list(range(0, nb, STEP))
if idx[-1] != nb - 1: idx.append(nb - 1)
zs = []
for i in range(0, len(idx), 90):
    chunk = idx[i:i + 90]
    locs = "|".join(f"{lat[j]:.6f},{lon[j]:.6f}" for j in chunk)
    url = f"https://api.opentopodata.org/v1/{dem}?locations={locs}&interpolation=cubic"
    for attempt in range(5):
        try:
            res = json.load(urllib.request.urlopen(url, timeout=60))["results"]; break
        except Exception as e:
            print("retry", e); time.sleep(3)
    zs += [p["elevation"] if p["elevation"] is not None else np.nan for p in res]
    time.sleep(1.2)
zs = np.array(zs, float)
z = np.interp(np.arange(nb), idx, fill(zs))
# smooth: a DEM is ~25 m cells, a car does not feel a 5 m wobble
def gauss(a, sigma_bins):
    k = np.exp(-0.5 * (np.arange(-3 * sigma_bins, 3 * sigma_bins + 1) / sigma_bins) ** 2); k /= k.sum()
    p = 3 * sigma_bins
    return np.convolve(np.concatenate([a[-p:], a, a[:p]]), k, mode="valid")
z = gauss(z, 6)
# a closed loop must close: spread the end mismatch along the lap
z = z - np.linspace(0, z[-1] - z[0], nb)
print("elevation range m", round(float(z.min()), 1), round(float(z.max()), 1), "relief", round(float(z.max() - z.min()), 1))

# --- laps to replay ---------------------------------------------------------------------
rep = []
for L in sorted(laps, key=lambda l: l["time"])[:5]:
    s = np.where(L["sel"])[0]
    t = t10[s] - L["a"]
    rep.append(dict(
        no=L["no"], time=round(L["time"], 3),
        x=np.round(x[s], 2).tolist(), y=np.round(y[s], 2).tolist(),
        ld=np.round(ch["Lap Dist"][s], 1).tolist(),
        v=np.round(at(fast["Ground Speed"], 100, t10[s]) / 3.6, 2).tolist(),
        th=np.round(at(fast["Throttle Pos"], 50, t10[s])).astype(int).tolist(),
        br=np.round(at(fast["Brake Pos"], 50, t10[s])).astype(int).tolist(),
        st=np.round(at(fast["Steering Pos"], 100, t10[s]), 1).tolist(),
        gear=step(gear_ts, gear_v, t10[s]).astype(int).tolist(),
        rpm=np.round(at(fast["Engine RPM"], 100, t10[s])).astype(int).tolist(),
        gl=np.round(ch["G Force Lat"][s], 2).tolist(),
    ))
data = dict(track=track_id, lengthM=LEN, bin=BIN, hz=HZ,
            road=dict(cx=np.round(cx, 2).tolist(), cy=np.round(cy, 2).tolist(),
                      hl=np.round(hl, 2).tolist(), hr=np.round(hr, 2).tolist(), z=np.round(z, 2).tolist()),
            laps=rep)
Path(out).write_text("window.FOLLOW_DATA=" + json.dumps(data, separators=(",", ":")) + ";\n")
print("wrote", out, round(Path(out).stat().st_size / 1e3), "kB")
