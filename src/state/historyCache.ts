import type { EarthquakeEvent } from '../core/models';

/**
 * Bounded on-device history of recent earthquake events.
 *
 * Purpose: a cold start with no network should show the recent earthquakes
 * from the last session instead of an empty map — clearly labelled as saved
 * history, never as live data.
 *
 * Safety contract:
 *  - Only earthquake *event records* are stored. EEW alert state and tsunami
 *    bulletins are never persisted, so nothing can be resurrected as an
 *    active warning: on restore there is no alert, by construction.
 *  - The snapshot carries the time of the last successful fetch (`savedAt`).
 *    The UI shows it as "saved history", and the store's freshness clock
 *    (`health.lastSuccessAt`) stays null until a real fetch succeeds this
 *    session — restored data can never look fresh.
 *  - Storage is best-effort. Corrupt JSON, a schema mismatch, malformed
 *    entries, an unavailable store, or a quota failure all degrade to
 *    "no history" without throwing. Simulated events are never written.
 *  - The same code runs in the browser and the Android WebView
 *    (`localStorage`, DomStorage is enabled in the shell). Where the store
 *    does not persist (some `file://` contexts), the feature silently
 *    no-ops rather than failing.
 */

export const HISTORY_KEY = 'yurewatch.history.v1';
export const HISTORY_SCHEMA = 1;
/** Hard bound on stored events, regardless of what the UI retains. */
export const HISTORY_LIMIT = 30;

export interface HistorySnapshot {
  /** When the snapshot was taken (the last successful fetch, ms epoch). */
  savedAt: number;
  events: EarthquakeEvent[];
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStorage(): StorageLike | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const probe = '__yurewatch_history_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return null;
  }
}

function isValidEvent(value: unknown): value is EarthquakeEvent {
  if (!value || typeof value !== 'object') return false;
  const e = value as Partial<EarthquakeEvent>;
  return (
    typeof e.id === 'string' &&
    e.id.length > 0 &&
    (e.originTime === null || Number.isFinite(e.originTime)) &&
    Number.isFinite(e.receivedAt) &&
    Array.isArray(e.points) &&
    Array.isArray(e.sourceIds)
  );
}

/**
 * Persist the current event list. Returns false (without throwing) when
 * storage is unavailable or full; on quota pressure it retries with a
 * shorter list before giving up.
 */
export function saveHistory(
  events: EarthquakeEvent[],
  savedAt: number,
  storage: StorageLike | null = defaultStorage(),
): boolean {
  if (!storage || !Number.isFinite(savedAt)) return false;
  const clean = events.filter((e) => !e.simulated).slice(0, HISTORY_LIMIT);
  if (!clean.length) return false;
  for (const limit of [clean.length, 15, 5]) {
    try {
      const payload = { v: HISTORY_SCHEMA, savedAt, events: clean.slice(0, limit) };
      storage.setItem(HISTORY_KEY, JSON.stringify(payload));
      return true;
    } catch {
      // Quota or privacy-mode failure: try a smaller snapshot, then give up.
    }
  }
  return false;
}

/**
 * Load the last snapshot, or null when there is nothing usable. Corrupt or
 * outdated payloads are removed so the next start does not trip over them
 * again.
 */
export function loadHistory(storage: StorageLike | null = defaultStorage()): HistorySnapshot | null {
  if (!storage) return null;
  let raw: string | null;
  try {
    raw = storage.getItem(HISTORY_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { v?: unknown; savedAt?: unknown; events?: unknown };
    if (parsed.v !== HISTORY_SCHEMA) throw new Error('schema');
    if (!Number.isFinite(parsed.savedAt) || !Array.isArray(parsed.events)) throw new Error('shape');
    const events = parsed.events.filter(isValidEvent).slice(0, HISTORY_LIMIT);
    if (!events.length) throw new Error('empty');
    return { savedAt: parsed.savedAt as number, events };
  } catch {
    try {
      storage.removeItem(HISTORY_KEY);
    } catch {
      /* best effort */
    }
    return null;
  }
}

export function clearHistory(storage: StorageLike | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(HISTORY_KEY);
  } catch {
    /* best effort */
  }
}
