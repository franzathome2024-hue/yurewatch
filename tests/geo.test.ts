import { describe, expect, it } from 'vitest';
import {
  JAPAN_BOUNDS,
  clampCamera,
  clampScale,
  defaultZoomLimits,
  fitBounds,
  midpoint,
  panBy,
  project,
  screenToWorld,
  unproject,
  worldToScreen,
  worldXToLon,
  worldYToLat,
  zoomAt,
  type Viewport,
} from '../src/map/geo';

const vp: Viewport = { width: 900, height: 700, dpr: 2 };

describe('projection', () => {
  it('round-trips lon/lat through world units', () => {
    for (const [lon, lat] of [
      [139.7, 35.7],
      [142.0, 38.0],
      [130.6, 32.4],
      [145.5, 43.1],
    ] as const) {
      const world = project({ lon, lat });
      const back = unproject(world);
      expect(back.lon).toBeCloseTo(lon, 6);
      expect(back.lat).toBeCloseTo(lat, 6);
    }
  });

  it('maps the prime meridian and equator to the world centre', () => {
    expect(project({ lon: 0, lat: 0 }).x).toBeCloseTo(0.5, 9);
    expect(project({ lon: 0, lat: 0 }).y).toBeCloseTo(0.5, 9);
  });

  it('orders world Y so that north is smaller', () => {
    expect(project({ lon: 140, lat: 45 }).y).toBeLessThan(project({ lon: 140, lat: 31 }).y);
  });

  it('converts world units back to geographic values', () => {
    expect(worldXToLon(0.5)).toBeCloseTo(0, 6);
    expect(worldYToLat(0.5)).toBeCloseTo(0, 6);
  });

  it('clamps latitudes inside the Mercator singularity', () => {
    const p = project({ lon: 0, lat: 89.999 });
    expect(Number.isFinite(p.y)).toBe(true);
  });
});

describe('camera', () => {
  it('fits Japan inside the viewport with padding', () => {
    const cam = fitBounds(JAPAN_BOUNDS, vp, 20);
    const nw = worldToScreen(cam, vp, project({ lon: JAPAN_BOUNDS.west, lat: JAPAN_BOUNDS.north }));
    const se = worldToScreen(cam, vp, project({ lon: JAPAN_BOUNDS.east, lat: JAPAN_BOUNDS.south }));
    expect(nw.x).toBeGreaterThanOrEqual(19);
    expect(nw.y).toBeGreaterThanOrEqual(19);
    expect(se.x).toBeLessThanOrEqual(vp.width - 19);
    expect(se.y).toBeLessThanOrEqual(vp.height - 19);
  });

  it('keeps the anchor point fixed while zooming', () => {
    const cam = fitBounds(JAPAN_BOUNDS, vp);
    const limits = defaultZoomLimits(vp);
    const anchor = { x: 640, y: 210 };
    const before = screenToWorld(cam, vp, anchor);
    const zoomed = zoomAt(cam, vp, anchor, 2, limits);
    const after = screenToWorld(zoomed, vp, anchor);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
    expect(zoomed.scale).toBeGreaterThan(cam.scale);
  });

  it('does not zoom past its limits', () => {
    const limits = { minScale: 100, maxScale: 200 };
    expect(clampScale(50, limits)).toBe(100);
    expect(clampScale(900, limits)).toBe(200);
    const cam = fitBounds(JAPAN_BOUNDS, vp);
    const a = zoomAt(cam, vp, { x: 0, y: 0 }, 100, limits);
    expect(a.scale).toBeLessThanOrEqual(200);
  });

  it('pans by screen pixels', () => {
    const cam = fitBounds(JAPAN_BOUNDS, vp);
    const moved = panBy(cam, vp, 100, 0, defaultZoomLimits(vp));
    expect(moved.cx).toBeLessThan(cam.cx);
  });

  it('keeps the camera over Japan when panned far away', () => {
    const cam = { cx: -5, cy: -5, scale: 40_000 };
    const clamped = clampCamera(cam, vp, defaultZoomLimits(vp));
    const nw = project({ lon: 118, lat: 52 });
    const se = project({ lon: 158, lat: 20 });
    // The centre may overhang the pan box by a quarter of the viewport (so the
    // edge of the country can be inspected) but never further.
    const slackX = vp.width / 2 / clamped.scale / 4;
    const slackY = vp.height / 2 / clamped.scale / 4;
    expect(clamped.cx).toBeGreaterThanOrEqual(nw.x - slackX - 1e-9);
    expect(clamped.cx).toBeLessThanOrEqual(se.x + slackX + 1e-9);
    expect(clamped.cy).toBeGreaterThanOrEqual(nw.y - slackY - 1e-9);
    expect(clamped.cy).toBeLessThanOrEqual(se.y + slackY + 1e-9);
  });

  it('never lets the viewport lose Japan entirely', () => {
    // Panning hard in every direction must leave the country on screen.
    const limits = defaultZoomLimits(vp);
    const start = fitBounds(JAPAN_BOUNDS, vp);
    for (const [dx, dy] of [
      [50_000, 0],
      [-50_000, 0],
      [0, 50_000],
      [0, -50_000],
      [0, 0],
    ] as const) {
      const clamped = panBy(start, vp, dx, dy, limits);
      const nw = project({ lon: JAPAN_BOUNDS.west, lat: JAPAN_BOUNDS.north });
      const se = project({ lon: JAPAN_BOUNDS.east, lat: JAPAN_BOUNDS.south });
      // Screen rectangle covered by the viewport, in world units.
      const viewW = vp.width / clamped.scale;
      const viewH = vp.height / clamped.scale;
      const viewLeft = clamped.cx - viewW / 2;
      const viewRight = clamped.cx + viewW / 2;
      const viewTop = clamped.cy - viewH / 2;
      const viewBottom = clamped.cy + viewH / 2;
      const overlapX = Math.min(viewRight, se.x) - Math.max(viewLeft, nw.x);
      const overlapY = Math.min(viewBottom, se.y) - Math.max(viewTop, nw.y);
      expect(overlapX).toBeGreaterThan(0);
      expect(overlapY).toBeGreaterThan(0);
    }
  });

  it('computes midpoints for pinch gestures', () => {
    expect(midpoint({ x: 0, y: 0 }, { x: 10, y: 20 })).toEqual({ x: 5, y: 10 });
  });
});
