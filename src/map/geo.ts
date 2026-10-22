/**
 * Web-Mercator projection helpers and camera maths.
 *
 * Pure functions only, so the viewport behaviour can be unit tested without a
 * canvas. Coordinates are normalised "world" units: x,y in [0,1] where
 * (0,0) is the north-west corner of the Mercator square.
 */

export interface LonLat {
  lon: number;
  lat: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Viewport {
  width: number;
  height: number;
  dpr: number;
}

export interface Camera {
  /** World-space centre. */
  cx: number;
  cy: number;
  /** Screen pixels per world unit (i.e. per 360° of longitude). */
  scale: number;
}

export const MIN_LAT = -85.05112878;
export const MAX_LAT = 85.05112878;

const clampLat = (lat: number) => Math.max(MIN_LAT, Math.min(MAX_LAT, lat));

export function lonToWorldX(lon: number): number {
  return (lon + 180) / 360;
}

export function latToWorldY(lat: number): number {
  const rad = (clampLat(lat) * Math.PI) / 180;
  const y = Math.log(Math.tan(Math.PI / 4 + rad / 2));
  return 0.5 - y / (2 * Math.PI);
}

export function worldXToLon(x: number): number {
  return x * 360 - 180;
}

export function worldYToLat(y: number): number {
  const n = Math.PI * (1 - 2 * y);
  return (Math.atan(Math.sinh(n)) * 180) / Math.PI;
}

export function project(p: LonLat): Point {
  return { x: lonToWorldX(p.lon), y: latToWorldY(p.lat) };
}

export function unproject(p: Point): LonLat {
  return { lon: worldXToLon(p.x), lat: worldYToLat(p.y) };
}

/** Geographic bounds helper. */
export interface GeoBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

/**
 * Framing box for the initial view. It deliberately excludes the Nansei/Ogasawara
 * islands so Honshu/Hokkaido/Kyushu fill the canvas — those islands stay
 * reachable by panning (PAN_BOUNDS is wider). Chosen by eye against the
 * reference layout, which also crops to the four main islands.
 */
export const JAPAN_BOUNDS: GeoBounds = { west: 129.3, south: 30.8, east: 146.2, north: 45.6 };

/**
 * Frame used for the initial view and the "show all of Japan" control.
 *
 * The four main islands plus the Okinawa group: the region someone monitoring
 * Japan expects to see at once. The dataset also contains detached islets far to
 * the south and east (Okinotorishima, Minamitorishima); fitting to those would
 * shrink the mainland to a strip in the corner. They remain reachable by
 * panning, and are covered by the zoom limits, which are derived from the full
 * geometry.
 */
export const PRIMARY_VIEW_BOUNDS: GeoBounds = { west: 127.0, south: 26.0, east: 146.6, north: 45.7 };

/** Camera fitted to `bounds` inside a viewport, with padding in px. */
export function fitBounds(bounds: GeoBounds, vp: Viewport, padding = 24): Camera {
  const nw = project({ lon: bounds.west, lat: bounds.north });
  const se = project({ lon: bounds.east, lat: bounds.south });
  const w = Math.max(1e-6, se.x - nw.x);
  const h = Math.max(1e-6, se.y - nw.y);
  const availW = Math.max(40, vp.width - padding * 2);
  const availH = Math.max(40, vp.height - padding * 2);
  const scale = Math.min(availW / w, availH / h);
  return { cx: (nw.x + se.x) / 2, cy: (nw.y + se.y) / 2, scale };
}

/**
 * Fit an arbitrary world-space rectangle into the viewport.
 *
 * Used with the *actual* geometry bounds rather than a hand-written lat/lon box:
 * the dataset includes Okinawa and the offshore islands, and fitting to a
 * narrower box silently cropped them on square-ish viewports.
 */
export function fitWorldRect(
  rect: { minX: number; minY: number; maxX: number; maxY: number },
  vp: Viewport,
  padding = 16,
): Camera {
  const w = Math.max(1e-9, rect.maxX - rect.minX);
  const h = Math.max(1e-9, rect.maxY - rect.minY);
  const availW = Math.max(40, vp.width - padding * 2);
  const availH = Math.max(40, vp.height - padding * 2);
  const scale = Math.min(availW / w, availH / h);
  return {
    cx: (rect.minX + rect.maxX) / 2,
    cy: (rect.minY + rect.maxY) / 2,
    scale,
  };
}

export function worldToScreen(cam: Camera, vp: Viewport, p: Point): Point {
  return {
    x: (p.x - cam.cx) * cam.scale + vp.width / 2,
    y: (p.y - cam.cy) * cam.scale + vp.height / 2,
  };
}

export function screenToWorld(cam: Camera, vp: Viewport, p: Point): Point {
  return {
    x: (p.x - vp.width / 2) / cam.scale + cam.cx,
    y: (p.y - vp.height / 2) / cam.scale + cam.cy,
  };
}

export function screenToLonLat(cam: Camera, vp: Viewport, p: Point): LonLat {
  return unproject(screenToWorld(cam, vp, p));
}

/** Zoom keeping the world point under `anchor` (screen px) fixed. */
export function zoomAt(cam: Camera, vp: Viewport, anchor: Point, factor: number, limits: ZoomLimits): Camera {
  const before = screenToWorld(cam, vp, anchor);
  const scale = clampScale(cam.scale * factor, limits);
  const after = screenToWorld({ ...cam, scale }, vp, anchor);
  return clampCamera(
    { cx: cam.cx + (before.x - after.x), cy: cam.cy + (before.y - after.y), scale },
    vp,
    limits,
  );
}

export interface ZoomLimits {
  minScale: number;
  maxScale: number;
}

export function clampScale(scale: number, limits: ZoomLimits): number {
  return Math.max(limits.minScale, Math.min(limits.maxScale, scale));
}

/**
 * Keep the viewport over Japan: the centre is restricted to a padded box around
 * the archipelago so a user cannot pan the country off-screen and get lost.
 */
export const PAN_BOUNDS: GeoBounds = { west: 118, south: 20, east: 158, north: 52 };

export function clampCamera(cam: Camera, vp: Viewport, limits: ZoomLimits): Camera {
  const nw = project({ lon: PAN_BOUNDS.west, lat: PAN_BOUNDS.north });
  const se = project({ lon: PAN_BOUNDS.east, lat: PAN_BOUNDS.south });
  const halfW = vp.width / 2 / cam.scale;
  const halfH = vp.height / 2 / cam.scale;
  const minX = nw.x + Math.min(halfW, (se.x - nw.x) / 2) * 0;
  const maxX = se.x;
  let cx = cam.cx;
  let cy = cam.cy;
  cx = Math.max(minX, Math.min(maxX, cx));
  cy = Math.max(nw.y, Math.min(se.y, cy));
  // If the viewport is wider/taller than the pan box, centre it instead.
  if (halfW * 2 > se.x - nw.x) cx = (nw.x + se.x) / 2;
  if (halfH * 2 > se.y - nw.y) cy = (nw.y + se.y) / 2;
  return { cx, cy, scale: clampScale(cam.scale, limits) };
}

export function panBy(cam: Camera, vp: Viewport, dxPx: number, dyPx: number, limits: ZoomLimits): Camera {
  return clampCamera(
    { cx: cam.cx - dxPx / cam.scale, cy: cam.cy - dyPx / cam.scale, scale: cam.scale },
    vp,
    limits,
  );
}

export function defaultZoomLimits(vp: Viewport): ZoomLimits {
  const fit = fitBounds(JAPAN_BOUNDS, vp);
  return { minScale: fit.scale * 0.55, maxScale: fit.scale * 22 };
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Midpoint, used by the pinch gesture. */
export function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
