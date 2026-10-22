#!/usr/bin/env python3
"""
Build the tsunami forecast-region layer from JMA's published GIS data.

Source
------
気象庁 予報区等GISデータ 「津波予報区」
https://www.data.jma.go.jp/developer/gis.html
File: 20240520_AreaTsunami_GIS.zip (data date 2024-05-14, JGD2011)

Licence
-------
JMA content is published under 公共データ利用規約（第1.0版） — Japan's Public Data
Licence 1.0, which is CC BY 4.0 compatible. Redistribution and modification are
permitted with attribution; the derived data must state that it was modified.
The attribution string is embedded in `meta.attribution` and shown in the app.

What the source actually contains
---------------------------------
70 features, one per 津波予報区 (the geographic regions JMA uses when it issues
津波警報 / 津波注意報 / 津波予報). Geometry is a MultiLineString, but every part is a
*closed ring*: the region outline. There are 8.9 million vertices in total
(islet-by-islet detail), which is far too much to bundle, so this script:

  * treats each closed part as a polygon ring,
  * drops rings below `--min-area` (default 0.00035 deg² ≈ 3.5 km²) but always
    keeps a region's largest ring so no region disappears,
  * simplifies with Douglas–Peucker (`--tolerance`, default 0.004° ≈ 440 m),
  * rounds coordinates to 3 decimals and stores flat [lon,lat] pairs.

Four features carry code "0" (帰属未定1…4): the source itself marks these as
UNASSIGNED. They are deliberately excluded — inventing a code for them would be
fabricating an identifier that JMA did not issue.

This is a *forecast region* layer. It is not a coastline and it is not a
tsunami-inundation hazard zone; see docs/DATA_SOURCES.md.

Usage:  python3 scripts/build_tsunami_areas.py [--src <shapefile>] [--out <json>]
Requires: geopandas
"""
from __future__ import annotations

import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_OUT = os.path.join(HERE, "..", "src", "data", "tsunami-areas.json")

DATASET_URL = "https://www.data.jma.go.jp/developer/gis/20240520_AreaTsunami_GIS.zip"
DATASET_DATE = "2024-05-14"
LICENCE = "公共データ利用規約（第1.0版） / Public Data Licence 1.0 (CC BY 4.0 compatible)"
ATTRIBUTION = (
    "出典：気象庁ホームページ「予報区等GISデータ（津波予報区）」"
    "(https://www.data.jma.go.jp/developer/gis.html) を加工して作成"
)


def ring_area(coords) -> float:
    """Shoelace area in deg² — only used to rank/drop rings, never displayed."""
    s = 0.0
    for i in range(len(coords) - 1):
        x1, y1 = coords[i]
        x2, y2 = coords[i + 1]
        s += x1 * y2 - x2 * y1
    return abs(s) / 2.0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=None, help="津波予報区.shp (extracted from the zip)")
    ap.add_argument("--out", default=DEFAULT_OUT)
    ap.add_argument("--tolerance", type=float, default=0.004)
    ap.add_argument("--min-area", type=float, default=0.00035)
    args = ap.parse_args()

    import geopandas as gpd
    from shapely.geometry import Polygon

    if args.src is None:
        print("error: --src is required (extract 20240520_AreaTsunami_GIS.zip first)")
        return 2

    gdf = gpd.read_file(args.src)
    # The DBF strings are UTF-8 that the driver reports as latin-1.
    for col in ("name", "namekana"):
        if col in gdf.columns:
            gdf[col] = gdf[col].map(
                lambda s: s.encode("latin-1", "ignore").decode("utf-8", "ignore") if isinstance(s, str) else s
            )

    regions = []
    skipped_unassigned = 0
    dropped_rings = 0
    for _, row in gdf.iterrows():
        code = str(row["code"]).strip()
        name = str(row["name"]).strip()
        if not code.isdigit() or int(code) == 0:
            # JMA marks these "帰属未定" (unassigned) — no stable identifier exists.
            skipped_unassigned += 1
            continue

        geom = row["geometry"]
        parts = list(getattr(geom, "geoms", [geom]))
        scored = []
        for part in parts:
            coords = list(part.coords)
            if len(coords) < 4:
                continue
            if coords[0] != coords[-1]:
                coords.append(coords[0])
            scored.append((ring_area(coords), coords))
        scored.sort(key=lambda t: t[0], reverse=True)

        rings = []
        for idx, (area, coords) in enumerate(scored):
            if idx > 0 and area < args.min_area:
                dropped_rings += 1
                continue
            poly = Polygon(coords).buffer(0).simplify(args.tolerance, preserve_topology=False)
            if poly.is_empty:
                continue
            polys = list(getattr(poly, "geoms", [poly]))
            for p in polys:
                if p.geom_type != "Polygon" or p.is_empty:
                    continue
                ring = [[round(x, 3), round(y, 3)] for x, y in p.exterior.coords]
                if len(ring) >= 4:
                    rings.append(ring)

        if not rings:
            print(f"  ! {code} {name}: no rings survived")
            continue
        regions.append({"code": int(code), "name": name, "rings": rings})

    regions.sort(key=lambda r: r["code"])

    payload = {
        "meta": {
            "layer": "jma-tsunami-forecast-regions",
            "source": "気象庁 予報区等GISデータ「津波予報区」",
            "sourceUrl": "https://www.data.jma.go.jp/developer/gis.html",
            "datasetFile": DATASET_URL,
            "datasetDate": DATASET_DATE,
            "crs": "JGD2011 (EPSG:6668) — WGS84-compatible for display",
            "licence": LICENCE,
            "attribution": ATTRIBUTION,
            "generator": "scripts/build_tsunami_areas.py",
            "processing": (
                f"closed boundary rings -> polygons; rings smaller than {args.min_area} deg² dropped "
                f"(largest ring per region always kept); Douglas-Peucker tolerance {args.tolerance} deg; "
                "coordinates rounded to 3 decimals"
            ),
            "note": (
                "JMA tsunami FORECAST REGIONS (津波予報区), i.e. the areas a 津波警報/注意報 is issued for. "
                "Not a coastline. Not a tsunami inundation hazard zone. "
                "Modified from the source; see attribution."
            ),
            "excluded": "コード0（帰属未定1〜4）は識別子が存在しないため収録していません。",
        },
        "regions": regions,
    }

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, separators=(",", ":"), sort_keys=False)

    pts = sum(len(r) for reg in regions for r in reg["rings"])
    rings_n = sum(len(reg["rings"]) for reg in regions)
    print(
        f"wrote {args.out}  {os.path.getsize(args.out)/1024:.0f} KiB  "
        f"{len(regions)} regions, {rings_n} rings, {pts} points "
        f"(dropped {dropped_rings} small rings, {skipped_unassigned} unassigned features)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
