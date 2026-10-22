/**
 * Framing profiles: what "show Japan" actually means.
 *
 * v0.2 used one hand-written lat/lon box (`PRIMARY_VIEW_BOUNDS`, since removed) and a comment
 * claiming it showed "the four main islands plus the Okinawa group". Measured
 * against the shipped geometry that claim was false: the box stopped at 26.0 °N
 * while the dataset carries Ogasawara and Okino-Torishima down to 24.2 °N, so
 * those rings were fitted *outside* the frame and fell off the bottom edge on
 * every landscape viewport. A hand-written box cannot know what the data holds.
 *
 * So coverage is defined as a rule over the actual rings, and the camera rect is
 * measured from the rings that rule selects. Cropping then becomes impossible by
 * construction: if a profile includes a feature, that feature's bounding box is
 * part of the rectangle the camera is fitted to.
 *
 * Two profiles, both explicit and both user-selectable from the map controls:
 *   mainland    — Hokkaidō, Honshū, Shikoku, Kyūshū and their coastal islands.
 *   archipelago — every ring shipped in src/data/japan-map.json.
 */

import type { GeoBounds } from './geo';
import type { Viewport } from './geo';
import type { MapGeometry } from './mapData';

export type FramingProfile = 'mainland' | 'archipelago';

export const FRAMING_PROFILES: FramingProfile[] = ['mainland', 'archipelago'];

/**
 * Latitude at or above which a ring counts as mainland.
 *
 * 30 °N is chosen because it is the documented, checkable boundary: the
 * southernmost point of Kyūshū (Cape Sata, 30.99 °N) and of its offshore islands
 * (Yakushima 30.34 °N) sit above it, while every 南西諸島 ring (Amami 28.3 °N and
 * south), the Ogasawara group (27.1 °N) and Okino-Torishima (24.2 °N) sit below.
 * Tested in tests/framing.test.ts, which fails if a future dataset shifts that
 * assumption.
 */
export const MAINLAND_MIN_LAT = 30.0;

/**
 * Remote-island rule for the archipelago profile.
 *
 * Framing is a statement about where the camera points, not about what is drawn:
 * every ring stays rendered and every ring stays reachable by panning. But a
 * bounding box is decided by its extremes, and the extremes here are the three
 * Izu/Ogasawara volcanoes — Kita-Iwo-To (25.4 °N), Iwo-To (24.8 °N) and
 * Minami-Iwo-To (24.2 °N), all east of 141 °E. Including them stretches the
 * frame across 400 km of empty Pacific beyond the inhabited Ogasawara group and
 * shrinks everything else.
 *
 * Until v0.4.0 this rule was expressed as "south of 26.5 °N and under 0.02 deg²",
 * which worked only because the dataset stopped at 127.6 °E: the whole Sakishima
 * group (Miyakojima, Ishigakijima, Iriomote, Yonaguni) was missing. Now that
 * those islands are in the file, an area threshold would silently exclude
 * inhabited islands of 25–290 km² from their own archipelago view. The rule is
 * therefore geographic — a box around the Izu/Ogasawara volcanoes — and tested
 * against the ring list in tests/framing.test.ts.
 */
export const REMOTE_ISLET_MIN_LON = 140.5;
export const REMOTE_ISLET_MAX_LAT = 26.5;

export interface FramingRect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Ring-level membership, in world space.
 *
 * `bbox.minY` is a ring's northern edge (world Y grows southwards), so recovering
 * the latitude from it answers "is any part of this ring north of the boundary".
 */
function includesRing(
  profile: FramingProfile,
  ring: { bbox: { minY: number; maxX: number }; area: number },
): boolean {
  const north = worldYToLat(ring.bbox.minY);
  if (profile === 'mainland') return north >= MAINLAND_MIN_LAT;
  // Izu/Ogasawara volcanoes: far east *and* far south. The Sakishima group is
  // just as far south but 15° west of this box, so it stays framed.
  const eastLon = ring.bbox.maxX * 360 - 180;
  if (eastLon > REMOTE_ISLET_MIN_LON && north < REMOTE_ISLET_MAX_LAT) return false;
  return true;
}

function worldYToLat(y: number): number {
  const n = Math.PI * (1 - 2 * y);
  return (Math.atan(Math.sinh(n)) * 180) / Math.PI;
}

/**
 * Included rings, as `pref:<code>:<ringIndex>`.
 *
 * Declared at ring level on purpose: 東京都 owns both Honshū's eastern half and
 * the Ogasawara islands 1,000 km south, so a per-prefecture declaration would
 * claim coverage the mainland profile deliberately excludes.
 */
export function profileRingKeys(geometry: MapGeometry, profile: FramingProfile): string[] {
  const keys: string[] = [];
  for (const pref of geometry.prefectures) {
    pref.rings.forEach((ring, index) => {
      if (includesRing(profile, ring)) keys.push(`pref:${pref.code}:${index}`);
    });
  }
  return keys;
}

/** Prefecture codes with at least one ring inside the profile. */
export function profileFeatureCodes(geometry: MapGeometry, profile: FramingProfile): string[] {
  return geometry.prefectures
    .filter((p) => p.rings.some((ring) => includesRing(profile, ring)))
    .map((p) => p.code);
}

/**
 * World-space rectangle covering every ring the profile includes.
 *
 * Works from the projected ring boxes already computed by `mapData`, so it costs
 * nothing at runtime and cannot disagree with what the renderer draws.
 */
export function profileRect(geometry: MapGeometry, profile: FramingProfile): FramingRect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const pref of geometry.prefectures) {
    for (const ring of pref.rings) {
      // `Shape.bbox` is per-ring, so filtering by ring (not prefecture) keeps
      // the mainland profile exact: 東京都 contributes Honshū but not Ogasawara.
      if (!includesRing(profile, ring)) continue;
      minX = Math.min(minX, ring.bbox.minX);
      minY = Math.min(minY, ring.bbox.minY);
      maxX = Math.max(maxX, ring.bbox.maxX);
      maxY = Math.max(maxY, ring.bbox.maxY);
    }
  }
  if (!Number.isFinite(minX)) return profileRect(geometry, 'archipelago');
  return { minX, minY, maxX, maxY };
}

/**
 * Screen-space insets the framing must respect, in px.
 *
 * The map has chrome sitting on top of it (zoom/recenter column bottom-right,
 * scale bar and attribution bottom-left, simulation banner top-left). Fitting to
 * the full canvas centres geography underneath that chrome. Insets are derived
 * from the measured viewport and clamped, because a fixed 18 px padding costs
 * 23 % of a 154 px-tall Android landscape pane.
 */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export function framingInsets(vp: Viewport): Insets {
  const base = Math.max(10, Math.min(28, Math.round(Math.min(vp.width, vp.height) * 0.055)));
  // Bottom carries the scale bar *and* the in-canvas attribution line (14 px of
  // text on a 6 px margin), so it can never be smaller than 30 px even on a
  // 150 px-tall landscape strip — the attribution was printing across the
  // 沖縄県 label.
  // 30 px on a normal pane; 20 px on a strip shorter than 220 px, where the
  // attribution text sits 6 px above the edge and cannot use more anyway.
  const bottomFloor = vp.height < 220 ? 20 : 30;
  const bottom = Math.max(bottomFloor, Math.min(Math.round(vp.height * 0.16), base + 26));
  const right = Math.min(Math.round(vp.width * 0.14), base + 22);
  return { top: base, right, bottom: Math.max(base, bottom), left: base };
}

/**
 * Which profile a fresh session should open with.
 *
 * A landscape pane is wider than Japan is: fitting the whole archipelago there
 * leaves the country as a narrow strip in a sea of empty ocean, which is the
 * "map too small" complaint. Landscape therefore frames the mainland, and the
 * archipelago is one tap away. Portrait panes are tall enough for everything.
 */
export function defaultProfile(vp: Viewport): FramingProfile {
  const aspect = vp.width / Math.max(1, vp.height);
  return aspect >= 1.25 ? 'mainland' : 'archipelago';
}

/** Human-facing coverage description, for debug output and the UI. */
export function profileBounds(geometry: MapGeometry, profile: FramingProfile): GeoBounds {
  const rect = profileRect(geometry, profile);
  return {
    west: rect.minX * 360 - 180,
    east: rect.maxX * 360 - 180,
    // North edge is the smaller Y.
    north: worldYToLat(rect.minY),
    south: worldYToLat(rect.maxY),
  };
}
