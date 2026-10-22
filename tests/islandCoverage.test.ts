import { describe, expect, it } from 'vitest';
import rawMap from '../src/data/japan-map.json';
import { project, unproject } from '../src/map/geo';
import { buildGeometry } from '../src/map/mapData';
import { profileBounds, profileRect } from '../src/map/framing';

/**
 * Milestone 2 — geographic data audit.
 *
 * These tests exist because the basemap silently lost four inhabited island
 * groups for three releases: `BOUNDS` in scripts/build_map_data.py clipped at
 * 127.5 °E, so Miyakojima, Ishigakijima, Iriomote and Yonaguni were cut out of
 * the shipped JSON while `meta.note` blamed Natural Earth for not carrying them.
 * Natural Earth 1:10m does carry all four. Nothing failed, because nothing
 * checked. Everything below is a check that would have failed then.
 */

type Ring = number[][];
interface Feature {
  code: string;
  name: string;
  rings: Ring[];
}
interface MapFile {
  meta: {
    bounds: number[];
    geometryBounds: number[];
    sources: Array<{
      id: string;
      dataset: string;
      url: string;
      licence: string;
      dataDate?: string;
      roles: string[];
      attribution?: string;
    }>;
    coverage: {
      islandsAdded: Array<{ prefecture: string; areaKm2: number; bbox: number[]; vertices: number }>;
      ringsReattributed: Array<{ from: string; to: string; bbox: number[] }>;
    };
    note: string;
  };
  prefectures: Feature[];
}

const MAP = rawMap as unknown as MapFile;
const GEO = buildGeometry(rawMap as never);

/** Sample points taken from GSI maps, not derived from the data under test. */
const ISLANDS: Array<{ name: string; lon: number; lat: number; prefecture: string }> = [
  { name: '宮古島 Miyakojima', lon: 125.281, lat: 24.805, prefecture: '47' },
  { name: '石垣島 Ishigakijima', lon: 124.19, lat: 24.4, prefecture: '47' },
  { name: '西表島 Iriomote', lon: 123.78, lat: 24.36, prefecture: '47' },
  { name: '与那国島 Yonaguni', lon: 123.0, lat: 24.46, prefecture: '47' },
  { name: '波照間島 Hateruma', lon: 123.78, lat: 24.06, prefecture: '47' },
  { name: '竹富島 Taketomi', lon: 124.09, lat: 24.33, prefecture: '47' },
  { name: '奄美大島 Amami Ōshima', lon: 129.4, lat: 28.3, prefecture: '46' },
  { name: '徳之島 Tokunoshima', lon: 128.98, lat: 27.75, prefecture: '46' },
  { name: '与論島 Yoron', lon: 128.43, lat: 27.04, prefecture: '46' },
  { name: '沖縄本島 Okinawa main island', lon: 127.95, lat: 26.5, prefecture: '47' },
];

function pointInRing(lon: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i] as [number, number];
    const [xj, yj] = ring[j] as [number, number];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function containingPrefectures(lon: number, lat: number): string[] {
  return MAP.prefectures
    .filter((p) =>
      p.rings.some((ring) => {
        const xs = ring.map((pt) => pt[0] as number);
        const ys = ring.map((pt) => pt[1] as number);
        return (
          Math.min(...xs) <= lon &&
          lon <= Math.max(...xs) &&
          Math.min(...ys) <= lat &&
          lat <= Math.max(...ys) &&
          pointInRing(lon, lat, ring)
        );
      }),
    )
    .map((p) => p.code);
}

describe('island coverage', () => {
  for (const island of ISLANDS) {
    it(`contains ${island.name} and attributes it to prefecture ${island.prefecture}`, () => {
      expect(containingPrefectures(island.lon, island.lat)).toEqual([island.prefecture]);
    });
  }

  it('does not leave the Amami group inside Okinawa', () => {
    // Natural Earth's admin-1 layer puts Amami Ōshima, Kakeroma, Tokunoshima,
    // Kikaijima and Yoron in JP-47. They belong to Kagoshima (JP-46); the build
    // re-assigns them using MLIT N03, and this keeps that fixed if the Natural
    // Earth layer is ever refreshed.
    // N03 leaves a handful of unnamed rocks (e.g. 128.24 E / 27.86 N) unassigned,
    // so a bbox-only rule would either fail on them or hide a real regression.
    // Anything an island-sized ring is a claim about inhabited land, and those
    // must be Kagoshima's.
    const okinawa = MAP.prefectures.find((p) => p.code === '47')!;
    const northern = okinawa.rings.filter((ring) => {
      const pts = ring as Array<[number, number]>;
      const lat = Math.min(...pts.map((pt) => pt[1]));
      const lon = Math.min(...pts.map((pt) => pt[0]));
      const span = Math.max(
        Math.max(...pts.map((pt) => pt[0])) - lon,
        Math.max(...pts.map((pt) => pt[1])) - lat,
      );
      return lat > 27.2 && span > 0.03; // >~3 km across, i.e. an actual island
    });
    expect(northern).toEqual([]);
  });

  it('keeps Ogasawara with Tōkyō rather than the Ryūkyū prefectures', () => {
    // Chichijima is a ~24 km² island at 142.2 E / 27.1 N, 1,000 km from the
    // mainland. Its ring must stay in 13 (Tōkyō) and must not be swallowed by
    // the Sakishima tests above or dropped by the remote-islet framing rule.
    const tokyo = MAP.prefectures.find((p) => p.code === '13')!;
    const chichijima = tokyo.rings.filter((ring) => {
      const pts = ring as Array<[number, number]>;
      return (
        Math.min(...pts.map((pt) => pt[0])) > 142.1 &&
        Math.min(...pts.map((pt) => pt[1])) > 27.0 &&
        Math.max(...pts.map((pt) => pt[1])) < 27.15
      );
    });
    expect(chichijima.length).toBeGreaterThan(0);
    for (const pref of MAP.prefectures) {
      if (pref.code === '13') continue;
      // Hokkaidō legitimately owns Kunashiri/Shikotan out at 145-146 E, so the
      // check is scoped to the subtropical band.
      const stray = pref.rings.some((ring) => {
        const pts = ring as Array<[number, number]>;
        return Math.min(...pts.map((pt) => pt[0])) > 142.0 && Math.min(...pts.map((pt) => pt[1])) < 30;
      });
      expect(stray).toBe(false);
    }
  });
});

describe('geometry bounds and clipping', () => {
  it('keeps every vertex inside the declared clip window', () => {
    const [west, south, east, north] = MAP.meta.bounds as [number, number, number, number];
    for (const pref of MAP.prefectures) {
      for (const ring of pref.rings) {
        for (const [lon, lat] of ring as Array<[number, number]>) {
          expect(lon).toBeGreaterThanOrEqual(west);
          expect(lon).toBeLessThanOrEqual(east);
          expect(lat).toBeGreaterThanOrEqual(south);
          expect(lat).toBeLessThanOrEqual(north);
        }
      }
    }
  });

  it('declares the measured extent, not the clip window', () => {
    const lons: number[] = [];
    const lats: number[] = [];
    for (const pref of MAP.prefectures) {
      for (const ring of pref.rings) {
        for (const [lon, lat] of ring as Array<[number, number]>) {
          lons.push(lon);
          lats.push(lat);
        }
      }
    }
    const measured = [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)].map(
      (v) => Math.round(v * 1000) / 1000,
    );
    expect(MAP.meta.geometryBounds).toEqual(measured);
    // The extent must actually reach the Sakishima group.
    expect(measured[0]!).toBeLessThan(123.1);
    expect(measured[1]!).toBeLessThan(24.2);
  });

  it('leaves no ring cut along the clip edge', () => {
    // A vertex sitting exactly on the window edge is a clip artefact: the
    // coastline would end in a ruled line. None of the Japanese land in these
    // sources lies on these exact meridians/parallels.
    const [west, south, east, north] = MAP.meta.bounds as [number, number, number, number];
    const eps = 1e-9;
    const clipped: string[] = [];
    MAP.prefectures.forEach((pref) => {
      pref.rings.forEach((ring, index) => {
        for (const [lon, lat] of ring as Array<[number, number]>) {
          if (
            Math.abs(lon - west) < eps ||
            Math.abs(lon - east) < eps ||
            Math.abs(lat - south) < eps ||
            Math.abs(lat - north) < eps
          ) {
            clipped.push(`pref:${pref.code}:${index}`);
            break;
          }
        }
      });
    });
    expect(clipped).toEqual([]);
  });

  it('keeps the bundle inside the documented size budget', () => {
    // The single-file build inlines this file; docs/DATA_SOURCES.md quotes the
    // budget so a future dataset swap cannot quietly double the download.
    const bytes = JSON.stringify(rawMap).length;
    expect(bytes).toBeLessThan(420 * 1024);
  });
});

describe('ring validity', () => {
  it('has no duplicate, degenerate or repeated-point rings', () => {
    const seen = new Set<string>();
    MAP.prefectures.forEach((pref) => {
      pref.rings.forEach((ring, index) => {
        expect(ring.length, `pref:${pref.code}:${index}`).toBeGreaterThanOrEqual(3);
        for (let i = 1; i < ring.length; i += 1) {
          expect(ring[i]).not.toEqual(ring[i - 1]);
        }
        // Rings are stored open; the renderer closes them.
        expect(ring[0]).not.toEqual(ring[ring.length - 1]);
        const key = ring.map((pt) => pt.join(',')).sort().join(';');
        expect(seen.has(key), `duplicate ring at pref:${pref.code}:${index}`).toBe(false);
        seen.add(key);
      });
    });
  });

  it('never lets a ring cross itself', () => {
    const orient = (a: number[], b: number[], c: number[]) =>
      Math.sign((b[0]! - a[0]!) * (c[1]! - a[1]!) - (b[1]! - a[1]!) * (c[0]! - a[0]!));
    const crosses = (a: number[], b: number[], c: number[], d: number[]) => {
      const o1 = orient(a, b, c);
      const o2 = orient(a, b, d);
      const o3 = orient(c, d, a);
      const o4 = orient(c, d, b);
      return o1 !== o2 && o3 !== o4 && o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0;
    };
    let checked = 0;
    for (const pref of MAP.prefectures) {
      for (const ring of pref.rings) {
        const n = ring.length;
        if (n < 9) continue;
        for (let i = 0; i < n; i += 1) {
          for (let j = i + 2; j < n; j += 1) {
            if (i === 0 && j === n - 1) continue;
            const hit = crosses(
              ring[i] as number[],
              ring[(i + 1) % n] as number[],
              ring[j] as number[],
              ring[(j + 1) % n] as number[],
            );
            if (hit) throw new Error(`self-intersection in ${pref.name} ring at ${i}/${j}`);
            checked += 1;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });
});

describe('projection', () => {
  it('round-trips every island through project/unproject', () => {
    for (const { name, lon, lat } of ISLANDS) {
      const back = unproject(project({ lon, lat }));
      expect(Math.abs(back.lon - lon), `${name} lon`).toBeLessThan(1e-9);
      expect(Math.abs(back.lat - lat), `${name} lat`).toBeLessThan(1e-9);
    }
  });

  it('projects Sakishima west of Okinawa and south of it', () => {
    // A sign error in mercator x would put Yonaguni east of Hokkaidō, and a
    // containment-only test would never notice.
    const yonaguni = project({ lon: 123.0, lat: 24.46 });
    const naha = project({ lon: 127.68, lat: 26.21 });
    const sapporo = project({ lon: 141.35, lat: 43.06 });
    expect(yonaguni.x).toBeLessThan(naha.x);
    expect(naha.x).toBeLessThan(sapporo.x);
    expect(yonaguni.y).toBeGreaterThan(naha.y); // world Y grows southwards
  });
});

describe('framing profiles declare their coverage', () => {
  it('archipelago reaches the Sakishima group, mainland stops at Kyūshū', () => {
    const wide = profileBounds(GEO, 'archipelago');
    const mainland = profileBounds(GEO, 'mainland');
    expect(wide.west).toBeLessThan(123.1);
    expect(wide.south).toBeLessThan(24.2);
    expect(mainland.south).toBeGreaterThan(29.9);
    expect(mainland.west).toBeGreaterThan(128);
  });

  it('both profiles produce an ordered rectangle', () => {
    for (const profile of ['mainland', 'archipelago'] as const) {
      const rect = profileRect(GEO, profile);
      expect(rect.maxX).toBeGreaterThan(rect.minX);
      expect(rect.maxY).toBeGreaterThan(rect.minY);
    }
  });
});

describe('provenance', () => {
  it('names both sources with a licence and an as-of date', () => {
    const ids = MAP.meta.sources.map((s) => s.id);
    expect(ids).toContain('natural-earth-10m');
    expect(ids).toContain('mlit-n03-2025');
    for (const source of MAP.meta.sources) {
      expect(source.licence.length).toBeGreaterThan(8);
      expect(source.roles.length).toBeGreaterThan(0);
    }
    // Public Data Licence 1.0 wants an attribution and a modification notice.
    const n03 = MAP.meta.sources.find((s) => s.id === 'mlit-n03-2025')!;
    expect(n03.dataDate).toBe('2025-01-01');
    expect(n03.attribution).toContain('国土数値情報');
  });

  it('records what the augmentation added', () => {
    const { islandsAdded, ringsReattributed } = MAP.meta.coverage;
    expect(islandsAdded.length).toBeGreaterThanOrEqual(10);
    for (const island of islandsAdded) {
      expect(island.areaKm2).toBeGreaterThanOrEqual(5);
      expect(island.vertices).toBeGreaterThanOrEqual(4);
      expect(['46', '47']).toContain(island.prefecture);
    }
    // The Amami-group rings were shipped as Okinawa by Natural Earth; N03 moves
    // them to Kagoshima. Six rings today: Amami Ōshima, Kakeroma, Tokunoshima,
    // Kikaijima, Okinoerabu and Yoron.
    expect(ringsReattributed.length).toBeGreaterThanOrEqual(5);
    const yoron = ringsReattributed.some(
      (move) => move.bbox[0]! < 128.45 && move.bbox[0]! > 128.35 && move.bbox[1]! < 27.05,
    );
    expect(yoron, 'Yoron (128.40-128.46 E) must be reassigned to Kagoshima').toBe(true);
    for (const move of ringsReattributed) {
      expect(move.from).toBe('47');
      expect(move.to).toBe('46');
    }
  });

  it('does not describe the basemap as hazard data', () => {
    expect(MAP.meta.note).toMatch(/no hazard|Basemap/i);
    expect(MAP.meta.note).not.toMatch(/hazard zone|inundation area|intensity zone/i);
  });
});
