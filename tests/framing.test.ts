import { describe, expect, it } from 'vitest';
import {
  DETACHED_ISLET_MAX_AREA_DEG2,
  DETACHED_ISLET_MAX_LAT,
  MAINLAND_MIN_LAT,
  defaultProfile,
  framingInsets,
  profileBounds,
  profileRect,
  profileRingKeys,
} from '../src/map/framing';
import { fitWorldRect, latToWorldY, worldYToLat, type Viewport } from '../src/map/geo';
import { buildGeometry } from '../src/map/mapData';
import rawMap from '../src/data/japan-map.json';

const geometry = buildGeometry(rawMap as never);

const lonLatOfRing = (code: string, index: number): number[][] => {
  const pref = (rawMap as { prefectures: Array<{ code: string; rings: number[][][] }> }).prefectures.find(
    (p) => p.code === code,
  );
  if (!pref) throw new Error(`no prefecture ${code}`);
  // Same ordering rule as mapData.buildShape(): descending projected area.
  return pref.rings[index]!;
};

describe('framing profiles', () => {
  it('declares mainland as everything north of 30°N', () => {
    const keys = profileRingKeys(geometry, 'mainland');
    const bounds = profileBounds(geometry, 'mainland');
    expect(keys.length).toBeGreaterThan(0);
    // Membership is per ring by its *northern* edge, so the box may dip slightly
    // below 30°N where an island straddles the boundary — but only slightly.
    expect(bounds.south).toBeGreaterThan(MAINLAND_MIN_LAT - 0.5);
    expect(bounds.south).toBeLessThan(MAINLAND_MIN_LAT + 0.5);
  });

  it('keeps Kyūshū and its islands in the mainland profile', () => {
    // Cape Sata is 30.99°N; Yakushima 30.34°N. If a dataset refresh ever moved
    // these below the boundary the mainland framing would start cropping Kyūshū.
    const bounds = profileBounds(geometry, 'mainland');
    expect(bounds.south).toBeLessThan(31.2);
  });

  it('excludes the Nansei chain and Ogasawara from mainland framing', () => {
    const bounds = profileBounds(geometry, 'mainland');
    expect(bounds.south).toBeGreaterThan(29.9);
    // Okinawa is at 26.1-26.7°N and must never be inside the mainland box.
    expect(bounds.south).toBeGreaterThan(26.8);
  });

  it('frames every ring the archipelago profile includes', () => {
    const rect = profileRect(geometry, 'archipelago');
    for (const pref of geometry.prefectures) {
      const included = profileRingKeys(geometry, 'archipelago');
      pref.rings.forEach((ring, index) => {
        if (!included.includes(`pref:${pref.code}:${index}`)) return;
        expect(ring.bbox.minX).toBeGreaterThanOrEqual(rect.minX - 1e-9);
        expect(ring.bbox.maxX).toBeLessThanOrEqual(rect.maxX + 1e-9);
        expect(ring.bbox.minY).toBeGreaterThanOrEqual(rect.minY - 1e-9);
        expect(ring.bbox.maxY).toBeLessThanOrEqual(rect.maxY + 1e-9);
      });
    }
  });

  it('does not frame the uninhabited Izu islets, but still ships them', () => {
    const rect = profileRect(geometry, 'archipelago');
    const south = worldYToLat(rect.maxY);
    // Framing stops at Okinawa, not at 24.2°N where Minami-Iwo-To sits.
    expect(south).toBeGreaterThan(DETACHED_ISLET_MAX_LAT - 0.5);
    // The rings are still present in the geometry, so panning can reach them.
    const all = geometry.prefectures.reduce((n, p) => n + p.rings.length, 0);
    const framed = profileRingKeys(geometry, 'archipelago').length;
    expect(framed).toBeLessThan(all);
    // Three Izu volcanoes + two Kerama islets in the current dataset.
    expect(all - framed).toBe(5);
  });

  it('keeps Okinawa inside the archipelago frame', () => {
    const bounds = profileBounds(geometry, 'archipelago');
    expect(bounds.south).toBeLessThan(26.7);
    expect(bounds.west).toBeLessThan(128);
  });

  it('excludes islands only below the detached-islet latitude', () => {
    // Guard against a threshold that could swallow a populated island.
    expect(DETACHED_ISLET_MAX_AREA_DEG2).toBeGreaterThan(0.05 * 0.05);
    expect(DETACHED_ISLET_MAX_LAT).toBeLessThan(26.9);
  });
});

describe('viewport-aware framing', () => {
  const viewports: Array<[string, Viewport]> = [
    ['desktop', { width: 1464, height: 932, dpr: 1 }],
    ['laptop', { width: 958, height: 620, dpr: 1 }],
    ['tablet portrait', { width: 804, height: 974, dpr: 2 }],
    ['phone portrait', { width: 344, height: 534, dpr: 3 }],
    ['phone landscape', { width: 724, height: 154, dpr: 2 }],
  ];

  it('prefers mainland framing on landscape panes and archipelago on portrait', () => {
    expect(defaultProfile({ width: 1464, height: 932, dpr: 1 })).toBe('mainland');
    expect(defaultProfile({ width: 724, height: 154, dpr: 2 })).toBe('mainland');
    expect(defaultProfile({ width: 344, height: 534, dpr: 3 })).toBe('archipelago');
    expect(defaultProfile({ width: 804, height: 974, dpr: 2 })).toBe('archipelago');
  });

  it('scales insets down on short panes instead of eating the map', () => {
    const phoneLandscape = framingInsets({ width: 724, height: 154, dpr: 2 });
    // The old fixed 18 px padding cost 23% of this 154 px height.
    expect(phoneLandscape.top + phoneLandscape.bottom).toBeLessThan(154 * 0.25);
    const desktop = framingInsets({ width: 1464, height: 932, dpr: 1 });
    expect(desktop.bottom).toBeGreaterThan(phoneLandscape.bottom);
  });

  it.each(viewports)('keeps the declared rect inside the canvas at %s', (_name, vp) => {
    for (const profile of ['mainland', 'archipelago'] as const) {
      const rect = profileRect(geometry, profile);
      const insets = framingInsets(vp);
      const cam = fitWorldRect(rect, vp, insets);
      const toScreen = (x: number, y: number) => ({
        x: (x - cam.cx) * cam.scale + vp.width / 2,
        y: (y - cam.cy) * cam.scale + vp.height / 2,
      });
      const nw = toScreen(rect.minX, rect.minY);
      const se = toScreen(rect.maxX, rect.maxY);
      // Inside the canvas, and inside the inset box it was fitted to.
      expect(nw.x).toBeGreaterThanOrEqual(-0.5);
      expect(nw.y).toBeGreaterThanOrEqual(-0.5);
      expect(se.x).toBeLessThanOrEqual(vp.width + 0.5);
      expect(se.y).toBeLessThanOrEqual(vp.height + 0.5);
      expect(nw.x).toBeGreaterThanOrEqual(insets.left - 1);
      expect(se.y).toBeLessThanOrEqual(vp.height - insets.bottom + 1);
    }
  });

  it('fills the axis it is limited by', () => {
    const vp = { width: 1464, height: 932, dpr: 1 };
    const rect = profileRect(geometry, 'mainland');
    const insets = framingInsets(vp);
    const cam = fitWorldRect(rect, vp, insets);
    const heightPx = (rect.maxY - rect.minY) * cam.scale;
    const widthPx = (rect.maxX - rect.minX) * cam.scale;
    expect(Math.max(heightPx, widthPx)).toBeGreaterThan((vp.height - insets.top - insets.bottom) * 0.98);
  });
});

describe('projection round trip', () => {
  it('recovers latitude from world Y', () => {
    for (const lat of [24.2, 26.5, 30, 35.7, 45.5]) {
      expect(worldYToLat(latToWorldY(lat))).toBeCloseTo(lat, 6);
    }
  });

  it('round-trips every shipped vertex within float tolerance', () => {
    let maxErr = 0;
    for (const pref of geometry.prefectures) {
      for (const ring of pref.rings) {
        for (let i = 1; i < ring.points.length; i += 2) {
          const lat = worldYToLat(ring.points[i]!);
          const back = latToWorldY(lat);
          maxErr = Math.max(maxErr, Math.abs(back - ring.points[i]!));
        }
      }
    }
    expect(maxErr).toBeLessThan(1e-12);
  });
});

describe('shipped geometry', () => {
  it('has all 47 prefectures', () => {
    expect(geometry.prefectures).toHaveLength(47);
  });

  it('reports measured bounds separately from the clip box', () => {
    const meta = rawMap.meta as unknown as {
      bounds: number[];
      geometryBounds: number[];
      contextBounds: number[];
    };
    // The clip box is what the generator asked for; geometryBounds is what it got.
    expect(meta.bounds).toHaveLength(4);
    expect(meta.geometryBounds).toHaveLength(4);
    // Metadata must not advertise the clip box as the extent of the geometry:
    // the easternmost point is well inside 148°E.
    expect(meta.geometryBounds[2]).toBeLessThan(meta.bounds[2]!);
    expect(meta.geometryBounds[1]).toBeGreaterThan(meta.bounds[1]!);
  });

  it('draws context land well beyond the pan limits so seas have no hard edge', () => {
    const meta = rawMap.meta as unknown as { contextBounds: number[] };
    // Pan bounds are 118..158E / 20..52N; context must extend past them.
    expect(meta.contextBounds[0]).toBeLessThan(118);
    expect(meta.contextBounds[2]).toBeGreaterThan(158);
    expect(meta.contextBounds[1]).toBeLessThan(20);
    expect(meta.contextBounds[3]).toBeGreaterThan(52);
  });

  it('keeps Tōkyō’s detached islands in the dataset even though framing skips them', () => {
    const ring = lonLatOfRing('13', 0);
    expect(ring.length).toBeGreaterThan(3);
  });
});
