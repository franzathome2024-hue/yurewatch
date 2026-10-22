import { describe, expect, it } from 'vitest';
import type { EarthquakeEvent } from '../src/core/models';
import {
  HISTORY_KEY,
  HISTORY_LIMIT,
  clearHistory,
  loadHistory,
  saveHistory,
} from '../src/state/historyCache';
import { initialState, reduce } from '../src/state/store';

const T = Date.parse('2026-10-22T07:50:00Z');

function ev(id: string, at = T): EarthquakeEvent {
  return {
    id,
    sourceIds: [`src-${id}`],
    originTime: at,
    issuedAt: at,
    receivedAt: at,
    infoType: 'DetailScale',
    correction: 'None',
    epicenter: {
      name: 'テスト',
      latitude: 35,
      longitude: 139,
      depthKm: 10,
      magnitude: 4.5,
      provisional: false,
    },
    maxIntensity: 30,
    points: [],
    tsunami: 'Unknown',
    simulated: false,
    revision: 1,
    preliminary: false,
    source: { authority: 'jma-via-p2pquake', provider: 'P2P地震情報', official: true, relayed: true },
  };
}

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

describe('historyCache', () => {
  it('round-trips events with their snapshot time', () => {
    const storage = memoryStorage();
    expect(saveHistory([ev('a'), ev('b')], T, storage)).toBe(true);
    const snap = loadHistory(storage);
    expect(snap?.savedAt).toBe(T);
    expect(snap?.events.map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('stores events only — no alert or tsunami state exists to resurrect', () => {
    const storage = memoryStorage();
    saveHistory([ev('a')], T, storage);
    const raw = JSON.parse(storage.map.get(HISTORY_KEY)!);
    expect(Object.keys(raw).sort()).toEqual(['events', 'savedAt', 'v']);
  });

  it('bounds the snapshot to HISTORY_LIMIT events', () => {
    const storage = memoryStorage();
    const many = Array.from({ length: HISTORY_LIMIT + 20 }, (_, i) => ev(`e${i}`));
    saveHistory(many, T, storage);
    expect(loadHistory(storage)?.events).toHaveLength(HISTORY_LIMIT);
  });

  it('never persists simulated events', () => {
    const storage = memoryStorage();
    saveHistory([ev('real'), { ...ev('sim'), simulated: true }], T, storage);
    expect(loadHistory(storage)?.events.map((e) => e.id)).toEqual(['real']);
  });

  it('degrades corrupt JSON to no history and clears the bad payload', () => {
    const storage = memoryStorage({ [HISTORY_KEY]: '{not json' });
    expect(loadHistory(storage)).toBeNull();
    expect(storage.map.has(HISTORY_KEY)).toBe(false);
  });

  it('rejects a snapshot from a different schema version', () => {
    const storage = memoryStorage({
      [HISTORY_KEY]: JSON.stringify({ v: 999, savedAt: T, events: [ev('a')] }),
    });
    expect(loadHistory(storage)).toBeNull();
    expect(storage.map.has(HISTORY_KEY)).toBe(false);
  });

  it('drops malformed entries but keeps valid ones', () => {
    const storage = memoryStorage({
      [HISTORY_KEY]: JSON.stringify({
        v: 1,
        savedAt: T,
        events: [ev('good'), { id: 42 }, null, { id: 'x', originTime: 'soon' }],
      }),
    });
    expect(loadHistory(storage)?.events.map((e) => e.id)).toEqual(['good']);
  });

  it('survives quota failures without throwing, shrinking the snapshot', () => {
    const throwing = {
      getItem: () => null,
      setItem: (_k: string, v: string) => {
        if (v.length > 400) throw new Error('QuotaExceededError');
      },
      removeItem: () => {},
    };
    const many = Array.from({ length: 20 }, (_, i) => ev(`quota-${i}`));
    expect(() => saveHistory(many, T, throwing)).not.toThrow();
  });

  it('returns false (no throw) when storage always fails', () => {
    const dead = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {},
    };
    expect(saveHistory([ev('a')], T, dead)).toBe(false);
    expect(loadHistory(dead)).toBeNull();
    expect(() => clearHistory(dead)).not.toThrow();
  });

  it('is a no-op without storage (e.g. storage disabled)', () => {
    expect(saveHistory([ev('a')], T, null)).toBe(false);
    expect(loadHistory(null)).toBeNull();
  });
});

describe('history restore in the store', () => {
  it('restores events without touching freshness or alert state', () => {
    const state = initialState('live', T);
    const next = reduce(state, { type: 'history-restored', events: [ev('a')], at: T - 3600_000 });
    expect(next.events).toHaveLength(1);
    expect(next.historySnapshotAt).toBe(T - 3600_000);
    // The whole point: restored history must not look like a fresh fetch.
    expect(next.health.lastSuccessAt).toBeNull();
    expect(next.alert).toBeNull();
    expect(next.tsunami).toBeNull();
  });

  it('fresh data supersedes restored history', () => {
    const restored = reduce(initialState('live', T), {
      type: 'history-restored',
      events: [ev('old')],
      at: T - 3600_000,
    });
    const fresh = reduce(restored, {
      type: 'batch',
      events: [ev('new')],
      eews: [],
      tsunami: null,
      at: T,
      rejected: 0,
    });
    expect(fresh.historySnapshotAt).toBeNull();
    expect(fresh.health.lastSuccessAt).toBe(T);
    expect(fresh.events.map((e) => e.id)).toContain('new');
  });
});
