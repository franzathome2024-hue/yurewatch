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
BUILD_DATE = "2026-10-22"  # retrieval date recorded in the shipped metadata
# Japan's own geometry: every prefecture ring Natural Earth holds inside this box.
# Bounds are a *stated coverage claim* — tools/map-qa.mjs asserts that everything
# inside them is reachable, and src/map/framing.ts asserts that whatever a framing
# profile includes is never cropped at the canvas edge.
# The west edge used to be 127.5 E, which cut off everything west of Okinawa
# island: Miyakojima, Ishigakijima, Iriomote and Yonaguni are all in Natural
# Earth 1:10m, but sat outside the clip box and were silently dropped (and the
# metadata blamed the source for it). The box now clears Yonaguni (122.94 E) and
# Hateruma (24.05 N).
BOUNDS = (122.5, 23.5, 148.0, 46.5)  # lon_min, lat_min, lon_max, lat_max

# Neighbouring countries are a backdrop, not coverage. They are clipped well
# outside the camera's pan limits (118..158 E, 20..52 N) so the sea never ends
# in a straight vertical line partway across the map — the old box cut China off
# at 127.5 E, which was visible as a ruled edge inside the viewport.
CONTEXT_BOUNDS = (114.0, 16.0, 162.0, 56.0)

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

# --------------------------------------------------------------------------- #
# Southern Ryūkyū augmentation — MLIT 国土数値情報 N03 行政区域
# --------------------------------------------------------------------------- #
# Natural Earth 1:10m carries the four big Sakishima islands (once the clip box
# stops cutting them off) but not the rest of the group: 18 islands of 5 km² or
# more in Okinawa and Kagoshima prefectures have no Natural Earth polygon at all
# (measured against N03-2025). Rather than swap the whole basemap for a 600 MB
# national dataset — which would put a 1:25,000 coastline next to a 1:10m one,
# the dual-shoreline problem documented in docs/DATA_SOURCES.md §2c — the build
# merges only the polygons Natural Earth is missing for those two prefectures.
#
# Licence: 公共データ利用規約（第1.0版）, the same terms as the bundled JMA
# tsunami regions; attribution and a modification statement are required and are
# carried in meta.sources, in the info panel and in the map attribution line.
N03_VERSION = "N03-2025"
N03_DATE = "2025-01-01"  # 時点 (as-of date stated by MLIT)
N03_ZIP = "https://nlftp.mlit.go.jp/ksj/gml/data/N03/N03-2025/N03-20250101_{code}_GML.zip"
N03_URL = "https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N03-v3_1.html"
N03_LICENCE = "公共データ利用規約（第1.0版）"
N03_PREFECTURES = ("46", "47")  # Kagoshima, Okinawa — the two with measured gaps
# Islands smaller than this are not worth a ring: 5 km² is ~0.00044 deg², which
# at the default archipelago framing is under two pixels, and below the detail
# the 1:10m basemap draws anyway.
N03_MIN_ISLAND_KM2 = 5.0
# A Natural Earth ring that overlaps this much of an N03 island is the same
# landmass (Natural Earth's own generalisation is ~1 km, so small buffer).
N03_OVERLAP_KEEP = 0.2
# Same simplification as the Natural Earth prefectures, so the added islands do
# not look sharper than the coastline they sit next to.
N03_TOLERANCE = 0.0015
KM2_PER_DEG2 = 111.32 * 102.2  # at ~30 deg N; only used for thresholds/logging


def _overlap(poly, tree, parts) -> float:
    """Area of `poly` covered by the N03 municipal polygons indexed by `tree`."""
    total = 0.0
    for idx in tree.query(poly):
        total += poly.intersection(parts[int(idx)]).area
    return total


def fetch_n03(code: str):
    """Download and read one prefecture's N03 administrative-area polygons."""
    import geopandas as gpd

    os.makedirs(CACHE, exist_ok=True)
    zpath = os.path.join(CACHE, f"N03-20250101_{code}_GML.zip")
    shp = os.path.join(CACHE, f"N03-20250101_{code}.shp")
    if not os.path.exists(shp):
        if not os.path.exists(zpath):
            url = N03_ZIP.format(code=code)
            print(f"downloading {url}")
            urllib.request.urlretrieve(url, zpath)
        with zipfile.ZipFile(zpath) as zf:
            for member in zf.namelist():
                if member.endswith((".shp", ".shx", ".dbf", ".prj")):
                    with open(os.path.join(CACHE, os.path.basename(member)), "wb") as fh:
                        fh.write(zf.read(member))
    return gpd.read_file(shp)


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


def rings(geom, tolerance: float, bounds=None, snap: bool = False):
    """Simplify + clip a geometry, return list of [ [lon,lat], ... ] rings."""
    from shapely.geometry import MultiPolygon, Polygon, box
    from shapely.ops import unary_union

    if geom is None or geom.is_empty:
        return []
    geom = geom.buffer(0)
    geom = geom.simplify(tolerance, preserve_topology=True)
    # Snap to the 3-decimal grid the file is written at, instead of rounding each
    # vertex afterwards. Independent rounding moves the two ends of an edge
    # differently and can make them cross; on the 5-20 km² islands from N03 that
    # turned valid polygons into bow-ties (two islands were dropped before this).
    # Only the N03-derived rings need this. Snap-to-grid collapses islets smaller
    # than the grid, and Natural Earth's coastline rounds cleanly without it —
    # applying it everywhere cost 11 context-land rings and 3 Ogasawara rocks.
    if snap:
        try:
            from shapely import set_precision

            geom = set_precision(geom, 10 ** -3)
        except Exception as exc:  # older shapely, or a geometry GEOS cannot snap
            print(f"  warning: set_precision skipped ({exc})", file=sys.stderr)
    geom = geom.intersection(box(*(bounds or BOUNDS)))
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
        ext = _round_ring(poly, poly.exterior.coords, "island")
        if len(ext) >= 3 and abs(_ring_area(ext)) >= MIN_ISLAND_AREA:
            out.append(ext)
        # Interior rings are kept as separate closed rings. The renderer fills
        # with the even-odd/composite rule, so a hole drawn inside its parent ring
        # punches back through to the ocean colour. Dropping them (as v0.1 did)
        # turned every lake and closed bay into land.
        for inner in poly.interiors:
            hole = _round_ring(poly, inner.coords, "hole")
            if len(hole) >= 3 and abs(_ring_area(hole)) >= MIN_HOLE_AREA:
                out.append(hole)
    return out


def _round_ring(poly, coords, kind: str, dp: int = 3):
    """Round a ring to `dp` decimals, stepping to 4 dp if that breaks topology.

    Small islands are the problem: 0.001 deg is ~100 m, and the 5-20 km² islands
    merged from N03 have features at that scale, so rounding at 3 dp can make two
    edges cross and turn a valid polygon into a bow-tie. Rather than ship an
    invalid ring (or silently drop the island), those rings keep one more decimal.
    """
    from shapely.geometry import Polygon

    for precision in (dp, 4):
        ring = [[round(x, precision), round(y, precision)] for x, y in coords]
        # Drop consecutive duplicates introduced by rounding (zero-length edges).
        dedup = [ring[0]] if ring else []
        for pt in ring[1:]:
            if pt != dedup[-1]:
                dedup.append(pt)
        # Rings are stored open, so a triangle is three points, not four.
        if len(dedup) >= 3:
            closed = dedup if dedup[0] == dedup[-1] else dedup + [dedup[0]]
        else:
            continue
        if Polygon(closed).is_valid:
            # Files store open rings; the renderer closes them. Keeping the
            # repeated last vertex here produced rings whose first and last
            # point were identical — wasted bytes, and a trap for any consumer
            # that measures ring length.
            return dedup[:-1] if dedup[0] == dedup[-1] else dedup
    print(f"  warning: dropped an invalid {kind} ring near {coords[0]}", file=sys.stderr)
    return []


def _ring_area(ring) -> float:
    s = 0.0
    for i in range(len(ring) - 1):
        x1, y1 = ring[i]
        x2, y2 = ring[i + 1]
        s += x1 * y2 - x2 * y1
    return s / 2.0


def _measured_bounds(prefectures):
    """Actual lon/lat extent of the shipped prefecture rings.

    `bounds` is the *clip box*; before this was separated, the metadata
    advertised the clip box as if it were the geometry, so 148 E and 24.0 N
    looked like real coordinates when the easternmost point is 145.8 E.
    """
    xs = [pt[0] for p in prefectures for ring in p["rings"] for pt in ring]
    ys = [pt[1] for p in prefectures for ring in p["rings"] for pt in ring]
    if not xs:
        return BOUNDS
    return [round(min(xs), 3), round(min(ys), 3), round(max(xs), 3), round(max(ys), 3)]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "src", "data", "japan-map.json"))
    args = ap.parse_args()

    import geopandas as gpd
    from shapely.geometry import Polygon
    from shapely.ops import unary_union

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

    # ---------------------------------------------------------------- N03 ----
    # Two jobs, both measured against the authoritative 行政区域 polygons:
    #   a) fix prefecture attribution, because Natural Earth puts the Amami
    #      group (28.1-28.5 N, 129.1-129.7 E) inside Okinawa;
    #   b) add the islands Natural Earth does not carry at 1:10m.
    print("loading N03 (administrative areas, prefectures 46/47)…")
    from shapely import STRtree

    n03_geom = {}
    n03_parts = {}
    n03_tree = {}
    for code in N03_PREFECTURES:
        gdf = fetch_n03(code)
        parts = list(gdf.geometry.values)
        # An STRtree lets the attribution step test a ring against the ~9,000
        # municipal polygons only where it actually is. The obvious alternative
        # (buffer the dissolved prefecture and intersect) allocates a multi-
        # hundred-megabyte geometry per comparison and the build gets OOM-killed.
        n03_tree[code] = STRtree(parts)
        n03_parts[code] = parts
        geom = unary_union(parts).buffer(0)
        n03_geom[code] = geom
        parts = list(geom.geoms) if geom.geom_type.startswith("Multi") else [geom]
        verts = sum(len(p.exterior.coords) for p in parts)
        print(f"  N03 {code}: {len(gdf)} municipal polygons -> {len(parts)} land parts, {verts} vertices (as of {N03_DATE})")

    by_code = {p["code"]: p for p in prefectures}

    reattributed = []
    for code in N03_PREFECTURES:
        others = [c for c in N03_PREFECTURES if c != code]
        src, dst = by_code.get(code), by_code.get(others[0]) if others else None
        if not src or not dst:
            continue
        keep = []
        for ring in src["rings"]:
            poly = Polygon(ring).buffer(0.01)  # absorbs ~1 km Natural Earth offset
            # Overlap, not a single probe point: a probe can land in a bay of the
            # generalised ring (Okinoerabujima did) and leave the island under the
            # wrong prefecture.
            overlap_other = _overlap(poly, n03_tree[others[0]], n03_parts[others[0]])
            overlap_own = _overlap(poly, n03_tree[code], n03_parts[code])
            # Compare against the unbuffered area: the buffer is only there to
            # absorb Natural Earth's ~1 km offset, so using the inflated area as
            # the threshold left the marginal islands (与論島, 20 km²) behind.
            if overlap_other > overlap_own and overlap_other > Polygon(ring).area * 0.5:
                dst["rings"].append(ring)
                reattributed.append((code, others[0], ring))
            else:
                keep.append(ring)
        src["rings"] = keep
    for frm, to, ring in reattributed:
        xs = [pt[0] for pt in ring]
        ys = [pt[1] for pt in ring]
        print(f"  reassigned ring {min(xs):.2f}-{max(xs):.2f} E {min(ys):.2f}-{max(ys):.2f} N: prefecture {frm} -> {to} (N03 attribution)")

    # Which island polygons does the basemap not have at all?
    basemap = unary_union([Polygon(ring) for p in prefectures for ring in p["rings"]])
    basemap = basemap.buffer(0.01)  # absorbs ~1 km of Natural Earth generalisation

    added = []
    for code in N03_PREFECTURES:
        target = by_code.get(code)
        if not target:
            continue
        geom = n03_geom[code]
        parts = list(geom.geoms) if geom.geom_type.startswith("Multi") else [geom]
        for part in parts:
            if part.area * KM2_PER_DEG2 < N03_MIN_ISLAND_KM2:
                continue
            if part.intersection(basemap).area / part.area >= N03_OVERLAP_KEEP:
                continue
            new_rings = rings(part, N03_TOLERANCE, snap=True)
            if not new_rings:
                continue
            # Drop Natural Earth rings this island replaces. NE carries some of
            # these islands as a few-point speck that overlaps the N03 outline;
            # keeping both draws two coastlines a few hundred metres apart.
            shell = Polygon(new_rings[0])
            target["rings"] = [
                ring
                for ring in target["rings"]
                if Polygon(ring).intersection(shell).area <= Polygon(ring).area * 0.5
            ]
            target["rings"].extend(new_rings)
            added.append((code, part, sum(len(r) for r in new_rings)))

    added.sort(key=lambda t: -t[1].area)
    for code, part, n in added:
        b = part.bounds
        print(f"  + prefecture {code}: island {part.area * KM2_PER_DEG2:6.1f} km² at {b[0]:.2f}-{b[2]:.2f} E {b[1]:.2f}-{b[3]:.2f} N ({n} vertices)")
    print(f"  N03: {sum(n for _, _, n in added)} vertices added for {len(added)} islands")

    for p in prefectures:
        p["rings"].sort(key=lambda r: -abs(_ring_area(r)))

    print("loading admin_0 (context land)…")
    adm0 = gpd.read_file(fetch("ne_10m_admin_0_countries"))
    neighbours = []
    for _, row in adm0.iterrows():
        if row.get("ADMIN") == "Japan":
            continue
        r = rings(row["geometry"], SOURCES["ne_10m_admin_0_countries"][1], CONTEXT_BOUNDS)
        if r:
            neighbours.append({"name": row.get("ADMIN"), "rings": r})
    print(f"neighbour countries intersecting bbox: {len(neighbours)}")

    payload = {
        "meta": {
            "source": "Natural Earth 1:10m (public domain) - ne_10m_admin_1_states_provinces, ne_10m_admin_0_countries; plus 国土数値情報（行政区域）N03-2025 for islands Natural Earth 1:10m does not carry",
            "sourceUrl": "https://www.naturalearthdata.com/",
            # Provenance per source: dataset, version, as-of date, licence and the
            # role it plays here. Anything the UI says about the basemap must be
            # traceable to one of these entries.
            "sources": [
                {
                    "id": "natural-earth-10m",
                    "dataset": "Natural Earth 1:10m — ne_10m_admin_1_states_provinces, ne_10m_admin_0_countries",
                    "url": "https://www.naturalearthdata.com/",
                    "retrieved": BUILD_DATE,
                    "licence": "Public domain — no attribution required, no share-alike",
                    "roles": ["47 prefecture polygons", "neighbouring land for context"],
                },
                {
                    "id": "mlit-n03-2025",
                    "dataset": "国土数値情報（行政区域）N03-2025 — prefectures 46 (鹿児島県) and 47 (沖縄県)",
                    "url": N03_URL,
                    "download": N03_ZIP.format(code="{code}"),
                    "version": N03_VERSION,
                    "dataDate": N03_DATE,
                    "retrieved": BUILD_DATE,
                    "licence": N03_LICENCE,
                    "attribution": "出典：国土数値情報（行政区域）を加工して作成",
                    "roles": [
                        f"{len(added)} islands that Natural Earth 1:10m does not carry (>= {N03_MIN_ISLAND_KM2:.0f} km²)",
                        f"prefecture attribution check — {len(reattributed)} rings moved between prefectures",
                    ],
                    "processing": (
                        "municipal polygons dissolved to prefecture, restricted to the islands absent from the "
                        f"Natural Earth basemap, Douglas-Peucker {N03_TOLERANCE} deg, rounded to 3 decimals"
                    ),
                },
            ],
            "bounds": BOUNDS,
            "contextBounds": CONTEXT_BOUNDS,
            "geometryBounds": _measured_bounds(prefectures),
            "generator": "scripts/build_map_data.py",
            "processing": (
                "Natural Earth 1:10m admin-1 (Japan) and admin-0 (neighbours) simplified with "
                f"Douglas-Peucker ({SOURCES['ne_10m_admin_1_states_provinces'][1]} deg prefectures, "
                f"{SOURCES['ne_10m_admin_0_countries'][1]} deg neighbours); islands >= {MIN_ISLAND_AREA} deg² kept; "
                f"interior rings (lakes) >= {MIN_HOLE_AREA} deg² kept; coordinates rounded to 3 decimals."
            ),
            "coverage": {
                "islandsAdded": [
                    {
                        "prefecture": code,
                        "areaKm2": round(part.area * KM2_PER_DEG2, 1),
                        "bbox": [round(v, 3) for v in part.bounds],
                        "vertices": n,
                    }
                    for code, part, n in added
                ],
                "ringsReattributed": [
                    {
                        "from": frm,
                        "to": to,
                        "bbox": [
                            round(min(pt[0] for pt in ring), 3),
                            round(min(pt[1] for pt in ring), 3),
                            round(max(pt[0] for pt in ring), 3),
                            round(max(pt[1] for pt in ring), 3),
                        ],
                    }
                    for frm, to, ring in reattributed
                ],
            },
            "note": (
                "Basemap only: land and administrative outlines for orientation. It carries no hazard, intensity "
                "or impact meaning. Natural Earth 1:10m is a generalised product (~1 km median offset against a "
                "1:25,000 coastline). Islands that Natural Earth 1:10m does not carry — "
                f"{len(added)} islands of {N03_MIN_ISLAND_KM2:.0f} km² and above in Kagoshima and Okinawa — come "
                "from 国土数値情報（行政区域）N03-2025 (data date 2025-01-01) and are simplified to the same "
                f"tolerance; islets below {N03_MIN_ISLAND_KM2:.0f} km² appear only where Natural Earth draws them. "
                "Not for navigation or measurement."
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
