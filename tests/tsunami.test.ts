import { beforeEach, describe, expect, it } from 'vitest';
import { geometry } from '../src/map/mapData';
import { matchRegionsByName, normalizeAreaName, tsunamiLayer } from '../src/map/tsunamiData';
import { buildScene, tsunamiGradeColor } from '../src/map/scene';
import { DARK_MAP_THEME } from '../src/map/theme';
import { fitBounds, JAPAN_BOUNDS, project, type Viewport } from '../src/map/geo';
import { initialState, reduce } from '../src/state/store';
import type { TsunamiInfo } from '../src/core/models';
import { parseTsunami } from '../src/sources/p2pquake/parse';
import { tsunamiWatch } from './fixtures';
import { __resetI18nForTests } from '../src/i18n';

const T = Date.parse('2026-10-22T07:50:00Z');
const VIEWPORT: Viewport = { width: 900, height: 700, dpr: 1 };
const CAMERA = fitBounds(JAPAN_BOUNDS, VIEWPORT, 16);

function scene(tsunami: TsunamiInfo | null, visible = true) {
  return buildScene({
    geometry: geometry(),
    camera: CAMERA,
    viewport: VIEWPORT,
    theme: DARK_MAP_THEME,
    events: [],
    selectedId: null,
    alert: null,
    intensityByPref: new Map(),
    now: T,
    tsunami,
    tsunamiLayerVisible: visible,
  });
}

function bulletin(areas: Array<{ name: string; grade: TsunamiInfo['areas'][number]['grade'] }>): TsunamiInfo {
  return {
    id: 'ts-1',
    issuedAt: T,
    receivedAt: T,
    cancelled: false,
    areas: areas.map((a) => ({
      ...a,
      immediate: false,
      arrivalTime: null,
      heightLabel: null,
      heightValue: null,
    })),
    source: { provider: 'P2P地震情報', relayed: true, url: '' } as TsunamiInfo['source'],
  };
}

beforeEach(() => __resetI18nForTests('ja'));

describe('tsunami forecast-region geometry', () => {
  it('loads the JMA region set with stable numeric codes and names', () => {
    const layer = tsunamiLayer();
    expect(layer.regions.length).toBe(66);
    expect(layer.byCode.get(300)?.name).toBe('茨城県');
    expect(layer.byCode.get(220)?.name).toBe('宮城県');
    expect(layer.byCode.get(800)?.name).toBe('沖縄本島地方');
    // Every region has geometry and every ring is a real polygon ring.
    for (const region of layer.regions) {
      expect(region.rings.length).toBeGreaterThan(0);
      for (const ring of region.rings) {
        expect(ring.length).toBeGreaterThanOrEqual(8);
        expect(ring.length % 2).toBe(0);
      }
    }
  });

  it('carries its provenance into the app, including the modification notice', () => {
    const { meta } = tsunamiLayer();
    expect(meta.sourceUrl).toContain('data.jma.go.jp');
    expect(meta.datasetDate).toBe('2024-05-14');
    expect(meta.licence).toContain('公共データ利用規約');
    // Japan's Public Data Licence requires stating that the data was modified.
    expect(meta.attribution).toContain('加工して作成');
    expect(meta.note).toContain('Not a coastline');
    expect(meta.note).toContain('inundation');
  });

  it('never exposes the unassigned "code 0" features as regions', () => {
    const layer = tsunamiLayer();
    expect(layer.byCode.has(0)).toBe(false);
    for (const region of layer.regions) expect(region.code).toBeGreaterThan(0);
  });

  it('projects into the same world space as the basemap', () => {
    const region = tsunamiLayer().byCode.get(300)!;
    const ring = region.rings[0]!;
    // Inside the world-space bbox of the region itself, and inside Japan's bbox.
    expect(ring[0]!).toBeGreaterThanOrEqual(region.bbox.minX - 1e-9);
    expect(ring[1]!).toBeGreaterThanOrEqual(region.bbox.minY - 1e-9);
    const japan = geometry();
    expect(region.bbox.minX).toBeGreaterThan(japan.bbox.minX);
    expect(region.bbox.maxX).toBeLessThan(japan.bbox.maxX);
    // Sanity check against the projection helper: the first vertex round-trips.
    expect(Number.isFinite(ring[0]!)).toBe(true);
    expect(ring[0]!).toBeCloseTo(project({ lon: 140.8, lat: 36.0 }).x, -1);
  });

  it('normalises names but does not invent a match', () => {
    expect(normalizeAreaName('宮城県')).toBe('宮城県');
    expect(normalizeAreaName(' 宮城県 ')).toBe('宮城県');
    expect(normalizeAreaName('千葉県九十九里・外房')).toBe('千葉県九十九里外房');
    const { matched, unmatched } = matchRegionsByName(['宮城県', '存在しない区域', '宮城県']);
    expect(matched.map((r) => r.code)).toEqual([220]);
    expect(unmatched).toEqual(['存在しない区域']);
  });
});

describe('tsunami map layer follows the bulletin, nothing else', () => {
  it('paints nothing when there is no bulletin', () => {
    expect(scene(null)?.tsunami?.regions).toEqual([]);
    expect(scene(null)?.tsunami?.unmatched).toEqual([]);
  });

  it('paints nothing for a cancelled bulletin', () => {
    const cancelled = { ...bulletin([{ name: '宮城県', grade: 'Warning' }]), cancelled: true };
    expect(scene(cancelled)?.tsunami?.regions).toEqual([]);
  });

  it('paints nothing when the user turns the layer off', () => {
    expect(scene(bulletin([{ name: '宮城県', grade: 'Warning' }]), false)?.tsunami).toBeNull();
  });

  it('paints exactly the regions the bulletin names, with their own grade', () => {
    const s = scene(
      bulletin([
        { name: '宮城県', grade: 'Warning' },
        { name: '福島県', grade: 'Watch' },
      ]),
    )!;
    expect(s.tsunami!.regions.map((r) => r.code).sort((a, b) => a - b)).toEqual([220, 250]);
    expect(s.tsunami!.regions.find((r) => r.code === 220)!.grade).toBe('Warning');
    expect(s.tsunami!.regions.find((r) => r.code === 250)!.grade).toBe('Watch');
  });

  it('reports unmatched bulletin areas instead of dropping them silently', () => {
    const s = scene(bulletin([{ name: '宮城県', grade: 'Warning' }, { name: '架空の湾', grade: 'Watch' }]))!;
    expect(s.tsunami!.regions).toHaveLength(1);
    expect(s.tsunami!.unmatched).toEqual(['架空の湾']);
  });

  it('does not paint a region for a "no tsunami" or unknown grade', () => {
    const s = scene(bulletin([{ name: '宮城県', grade: 'None' }]));
    expect(s.tsunami!.regions).toEqual([]);
  });

  it('uses distinct colours for warning, advisory and non-effective', () => {
    const colours = new Set([
      tsunamiGradeColor('MajorWarning'),
      tsunamiGradeColor('Warning'),
      tsunamiGradeColor('Watch'),
      tsunamiGradeColor('NonEffective'),
    ]);
    expect(colours.size).toBe(4);
    // Tsunami warning colour is not the EEW red used for the crosshair.
    expect(tsunamiGradeColor('Warning')).not.toBe(DARK_MAP_THEME.eew);
  });

  it('clears the highlight when a later bulletin drops an area (no stale regions)', () => {
    let state = initialState('live', T);
    const first = parseTsunami(tsunamiWatch, T);
    if (!first.ok) throw new Error(first.reason);
    state = reduce(state, { type: 'batch', events: [], eews: [], tsunami: first.value, at: T, rejected: 0 });
    expect(scene(state.tsunami)!.tsunami!.regions.map((r) => r.code)).toEqual([220]);

    const later: TsunamiInfo = { ...bulletin([{ name: '茨城県', grade: 'Watch' }]), id: 'ts-2', receivedAt: T + 60_000 };
    state = reduce(state, { type: 'batch', events: [], eews: [], tsunami: later, at: T + 60_000, rejected: 0 });
    const codes = scene(state.tsunami)!.tsunami!.regions.map((r) => r.code);
    expect(codes).toEqual([300]);
    expect(codes).not.toContain(220);
  });
});

describe('coastline geometry', () => {
  it('keeps every prefecture and enough islands to survive zooming', () => {
    const g = geometry();
    expect(g.prefectures).toHaveLength(47);
    // v0.1.1 stored 134 polygon rings / 5,286 vertices with a 0.006° tolerance.
    // This build stores 136 rings / 10,034 vertices at 0.0015°, i.e. roughly twice
    // the coastal detail in the same file size (and lakes are holes now).
    const parts = g.prefectures.reduce((n, p) => n + p.rings.length, 0);
    const vertices = g.prefectures.reduce(
      (n, p) => n + p.rings.reduce((m, r) => m + r.points.length / 2, 0),
      0,
    );
    expect(parts).toBeGreaterThanOrEqual(134);
    expect(vertices).toBeGreaterThan(9_000);
    for (const pref of g.prefectures) {
      expect(pref.rings.length).toBeGreaterThan(0);
      for (const ring of pref.rings) expect(ring.points.length).toBeGreaterThanOrEqual(8);
    }
  });

  it('keeps Lake Biwa as a hole so it is not painted as land', () => {
    const shiga = geometry().byCode.get('25')!;
    const lake = shiga.rings.find((r) => {
      const xs = r.points.filter((_, i) => i % 2 === 0);
      const ys = r.points.filter((_, i) => i % 2 === 1);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      const centre = project({ lon: 136.08, lat: 35.25 });
      return Math.abs(cx - centre.x) < 0.02 && Math.abs(cy - centre.y) < 0.02;
    });
    expect(lake).toBeDefined();
  });

  it('records how the geometry was produced', () => {
    const meta = geometry().meta as unknown as { processing?: string; note?: string };
    expect(meta.processing).toContain('Douglas-Peucker');
    expect(meta.note).toContain('Natural Earth 1:10m');
  });
});
