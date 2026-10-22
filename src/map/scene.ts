import { hasIntensity, scaleStyle } from '../core/intensity';
import type { EarthquakeEvent, EewAlert, JmaScale, TsunamiGrade, TsunamiInfo } from '../core/models';
import { resolvePrefecture } from '../data/prefectures';
import {
  JAPAN_BOUNDS,
  fitBounds,
  project,
  screenToWorld,
  worldToScreen,
  worldXToLon,
  worldYToLat,
  type Camera,
  type Point,
  type Viewport,
} from './geo';
import type { MapGeometry } from './mapData';
import { matchRegionsByName, type TsunamiRegion } from './tsunamiData';
import type { MapTheme } from './theme';
import { t } from '../i18n';

/**
 * Scene construction: converts application state into screen-space drawing
 * instructions. No canvas API is touched here, so marker placement, culling,
 * label priority and colour selection are all unit-testable.
 */

export interface Marker {
  id: string;
  x: number;
  y: number;
  r: number;
  fill: string;
  textColor: string;
  opacity: number;
  selected: boolean;
  /** `quake` markers are observations; `eew` markers are predictions. */
  kind: 'quake' | 'eew';
  label: string | null;
  intensity: JmaScale;
  magnitude: number;
  depthKm: number;
  ageMs: number | null;
  preliminary: boolean;
}

export interface PrefectureStyle {
  fill: string | null;
  stroke: string;
  lineWidth: number;
  /** Draw an extra dashed outline (EEW 警報対象). */
  alertOutline: boolean;
  dash: number[];
}

export interface SceneLabel {
  text: string;
  x: number;
  y: number;
  alpha: number;
  size: number;
  weight: number;
  color: string;
}

/** A tsunami forecast region that the current bulletin actually names. */
export interface TsunamiRegionHit {
  code: number;
  name: string;
  grade: TsunamiGrade;
  region: TsunamiRegion;
}

export interface TsunamiLayerScene {
  regions: TsunamiRegionHit[];
  /** Areas named by the bulletin that could not be matched to geometry. */
  unmatched: string[];
  /** Newest bulletin's issue time, or null when unknown. */
  issuedAt: number | null;
}

export interface MapScene {
  viewport: Viewport;
  camera: Camera;
  scale: number;
  zoomRatio: number;
  prefectureStyles: Map<string, PrefectureStyle>;
  labels: SceneLabel[];
  markers: Marker[];
  eew: {
    x: number;
    y: number;
    pulsing: boolean;
    label: string;
    sublabel: string | null;
  } | null;
  /** Tsunami forecast regions to paint; null when the layer is off. */
  tsunami: TsunamiLayerScene | null;
  graticule: { vertical: number[]; horizontal: number[] };
  scaleBar: { px: number; label: string };
  attribution: string;
  empty: boolean;
  /** Screen-space bounds of Japan, for "recentre" affordances. */
  japanBounds: { x: number; y: number; w: number; h: number };
}

export interface SceneInput {
  geometry: MapGeometry;
  camera: Camera;
  viewport: Viewport;
  theme: MapTheme;
  events: EarthquakeEvent[];
  selectedId: string | null;
  alert: EewAlert | null;
  /** Max observed intensity per prefecture for the focused event. */
  intensityByPref: Map<string, number>;
  now: number;
  /** Max markers drawn (perf guard on old devices). */
  markerLimit?: number;
  /** Newest tsunami bulletin (already reduced to "current" by the store). */
  tsunami?: TsunamiInfo | null;
  /** User preference: draw the 津波予報区 layer at all. */
  tsunamiLayerVisible?: boolean;
}

const MARKER_MIN = 6;
const MARKER_MAX = 20;

export function markerRadius(magnitude: number, intensity: JmaScale): number {
  if (magnitude > 0) return Math.max(MARKER_MIN, Math.min(MARKER_MAX, 5 + (magnitude - 3) * 2.4));
  if (hasIntensity(intensity)) return Math.max(MARKER_MIN, Math.min(MARKER_MAX, 6 + (intensity - 10) * 0.16));
  return MARKER_MIN;
}

/** Age-driven emphasis: fresh events are solid, older ones recede. */
export function markerOpacity(ageMs: number | null): number {
  if (ageMs === null) return 0.7;
  if (ageMs < 60 * 60_000) return 1;
  if (ageMs < 6 * 60 * 60_000) return 0.86;
  if (ageMs < 24 * 60 * 60_000) return 0.68;
  return 0.5;
}

function gradeRank(grade: TsunamiGrade): number {
  switch (grade) {
    case 'MajorWarning':
      return 5;
    case 'Warning':
      return 4;
    case 'Watch':
      return 3;
    case 'NonEffective':
      return 2;
    case 'Checking':
      return 1;
    default:
      return 0;
  }
}

function pickGrade(bulletin: TsunamiInfo, name: string): TsunamiGrade {
  let best: TsunamiGrade = 'None';
  for (const area of bulletin.areas) {
    if (area.name !== name) continue;
    if (gradeRank(area.grade) > gradeRank(best)) best = area.grade;
  }
  return best;
}

/** Colour for a tsunami grade. Deliberately distinct from the EEW red. */
export function tsunamiGradeColor(grade: TsunamiGrade): string {
  switch (grade) {
    case 'MajorWarning':
      return '#c2185b';
    case 'Warning':
      return '#d1495b';
    case 'Watch':
      return '#c98a2b';
    case 'NonEffective':
      return '#6f8faf';
    case 'Checking':
      return '#6f8faf';
    default:
      return '#6f8faf';
  }
}

export function buildScene(input: SceneInput): MapScene {
  const { geometry, camera, viewport, theme, events, selectedId, alert, intensityByPref, now } = input;
  const fit = fitBounds(JAPAN_BOUNDS, viewport);
  const zoomRatio = camera.scale / fit.scale;

  // ---- prefecture styling -------------------------------------------
  const alerted = new Map<string, JmaScale>();
  for (const area of alert?.areas ?? []) {
    const pref = resolvePrefecture(area.pref, area.name);
    if (!pref) continue;
    const prev = alerted.get(pref.name);
    if (prev === undefined || area.scaleTo > prev) alerted.set(pref.name, area.scaleTo);
  }

  const prefectureStyles = new Map<string, PrefectureStyle>();
  for (const pref of geometry.prefectures) {
    const observed = intensityByPref.get(pref.name);
    const alertScale = alerted.get(pref.name);
    let fill: string | null = null;
    if (alertScale !== undefined && hasIntensity(alertScale)) {
      fill = withAlpha(scaleStyle(alertScale).fill, 0.34);
    } else if (observed !== undefined && hasIntensity(observed)) {
      fill = withAlpha(scaleStyle(observed).fill, 0.3);
    }
    prefectureStyles.set(pref.code, {
      fill,
      stroke: alertScale !== undefined ? theme.eewAreaStroke : theme.prefStroke,
      lineWidth: alertScale !== undefined ? 1.4 : 0.7,
      alertOutline: alertScale !== undefined,
      dash: alertScale !== undefined ? [5, 4] : [],
    });
  }

  // ---- tsunami forecast regions --------------------------------------
  // Only regions named by the current bulletin are shown. A cancelled bulletin
  // paints nothing: "cancelled" is not "still in force, but greyed out".
  let tsunami: TsunamiLayerScene | null = null;
  if (input.tsunamiLayerVisible !== false) {
    const bulletin = input.tsunami ?? null;
    if (bulletin && !bulletin.cancelled && bulletin.areas.length) {
      const { matched, unmatched } = matchRegionsByName(bulletin.areas.map((a) => a.name));
      const gradeByName = new Map<string, TsunamiGrade>();
      for (const area of bulletin.areas) {
        const existing = gradeByName.get(area.name);
        if (existing === undefined || gradeRank(area.grade) > gradeRank(existing)) {
          gradeByName.set(area.name, area.grade);
        }
      }
      const regions: TsunamiRegionHit[] = [];
      for (const region of matched) {
        const grade = gradeByName.get(region.name) ?? pickGrade(bulletin, region.name);
        if (!grade || grade === 'None' || grade === 'Unknown') continue;
        regions.push({ code: region.code, name: region.name, grade, region });
      }
      tsunami = { regions, unmatched, issuedAt: bulletin.issuedAt };
    } else {
      tsunami = { regions: [], unmatched: [], issuedAt: bulletin?.issuedAt ?? null };
    }
  }

  // ---- markers ------------------------------------------------------
  const markers: Marker[] = [];
  const limit = input.markerLimit ?? 40;
  const visible = events.slice(0, limit);
  for (const ev of visible) {
    const epi = ev.epicenter;
    if (!epi) continue;
    const screen = worldToScreen(camera, viewport, project({ lon: epi.longitude, lat: epi.latitude }));
    if (screen.x < -80 || screen.y < -80 || screen.x > viewport.width + 80 || screen.y > viewport.height + 80) {
      continue;
    }
    const style = scaleStyle(ev.maxIntensity);
    markers.push({
      id: ev.id,
      x: screen.x,
      y: screen.y,
      r: markerRadius(epi.magnitude, ev.maxIntensity),
      fill: style.fill,
      textColor: style.text,
      opacity: markerOpacity(ev.originTime === null ? null : now - ev.originTime),
      selected: ev.id === selectedId,
      kind: 'quake',
      label: null,
      intensity: ev.maxIntensity,
      magnitude: epi.magnitude,
      depthKm: epi.depthKm,
      ageMs: ev.originTime === null ? null : now - ev.originTime,
      preliminary: ev.preliminary,
    });
  }

  // Selected marker draws last (on top).
  markers.sort((a, b) => Number(a.selected) - Number(b.selected));

  // ---- labels -------------------------------------------------------
  const labels: SceneLabel[] = [];
  // Approximate placed-text boxes, so prefecture names and epicentre callouts
  // never print on top of each other (the live feed often has several events
  // within a few kilometres).
  const placed: Array<{ x: number; y: number; w: number; h: number }> = [];
  const overlaps = (x: number, y: number, w: number, h: number) =>
    placed.some((p) => Math.abs(p.x - x) < (p.w + w) / 2 && Math.abs(p.y - y) < (p.h + h) / 2);
  const showPrefLabels = zoomRatio > 1.7;
  for (const pref of geometry.prefectures) {
    if (!showPrefLabels) break;
    const screen = worldToScreen(camera, viewport, pref.label);
    if (screen.x < 0 || screen.y < 0 || screen.x > viewport.width || screen.y > viewport.height) continue;
    // Only label prefectures that occupy enough screen space to carry text.
    const w = Math.abs(pref.bbox.maxX - pref.bbox.minX) * camera.scale;
    const h = Math.abs(pref.bbox.maxY - pref.bbox.minY) * camera.scale;
    if (w < 46 || h < 24) continue;
    const labelW = pref.name.length * 11;
    if (overlaps(screen.x, screen.y, labelW, 13)) continue;
    placed.push({ x: screen.x, y: screen.y, w: labelW, h: 13 });
    labels.push({
      text: pref.name,
      x: screen.x,
      y: screen.y,
      alpha: Math.min(0.85, 0.3 + zoomRatio * 0.18),
      size: 11,
      weight: 500,
      color: theme.label,
    });
  }

  // Epicentre labels: selected first, then the two most recent events.
  const labelled = new Set<string>();
  const selectedMarker = markers.find((m) => m.selected);
  if (selectedMarker) labelled.add(selectedMarker.id);
  for (const m of markers) {
    if (labelled.size >= 3) break;
    if (!m.selected) labelled.add(m.id);
  }
  for (const m of markers) {
    if (!labelled.has(m.id)) continue;
    const ev = visible.find((e) => e.id === m.id);
    if (!ev?.epicenter) continue;
    const name = ev.epicenter.name ?? '震源不明';
    // Skip the callout for markers hidden behind the EEW crosshair.
    if (alert?.epicenter && m.selected) continue;
    const boxW = name.length * 11 + 8;
    const boxX = m.x + m.r + 6 + boxW / 2 - 4;
    if (overlaps(boxX, m.y + 4, boxW, 13)) continue;
    placed.push({ x: boxX, y: m.y + 4, w: boxW, h: 13 });
    labels.push({
      text: name,
      x: m.x + m.r + 6,
      y: m.y + 4,
      alpha: m.selected ? 1 : 0.8,
      size: m.selected ? 12 : 11,
      weight: m.selected ? 700 : 500,
      color: m.selected ? '#ffffff' : theme.label,
    });
  }

  // ---- EEW marker ---------------------------------------------------
  let eew: MapScene['eew'] = null;
  // A cancelled alert keeps its place in the panel, but drawing a red crosshair
  // for it on the map would suggest shaking is still expected. Don't.
  const alertOnMap =
    alert?.state === 'warning' || alert?.state === 'updated' || alert?.state === 'forecast';
  if (alert?.epicenter && alertOnMap) {
    const p = worldToScreen(camera, viewport, project({ lon: alert.epicenter.longitude, lat: alert.epicenter.latitude }));
    if (p.x > -200 && p.y > -200 && p.x < viewport.width + 200 && p.y < viewport.height + 200) {
      const style = hasIntensity(alert.maxScaleTo) ? scaleStyle(alert.maxScaleTo) : null;
      eew = {
        x: p.x,
        y: p.y,
        pulsing: alert.state === 'warning' || alert.state === 'updated' || alert.state === 'forecast',
        label: alert.epicenter.name ?? '震源不明',
        sublabel: style ? t('map.eewPredicted', { scale: style.label }) : null,
      };
    }
  }

  // ---- graticule ----------------------------------------------------
  const nw = screenToWorld(camera, viewport, { x: 0, y: 0 });
  const se = screenToWorld(camera, viewport, { x: viewport.width, y: viewport.height });
  const west = worldXToLon(nw.x);
  const east = worldXToLon(se.x);
  const north = worldYToLat(nw.y);
  const south = worldYToLat(se.y);
  const step = zoomRatio > 4 ? 1 : zoomRatio > 1.6 ? 2 : 5;
  const vertical: number[] = [];
  for (let lon = Math.ceil(west / step) * step; lon <= east; lon += step) {
    vertical.push(worldToScreen(camera, viewport, project({ lon, lat: 0 })).x);
  }
  const horizontal: number[] = [];
  for (let lat = Math.ceil(south / step) * step; lat <= north; lat += step) {
    horizontal.push(worldToScreen(camera, viewport, project({ lon: 0, lat })).y);
  }

  // ---- scale bar ----------------------------------------------------
  const centreLat = worldYToLat(camera.cy);
  const metresPerPx = (40_075_017 * Math.cos((centreLat * Math.PI) / 180)) / camera.scale;
  const targetPx = 90;
  const rawKm = (metresPerPx * targetPx) / 1000;
  const nice = niceDistance(rawKm);
  const scaleBar = { px: (nice * 1000) / metresPerPx, label: nice >= 1 ? `${nice} km` : `${Math.round(nice * 1000)} m` };

  // ---- Japan bounds in screen space ---------------------------------
  const a = worldToScreen(camera, viewport, { x: geometry.bbox.minX, y: geometry.bbox.minY });
  const b = worldToScreen(camera, viewport, { x: geometry.bbox.maxX, y: geometry.bbox.maxY });

  return {
    viewport,
    camera,
    scale: camera.scale,
    zoomRatio,
    prefectureStyles,
    labels,
    markers,
    eew,
    tsunami,
    graticule: { vertical, horizontal },
    scaleBar,
    attribution: t('map.attribution'),
    empty: markers.length === 0 && !eew,
    japanBounds: { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y },
  };
}

function niceDistance(km: number): number {
  const steps = [0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000];
  let best = steps[0]!;
  for (const s of steps) if (s <= km) best = s;
  return best;
}

/** Hex + alpha -> rgba(); keeps intensity fills usable as overlays. */
export function withAlpha(hex: string, alpha: number): string {
  if (hex.startsWith('rgba') || hex.startsWith('rgb')) return hex;
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const r = Number.parseInt(full.slice(0, 2), 16);
  const g = Number.parseInt(full.slice(2, 4), 16);
  const b = Number.parseInt(full.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Nearest marker within `tolerance` px — used for tap/click selection. */
export function hitTest(scene: MapScene, point: Point, tolerance = 20): Marker | null {
  let best: Marker | null = null;
  let bestD = Infinity;
  for (const m of scene.markers) {
    const d = Math.hypot(m.x - point.x, m.y - point.y);
    if (d <= m.r + tolerance && d < bestD) {
      best = m;
      bestD = d;
    }
  }
  return best;
}
