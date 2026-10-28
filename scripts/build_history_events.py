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
GEO = {
    "PK014": dict(tier="C", q="Shispare", want="peak", note="Shispare summit (OpenStreetMap). Camp II is not published; the path is placed near 5,700 m on the peak, as the record says.",
                  sim=dict(mode="band", R=4500, z=(5550, 5900))),
    "PK027": dict(tier="A", note="Epicentral area given in the record. No avalanche is documented for this earthquake.", anim="No avalanche documented (earthquake candidate)."),
    "PK001": dict(tier="A", note="Coordinates from the HiAVAL database (as in the record).", sim=dict(mode="impact", R=5000, tol=350)),
    "PK015": dict(tier="B", q="Behrain", want="town", note="Bahrain (Behrain) town, Swat (OpenStreetMap).", sim=dict(mode="impact", R=5000, tol=350)),
    "PK036": dict(tier="E", note="Village not named in the source."),
    "PK016": dict(tier="B", q="Lowari Pass", want="mountain_pass", note="Lowari Pass (OpenStreetMap). The record says the Chitral side; the exact road position is not given.",
                  sim=dict(mode="impact", R=4500, tol=450)),
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
    k = int(np.argmax(score))
    tr = slide(T, X[k:k + 1], Y[k:k + 1], record=True)
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
    res = dict(mode=s["mode"], release=dict(lon=pts[0][0], lat=pts[0][1], z=pts[0][2], slope_deg=round(float(sl[k])), aspect_deg=round(aspect)),
               runout=dict(lon=pts[-1][0], lat=pts[-1][1], z=pts[-1][2]),
               length_m=round(tr[-1]["d"]), drop_m=round(tr[0]["z"] - tr[-1]["z"]), vmax_ms=round(max(p["v"] for p in tr), 1), duration_s=round(tr[-1]["t"], 1),
               path=pts, candidates=int(hit.sum()))
    if s["mode"] == "impact":
        res["place_dist_m"] = round(float(np.hypot(PX[:, k] - ax, PY[:, k] - ay).min()))
        res["place_z"] = round(zT)
    return res, None


def main():
    refresh = "--refresh-osm" in sys.argv
    cache = json.loads(CACHE.read_text(encoding="utf-8")) if CACHE.exists() else {}
    rows = list(csv.DictReader(SRC.open(encoding="utf-8")))
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
                       "Voellmy-type friction (mu 0.20, xi*h 4000 m/s2, textbook defaults, not calibrated). impact = the run that reaches the documented "
                       "place with the largest drop; band = release at the elevation given in the record. Illustrative: not the historical path.",
                geocoder="OpenStreetMap Nominatim (data (c) OpenStreetMap contributors, ODbL)", generated=time.strftime("%Y-%m-%d"))
    OUT.write_text(json.dumps(dict(type="FeatureCollection", metadata=meta, features=feats), ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{len(feats)} records, {n_anim} with an illustrative path -> {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
