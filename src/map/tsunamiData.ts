import raw from '../data/tsunami-areas.json';
import { project } from './geo';

/**
 * JMA tsunami forecast regions (津波予報区) — a dedicated map layer.
 *
 * This is NOT a coastline and NOT a tsunami inundation hazard zone. It is the
 * set of geographic regions the Japan Meteorological Agency uses when it issues
 * 津波警報 / 津波注意報 / 津波予報, derived from JMA's own published GIS data
 * (予報区等GISデータ「津波予報区」, dataset date 2024-05-14, JGD2011) under Japan's
 * Public Data Licence 1.0. Provenance, processing and attribution are stored in
 * `meta` and surfaced in the app; see docs/DATA_SOURCES.md.
 *
 * The layer only ever highlights regions that the *current* tsunami bulletin
 * names. Nothing is inferred from an earthquake's location.
 */

interface RawRing {
  [i: number]: [number, number];
  length: number;
}

interface RawFile {
  meta: {
    layer: string;
    source: string;
    sourceUrl: string;
    datasetDate: string;
    licence: string;
    attribution: string;
    processing: string;
    note: string;
  };
  regions: Array<{ code: number; name: string; rings: number[][][] }>;
}

export interface TsunamiRegionShape {
  /** Closed rings in interleaved world-space [x0,y0,x1,y1,…]. */
  rings: Float64Array[];
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
}

export interface TsunamiRegion extends TsunamiRegionShape {
  code: number;
  name: string;
}

export interface TsunamiLayer {
  meta: RawFile['meta'];
  regions: TsunamiRegion[];
  byCode: Map<number, TsunamiRegion>;
  /** Normalised name → region, for matching bulletin area names. */
  byName: Map<string, TsunamiRegion>;
}

/**
 * Name normalisation for matching bulletin areas to region geometry.
 *
 * JMA issues bulletins by region *name* (P2PQuake relays those names verbatim),
 * so the join key is the name, not the code. Full-width/half-width differences,
 * stray spaces and the common 「沿岸」 suffix variants are normalised so a
 * harmless formatting difference does not silently drop a highlight. Anything
 * that still does not match is counted and disclosed rather than guessed.
 */
export function normalizeAreaName(name: string): string {
  return name
    .normalize('NFKC')
    .replace(/[\s\u3000]/g, '')
    .replace(/[・･]/g, '')
    .trim();
}

let cached: TsunamiLayer | null = null;

export function tsunamiLayer(): TsunamiLayer {
  if (cached) return cached;
  const file = raw as unknown as RawFile;
  const regions: TsunamiRegion[] = [];
  const byCode = new Map<number, TsunamiRegion>();
  const byName = new Map<string, TsunamiRegion>();

  for (const region of file.regions) {
    const rings: Float64Array[] = [];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const ring of region.rings) {
      const pts = new Float64Array(ring.length * 2);
      for (let i = 0; i < ring.length; i += 1) {
        const pair = ring[i] as unknown as [number, number];
        const p = project({ lon: pair[0], lat: pair[1] });
        pts[i * 2] = p.x;
        pts[i * 2 + 1] = p.y;
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
      if (pts.length >= 8) rings.push(pts);
    }
    if (!rings.length) continue;
    const shape: TsunamiRegion = { code: region.code, name: region.name, rings, bbox: { minX, minY, maxX, maxY } };
    regions.push(shape);
    byCode.set(region.code, shape);
    byName.set(normalizeAreaName(region.name), shape);
  }

  cached = { meta: file.meta, regions, byCode, byName };
  return cached;
}

/** Test hook: drops the memoised geometry. */
export function __resetTsunamiLayerForTests(): void {
  cached = null;
}

/**
 * Largest regions first, so a broad region is painted before a narrow one that
 * sits on top of it (Seto Inland Sea subregions, bay-specific regions).
 */
export function matchRegionsByName(names: string[]): { matched: TsunamiRegion[]; unmatched: string[] } {
  const layer = tsunamiLayer();
  const matched: TsunamiRegion[] = [];
  const unmatched: string[] = [];
  const seen = new Set<number>();
  for (const name of names) {
    const region = layer.byName.get(normalizeAreaName(name));
    if (!region) {
      unmatched.push(name);
      continue;
    }
    if (!seen.has(region.code)) {
      seen.add(region.code);
      matched.push(region);
    }
  }
  matched.sort((a, b) => area(a) - area(b));
  return { matched, unmatched };
}

function area(r: TsunamiRegion): number {
  return (r.bbox.maxX - r.bbox.minX) * (r.bbox.maxY - r.bbox.minY);
}
