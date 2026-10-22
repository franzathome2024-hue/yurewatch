import type {
  EarthquakeEvent,
  EewAlert,
  EewArea,
  Epicenter,
  JmaQuakeType,
  JmaScale,
  ObservationPoint,
  SourceRef,
  TsunamiArea,
  TsunamiGrade,
  TsunamiInfo,
} from '../../core/models';
import { maxScale } from '../../core/intensity';
import { parseJst } from '../../core/time';
import type { RawEew, RawJmaQuake, RawTsunami } from './wire';

/**
 * Pure parsers: P2P地震情報 JSON -> domain model.
 *
 * Design rules enforced here (and covered by tests):
 *  - Never invent a value. JMA sentinels (-1 depth/magnitude/scale, -200 lat/lon)
 *    become `null`/unknown, never 0.
 *  - Never substitute a timestamp. A missing issue time stays `null`.
 *  - Never upgrade confidence. A 震度速報 stays `preliminary: true`.
 *  - Malformed input returns a typed failure instead of throwing, so one bad
 *    record cannot take down the feed.
 */

export type ParseResult<T> = { ok: true; value: T } | { ok: false; reason: string };

export const P2PQUAKE_SOURCE: SourceRef = {
  authority: 'jma-via-p2pquake',
  provider: '気象庁 / P2P地震情報',
  official: true,
  relayed: true,
  url: 'https://www.p2pquake.net/',
};

export const DEMO_SOURCE: SourceRef = {
  authority: 'simulation',
  provider: 'YureWatch DEMO ENGINE',
  official: false,
  relayed: false,
};

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** JMA scale codes arrive as floats ("system quirk"); the integer part is significant. */
export function normaliseScale(v: unknown): JmaScale | null {
  if (!isFiniteNumber(v)) return null;
  if (v < 0) return null;
  const n = Math.trunc(v);
  return n as JmaScale;
}

const QUAKE_TYPES: JmaQuakeType[] = [
  'ScalePrompt',
  'Destination',
  'ScaleAndDestination',
  'DetailScale',
  'Foreign',
  'Other',
];

export function normaliseQuakeType(v: unknown): JmaQuakeType {
  return typeof v === 'string' && (QUAKE_TYPES as string[]).includes(v) ? (v as JmaQuakeType) : 'unknown';
}

const TSUNAMI_GRADES: TsunamiGrade[] = [
  'None',
  'Unknown',
  'Checking',
  'NonEffective',
  'Watch',
  'Warning',
  'MajorWarning',
];

export function normaliseTsunamiGrade(v: unknown): TsunamiGrade {
  return typeof v === 'string' && (TSUNAMI_GRADES as string[]).includes(v)
    ? (v as TsunamiGrade)
    : 'Unknown';
}

/** JMA 仮定震源要素 flag: the hypocentre solution is provisional. */
const PROVISIONAL_MARKERS = ['仮定震源要素', '仮定震源'];

export function parseEpicenter(
  h: { name?: string; latitude?: number; longitude?: number; depth?: number; magnitude?: number } | undefined | null,
  condition?: string | null,
): Epicenter | null {
  if (!h) return null;
  const lat = h.latitude;
  const lon = h.longitude;
  // JMA uses -200 for "no hypocentre solution".
  if (!isFiniteNumber(lat) || !isFiniteNumber(lon)) return null;
  if (lat <= -200 || lon <= -200) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  const depth = isFiniteNumber(h.depth) && h.depth >= 0 ? h.depth : -1;
  const magnitude = isFiniteNumber(h.magnitude) && h.magnitude > 0 ? h.magnitude : -1;
  const provisional =
    typeof condition === 'string' && PROVISIONAL_MARKERS.some((m) => condition.includes(m));
  return {
    name: typeof h.name === 'string' && h.name.trim() ? h.name.trim() : null,
    latitude: lat,
    longitude: lon,
    depthKm: depth,
    magnitude,
    provisional,
  };
}

/** Completeness rank of a 地震情報 telegram; higher wins when merging revisions. */
export function infoTypeRank(t: JmaQuakeType): number {
  switch (t) {
    case 'DetailScale':
      return 4;
    case 'ScaleAndDestination':
      return 3;
    case 'Destination':
      return 2;
    case 'ScalePrompt':
      return 1;
    default:
      return 0;
  }
}

function eventIdFor(originTime: number | null, fallback: string): string {
  if (originTime === null) return `q-${fallback}`;
  // Origin time is unique enough in practice and is stable across revisions,
  // which is exactly what we need for de-duplication.
  return `q-${new Date(originTime).toISOString()}`;
}

export function parseEarthquake(
  raw: unknown,
  receivedAt: number,
  source: SourceRef = P2PQUAKE_SOURCE,
): ParseResult<EarthquakeEvent> {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'not an object' };
  const r = raw as Partial<RawJmaQuake>;
  if (r.code !== 551) return { ok: false, reason: `unexpected code ${String(r.code)}` };
  if (!r.earthquake || typeof r.earthquake !== 'object') return { ok: false, reason: 'missing earthquake' };
  if (typeof r.id !== 'string' || !r.id) return { ok: false, reason: 'missing id' };

  const originTime = parseJst(r.earthquake.time ?? null);
  const issuedAt = parseJst(r.issue?.time ?? null);
  const infoType = normaliseQuakeType(r.issue?.type);

  const points: ObservationPoint[] = [];
  if (Array.isArray(r.points)) {
    for (const p of r.points) {
      if (!p || typeof p !== 'object') continue;
      const scale = normaliseScale(p.scale);
      if (scale === null) continue;
      const pref = typeof p.pref === 'string' ? p.pref.trim() : '';
      const name = typeof p.addr === 'string' ? p.addr.trim() : '';
      if (!pref && !name) continue;
      points.push({ pref, name, scale });
    }
  }

  const reportedMax = normaliseScale(r.earthquake.maxScale);
  const derivedMax = maxScale(points.map((p) => p.scale));

  return {
    ok: true,
    value: {
      id: eventIdFor(originTime, r.id),
      sourceIds: [r.id],
      originTime,
      issuedAt,
      receivedAt,
      infoType,
      correction: typeof r.issue?.correct === 'string' ? r.issue.correct : 'None',
      epicenter: parseEpicenter(r.earthquake.hypocenter),
      maxIntensity: reportedMax ?? derivedMax,
      points,
      tsunami: normaliseTsunamiGrade(r.earthquake.domesticTsunami),
      simulated: source.authority === 'simulation',
      revision: 1,
      preliminary: infoType !== 'DetailScale',
      source,
    },
  };
}

/**
 * Merge a newer telegram into an existing event.
 * Later, more complete announcements replace earlier ones; observed points are
 * unioned (a 詳細 report carries more points than a 震度速報).
 */
export function mergeEarthquake(prev: EarthquakeEvent, next: EarthquakeEvent): EarthquakeEvent {
  const nextIsBetter = infoTypeRank(next.infoType) >= infoTypeRank(prev.infoType);
  const pointMap = new Map<string, ObservationPoint>();
  for (const p of prev.points) pointMap.set(`${p.pref}|${p.name}`, p);
  for (const p of next.points) pointMap.set(`${p.pref}|${p.name}`, p);
  const points = [...pointMap.values()].sort((a, b) => b.scale - a.scale);

  const epicenter = next.epicenter ?? prev.epicenter;
  const base = nextIsBetter ? next : prev;
  return {
    ...base,
    id: prev.id,
    sourceIds: [...new Set([...prev.sourceIds, ...next.sourceIds])],
    originTime: prev.originTime ?? next.originTime,
    issuedAt: next.issuedAt ?? prev.issuedAt,
    epicenter,
    maxIntensity: maxScale([prev.maxIntensity, next.maxIntensity, ...points.map((p) => p.scale)]),
    points,
    tsunami: next.tsunami !== 'Unknown' ? next.tsunami : prev.tsunami,
    revision: prev.revision + 1,
    preliminary: next.preliminary && prev.preliminary,
    receivedAt: Math.min(prev.receivedAt, next.receivedAt),
    simulated: prev.simulated || next.simulated,
  };
}

/**
 * EEW alert level derived from the message itself.
 *
 * JMA 警報 always carries 警報対象区域; 予報 does not. The public P2P relay only
 * forwards 警報, so an area-less message means we received prediction-grade
 * content and must NOT be presented as a warning.
 */
export function deriveEewLevel(areas: EewArea[], cancelled: boolean): 'warning' | 'forecast' | 'cancelled' {
  if (cancelled) return 'cancelled';
  return areas.length > 0 ? 'warning' : 'forecast';
}

export function parseEew(
  raw: unknown,
  receivedAt: number,
  source: SourceRef = P2PQUAKE_SOURCE,
): ParseResult<EewAlert> {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'not an object' };
  const r = raw as Partial<RawEew>;
  if (r.code !== 556) return { ok: false, reason: `unexpected code ${String(r.code)}` };
  if (!r.issue || typeof r.issue !== 'object' || typeof r.issue.eventId !== 'string') {
    return { ok: false, reason: 'missing issue.eventId' };
  }
  const serial = Number.parseInt(String(r.issue.serial ?? '0'), 10);
  if (!Number.isFinite(serial) || serial < 0) return { ok: false, reason: 'bad serial' };

  const cancelled = r.cancelled === true;
  const areas: EewArea[] = [];
  if (Array.isArray(r.areas)) {
    for (const a of r.areas) {
      if (!a || typeof a !== 'object') continue;
      const from = normaliseScale(a.scaleFrom);
      const to = normaliseScale(a.scaleTo);
      if (!a.name || from === null) continue;
      areas.push({
        pref: typeof a.pref === 'string' ? a.pref : '',
        name: String(a.name),
        scaleFrom: from,
        scaleTo: (to ?? from) as JmaScale,
        kindCode: typeof a.kindCode === 'string' ? a.kindCode : '',
        arrivalTime: parseJst(a.arrivalTime ?? null),
      });
    }
  }

  const eq = r.earthquake ?? null;
  const level = deriveEewLevel(areas, cancelled);
  const state = level === 'cancelled' ? 'cancelled' : level;

  return {
    ok: true,
    value: {
      eventId: r.issue.eventId,
      serial,
      state,
      issuedAt: parseJst(r.issue.time ?? null),
      receivedAt,
      originTime: parseJst(eq?.originTime ?? null),
      epicenter: parseEpicenter(eq?.hypocenter, eq?.condition ?? null),
      areas: areas.sort((a, b) => b.scaleTo - a.scaleTo),
      maxScaleTo: maxScale(areas.map((a) => a.scaleTo)),
      isTest: r.test === true,
      simulated: source.authority === 'simulation',
      revision: 1,
      source,
    },
  };
}

export function parseTsunami(
  raw: unknown,
  receivedAt: number,
  source: SourceRef = P2PQUAKE_SOURCE,
): ParseResult<TsunamiInfo> {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'not an object' };
  const r = raw as Partial<RawTsunami>;
  if (r.code !== 552) return { ok: false, reason: `unexpected code ${String(r.code)}` };
  if (typeof r.id !== 'string' || !r.id) return { ok: false, reason: 'missing id' };

  const areas: TsunamiArea[] = [];
  if (Array.isArray(r.areas)) {
    for (const a of r.areas) {
      if (!a || typeof a !== 'object') continue;
      if (!a.name) continue;
      areas.push({
        grade: normaliseTsunamiGrade(a.grade),
        name: String(a.name),
        immediate: a.immediate === true,
        arrivalTime: a.firstHeight?.arrivalTime ?? null,
        heightLabel: a.maxHeight?.description ?? null,
        heightValue: isFiniteNumber(a.maxHeight?.value) ? a.maxHeight.value : null,
      });
    }
  }

  return {
    ok: true,
    value: {
      id: r.id,
      issuedAt: parseJst(r.issue?.time ?? null),
      receivedAt,
      cancelled: r.cancelled === true,
      areas,
      source,
    },
  };
}

/** Tolerant batch entry point: one bad record must not discard the batch. */
export function parseBatch(items: unknown[], receivedAt: number, source: SourceRef = P2PQUAKE_SOURCE) {
  const quakes: EarthquakeEvent[] = [];
  const eews: EewAlert[] = [];
  const tsunamis: TsunamiInfo[] = [];
  const rejected: string[] = [];

  for (const item of items) {
    if (!item || typeof item !== 'object') {
      rejected.push('not an object');
      continue;
    }
    const code = (item as { code?: unknown }).code;
    if (code === 551) {
      const r = parseEarthquake(item, receivedAt, source);
      if (r.ok) quakes.push(r.value);
      else rejected.push(`551: ${r.reason}`);
    } else if (code === 556) {
      const r = parseEew(item, receivedAt, source);
      if (r.ok) eews.push(r.value);
      else rejected.push(`556: ${r.reason}`);
    } else if (code === 552) {
      const r = parseTsunami(item, receivedAt, source);
      if (r.ok) tsunamis.push(r.value);
      else rejected.push(`552: ${r.reason}`);
    }
    // Other codes (554 EEW detection, 561 userquake, 9611 …) are intentionally
    // ignored: we do not present them as official information.
  }
  return { quakes, eews, tsunamis, rejected };
}
