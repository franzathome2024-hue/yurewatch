#!/usr/bin/env python3
"""
Build the app's Japan map geometry from Natural Earth (public domain) data.

Inputs (downloaded automatically, ~20 MB, not committed):
  ne_10m_admin_1_states_provinces  -> Japan's 47 prefectures (name_ja, iso_3166_2)
  ne_10m_admin_0_countries         -> neighbouring land + coastlines for context

Output:
  src/data/japan-map.json   compact ring arrays, lon/lat rounded to 3 decimals

Why this data: Natural Earth is public domain (no share-alike, no attribution
required), which keeps the new project's licence clean. The reference project's
own map is derived from JMA 予報区等GISデータ (see docs/REFERENCE_INSPECTION.md),
whose terms we do not inherit; we therefore rebuild the basemap ourselves.

Usage:  python3 scripts/build_map_data.py [--out src/data/japan-map.json]
Requires: geopandas, shapely  (pip install geopandas)
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.request
import zipfile

NE = "https://naciscdn.org/naturalearth/10m/cultural/"
CACHE = os.path.join(os.path.dirname(__file__), ".naturalearth")
BOUNDS = (127.5, 24.0, 148.0, 46.5)  # lon_min, lat_min, lon_max, lat_max

SOURCES = {
    "ne_10m_admin_1_states_provinces": ("shp", 0.006),
    "ne_10m_admin_0_countries": ("shp", 0.018),
}


def fetch(name: str) -> str:
    os.makedirs(CACHE, exist_ok=True)
    shp = os.path.join(CACHE, name + ".shp")
    if os.path.exists(shp):
        return shp
    url = NE + name + ".zip"
    zpath = os.path.join(CACHE, name + ".zip")
    print(f"downloading {url}")
    urllib.request.urlretrieve(url, zpath)
    with zipfile.ZipFile(zpath) as zf:
        zf.extractall(CACHE)
    return shp


def rings(geom, tolerance: float):
    """Simplify + clip a geometry, return list of [ [lon,lat], ... ] rings."""
    from shapely.geometry import MultiPolygon, Polygon, box
    from shapely.ops import unary_union

    if geom is None or geom.is_empty:
        return []
    geom = geom.buffer(0)
    geom = geom.simplify(tolerance, preserve_topology=True)
    geom = geom.intersection(box(*BOUNDS))
    if geom.is_empty:
        return []
    if isinstance(geom, Polygon):
        polys = [geom]
    elif isinstance(geom, MultiPolygon):
        polys = list(geom.geoms)
    else:
        polys = [p for p in getattr(unary_union(geom), "geoms", []) if isinstance(p, Polygon)]
    out = []
    for poly in polys:
        if poly.area < 1e-5:  # drop sub-pixel slivers
            continue
        ext = [[round(x, 3), round(y, 3)] for x, y in poly.exterior.coords]
        if len(ext) >= 4:
            out.append(ext)
        # inner rings (lakes/bays) are dropped: at this scale they add noise only
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "src", "data", "japan-map.json"))
    args = ap.parse_args()

    import geopandas as gpd

    print("loading admin_1 (prefectures)…")
    adm1 = gpd.read_file(fetch("ne_10m_admin_1_states_provinces"))
    jp = adm1[adm1["admin"] == "Japan"].copy()

    # JMA names prefectures 東京都 / 北海道 / 大阪府 / 京都府 ; Natural Earth has these
    # in name_ja, with a couple of gaps -> fall back through name_local / name.
    def jname(row):
        for key in ("name_ja", "name_local", "name"):
            val = row.get(key)
            if isinstance(val, str) and val.strip():
                return val.strip()
        return row["iso_3166_2"]

    prefectures = []
    for _, row in jp.iterrows():
        code = str(row["iso_3166_2"]).replace("JP-", "")
        prefectures.append(
            {
                "code": code,
                "name": jname(row),
                "rings": rings(row["geometry"], SOURCES["ne_10m_admin_1_states_provinces"][1]),
            }
        )
    prefectures.sort(key=lambda p: p["code"])
    prefectures = [p for p in prefectures if p["rings"]]
    print(f"prefectures: {len(prefectures)}")

    print("loading admin_0 (context land)…")
    adm0 = gpd.read_file(fetch("ne_10m_admin_0_countries"))
    neighbours = []
    for _, row in adm0.iterrows():
        if row.get("ADMIN") == "Japan":
            continue
        r = rings(row["geometry"], SOURCES["ne_10m_admin_0_countries"][1])
        if r:
            neighbours.append({"name": row.get("ADMIN"), "rings": r})
    print(f"neighbour countries intersecting bbox: {len(neighbours)}")

    payload = {
        "meta": {
            "source": "Natural Earth 1:10m (public domain) - ne_10m_admin_1_states_provinces, ne_10m_admin_0_countries",
            "sourceUrl": "https://www.naturalearthdata.com/",
            "bounds": BOUNDS,
            "generator": "scripts/build_map_data.py",
            "note": "Coastlines simplified for display. Not for navigation or measurement.",
        },
        "prefectures": prefectures,
        "land": neighbours,
    }

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, separators=(",", ":"))
    size = os.path.getsize(args.out)
    pts = sum(len(r) for p in prefectures for r in p["rings"]) + sum(
        len(r) for n in neighbours for r in n["rings"]
    )
    print(f"wrote {args.out}  {size/1024:.0f} KiB  ({pts} points)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
