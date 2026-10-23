import { describe, expect, it } from 'vitest';
import { buildGeometry } from '../src/map/mapData';
import { JAPAN_BOUNDS, fitBounds, project, worldToScreen, type Viewport } from '../src/map/geo';
import { buildScene, hitTest, markerOpacity, markerRadius, withAlpha } from '../src/map/scene';
import { DARK_MAP_THEME } from '../src/map/theme';
import { intensityByPrefecture } from '../src/state/events';
import { parseEarthquake, parseEew } from '../src/sources/p2pquake/parse';
import { eewCancelled, eewWarning, quakeDetail } from './fixtures';

const geometry = buildGeometry();
const vp: Viewport = { width: 900, height: 700, dpr: 2 };
const camera = fitBounds(JAPAN_BOUNDS, vp, 18);
const T = Date.parse('2026-10-22T07:50:00Z');

function quake(raw: unknown = quakeDetail, at = T) {
  const r = parseEarthquake(raw, at);
  if (!r.ok) throw new Error(r.reason);
  return r.value;
}
function eew(raw: unknown = eewWarning, at = T) {
  const r = parseEew(raw, at);
  if (!r.ok) throw new Error(r.reason);
  return r.value;
}

function scene(overrides: Partial<Parameters<typeof buildScene>[0]> = {}) {
  return buildScene({
    geometry,
    camera,
    viewport: vp,
    theme: DARK_MAP_THEME,
    events: [],
    selectedId: null,
    alert: null,
    intensityByPref: new Map(),
    now: T,
    ...overrides,
  });
}

describe('geometry', () => {
  it('loads 47 prefectures with sane world coordinates', () => {
    expect(geometry.prefectures).toHaveLength(47);
    for (const pref of geometry.prefectures) {
      expect(pref.rings.length).toBeGreaterThan(0);
      expect(pref.bbox.minX).toBeGreaterThanOrEqual(0);
      expect(pref.bbox.maxX).toBeLessThanOrEqual(1);
      expect(pref.bbox.minY).toBeGreaterThanOrEqual(0);
      expect(pref.bbox.maxY).toBeLessThanOrEqual(1);
      expect(Number.isFinite(pref.label.x)).toBe(true);
    }
  });

  it('indexes prefectures by JMA name and code', () => {
    expect(geometry.byName.get('東京都')?.code).toBe('13');
    expect(geometry.byCode.get('43')?.name).toBe('熊本県');
  });

  it('includes neighbouring land for context', () => {
    expect(geometry.land.length).toBeGreaterThan(0);
  });
});

describe('buildScene — markers', () => {
  it('projects an epicentre to the expected screen position', () => {
    const s = scene({ events: [quake()], selectedId: null });
    const marker = s.markers[0]!;
    const expected = worldToScreen(camera, vp, project({ lon: 130.6, lat: 32.4 }));
    expect(marker.x).toBeCloseTo(expected.x, 6);
    expect(marker.y).toBeCloseTo(expected.y, 6);
  });

  it('culls markers outside the viewport', () => {
    const far = parseEarthquake(
      {
        ...quakeDetail,
        id: 'far',
        earthquake: { ...quakeDetail.earthquake, hypocenter: { name: '遠方', latitude: 0, longitude: 0 } },
      },
      T,
    );
    if (!far.ok) throw new Error('bad fixture');
    const s = scene({ events: [far.value] });
    expect(s.markers).toHaveLength(0);
    expect(s.empty).toBe(true);
  });

  it('sizes markers by magnitude and colours by intensity', () => {
    const s = scene({ events: [quake()] });
    const m = s.markers[0]!;
    expect(m.r).toBeGreaterThanOrEqual(6);
    expect(m.fill).toBe('#f2f2ff'); // 震度1 near-white in the JMA published scheme
    expect(m.intensity).toBe(10);
  });

  it('draws the selected marker last and flags it', () => {
    const older = parseEarthquake({ ...quakeDetail, id: 'older', earthquake: { ...quakeDetail.earthquake, time: '2026/10/21 01:00:00' } }, T);
    if (!older.ok) throw new Error('bad fixture');
    const s = scene({ events: [quake(), older.value], selectedId: older.value.id });
    expect(s.markers).toHaveLength(2);
    expect(s.markers[s.markers.length - 1]!.selected).toBe(true);
    expect(s.markers.filter((m) => m.selected)).toHaveLength(1);
  });

  it('fades old events', () => {
    expect(markerOpacity(10_000)).toBe(1);
    expect(markerOpacity(3 * 3600_000)).toBeLessThan(1);
    expect(markerOpacity(48 * 3600_000)).toBeLessThan(markerOpacity(3 * 3600_000));
    expect(markerRadius(6, 10)).toBeGreaterThan(markerRadius(4, 10));
    expect(markerRadius(9, 70)).toBeLessThanOrEqual(20);
    expect(markerRadius(-1, -1)).toBe(6);
  });

  it('labels the selected epicentre', () => {
    const ev = quake();
    const s = scene({ events: [ev], selectedId: ev.id });
    expect(s.labels.some((l) => l.text === '熊本県熊本地方')).toBe(true);
  });
});

describe('buildScene — intensity shading', () => {
  it('fills the prefecture that reported an observation', () => {
    const ev = quake();
    const s = scene({ events: [ev], selectedId: ev.id, intensityByPref: intensityByPrefecture([ev]) });
    const kumamoto = s.prefectureStyles.get('43')!;
    expect(kumamoto.fill).toMatch(/^rgba\(/);
    const tokyo = s.prefectureStyles.get('13')!;
    expect(tokyo.fill).toBeNull();
  });

  it('leaves every prefecture unshaded when there is no data', () => {
    const s = scene();
    for (const style of s.prefectureStyles.values()) expect(style.fill).toBeNull();
  });
});

describe('buildScene — EEW', () => {
  it('places an EEW marker for an active warning', () => {
    const s = scene({ alert: eew() });
    expect(s.eew).not.toBeNull();
    expect(s.eew?.pulsing).toBe(true);
    // scaleTo 55 is JMA 6弱; the sublabel mirrors the source's prediction.
    expect(s.eew?.sublabel).toContain('6弱');
    const expected = worldToScreen(camera, vp, project({ lon: 140.6, lat: 35.9 }));
    expect(s.eew?.x).toBeCloseTo(expected.x, 6);
  });

  it('outlines prefectures named in the warning areas', () => {
    const s = scene({ alert: eew() });
    const ibaraki = s.prefectureStyles.get('08')!;
    expect(ibaraki.stroke).toBe(DARK_MAP_THEME.eewAreaStroke);
    expect(ibaraki.alertOutline).toBe(true);
    expect(ibaraki.fill).toMatch(/^rgba\(/);
  });

  it('stops drawing the crosshair once cancelled', () => {
    const cancelled = eew({ ...eewWarning, cancelled: true, areas: [], issue: { ...eewWarning.issue, serial: '5' } });
    const s = scene({ alert: cancelled });
    expect(s.eew).toBeNull();
  });

  it('shows no EEW marker for a forecast without a hypocentre', () => {
    const forecast = eew({ ...eewWarning, areas: [], earthquake: { ...eewWarning.earthquake, hypocenter: undefined } });
    const s = scene({ alert: forecast });
    expect(s.eew).toBeNull();
  });
});

describe('buildScene — chrome', () => {
  it('produces a graticule and a sane scale bar', () => {
    const s = scene();
    expect(s.graticule.vertical.length).toBeGreaterThan(0);
    expect(s.graticule.horizontal.length).toBeGreaterThan(0);
    expect(s.scaleBar.px).toBeGreaterThan(10);
    expect(s.scaleBar.label).toMatch(/(km|m)$/);
  });

  it('reports zoom ratio relative to the Japan fit', () => {
    const zoomed = buildScene({
      geometry,
      camera: { ...camera, scale: camera.scale * 3 },
      viewport: vp,
      theme: DARK_MAP_THEME,
      events: [],
      selectedId: null,
      alert: null,
      intensityByPref: new Map(),
      now: T,
    });
    const fitScale = fitBounds(JAPAN_BOUNDS, vp).scale;
    expect(zoomed.zoomRatio).toBeCloseTo((camera.scale * 3) / fitScale, 6);
  });

  it('attributes the basemap', () => {
    expect(scene().attribution).toContain('Natural Earth');
  });
});

describe('hitTest', () => {
  it('returns the marker under the pointer', () => {
    const s = scene({ events: [quake()] });
    const m = s.markers[0]!;
    expect(hitTest(s, { x: m.x + 3, y: m.y - 3 })?.id).toBe(m.id);
  });

  it('returns null when the pointer is far from every marker', () => {
    const s = scene({ events: [quake()] });
    expect(hitTest(s, { x: 5, y: 5 })).toBeNull();
  });

  it('picks the nearest marker when two overlap', () => {
    const near = parseEarthquake(
      {
        ...quakeDetail,
        id: 'near',
        earthquake: {
          ...quakeDetail.earthquake,
          time: '2026/10/22 07:44:00',
          hypocenter: { ...quakeDetail.earthquake.hypocenter, longitude: 130.65 },
        },
      },
      T,
    );
    if (!near.ok) throw new Error('bad fixture');
    const s = scene({ events: [quake(), near.value] });
    const target = s.markers.find((m) => m.id === near.value.id)!;
    expect(target).toBeDefined();
    expect(hitTest(s, { x: target.x, y: target.y })?.id).toBe(near.value.id);
  });
});

describe('withAlpha', () => {
  it('converts hex to rgba and passes rgb through', () => {
    expect(withAlpha('#3b6fe0', 0.5)).toBe('rgba(59,111,224,0.5)');
    expect(withAlpha('#fff', 1)).toBe('rgba(255,255,255,1)');
    expect(withAlpha('rgba(1,2,3,0.4)', 0.9)).toBe('rgba(1,2,3,0.4)');
  });
});
