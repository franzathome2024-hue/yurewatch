import rawMap from '../data/japan-map.json';
import { project, type Point } from './geo';

/**
 * Map geometry, built once at startup from `src/data/japan-map.json`
 * (Natural Earth 1:10m, public domain — see docs/DATA_SOURCES.md).
 *
 * Rings are projected to Web-Mercator world units here so the renderer can draw
 * them with a single canvas transform and no per-frame projection cost.
 */

export interface RawRingMap {
  meta: { source: string; sourceUrl: string; bounds: [number, number, number, number]; note: string };
  prefectures: Array<{ code: string; name: string; rings: number[][][] }>;
  land: Array<{ name: string; rings: number[][][] }>;
}

export interface Shape {
  /** Interleaved [x0,y0,x1,y1,…] in world units. */
  points: Float64Array;
  /** Ring bounding box in world units. */
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
  /** Representative label position (largest ring's centroid). */
  label: Point;
  /** Approximate area in world units², used to decide whether to label. */
  area: number;
}

export interface PrefectureGeometry extends Shape {
  code: string;
  name: string;
  rings: Shape[];
}

export interface MapGeometry {
  meta: RawRingMap['meta'];
  prefectures: PrefectureGeometry[];
  land: Shape[];
  byCode: Map<string, PrefectureGeometry>;
  byName: Map<string, PrefectureGeometry>;
  /** Whole-Japan bounding box in world units. */
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
}

function ringArea(points: Float64Array): number {
  let sum = 0;
  const n = points.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = points[i * 2]!;
    const yi = points[i * 2 + 1]!;
    const xj = points[j * 2]!;
    const yj = points[j * 2 + 1]!;
    sum += xj * yi - xi * yj;
  }
  return Math.abs(sum / 2);
}

function ringCentroid(points: Float64Array): Point {
  let a = 0;
  let cx = 0;
  let cy = 0;
  const n = points.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = points[i * 2]!;
    const yi = points[i * 2 + 1]!;
    const xj = points[j * 2]!;
    const yj = points[j * 2 + 1]!;
    const cross = xj * yi - xi * yj;
    a += cross;
    cx += (xj + xi) * cross;
    cy += (yj + yi) * cross;
  }
  if (Math.abs(a) < 1e-12) {
    // Degenerate ring: fall back to the mean of its vertices.
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < n; i++) {
      sx += points[i * 2]!;
      sy += points[i * 2 + 1]!;
    }
    return { x: sx / n, y: sy / n };
  }
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

function buildShape(rings: number[][][]): { shape: Shape; rings: Shape[] } {
  const shapes: Shape[] = [];
  for (const ring of rings) {
    if (ring.length < 4) continue;
    const pts = new Float64Array(ring.length * 2);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < ring.length; i++) {
      const [lon, lat] = ring[i]!;
      const p = project({ lon: lon as number, lat: lat as number });
      pts[i * 2] = p.x;
      pts[i * 2 + 1] = p.y;
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    shapes.push({
      points: pts,
      bbox: { minX, minY, maxX, maxY },
      label: ringCentroid(pts),
      area: ringArea(pts),
    });
  }
  shapes.sort((a, b) => b.area - a.area);
  const dominant = shapes[0];
  const union = shapes.reduce(
    (acc, s) => ({
      minX: Math.min(acc.minX, s.bbox.minX),
      minY: Math.min(acc.minY, s.bbox.minY),
      maxX: Math.max(acc.maxX, s.bbox.maxX),
      maxY: Math.max(acc.maxY, s.bbox.maxY),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );
  const shape: Shape = {
    points: dominant?.points ?? new Float64Array(0),
    bbox: union,
    label: dominant?.label ?? { x: 0, y: 0 },
    area: shapes.reduce((a, s) => a + s.area, 0),
  };
  return { shape, rings: shapes };
}

export function buildGeometry(json: RawRingMap = rawMap as unknown as RawRingMap): MapGeometry {
  const prefectures: PrefectureGeometry[] = json.prefectures.map((p) => {
    const { shape, rings } = buildShape(p.rings);
    return { ...shape, rings, code: p.code, name: p.name };
  });
  const land = json.land.map((l) => buildShape(l.rings).shape);

  const bbox = prefectures.reduce(
    (acc, p) => ({
      minX: Math.min(acc.minX, p.bbox.minX),
      minY: Math.min(acc.minY, p.bbox.minY),
      maxX: Math.max(acc.maxX, p.bbox.maxX),
      maxY: Math.max(acc.maxY, p.bbox.maxY),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );

  return {
    meta: json.meta,
    prefectures,
    land,
    byCode: new Map(prefectures.map((p) => [p.code, p])),
    byName: new Map(prefectures.map((p) => [p.name, p])),
    bbox,
  };
}

/** Lazy singleton — the JSON import is bundled, building takes ~5 ms. */
let cached: MapGeometry | null = null;
export function geometry(): MapGeometry {
  if (!cached) cached = buildGeometry();
  return cached;
}
