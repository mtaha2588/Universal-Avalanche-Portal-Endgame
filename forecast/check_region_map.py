"""
check_region_map.py - draws every forecast tile coloured by its region (user request, Step 1)
================================================================================================
Run from the forecast/ folder: python check_region_map.py
Writes output/region_check_map.png. Uses the live region rule in forecast_core.region()
(config/regions.json), so this always shows exactly what the forecast will use.
"""
import os
import sys

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import forecast_core as fc  # noqa: E402

COLORS = {"Hindu Kush": "#22d3ee", "Karakoram": "#ef4444", "West Himalaya": "#22c55e"}

tt = pd.read_csv(os.path.join(HERE, "data", "tile_thresholds.csv"))
ll = tt.tile_id.str.extract(r"N([\d.]+)_E([\d.]+)").astype(float)
tt["lat"], tt["lon"] = ll[0], ll[1]
tt["region"] = [fc.region(la, lo) for la, lo in zip(tt.lat, tt.lon)]

r = fc._regions()  # noqa: SLF001 - just reading the live boundary values to draw reference lines

fig, ax = plt.subplots(figsize=(9, 8), dpi=150)
for name, col in COLORS.items():
    g = tt[tt.region == name]
    ax.scatter(g.lon, g.lat, s=130, marker="s", c=col, edgecolors="#0b1220", linewidths=0.6,
               label=f"{name}  ({len(g)} tiles)", zorder=3)

ax.axvline(r["lon_hindu_kush_max"], color="#94a3b8", ls="--", lw=1, zorder=1)
ax.axvline(r["lon_karakoram_min"], color="#94a3b8", ls="--", lw=1, zorder=1)
ax.axhline(r["lat_split"], color="#94a3b8", ls="--", lw=1, zorder=1)
trans = ax.get_xaxis_transform()        # x in data coords, y in axes-fraction: labels always land inside the plot
ax.text(r["lon_hindu_kush_max"], 1.01, f'lon={r["lon_hindu_kush_max"]}', fontsize=8, color="#64748b", transform=trans, ha="center")
ax.text(r["lon_karakoram_min"], 1.01, f'lon={r["lon_karakoram_min"]}', fontsize=8, color="#64748b", transform=trans, ha="center")
ax.text(0.01, r["lat_split"], f'lat={r["lat_split"]}', fontsize=8, color="#64748b",
        transform=ax.get_yaxis_transform(), va="bottom")

ax.set_facecolor("#0b1220")
fig.patch.set_facecolor("#ffffff")
ax.set_xlabel("longitude"); ax.set_ylabel("latitude")
ax.set_title(f"Alert forecast tiles by region -- {len(tt)} tiles total (config/regions.json)")
ax.legend(loc="lower left", framealpha=0.95)
ax.set_aspect("equal")
fig.tight_layout()

out = os.path.join(HERE, "output", "region_check_map.png")
fig.savefig(out)
print(f"wrote {out}")
print(tt.groupby("region").size().to_string())
assert tt.region.notna().all() and set(tt.region) <= set(COLORS), "every tile must get exactly one of the 3 regions"
print("OK: every tile got exactly one of the 3 regions")
