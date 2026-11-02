"""Historical avalanche events of Pakistan: locate each record and build an illustrative avalanche path on real terrain.

Input : data/history/events/avalanche_events_pakistan_compiled.csv (the compiled table supplied by NGT, copied unchanged).
Output: data/history/events/pk_events.geojson   (one feature per record; every CSV field copied unchanged)
        data/history/events/osm_geocode.json     (cache of the OpenStreetMap Nominatim answers used, with OSM ids)

Location (property `loc`), best first:
  A  coordinates given in the record itself (HiAVAL database or the peak coordinates the record names)
  B  the place the record names, found in OpenStreetMap (Nominatim)
  C  the place itself is not mapped; the nearest named place / landmark the record mentions is used and named
  D  only a valley or district is known: shown as an approximate area, never animated
  E  no usable location
Avalanche path (property `anim`, only for A-C snow / ice avalanches): ILLUSTRATIVE. Release cells are searched on the
portal's own DEM tiles (data/dem/terrarium, zoom 12, Copernicus GLO-30, ~30 m): steep (28-55 deg) high slopes - the peaks,
ridges and glacier walls above the place. From each one a sliding block with Voellmy-type friction (mu 0.20, xi*h 4000 m/s2,
the same textbook defaults as static/js/avalanche.js) runs down the DEM. "impact" events keep the run that reaches the
documented place with the largest drop; "band" events (high-altitude climbing accidents) release at the elevation the record
gives. No path, release point, speed or volume is historical: the records do not contain any.

Usage (system Python, numpy + Pillow):  python scripts/build_history_events.py [--refresh-osm]
"""
import csv, json, math, sys, time, urllib.parse, urllib.request
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
DIR = ROOT / "data" / "history" / "events"
SRC = DIR / "avalanche_events_pakistan_compiled.csv"
OUT = DIR / "pk_events.geojson"
CACHE = DIR / "osm_geocode.json"
DEM = ROOT / "data" / "dem" / "terrarium" / "12"
Z = 12
G, MU, XIH = 9.81, 0.20, 4000.0
R_E = 6378137.0
UA = {"User-Agent": "NDMA-avalanche-portal/1.0 (historical event geocoding; low volume)"}

# Per record: how it is located and whether / how a path is built. Queries were checked by hand against the OSM answers
# (district and province in the display name must match the record).
LOWARI_N = {"osm": "way/448975812", "end": "north", "label": "Lowari Tunnel, north (Chitral) portal"}
# Records left out of the portal entirely (still in the source CSV), at the user's request.
EXCLUDED = {"PK027": "Pattan earthquake area: no avalanche documented (earthquake candidate)."}
GEO = {
    "PK014": dict(tier="C", q="Shispare", want="peak", note="Shispare summit (OpenStreetMap). Camp II is not published; the path is placed near 5,700 m on the peak, as the record says.",
                  sim=dict(mode="band", R=4500, z=(5550, 5900))),
    "PK027": dict(tier="A", note="Epicentral area given in the record. No avalanche is documented for this earthquake.", anim="No avalanche documented (earthquake candidate)."),
    "PK001": dict(tier="A", note="Coordinates from the HiAVAL database (as in the record).", sim=dict(mode="impact", R=5000, tol=350)),
    "PK015": dict(tier="B", q="Behrain", want="town", note="Bahrain (Behrain) town, Swat (OpenStreetMap).", sim=dict(mode="impact", R=5000, tol=350)),
    "PK036": dict(tier="E", note="Village not named in the source."),
    "PK016": dict(tier="B", q="Lowari Pass", want="mountain_pass", note="Lowari Pass (OpenStreetMap). The record says the Chitral side; the exact road position is not given.",
                  sim=dict(mode="impact", R=4500, tol=450, to_place=True)),
    "PK017": dict(tier="C", q="Jagran", want="village", note="Misra Jagran is not mapped; Jagran village (lower Neelum, OpenStreetMap) is used.", sim=dict(mode="impact", R=4500, tol=450)),
    "PK031": dict(tier="B", q="Khawaja Seri", want="village", note="Khawaja Seri village, Sharda tehsil (OpenStreetMap).", sim=dict(mode="impact", R=4500, tol=350)),
    "PK032": dict(tier="D", q="Neelam Valley District", want="administrative", note="Neelum Valley; the place is not named in the source."),
    "PK035": dict(tier="D", q="Leepa", want="village", note="Leepa valley; Leepa village (OpenStreetMap) marks the valley. The house is not located."),
    "PK033": dict(tier="B", q="Janwai", want="village", note="Janawai = Janwai village, Sharda tehsil (OpenStreetMap).", sim=dict(mode="impact", R=4500, tol=350)),
    "PK034": dict(tier="D", q="Astore District", want="administrative", note="Astore valley; the village is not named in the source."),
    "PK028": dict(tier="D", q="Neelam Valley District", want="administrative", note="Mayyatan Wali Seri is not in OpenStreetMap; only the valley is known."),
    "PK002": dict(tier="D", q="Upper Kohistan District", want="administrative", note="Sputmali is not in OpenStreetMap; only the district (Kohistan) is known."),
    "PK018": dict(tier="C", **LOWARI_N, note="Ziarat checkpoint is not mapped; the north (Chitral) portal of the Lowari Tunnel (OpenStreetMap way 448975812) is used.",
                  sim=dict(mode="impact", R=4500, tol=450)),
    "PK019": dict(tier="B", q="Lowari Pass", want="mountain_pass", note="Lowari Pass (OpenStreetMap).", anim="Source does not say these deaths were from an avalanche."),
    "PK003": dict(tier="A", note="K2 summit coordinates in the record; the Bottleneck is just below it (about 8,200 m).", sim=dict(mode="band", R=1800, z=(8050, 8400))),
    "PK004": dict(tier="E", note="Place and day not stated in the source."),
    "PK006": dict(tier="E", note="Sector only; not located."),
    "PK005": dict(tier="A", note="Coordinates from the HiAVAL database (as in the record).", sim=dict(mode="impact", R=5000, tol=400)),
    "PK007": dict(tier="B", q="Gyari", want="hamlet", note="Gyari hamlet, Mashabrum tehsil, Ghanche (OpenStreetMap), 3,775 m on the DEM. The record's coordinates "
                  "(35.498 N, 76.753 E) lie at 5,822 m on the DEM, which does not fit the documented base at about 4,000 m, so they are not used.",
                  sim=dict(mode="impact", R=5000, tol=350)),
    "PK037": dict(tier="E", note="Outpost not named in the source."),
    "PK026": dict(tier="D", q="Kandia", want="village", note="Kohistan; Kandia (OpenStreetMap) marks the area.", anim="Rain-triggered landslides; avalanches only mentioned in passing."),
    "PK029": dict(tier="B", q="Shershal", want="village", note="Sher Shal = Shershal village, Chitral (OpenStreetMap).", sim=dict(mode="impact", R=4500, tol=350)),
    "PK038": dict(tier="E", note="Arandu village, Shigar is not located here.", anim="Glacier movement, not an avalanche; no deaths."),
    "PK020": dict(tier="C", **LOWARI_N, note="Sambu workshop at the north portal of the Lowari Tunnel; the portal (OpenStreetMap way 448975812) is used.",
                  sim=dict(mode="impact", R=4500, tol=450)),
    "PK021": dict(tier="D", q="Sur Rech", want="village", note="Rech valley, Chitral; Sur Rech village (OpenStreetMap) marks the valley."),
    "PK022": dict(tier="D", q="Swat District", want="administrative", note="Swat; place not named.", anim="Summer event; doubtful as a snow avalanche."),
    "PK008": dict(tier="B", q="Bakwali", want="village", note="Bakwali hamlet, Surgan area, Sharda tehsil (OpenStreetMap), named in the record.", sim=dict(mode="impact", R=4500, tol=350)),
    "PK009": dict(tier="D", q="Astore District", want="administrative", note="Dombabaho is not in OpenStreetMap; only the district (Astore) is known."),
    "PK023": dict(tier="C", q="Qamri", want="village", note="Thali area is not mapped; Qamri (OpenStreetMap) is used.", sim=dict(mode="impact", R=4500, tol=450)),
    "PK010": dict(tier="E", note="Kandla, Abbottabad is not in OpenStreetMap."),
    "PK024": dict(tier="B", q="Behrain", want="town", note="Bahrain (Behrain) town, Swat (OpenStreetMap).", sim=dict(mode="impact", R=5000, tol=350)),
    "PK025": dict(tier="C", q="Bakwali", want="village", note="Sargan village is not mapped; Bakwali, a hamlet of the Surgan area (OpenStreetMap), is used.",
                  sim=dict(mode="impact", R=4500, tol=450)),
    "PK039": dict(tier="E", note="Two areas (Naltar, Shigar), no day; not located."),
    "PK030": dict(tier="C", **LOWARI_N, note="Lowari Tunnel, Chitral side: the north portal (OpenStreetMap way 448975812).", sim=dict(mode="impact", R=4500, tol=450)),
    "PK011": dict(tier="C", q="Shounter Lake", want="lake", note="Shounter Pass is not in OpenStreetMap; Shounter Lake below it is the nearest mapped feature. The path is placed on slopes above the pass's documented 4,420 m within 6 km.",
                  sim=dict(mode="band", R=6000, z=(4500, 5200), through=4420)),
    "PK012": dict(tier="C", q="Arandu, Chitral", want="town", note="Serigal and Damil are not mapped; Arandu, Lower Chitral (OpenStreetMap) is used.", sim=dict(mode="impact", R=4500, tol=450)),
    "PK013": dict(tier="A", note="Broad Peak coordinates in the record (the peak); the route between Camp 2 and Camp 3 is at about 6,600-6,700 m.",
                  sim=dict(mode="band", R=3500, z=(6550, 6800))),
}
NO_ANIM_TYPES = ("unclear", "candidate", "rain-triggered", "glacier/avalanche movement")


# ------------------------------------------------------------------ OpenStreetMap
def osm(cache, key, refresh):
    if key in cache and not refresh:
        return cache[key]
    if key.startswith("way/"):
        u = "https://nominatim.openstreetmap.org/lookup?" + urllib.parse.urlencode({"osm_ids": "W" + key[4:], "format": "jsonv2", "polygon_geojson": 1})
    else:
        u = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode({"q": key, "format": "jsonv2", "limit": 5, "countrycodes": "pk", "accept-language": "en"})
    time.sleep(1.1)
    ans = json.load(urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=40))
    cache[key] = ans
    return ans


def locate(rec, spec, cache, refresh):
    if spec["tier"] == "A":
        return float(rec["lon"]), float(rec["lat"]), {"source": "record"}
    if spec["tier"] == "E":
        return None
    if spec.get("osm"):
        a = osm(cache, spec["osm"], refresh)[0]
        c = a["geojson"]["coordinates"]
        end = max(c, key=lambda p: p[1]) if spec["end"] == "north" else min(c, key=lambda p: p[1])
        return end[0], end[1], {"source": "OpenStreetMap", "osm": spec["osm"], "name": spec["label"]}
    ans = osm(cache, spec["q"], refresh)
    hit = next((a for a in ans if spec["want"] in (a.get("type"), a.get("category"), a.get("addresstype"))), None)
    if not hit:
        raise SystemExit(f"{rec['event_id']}: no OSM '{spec['want']}' for {spec['q']!r}")
    return float(hit["lon"]), float(hit["lat"]), {"source": "OpenStreetMap", "osm": f"{hit['osm_type']}/{hit['osm_id']}", "name": hit["display_name"]}


# ------------------------------------------------------------------ DEM mosaic (local zoom-12 terrarium tiles)
def tx(lon): return (lon + 180) / 360 * (1 << Z)
def ty(lat): return (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * (1 << Z)


class Terrain:
    def __init__(self, lon, lat, half=2):
        cx, cy = int(tx(lon)), int(ty(lat))
        self.x0, self.y0 = cx - half, cy - half
        n = 2 * half + 1
        self.h = np.full((n * 256, n * 256), np.nan, np.float32)
        missing = 0
        for i in range(n):
            for j in range(n):
                p = DEM / str(self.x0 + i) / f"{self.y0 + j}.png"
                if not p.exists():
                    missing += 1; continue
                a = np.asarray(Image.open(p).convert("RGB"), np.float32)
                self.h[j * 256:(j + 1) * 256, i * 256:(i + 1) * 256] = a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768
        if missing:
            print(f"   ({missing} DEM tiles not on disk around {lon:.3f},{lat:.3f})")
        self.lon0, self.lat0 = lon, lat
        self.kx, self.ky = R_E * math.pi / 180 * math.cos(math.radians(lat)), R_E * math.pi / 180

    def ll(self, x, y): return self.lon0 + x / self.kx, self.lat0 + y / self.ky
    def xy(self, lon, lat): return (lon - self.lon0) * self.kx, (lat - self.lat0) * self.ky

    def px(self, x, y):
        lon, lat = self.ll(np.asarray(x, float), np.asarray(y, float))
        X = (lon + 180) / 360 * (1 << Z) * 256 - self.x0 * 256 - 0.5
        la = np.radians(lat)
        Y = (1 - np.log(np.tan(la) + 1 / np.cos(la)) / np.pi) / 2 * (1 << Z) * 256 - self.y0 * 256 - 0.5
        return X, Y

    def __call__(self, x, y):
        X, Y = self.px(x, y)
        x0, y0 = np.floor(X).astype(int), np.floor(Y).astype(int)
        fx, fy = X - x0, Y - y0
        H, W = self.h.shape
        ok = (x0 >= 0) & (y0 >= 0) & (x0 < W - 1) & (y0 < H - 1)
        x0c, y0c = np.clip(x0, 0, W - 2), np.clip(y0, 0, H - 2)
        h = self.h
        v = (h[y0c, x0c] * (1 - fx) + h[y0c, x0c + 1] * fx) * (1 - fy) + (h[y0c + 1, x0c] * (1 - fx) + h[y0c + 1, x0c + 1] * fx) * fy
        return np.where(ok, v, np.nan)

    def grad(self, x, y, e=40.0):
        return (self(x + e, y) - self(x - e, y)) / (2 * e), (self(x, y + e) - self(x, y - e)) / (2 * e)


# ------------------------------------------------------------------ sliding block (same model as avalanche.js, many starts at once)
def slide(T, x, y, record=False, dt=0.2, steps=2400):
    x, y = np.array(x, float), np.array(y, float)
    gx, gy = T.grad(x, y); m = np.hypot(gx, gy) + 1e-9
    vx, vy = -gx / m * 2, -gy / m * 2
    alive = np.isfinite(T(x, y))
    t = np.zeros_like(x); dist = np.zeros_like(x)
    tr = [] if record else None
    track = [(x.copy(), y.copy())]
    for _ in range(steps):
        if not alive.any():
            break
        z = T(x, y)
        gx, gy = T.grad(x, y); m = np.hypot(gx, gy) + 1e-9
        cos = 1 / np.sqrt(1 + m * m); sin = m * cos
        v = np.hypot(vx, vy)
        along = np.where(v > 0.01, -(gx * vx + gy * vy) / np.maximum(v, 1e-9), 0)
        if record:
            tr.append(dict(x=float(x[0]), y=float(y[0]), z=float(z[0]), t=float(t[0]), d=float(dist[0]), v=float(v[0] * math.sqrt(1 + along[0] ** 2))))
        ax, ay = -gx / m * G * sin * cos, -gy / m * G * sin * cos
        f = (MU * G * cos + G * v * v / (cos * cos) / XIH) * cos      # v is the map-plane speed; drag uses the speed along the slope
        mv = v > 0.01
        ax = np.where(mv, ax - vx / np.maximum(v, 1e-9) * f, ax); ay = np.where(mv, ay - vy / np.maximum(v, 1e-9) * f, ay)
        nvx, nvy = vx + ax * dt, vy + ay * dt
        stop = (nvx * vx + nvy * vy <= 0) | ((np.hypot(nvx, nvy) < 0.6) & (t > 4)) | ~np.isfinite(z) | (dist > 6500) | (t > 300)
        alive &= ~stop
        vx, vy = np.where(alive, nvx, 0), np.where(alive, nvy, 0)
        sx, sy = vx * dt, vy * dt
        x, y = x + sx, y + sy; dist += np.hypot(sx, sy); t += np.where(alive, dt, 0)
        track.append((x.copy(), y.copy()))
    if record:
        if tr:
            tr.append(dict(x=float(x[0]), y=float(y[0]), z=float(T(x, y)[0]), t=tr[-1]["t"] + dt, d=float(dist[0]), v=0.0))
        return tr
    return track


def headroom(T, X, Y):
    """How much higher the terrain rises within ~400 m of each cell: small = the cell is at the top of its slope, just under the
    ridge or peak where a slab breaks away (the crown), large = somewhere down the face."""
    top = np.full(len(X), -np.inf)
    for r in (130.0, 260.0, 400.0):
        for a in np.arange(0, 2 * np.pi, np.pi / 6):
            top = np.fmax(top, T(X + r * np.cos(a), Y + r * np.sin(a)))
    return np.maximum(0.0, top - T(X, Y))


def climb(T, x, y, step=20.0, max_m=1500.0):
    """Walk up the fall line from (x, y) while the slope is still avalanche terrain (>= 25 deg): the top of the start zone."""
    for _ in range(int(max_m / step)):
        gx, gy = T.grad(np.array([x]), np.array([y])); m = float(np.hypot(gx[0], gy[0]))
        if not (m >= math.tan(math.radians(25))):
            break
        nx, ny = x + gx[0] / m * step, y + gy[0] / m * step
        if not (T(np.array([nx]), np.array([ny]))[0] > T(np.array([x]), np.array([y]))[0]):
            break
        x, y = nx, ny
    return x, y


def ascend(T, x, y, step=20.0, max_m=6000.0, zmax=None):
    """Climb from (x, y) to the top of that mountain face: always towards the highest of 16 directions, looking 20, 60 and
    120 m ahead so small bumps of the 30 m DEM do not stop it, until nothing around is higher (the summit or the top of the
    ridge) or the elevation limit is reached. Returns the track, bottom first."""
    pts, z = [(x, y)], float(T(np.array([x]), np.array([y]))[0])
    ang = np.arange(0, 2 * np.pi, np.pi / 8)
    walked = 0.0
    while walked < max_m:
        best = None
        for r in (step, 3 * step, 6 * step):
            cx, cy = x + r * np.cos(ang), y + r * np.sin(ang)
            cz = T(cx, cy)
            if not np.isfinite(cz).any():
                continue
            j = int(np.nanargmax(cz))
            if cz[j] > z + 0.3 and (zmax is None or cz[j] <= zmax):
                best = (float(cx[j]), float(cy[j]), float(cz[j]), r)
                break                                         # the nearest look-ahead that still climbs
        if not best:
            break
        x, y, z, r = best; walked += r
        pts.append((x, y))
    return pts


def run_along(T, lx, ly, ds=4.0, mu=MU, xih=XIH, vmin=0.0):
    """The same sliding block (gravity, Coulomb + Voellmy friction) run along a fixed line: speeds and times for a path that
    starts at the summit and follows the fall line down."""
    lx, ly = np.asarray(lx, float), np.asarray(ly, float)
    c = np.concatenate([[0.0], np.cumsum(np.hypot(np.diff(lx), np.diff(ly)))])
    s = np.arange(0.0, c[-1], ds)
    X, Y = np.interp(s, c, lx), np.interp(s, c, ly)
    k = 6                                                   # smooth the 20 m climbing steps
    ker = np.ones(2 * k + 1) / (2 * k + 1)
    X = np.convolve(np.pad(X, k, mode="edge"), ker, "valid"); Y = np.convolve(np.pad(Y, k, mode="edge"), ker, "valid")
    Z = T(X, Y)
    v, t, d, out, loose = 2.0, 0.0, 0.0, [], True
    for i in range(len(s) - 1):
        out.append(dict(x=float(X[i]), y=float(Y[i]), z=float(Z[i]), t=t, d=d, v=v))
        h = math.hypot(X[i + 1] - X[i], Y[i + 1] - Y[i]); dz = float(Z[i + 1] - Z[i]); l = math.hypot(h, dz)
        if l < 1e-6 or not math.isfinite(dz):
            continue
        sin, cos = -dz / l, h / l
        if loose and sin > math.sin(math.radians(25)) and d > 40:
            loose = False                                   # the fracture has reached the steep face: from here on, physics only
        v2 = v * v + 2 * (G * sin - mu * G * cos - G * v * v / xih) * l
        if v2 <= 0.25 and not loose and not vmin:
            break                                           # friction has stopped it
        # breaking loose across the rounded summit cap: creeping, not stopped; vmin: a large avalanche's mass carried over benches
        vn = math.sqrt(max(v2, 1.0 if loose else vmin * vmin))
        t += l / max(0.5, (v + vn) / 2); d += h; v = vn
    if out:
        out.append(dict(x=float(X[len(out)]), y=float(Y[len(out)]), z=float(Z[len(out)]), t=t, d=d, v=0.0))
    return out


def peak_run(T, ax, ay, zT, R=4000.0, cell=45.0, top=12, near=2500.0, band=None, through=None):
    """The avalanche from the highest ground above the documented place (user request: break at the summit / ridge top and
    come down the big face below it). Peaks within R (higher than everything within ~90 m and at least 300 m above the
    place), highest first; from each, sliding blocks start 60 m below the top in 16 directions and run down the terrain by
    themselves (the fall line into the face or gully). Takes the highest peak whose run comes within `near` of the documented
    place (impact) or, with `band` = the record's elevation band (z0, z1), whose run starts above the band and comes down
    through it (and below `through`, if given), and from it the run with the biggest vertical drop. Returns (x, y) or None."""
    n = int(math.ceil(R / cell))
    gx = np.arange(-n, n + 1) * cell
    X, Y = np.meshgrid(gx + ax, gx + ay)
    Z = T(X.ravel(), Y.ravel()).reshape(X.shape)
    m = Z.shape[0]
    Zp = np.pad(np.where(np.isfinite(Z), Z, -np.inf), 2, constant_values=-np.inf)
    nbmax = np.max([Zp[2 + di:2 + di + m, 2 + dj:2 + dj + m] for di in range(-2, 3) for dj in range(-2, 3) if di or dj], axis=0)
    ok = np.isfinite(Z) & (Z >= nbmax) & (Z >= zT + 300 if band is None else Z >= band[1]) & (np.hypot(X - ax, Y - ay) <= R)
    peaks = sorted(np.argwhere(ok).tolist(), key=lambda p: -Z[p[0], p[1]])[:top]
    if not peaks:
        return None
    ang = np.arange(0, 2 * np.pi, np.pi / 8)
    SX = np.concatenate([X[i, j] + 60 * np.cos(ang) for i, j in peaks]); SY = np.concatenate([Y[i, j] + 60 * np.sin(ang) for i, j in peaks])
    PZ = np.repeat([Z[i, j] for i, j in peaks], len(ang))
    track = slide(T, SX, SY)
    PX = np.array([p[0] for p in track]); PY = np.array([p[1] for p in track])
    ze = T(PX[-1], PY[-1]); L = np.hypot(np.diff(PX, axis=0), np.diff(PY, axis=0)).sum(axis=0)
    if band is None:                                                        # impact: comes down towards the documented place
        good = np.isfinite(ze) & (L >= 600) & (np.hypot(PX - ax, PY - ay).min(axis=0) <= near)
    else:                                                                   # band: comes down through the record's elevation
        good = np.isfinite(ze) & (L >= 600) & (ze <= band[0])
        if through is not None:
            good &= ze <= through
    if not good.any():
        return None
    top_z = PZ[good].max()                                                  # the highest peak with a qualifying run
    score = np.where(good & (PZ >= top_z - 0.5), PZ - ze, -np.inf)          # ... and its run with the biggest drop
    k = int(np.argmax(score))
    return float(SX[k]), float(SY[k])

def route_down(T, sx, sy, ax, ay, cell=45.0):
    """A downhill route from (sx, sy) to the documented place (ax, ay): Dijkstra over a 45 m grid, moving only to cells not
    higher than the current one (5 m DEM noise allowed); steep steps are cheaper, so it follows faces, gullies and the valley.
    Returns the route (start first), smoothed over +-90 m, or None."""
    import heapq
    x0, x1 = min(sx, ax) - 1500, max(sx, ax) + 1500; y0, y1 = min(sy, ay) - 1500, max(sy, ay) + 1500
    gx, gy = np.arange(x0, x1 + cell, cell), np.arange(y0, y1 + cell, cell)
    X, Y = np.meshgrid(gx, gy); Z = T(X.ravel(), Y.ravel()).reshape(X.shape)
    ny_, nx_ = Z.shape
    si, sj = int(round((sy - y0) / cell)), int(round((sx - x0) / cell)); ti, tj = int(round((ay - y0) / cell)), int(round((ax - x0) / cell))
    dist = np.full(Z.shape, np.inf); prev = np.full(Z.shape + (2,), -1, int); dist[si, sj] = 0.0; pq = [(0.0, si, sj)]
    while pq:
        d, i, j = heapq.heappop(pq)
        if (i, j) == (ti, tj):
            break
        if d > dist[i, j]:
            continue
        for di in (-1, 0, 1):
            for dj in (-1, 0, 1):
                a, b = i + di, j + dj
                if (di or dj) and 0 <= a < ny_ and 0 <= b < nx_ and np.isfinite(Z[a, b]):
                    drop = Z[i, j] - Z[a, b]
                    if drop < -5:
                        continue
                    h = cell * math.hypot(di, dj)
                    c = h * (1 + 4.0 * (1 - min(1.0, max(0.0, drop) / h / 0.7)))
                    if d + c < dist[a, b]:
                        dist[a, b] = d + c; prev[a, b] = (i, j); heapq.heappush(pq, (d + c, a, b))
    if not np.isfinite(dist[ti, tj]):
        return None
    pts, (i, j) = [], (ti, tj)
    while i >= 0:
        pts.append((float(X[i, j]), float(Y[i, j]))); i, j = prev[i, j]
    pts.reverse()
    lx, ly = np.array([p[0] for p in pts]), np.array([p[1] for p in pts])
    c_ = np.concatenate([[0.0], np.cumsum(np.hypot(np.diff(lx), np.diff(ly)))]); s_ = np.arange(0.0, c_[-1] + 5, 10.0)
    Xs, Ys = np.interp(s_, c_, lx), np.interp(s_, c_, ly); k = 9; ker = np.ones(2 * k + 1) / (2 * k + 1)
    Xs = np.convolve(np.pad(Xs, k, mode="edge"), ker, "valid"); Ys = np.convolve(np.pad(Ys, k, mode="edge"), ker, "valid")
    Xs[0], Ys[0], Xs[-1], Ys[-1] = sx, sy, ax, ay
    return list(Xs), list(Ys)


def build_path(T, ev, spec, lon, lat):
    s = spec["sim"]
    ax, ay = T.xy(lon, lat)
    zT = float(T(np.array([ax]), np.array([ay]))[0])
    # candidate release cells on a ~45 m grid inside the search radius
    g = np.arange(-s["R"], s["R"] + 1, 45.0)
    X, Y = np.meshgrid(g + ax, g + ay); X, Y = X.ravel(), Y.ravel()
    keep = np.hypot(X - ax, Y - ay) <= s["R"]
    X, Y = X[keep], Y[keep]
    zc = T(X, Y); gx, gy = T.grad(X, Y); sl = np.degrees(np.arctan(np.hypot(gx, gy)))
    ok = np.isfinite(zc) & (sl >= 28) & (sl <= 55)
    if s["mode"] == "impact":
        ok &= zc >= zT + 200
    else:
        ok &= (zc >= s["z"][0]) & (zc <= s["z"][1])
    X, Y, zc, sl = X[ok], Y[ok], zc[ok], sl[ok]
    if len(X) == 0:
        return None, "no steep slope in the search area on the DEM"
    rs = np.random.default_rng(int(ev[2:]))
    if len(X) > 1800:
        top = np.argsort(-zc)[:300]
        idx = np.unique(np.concatenate([top, rs.choice(len(X), 1500, replace=False)]))
        X, Y, zc, sl = X[idx], Y[idx], zc[idx], sl[idx]
    track = slide(T, X, Y)
    PX = np.array([p[0] for p in track]); PY = np.array([p[1] for p in track])      # steps x candidates
    xe, ye = PX[-1], PY[-1]
    ze = T(xe, ye)
    L = np.zeros(len(X))
    L[:] = np.hypot(np.diff(PX, axis=0), np.diff(PY, axis=0)).sum(axis=0)
    good = np.isfinite(ze) & (L >= 250)
    if s["mode"] == "impact":
        D = np.hypot(PX - ax, PY - ay)
        ic = D.argmin(axis=0); dmin = D[ic, np.arange(len(X))]
        zc_at = T(PX[ic, np.arange(len(X))], PY[ic, np.arange(len(X))])
        good &= np.abs(zc_at - zT) <= 150          # it must reach the place at the place's own height, not pass above it on a cliff
        dend = np.hypot(xe - ax, ye - ay)
        for tol in (s["tol"], s["tol"] * 2):
            hit = good & (dmin <= tol)
            if hit.any():
                break
        else:
            return None, "no simulated slide on the DEM reaches the documented place"
        score = np.where(hit, (zc - zT) - 1.5 * np.maximum(0, dend - 350) - 0.15 * np.maximum(0, L - 3500), -np.inf)
    else:
        hit = good
        if "through" in s:
            hit &= ze <= s["through"]
        if not hit.any():
            return None, "no simulated slide from the documented elevation band"
        score = np.where(hit, (zc - ze) + 150 * ((sl >= 30) & (sl <= 45)), -np.inf)
    # Start at the top of the slope: among the runs that qualify, prefer those released just under the ridge (headroom <= 150 m),
    # and within them the ones with the least slope left above.
    hr = headroom(T, X, Y)
    crest = hit & (hr <= 150)
    if crest.any():
        score = np.where(crest, score, -np.inf)
    score = score - 1.2 * hr
    k = int(np.argmax(score))
    x0, y0, rel_sl = X[k:k + 1], Y[k:k + 1], float(sl[k])
    # Then climb the fall line from that cell to the crest (while the slope stays >= 25 deg) and release there instead, if the run
    # from the crest still reaches the documented place (impact) or stays in the documented band.
    cx, cy = climb(T, X[k], Y[k])
    if np.hypot(cx - X[k], cy - Y[k]) > 40:
        tr2 = slide(T, np.array([cx]), np.array([cy]), record=True)
        xs2, ys2 = np.array([p["x"] for p in tr2]), np.array([p["y"] for p in tr2])
        ok2 = len(tr2) > 5 and np.isfinite(tr2[-1]["z"])
        if ok2 and s["mode"] == "impact":
            d2 = np.hypot(xs2 - ax, ys2 - ay); j = int(d2.argmin())
            ok2 = d2[j] <= max(s["tol"], float(dmin[k]) + 100) and abs(tr2[j]["z"] - zT) <= 150   # as close to the place as before
        elif ok2:
            ok2 = tr2[0]["z"] <= s["z"][1] + 150 and ("through" not in s or tr2[-1]["z"] <= s["through"])
        if ok2:
            x0, y0 = np.array([cx]), np.array([cy])
    tr = slide(T, x0, y0, record=True)
    # Start at the peak (user request): climb from the release to the summit / highest point above it and run the avalanche down
    # the whole line (summit -> release -> the run). Kept only if it still reaches the documented place (impact) or does not stop
    # in the first half (band; the climb stays inside the record's elevation band).
    up_all = ascend(T, tr[0]["x"], tr[0]["y"], zmax=s["z"][1] + 50 if s["mode"] == "band" else None)
    d_orig = float(np.hypot(np.array([p["x"] for p in tr]) - ax, np.array([p["y"] for p in tr]) - ay).min())
    # from the summit first; if that run misses the place, from 3/4, 1/2 and 1/4 of the way up
    for frac in (1.0, 0.75, 0.5, 0.25):
        up = up_all[:max(1, int(round(len(up_all) * frac)))]
        if len(up) <= 2:
            break
        lx = [p[0] for p in reversed(up)] + [p["x"] for p in tr[1:]]
        ly = [p[1] for p in reversed(up)] + [p["y"] for p in tr[1:]]
        tr3 = run_along(T, lx, ly)
        total = float(np.hypot(np.diff(lx), np.diff(ly)).sum())
        ok3 = len(tr3) > 10
        if ok3 and s["mode"] == "impact":
            x3, y3 = np.array([p["x"] for p in tr3]), np.array([p["y"] for p in tr3])
            d3 = np.hypot(x3 - ax, y3 - ay); j = int(d3.argmin())
            ok3 = d3[j] <= max(s["tol"], d_orig + 100) and abs(tr3[j]["z"] - zT) <= 150
        elif ok3:
            ok3 = tr3[-1]["d"] >= 0.5 * total
        if ok3:
            tr = tr3
            x0, y0 = np.array([tr[0]["x"]]), np.array([tr[0]["y"]])
            break
    # Impact events: the avalanche breaks at the highest ground above the documented place and comes down the face below it by
    # itself (user request, with a sketch: start at the ridge top, fall down the big face). It does not have to end exactly at
    # the documented place any more; how close it comes is stored in place_dist_m and shown.
    # Band events (climbers hit at the elevation the record gives) likewise start at the highest point above and must come down
    # through that elevation (user request: every avalanche from the peak).
    if s["mode"] == "impact":
        st = peak_run(T, ax, ay, zT, R=min(s["R"], 4000.0))
    else:
        st = peak_run(T, ax, ay, zT, R=max(s["R"], 3000.0), band=s["z"], through=s.get("through"))
    if st:
        tr5 = slide(T, np.array([st[0]]), np.array([st[1]]), record=True)
        if len(tr5) > 10 and tr5[0]["z"] > tr[0]["z"]:
            tr = tr5
            x0, y0 = np.array([tr[0]["x"]]), np.array([tr[0]["y"]])
    # Per-event route to the documented place (user, with a sketch: Lowari Top - the debris must lie at the documented place): from
    # the summit start down a downhill route to the place, the mass kept moving (>= 6 m/s) over the flatter benches near the pass.
    carried = False
    if s.get("to_place") and s["mode"] == "impact":
        rd = route_down(T, tr[0]["x"], tr[0]["y"], ax, ay)
        if rd:
            tr6 = run_along(T, rd[0], rd[1], vmin=6.0)
            if len(tr6) > 10:
                tr, carried = tr6, True
                x0, y0 = np.array([tr[0]["x"]]), np.array([tr[0]["y"]])
    # slope of the start zone: the steepest ~100 m stretch in the first 500 m (where the slab breaks; the summit itself is flatter)
    ds_ = np.array([p["d"] for p in tr]); zs_ = np.array([p["z"] for p in tr]); best = None
    for i in range(len(tr)):
        if ds_[i] > 500:
            break
        j = int(np.searchsorted(ds_, ds_[i] + 100))
        if j < len(tr) and ds_[j] - ds_[i] > 30:
            a = math.degrees(math.atan((zs_[i] - zs_[j]) / (ds_[j] - ds_[i])))
            best = a if best is None else max(best, a)
    if best is not None:
        rel_sl = best
    # smooth the track over +-6 steps (the 30 m DEM gradient is noisy), as the browser engine does
    xs, ys = np.array([p["x"] for p in tr]), np.array([p["y"] for p in tr])
    sx, sy = xs.copy(), ys.copy()
    for i in range(2, len(tr) - 2):
        a, b = max(0, i - 6), min(len(tr), i + 7)
        sx[i], sy[i] = xs[a:b].mean(), ys[a:b].mean()
    pts = []
    for i, p in enumerate(tr):
        if i % 5 and i != len(tr) - 1:
            continue
        lo, la = T.ll(sx[i], sy[i])
        pts.append([round(lo, 6), round(la, 6), round(p["z"]), round(p["t"], 1), round(p["v"], 1)])
    rel = tr[0]
    gxr, gyr = T.grad(np.array([rel["x"]]), np.array([rel["y"]]))
    aspect = (math.degrees(math.atan2(-gxr[0], -gyr[0])) + 360) % 360       # direction the slope faces (downhill)
    res = dict(mode=s["mode"], release=dict(lon=pts[0][0], lat=pts[0][1], z=pts[0][2], slope_deg=round(rel_sl), aspect_deg=round(aspect),
                                            below_crest_m=round(float(headroom(T, x0, y0)[0]))),
               runout=dict(lon=pts[-1][0], lat=pts[-1][1], z=pts[-1][2]),
               length_m=round(tr[-1]["d"]), drop_m=round(tr[0]["z"] - tr[-1]["z"]), vmax_ms=round(max(p["v"] for p in tr), 1), duration_s=round(tr[-1]["t"], 1),
               path=pts, candidates=int(hit.sum()))
    if carried:
        res["route_to_place"] = "Route from the summit down to the documented place; the mass is kept moving (>= 6 m/s) over flatter benches."
    if s["mode"] == "impact":
        res["place_dist_m"] = round(float(np.hypot(xs - ax, ys - ay).min()))
        res["place_z"] = round(zT)
    return res, None


BATURA = ROOT / "static" / "history" / "batura_1974" / "3d"
BATURA_EXT = ROOT / "static" / "history" / "batura_1974" / "summit_extension.json"


def batura_extension():
    """Batura 1974 (NGT model reconstruction): the model's own path, times and speeds stay unchanged. At the user's request the
    tour starts the avalanche higher, at the peak above the model's release point: climb from the release to the top of that
    mountain (`ascend`) and run the same sliding block as the other tour paths back down that line to the release (`run_along`).
    Written to its own file; the tour prepends it to the model path and says so. Illustration, not part of the model."""
    rows = list(csv.DictReader((BATURA / "avalanche_path_with_time.csv").open(encoding="utf-8")))
    lon, lat = float(rows[0]["lon"]), float(rows[0]["lat"])
    T = Terrain(lon, lat)
    up = ascend(T, *T.xy(lon, lat))
    if len(up) < 3:
        BATURA_EXT.unlink(missing_ok=True)
        return
    line = list(reversed(up))
    # the slab breaks just under the summit, where the fall line first gets steep (>= 25 deg), not on the flat summit cap
    zl = T(np.array([p[0] for p in line]), np.array([p[1] for p in line]))
    for i in range(len(line) - 3):
        hh = math.hypot(line[i + 3][0] - line[i][0], line[i + 3][1] - line[i][1])
        if hh > 1 and (zl[i] - zl[i + 3]) / hh >= math.tan(math.radians(25)):
            line = line[i:]
            break
    tr = run_along(T, [p[0] for p in line], [p[1] for p in line])
    pts = []
    for i, p in enumerate(tr[:-1]):                       # the last point is the model's release itself
        if i % 5:
            continue
        lo, la = T.ll(p["x"], p["y"])
        pts.append([round(lo, 6), round(la, 6), round(p["z"]), round(p["t"], 1), round(p["v"], 1)])
    out = dict(note="Illustrative extension above the NGT model's release point (user request: start at the peak). Sliding block with "
                    "Voellmy-type friction (mu 0.20, xi*h 4000 m/s2) on the portal DEM, from the top of the mountain down the line to the model's "
                    "release. Not part of the NGT model: the model's own path, times and speeds follow unchanged.",
               peak_z=pts[0][2], release_z=round(float(rows[0]["elevation_m"])), duration_s=round(tr[-1]["t"], 1), arrive_ms=round(tr[-2]["v"], 1), path=pts)
    BATURA_EXT.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    print(f"Batura summit extension: {out['peak_z']} m -> model release {out['release_z']} m, {len(pts)} points, {out['duration_s']} s")


def main():
    refresh = "--refresh-osm" in sys.argv
    cache = json.loads(CACHE.read_text(encoding="utf-8")) if CACHE.exists() else {}
    rows = [r for r in csv.DictReader(SRC.open(encoding="utf-8")) if r["event_id"] not in EXCLUDED]
    feats, n_anim = [], 0
    for r in rows:
        ev = r["event_id"]
        spec = GEO.get(ev)
        if not spec:
            raise SystemExit(f"{ev}: no location rule in GEO")
        loc = locate(r, spec, cache, refresh)
        props = dict(r)
        props["loc"] = dict(tier=spec["tier"], note=spec["note"], **(loc[2] if loc else {}))
        anim, why = None, spec.get("anim")
        etype = r["event_type"].lower()
        if not why and any(k in etype for k in NO_ANIM_TYPES):
            why = "Not a documented snow / ice avalanche."
        if loc and not why and spec["tier"] in "ABC" and "sim" in spec:
            T = Terrain(loc[0], loc[1])
            anim, why = build_path(T, ev, spec, loc[0], loc[1])
        if not anim and not why:
            why = "Location known only as a valley or district." if spec["tier"] == "D" else "No usable location."
        if anim:
            n_anim += 1
            print(f"{ev} {spec['tier']} {anim['mode']:6} rel {anim['release']['z']:>5} m slope {anim['release']['slope_deg']}  "
                  f"L {anim['length_m']:>5} m  drop {anim['drop_m']:>5} m  vmax {anim['vmax_ms']:>5}  T {anim['duration_s']:>5} s"
                  + (f"  place {anim['place_dist_m']} m" if "place_dist_m" in anim else "") + f"  ({anim['candidates']} runs)")
        else:
            print(f"{ev} {spec['tier']} -- {why}")
        props["anim"] = anim
        props["anim_reason"] = why
        feats.append(dict(type="Feature", properties=props, geometry=dict(type="Point", coordinates=[round(loc[0], 6), round(loc[1], 6)]) if loc else None))
    CACHE.write_text(json.dumps(cache, ensure_ascii=False, indent=1), encoding="utf-8")
    meta = dict(source=SRC.name, records=len(rows), animated=n_anim,
                method="Release cells: 28-55 deg slopes on the portal DEM (Copernicus GLO-30 zoom 12, ~30 m) within the search radius; sliding block with "
                       "Voellmy-type friction (mu 0.20, xi*h 4000 m/s2, textbook defaults, not calibrated). impact = released at the highest ground "
                       "above the documented place (a peak within 4 km) and run down its own fall line; place_dist_m says how close it comes to the "
                       "place; band = release at the elevation given in the record. Illustrative: not the historical path.",
                geocoder="OpenStreetMap Nominatim (data (c) OpenStreetMap contributors, ODbL)", generated=time.strftime("%Y-%m-%d"))
    OUT.write_text(json.dumps(dict(type="FeatureCollection", metadata=meta, features=feats), ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{len(feats)} records, {n_anim} with an illustrative path -> {OUT.relative_to(ROOT)}")
    batura_extension()


if __name__ == "__main__":
    main()
