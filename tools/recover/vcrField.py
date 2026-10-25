"""Rebuild a race's field (every car, 5 Hz, the app's field v2 format) from LMU's own replay (.Vcr).

Pit wall thread 98 (the 2026-10-21 Sebring race had no capture): the replay holds every car's world
position, yaw and pit flag at 50 Hz; everything else is derived and checked, never guessed:
  lapDist + pathLateral : the car projected onto the track's own centre path (the surface centre),
  laps + place          : from line crossings and progress, checked against the results XML,
  class, vehicle, best  : from the results XML driver rows, the replay car matched to its driver by
                          comparing lap times (a driver is taken only when its lap times match).
A qualifying has no progress order (it ranks by best lap), so its place is the best-lap order at each moment
(--kind, read from the XML's <Qualify>/<Race> block when not given); laps follow the XML's lap numbers (a
qualifying's out lap has no row and ended before the replay's first tick).
Read-only: reads the .Vcr, the surface JSON and the results XML, writes a JSON file and a report.
Run: uv run --with numpy python -I tools/recover/vcrField.py --vcr R.Vcr --surface surf.json --xml results.xml --out field.json
The record layout is rumble's (pit wall thread 94 #6231): slice = float32 time + uint16 count, event header
uint32 (driver = h&0xff, size = (h>>8)&0x1ff, type = (h>>17)&0x3f, class = h>>29), +1 byte, payload; a car state
is class 0, type 7..16, size 65: info1 u32 @5 (bit 17 = pit), x,y,z,rot x,y,z float32 @46.
"""
import argparse, json, math, mmap, re, struct
import numpy as np

TICK_S = 0.2
SENTINEL = 5000.0  # the replay writes ~1e9 for a car that is not in the world


def read_vcr(path):
    f = open(path, 'rb')
    d = mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ)
    L = len(d)
    o = 0x3d
    S_SL = struct.Struct('<fH')
    S_H = struct.Struct('<I')
    S_I = struct.Struct('<I')
    S_P = struct.Struct('<6f')
    hup = struct.unpack_from('<I', d, 0x43)[0] >> 23
    rec = {'t': [], 'drv': [], 'info': [], 'p': []}
    while o < L - 8:
        t, n = S_SL.unpack_from(d, o)
        if not (0 <= t < 1e5) or o + 6 > L:
            break
        o += 6
        for _ in range(n):
            if o + 4 > L:
                break
            h = S_H.unpack_from(d, o)[0]
            drv = h & 0xff
            size = (h >> 8) & 0x1ff
            typ = (h >> 17) & 0x3f
            if 7 <= typ <= 16 and size == 65 and (h >> 23) == hup:
                b = o + 5
                rec['t'].append(t)
                rec['drv'].append(drv)
                rec['info'].append(S_I.unpack_from(d, b)[0])
                rec['p'].append(S_P.unpack_from(d, b + 41))
            o += 5 + size
    return {k: np.array(v) for k, v in rec.items()}


def centre_from_surface(path):
    S = json.load(open(path))
    bins = S['neu'] if 'neu' in S else S['bins']
    step = 10.0
    C = [(b * step + step / 2, bn['sx'] / bn['n'], bn['sy'] / bn['n']) for b, bn in enumerate(bins) if bn['n'] > 0]
    length = float(S['length']) if 'length' in S else float(S['lengthM'])
    return np.array(C), length


def centre_from_game(path):
    """The game's own centre path in the game's own lap-distance axis, from the player's racing laps of the
    same session (its .duckdb): centre = position - pathLateral * (right normal of the car's path), averaged per
    5 m of lap distance. Same coordinates as the replay (x east, y north), so the projection below agrees with
    the game's lapDist and pathLateral by construction."""
    import duckdb
    con = duckdb.connect(path, read_only=True)

    def ch(n):
        return np.array([r[0] for r in con.execute('select value from "%s"' % n).fetchall()], float)

    lat, lon, ld, pl = ch('GPS Latitude'), ch('GPS Longitude'), ch('Lap Dist'), ch('Path Lateral')
    n = min(len(lat), len(ld), len(pl))
    lat, lon, ld, pl = lat[:n], lon[:n], ld[:n], pl[:n]
    R = 6378137.0
    x = np.radians(lon) * R * math.cos(math.radians(60))
    y = np.radians(lat - 60) * R
    dx = np.gradient(x)
    dy = np.gradient(y)
    ln = np.hypot(dx, dy) + 1e-9
    nx, ny = dy / ln, -dx / ln  # right of travel
    cx = x - pl * nx
    cy = y - pl * ny
    L = float(np.percentile(ld[ld > 0], 99.9))
    ok = (np.hypot(dx, dy) > 0.5) & (np.abs(pl) < 20) & (ld > 0) & (ld < L)
    step = 5.0
    nb = int(math.ceil(L / step))
    b = np.minimum((ld[ok] / step).astype(int), nb - 1)
    out = []
    for i in range(nb):
        m = b == i
        if m.sum() >= 3:
            out.append((i * step + step / 2, float(np.median(cx[ok][m])), float(np.median(cy[ok][m]))))
    return np.array(out), L


def project(C, L, x, y):
    cl, cx, cy = C[:, 0], C[:, 1], C[:, 2]
    n = len(C)
    ld = np.empty(len(x))
    lat = np.empty(len(x))
    for s in range(0, len(x), 20000):
        xs, ys = x[s:s + 20000], y[s:s + 20000]
        dd = (xs[:, None] - cx[None, :]) ** 2 + (ys[:, None] - cy[None, :]) ** 2
        j = dd.argmin(1)
        best = np.full(len(j), np.inf)
        bld = np.zeros(len(j))
        blat = np.zeros(len(j))
        for off in (-1, 0):
            i0 = (j + off) % n
            i1 = (j + off + 1) % n
            ax, ay, bx, by = cx[i0], cy[i0], cx[i1], cy[i1]
            vx, vy = bx - ax, by - ay
            vv = vx * vx + vy * vy + 1e-9
            t = np.clip(((xs - ax) * vx + (ys - ay) * vy) / vv, 0, 1)
            qx, qy = ax + t * vx, ay + t * vy
            dist = np.hypot(xs - qx, ys - qy)
            l0, l1 = cl[i0], cl[i1]
            lds = l0 + t * np.where(l1 < l0, (l1 - l0) % L, l1 - l0)
            lats = ((xs - qx) * vy - (ys - qy) * vx) / np.sqrt(vv)
            m = dist < best
            best[m] = dist[m]
            bld[m] = lds[m] % L
            blat[m] = lats[m]
        ld[s:s + 20000] = bld
        lat[s:s + 20000] = blat
    return ld, lat


def read_xml(path):
    s = open(path, encoding='utf-8', errors='replace').read()

    def g(blk, tag):
        m = re.search(r'<%s>([^<]*)</%s>' % (tag, tag), blk)
        return m.group(1) if m else None

    out = []
    for blk in re.findall(r'<Driver>([\s\S]*?)</Driver>', s):
        rows = re.findall(r'<Lap [^>]*et="([0-9.]+)"[^>]*>([0-9.-]+)</Lap>', blk)
        nums = [int(n) for n in re.findall(r'<Lap num="([0-9]+)"[^>]*et="[0-9.]+"', blk)]  # the game's lap number at each row's end
        ends = [float(e) for e, _ in rows]  # the session clock at the end of each lap
        laps = [float(t) if re.fullmatch(r'[0-9.]+', t) else -1.0 for _, t in rows]  # an invalid lap reads --.----
        out.append({'name': g(blk, 'Name'), 'cls': g(blk, 'CarClass'), 'model': g(blk, 'CarType'),
                    'best': float(g(blk, 'BestLapTime') or -1), 'position': int(g(blk, 'Position') or 0),
                    'classPos': int(g(blk, 'ClassPosition') or 0), 'lapsXml': int(g(blk, 'Laps') or 0),
                    'laps': laps, 'ends': ends, 'nums': nums, 'finish': g(blk, 'FinishStatus')})
    return out


def read_kind(path):
    """race | qualify | practice, from the results XML's session block (a race is the default)."""
    s = open(path, encoding='utf-8', errors='replace').read()
    for tag, kind in (('<Qualify>', 'qualify'), ('<Race>', 'race')):
        if tag in s:
            return kind
    return 'practice' if re.search(r'<Practice[0-9]*>', s) else 'race'


def match_cars(cars, drivers):
    """Which XML driver each replay car is, from lap-end times alone. `cars[d]` needs 'cross' (the car's line crossings) and
    'cross_x' (the same on the XML's clock: after the timing-line offset). Returns (assign, scores, how): replay car ->
    driver index, the fraction of the driver's lap ends the car's crossings hit, and the pass that took the pair."""
    scores = {}
    for d, c in cars.items():
        for j, dr in enumerate(drivers):
            xs = np.array(dr['ends'])
            if len(xs) == 0 or len(c['cross']) == 0:
                continue
            hit = sum(bool(np.any(np.abs(c['cross_x'] - x) < 0.4)) for x in xs)
            scores[(d, j)] = hit / len(xs)
    used = set()
    assign = {}
    def margin_ok(d, j, s):
        # the pair must stand clear of every other pairing of that car and of that driver
        other = [v for (dd, jj), v in scores.items() if (dd == d) != (jj == j) and v > 0]
        return all(s - v >= 0.15 for v in other)

    for (d, j), s in sorted(scores.items(), key=lambda kv: -kv[1]):
        if d in assign or j in used or s < 0.6 or not margin_ok(d, j, s):
            continue
        assign[d] = j
        used.add(j)
    how = {d: 'clear' for d in assign}

    def left():
        return ([d for d in cars if d not in assign],
                [j for j in range(len(drivers)) if j not in used and len(drivers[j]['ends']) > 0])

    # pass 1b, among what is left: two cars running together (the same laps to a tenth) pass the fraction test for
    # each other's driver, so the clear pass leaves both. Counted in lap ends instead: a pair with at least 2 shared
    # ends that has 2 more than any other pairing of that car or that driver is taken, then the rest is judged again
    # without it (the second car's pair has nothing left to be confused with).
    def shared(d, j):
        return sum(bool(np.any(np.abs(cars[d]['cross_x'] - x) < 0.4)) for x in drivers[j]['ends'])

    progress = True
    while progress:
        progress = False
        lc, lj = left()
        cnt = {(d, j): shared(d, j) for d in lc for j in lj}
        for (d, j), n in sorted(cnt.items(), key=lambda kv: -kv[1]):
            if n < 2:
                break
            other = [v for (dd, jj), v in cnt.items() if (dd == d) != (jj == j)]
            if n - max(other, default=0) >= 2:
                assign[d] = j
                used.add(j)
                scores[(d, j)] = n / len(drivers[j]['ends'])
                how[d] = 'among the rest, by lap ends shared'
                progress = True
                break
    # pass 1c: a car and a driver that share one lap end (to 0.25 s, after the offset) and no other pairing of either
    # does: the pit-lane crossings the line-distance wrap misses leave a car with one clean pair
    lc, lj = left()
    hits = {}
    for d in lc:
        for j in lj:
            n = sum(bool(np.any(np.abs(cars[d]['cross_x'] - x) < 0.25)) for x in drivers[j]['ends'])
            if n >= 1:
                hits[(d, j)] = n
    for (d, j), n in sorted(hits.items()):
        if sum(1 for (dd, jj) in hits if dd == d) == 1 and sum(1 for (dd, jj) in hits if jj == j) == 1:
            assign[d] = j
            used.add(j)
            scores[(d, j)] = n / len(drivers[j]['ends'])
            how[d] = 'one lap end only'
    # second pass: what is left, matched on the number of lap ends only when exactly one car and one driver have it
    left_c = [d for d in cars if d not in assign]
    left_j = [j for j in range(len(drivers)) if j not in used and len(drivers[j]['ends']) > 0]
    for d in left_c:
        n = len(cars[d]['cross'])
        same_j = [j for j in left_j if len(drivers[j]['ends']) == n]
        same_c = [e for e in left_c if len(cars[e]['cross']) == n]
        if len(same_j) == 1 and len(same_c) == 1:
            assign[d] = same_j[0]
            used.add(same_j[0])
            scores[(d, same_j[0])] = 0.0
            how[d] = 'by lap count'
    # third pass: a car whose line crossings include the driver's first lap end, when exactly one such car and one such driver are left
    left_c = [d for d in cars if d not in assign]
    left_j = [j for j in range(len(drivers)) if j not in used and len(drivers[j]['ends']) > 0]
    for d in left_c:
        cand = [j for j in left_j if np.any(np.abs(cars[d]['cross_x'] - drivers[j]['ends'][0]) < 0.5)]
        cands_c = [e for e in left_c if any(np.any(np.abs(cars[e]['cross_x'] - drivers[j]['ends'][0]) < 0.5) for j in cand)]
        if len(cand) == 1 and len(cands_c) == 1:
            assign[d] = cand[0]
            used.add(cand[0])
            scores[(d, cand[0])] = -1.0  # reported as matched on the first lap end only
            how[d] = 'first lap end'
    return assign, scores, how


def laps_completed(nums, ends, ticks):
    """Laps completed at each tick, as the game counts them: the lap number at each end. A qualifying's out lap has
    no row (it ended before the replay's first tick), so the first row's number is 2 and one lap was already done."""
    done = nums[0] - 1 if len(nums) else 0
    return done + np.searchsorted(ends, ticks, side='right')


def best_laps_so_far(order, assign, drivers, ticks):
    """For each car (rows, in `order`) and tick, the best timed lap it has finished by then; 1e9 before its first."""
    bestnow = np.full((len(order), len(ticks)), 1e9)
    for i, d in enumerate(order):
        j = assign.get(d)
        if j is None:
            continue
        for end, lt in zip(drivers[j]['ends'], drivers[j]['laps']):
            if lt > 0:
                m = ticks >= end
                bestnow[i, m] = np.minimum(bestnow[i, m], lt)
    return bestnow


def rank_places(kind, prog, bestnow):
    """Place per car (rows) and tick, 1 = first. A race ranks by progress on track. A qualifying (and a practice)
    ranks by best lap, never by progress: the best timed lap so far, a car with none yet after the ones that have, by
    progress."""
    place = np.zeros(prog.shape, dtype=int)
    for k in range(prog.shape[1]):
        r = np.argsort(-prog[:, k]) if kind == 'race' else np.lexsort((-prog[:, k], bestnow[:, k]))
        place[r, k] = np.arange(1, prog.shape[0] + 1)
    return place


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--vcr', required=True)
    ap.add_argument('--surface', default=None, help='a surface json; used when --game is not given')
    ap.add_argument('--game', default=None, help="the player's own game file (.duckdb) of this session: the centre path in the game's own axis")
    ap.add_argument('--xml', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--player', type=int, default=None, help='replay driver id of the player')
    ap.add_argument('--report', default=None)
    ap.add_argument('--kind', choices=['race', 'qualify', 'practice'], default=None, help="the session's kind; read from the XML when not given")
    ap.add_argument('--player-best', type=float, default=None, help="the player's best lap in seconds (the app's session best): names the player's XML driver, so the timing-line offset needs only 3 laps, not 5")
    a = ap.parse_args()
    R = read_vcr(a.vcr)
    ids = [int(i) for i in np.unique(R['drv'])]
    C, L = centre_from_game(a.game) if a.game else centre_from_surface(a.surface)
    cent = ("the player's own laps in the game file (%d points, lap length %.1f m)" % (len(C), L)) if a.game else 'the stored surface'
    drivers = read_xml(a.xml)
    kind = a.kind or read_kind(a.xml)
    tmax = float(R['t'].max())
    ticks = np.arange(0, tmax, TICK_S)
    nT = len(ticks)
    cars = {}
    for d in ids:
        m = R['drv'] == d
        t = R['t'][m]
        p = R['p'][m]
        info = R['info'][m]
        ok = (np.abs(p[:, 0]) < SENTINEL) & (np.abs(p[:, 2]) < SENTINEL)
        if ok.sum() < 1000:
            continue
        if np.ptp(p[ok, 0]) < 1 and np.ptp(p[ok, 2]) < 1:
            continue  # a static object, not a car
        idx = np.searchsorted(t, ticks).clip(0, len(t) - 1)
        valid = ok[idx] & (np.abs(t[idx] - ticks) < 0.05)
        x = np.where(valid, p[idx, 0], np.nan)
        z = np.where(valid, p[idx, 2], np.nan)
        yaw = np.where(valid, p[idx, 4] - math.pi, np.nan)
        pit = np.where(valid, (info[idx] >> 17) & 1, 0)
        ld = np.full(nT, np.nan)
        lat = np.full(nT, np.nan)
        v = np.where(valid)[0]
        ld[v], lat[v] = project(C, L, x[v], z[v])
        cars[d] = {'x': x, 'z': z, 'yaw': yaw, 'ld': ld, 'lat': lat, 'pit': pit, 'valid': valid}
    rep = []
    rep.append('centre path from ' + cent)
    rep.append('session kind: %s' % kind)
    rep.append('cars in the replay: %s (xml drivers: %d)' % (sorted(cars), len(drivers)))

    def crossings(ld, start_of):
        # A crossing counts only after the car has been past mid-lap since the last one: a car
        # hovering at the line (the garage, the pit box) must not count as laps.
        out = []
        last = None
        armed = True
        for k in range(nT):
            v = ld[k]
            if np.isnan(v) or ticks[k] < start_of[0]:
                continue
            if 0.25 * L < v < 0.75 * L:
                armed = True
            if armed and last is not None and last[1] > L * 0.75 and v < L * 0.25 and ticks[k] - last[0] < 2.0:
                gap = v + L - last[1]
                frac = (L - last[1]) / gap if gap > 0 else 0
                out.append(last[0] + frac * (ticks[k] - last[0]))
                armed = False
            last = (ticks[k], v)
        return np.array(out)

    for d, c in cars.items():
        # the car is on the grid after its largest position jump in the first two minutes (garage to grid)
        v = np.where(c['valid'])[0]
        early = v[ticks[v] < 120]
        jumps = np.hypot(np.diff(c['x'][early]), np.diff(c['z'][early])) if len(early) > 1 else np.array([0.0])
        c['start'] = float(ticks[early[int(jumps.argmax()) + 1]]) if len(early) > 1 and jumps.max() > 50 else 0.0
        c['cross'] = crossings(c['ld'], (c['start'],))
        # The replay's pit bit never changes in this file (checked on the player's own stop), so the only
        # pit state stated is the one the data proves: a car that has not yet been put on the grid is in the garage.
        c['pit'] = np.where(ticks < c['start'], 1, 0)
    # The xml times a lap at its own timing line, not at lapDist 0: one constant offset for every car. It is
    # measured on the player (known from the game file) against the xml driver whose lap ends sit closest.
    # With the player's own best lap the driver is named, so 3 laps are enough to measure the offset (a qualifying
    # has 4-5); without it the driver is the best fit of all, which needs 5 to be told from a lucky one.
    need = 3 if a.player_best is not None else 5
    delta = 0.0
    if a.player in cars and len(cars[a.player]['cross']) >= need - 1:
        pc = cars[a.player]['cross']
        best = None
        for dr in drivers:
            if len(dr['ends']) < need:
                continue
            if a.player_best is not None and not (dr['best'] > 0 and abs(dr['best'] - a.player_best) < 0.002):
                continue
            e = np.array(dr['ends'])
            diffs = np.array([e[np.abs(e - x).argmin()] - x for x in pc if np.abs(e - x).min() < 3.0])
            if len(diffs) >= need and (best is None or np.median(np.abs(diffs - np.median(diffs))) < best[0]):
                best = (float(np.median(np.abs(diffs - np.median(diffs)))), float(np.median(diffs)), dr['name'], len(diffs))
        if best:
            delta = best[1]
            rep.append("timing-line offset (xml lap end minus the car's lapDist-0 crossing), from the player against %s over %d laps: %.3f s" % (best[2], best[3], delta))
        else:
            rep.append('timing-line offset: none measured (no driver with %d or more lap ends matched the player), offset 0' % need)
    else:
        rep.append('timing-line offset: none measured (the player has fewer than %d line crossings), offset 0' % (need - 1))
    for c in cars.values():
        c['cross_x'] = c['cross'] + delta
    assign, scores, how = match_cars(cars, drivers)
    used = set(assign.values())
    rep.append("matched by lap-end times (at least 60%% of the driver's lap ends within 0.4 s of one of the car's line crossings (after the timing-line offset), and at least 0.15 clear of every other pairing of that car or driver): %d of %d cars" % (len(assign), len(cars)))
    for d in sorted(cars):
        j = assign.get(d)
        if j is None:
            rep.append('  replay %2d -> UNMATCHED' % d)
        else:
            rep.append('  replay %2d -> %s | %s | %s | best %.3f | matched %.2f%s' % (d, drivers[j]['name'], drivers[j]['cls'], drivers[j]['model'], drivers[j]['best'], scores[(d, j)], '' if how.get(d, 'clear') == 'clear' else ' (' + how[d] + ')'))
    for d, c in cars.items():
        j = assign.get(d)
        ends = np.array(drivers[j]['ends']) if j is not None else c['cross']
        c['laps'] = laps_completed(drivers[j]['nums'] if j is not None else [], ends, ticks)
    unidentified = [d for d in cars if d not in assign]
    for d in unidentified:
        rep.append('NOT IN THE FIELD: replay car %d has no matching driver (%d line crossings); the xml drivers left without a car: %s' % (d, len(cars[d]['cross']), [drivers[j]['name'] + ' (' + str(drivers[j]['lapsXml']) + ' laps)' for j in range(len(drivers)) if j not in used]))
        del cars[d]
    order = sorted(cars)
    prog = np.array([cars[d]['laps'] * L + np.nan_to_num(cars[d]['ld'], nan=0.0) for d in order])
    for i, d in enumerate(order):
        j = assign.get(d)
        if j is None or not drivers[j]['ends'] or drivers[j]['finish'] != 'Finished Normally':
            continue
        fin = drivers[j]['ends'][-1]
        done = ticks >= fin
        # a finisher's rank is fixed at the flag: more laps first, then the earlier finish
        prog[i, done] = cars[d]['laps'][done] * L + (L - 1.0) - fin * 1e-3
    place = rank_places(kind, prog, best_laps_so_far(order, assign, drivers, ticks) if kind != 'race' else None)
    final = {d: int(place[i, -1]) for i, d in enumerate(order)}
    rep.append('final order from the replay (%s) vs the xml Position, laps vs the xml Laps:' % ('progress at the last tick' if kind == 'race' else 'best lap so far; the xml position is ranked among the matched cars only'))
    xml_rank = {}
    if kind != 'race':
        matched = sorted((d for d in order if assign.get(d) is not None), key=lambda d: drivers[assign[d]]['position'])
        xml_rank = {d: n + 1 for n, d in enumerate(matched)}
        final = {d: int(sum(1 for e in matched if place[order.index(e), -1] <= place[order.index(d), -1])) for d in matched}
    differ = 0
    for d in order:
        j = assign.get(d)
        if j is None:
            continue
        ok = final[d] == xml_rank.get(d, drivers[j]['position'])
        differ += 0 if ok else 1
        rep.append('  %s: derived %d, xml %d | laps derived %d, xml %d %s' % (drivers[j]['name'], final[d], xml_rank.get(d, drivers[j]['position']), int(cars[d]['laps'][-1]), drivers[j]['lapsXml'], '' if ok else '<-- differs'))
    rep.append('matched cars whose final place differs from the xml: %d' % differ)

    def delta(vals, unit):
        out = []
        prev = 0
        for v in vals:
            if v is None or (isinstance(v, float) and math.isnan(v)):
                out.append(None)
                continue
            q = int(round(v / unit))
            out.append(q - prev)
            prev = q
        return out

    field = {'v': 2, 'hz': 5, 'et0': 0.0, 'tDs': [int(round(t * 10)) for t in ticks], 'cars': [], 'lapDistDm': [],
             'pathLateralDm': [], 'xDm': [], 'zDm': [], 'yawCrad': [], 'place': [], 'laps': [], 'inPits': [], 'flag': []}
    for i, d in enumerate(order):
        c = cars[d]
        j = assign.get(d)
        dr = drivers[j] if j is not None else None
        field['cars'].append({'i': i, 'class': (dr['cls'] if dr else ''), 'vehicle': (dr['model'] if dr else ''),
                              'player': d == a.player, 'bestLapS': (dr['best'] if dr and dr['best'] > 0 else None)})
        field['lapDistDm'].append(delta(c['ld'].tolist(), 0.1))
        field['pathLateralDm'].append(delta(c['lat'].tolist(), 0.1))
        field['xDm'].append(delta(c['x'].tolist(), 0.1))
        field['zDm'].append(delta(c['z'].tolist(), 0.1))
        yw = [None if math.isnan(v) else ((v + math.pi) % (2 * math.pi) - math.pi) for v in c['yaw'].tolist()]
        field['yawCrad'].append(delta(yw, 0.01))
        field['place'].append([int(place[i, k]) if c['valid'][k] else None for k in range(nT)])
        field['laps'].append([int(c['laps'][k]) if c['valid'][k] else None for k in range(nT)])
        field['inPits'].append([int(c['pit'][k]) if c['valid'][k] else None for k in range(nT)])
        field['flag'].append([0 if c['valid'][k] else None for k in range(nT)])
    json.dump(field, open(a.out, 'w'), separators=(',', ':'))
    rep.append('wrote %s: %d cars, %d ticks (%.0f s)' % (a.out, len(order), nT, tmax))
    txt = '\n'.join(rep)
    print(txt)
    if a.report:
        open(a.report, 'w').write(txt + '\n')


if __name__ == '__main__':
    main()
