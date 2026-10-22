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

# Simplification tolerance per source, in degrees. The previous build used 0.006
# (~660 m) for prefectures, which visibly cut corners off bays and peninsulas once
# the map was zoomed. 0.0015 (~165 m) keeps an order of magnitude more shape while
# staying well inside Natural Earth's own 1:10m generalisation error — refining
# past this point would only add vertices, not accuracy.
SOURCES = {
    "ne_10m_admin_1_states_provinces": ("shp", 0.0015),
    "ne_10m_admin_0_countries": ("shp", 0.008),
}

# Islands smaller than this (deg²) are dropped; ~1e-6 deg² ≈ 0.01 km², i.e. a
# ~100 m islet — enough to keep harbour breakwaters out without losing real
# islands. The previous threshold (1e-5) discarded ~7 islands.
MIN_ISLAND_AREA = 1e-6

# Interior rings (lakes, calderas, deep bays that close) above this area are kept
# so Lake Biwa, Lake Saroma and similar features are not filled in as land.
MIN_HOLE_AREA = 2e-5


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
        if poly.area < MIN_ISLAND_AREA:
            continue
        ext = [[round(x, 3), round(y, 3)] for x, y in poly.exterior.coords]
        if len(ext) >= 4:
            out.append(ext)
        # Interior rings are kept as separate closed rings. The renderer fills
        # with the even-odd/composite rule, so a hole drawn inside its parent ring
        # punches back through to the ocean colour. Dropping them (as v0.1 did)
        # turned every lake and closed bay into land.
        for inner in poly.interiors:
            hole = [[round(x, 3), round(y, 3)] for x, y in inner.coords]
            if len(hole) >= 4 and abs(_ring_area(hole)) >= MIN_HOLE_AREA:
                out.append(hole)
    return out


def _ring_area(ring) -> float:
    s = 0.0
    for i in range(len(ring) - 1):
        x1, y1 = ring[i]
        x2, y2 = ring[i + 1]
        s += x1 * y2 - x2 * y1
    return s / 2.0


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
            "processing": (
                "Natural Earth 1:10m admin-1 (Japan) and admin-0 (neighbours) simplified with "
                f"Douglas-Peucker ({SOURCES['ne_10m_admin_1_states_provinces'][1]} deg prefectures, "
                f"{SOURCES['ne_10m_admin_0_countries'][1]} deg neighbours); islands >= {MIN_ISLAND_AREA} deg² kept; "
                f"interior rings (lakes) >= {MIN_HOLE_AREA} deg² kept; coordinates rounded to 3 decimals."
            ),
            "note": (
                "Coastline detail is limited by the source: Natural Earth 1:10m holds only ~160 polygon parts for "
                "Japan, so small islands and fine harbour detail are absent at high zoom. Not for navigation or measurement."
            ),
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
