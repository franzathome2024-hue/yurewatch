import type { EarthquakeEvent } from '../core/models';
import { mergeEarthquake } from '../sources/p2pquake/parse';

/**
 * Earthquake event list reduction (pure).
 *
 * One earthquake can arrive as several JMA telegrams (震度速報 → 震源情報 →
 * 各地の震度). They share an origin time, so we merge them into one event and
 * count revisions rather than showing duplicates in the feed.
 */

export interface EventListOptions {
  /** Maximum events retained in memory / shown in the feed. */
  limit?: number;
}

export function sortEvents(events: EarthquakeEvent[]): EarthquakeEvent[] {
  return [...events].sort((a, b) => {
    const at = a.originTime ?? a.receivedAt;
    const bt = b.originTime ?? b.receivedAt;
    return bt - at;
  });
}

export function ingestEvents(
  current: EarthquakeEvent[],
  incoming: EarthquakeEvent[],
  opts: EventListOptions = {},
): { events: EarthquakeEvent[]; changed: boolean } {
  const limit = opts.limit ?? 80;
  const byId = new Map(current.map((e) => [e.id, e]));
  let changed = false;

  for (const ev of incoming) {
    const existing = byId.get(ev.id);
    if (!existing) {
      byId.set(ev.id, ev);
      changed = true;
      continue;
    }
    // Same origin time: merge. Skipping when the payload is identical keeps the
    // revision counter meaningful (and avoids needless re-renders).
    const duplicate =
      existing.infoType === ev.infoType &&
      existing.sourceIds.some((id) => ev.sourceIds.includes(id));
    if (duplicate) continue;
    byId.set(ev.id, mergeEarthquake(existing, ev));
    changed = true;
  }

  if (!changed) return { events: current, changed: false };
  const events = sortEvents([...byId.values()]).slice(0, limit);
  return { events, changed: true };
}

/** Max observed intensity per prefecture, for map shading. */
export function intensityByPrefecture(events: EarthquakeEvent[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const ev of events) {
    for (const p of ev.points) {
      if (!p.pref) continue;
      const prev = out.get(p.pref);
      if (prev === undefined || p.scale > prev) out.set(p.pref, p.scale);
    }
  }
  return out;
}
