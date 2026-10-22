import { describe, expect, it } from 'vitest';
import type { EarthquakeEvent, EewAlert } from '../src/core/models';
import { DEMO_SOURCE, parseBatch, parseEarthquake, parseEew } from '../src/sources/p2pquake/parse';
import {
  Store,
  connectionLabel,
  freshnessLabel,
  freshnessOf,
  initialState,
  isDataUntrustworthy,
  reduce,
  selectEvent,
  type Action,
  type AppState,
} from '../src/state/store';
import { eewCancelled, eewWarning, quakeDetail } from './fixtures';

const T = Date.parse('2026-10-22T07:50:00Z');

function quake(at = T): EarthquakeEvent {
  const r = parseEarthquake(quakeDetail, at);
  if (!r.ok) throw new Error(r.reason);
  return r.value;
}

function alert(raw: unknown = eewWarning, at = T, source = undefined): EewAlert {
  const r = parseEew(raw, at, source);
  if (!r.ok) throw new Error(r.reason);
  return r.value;
}

const run = (state: AppState, ...actions: Action[]): AppState =>
  actions.reduce((s, a) => reduce(s, a, { sound: () => {} }), state);

describe('reducer — connection', () => {
  it('records success and clears failure counters', () => {
    const s = run(initialState('live', T), { type: 'connection', state: 'live', at: T });
    expect(s.health.state).toBe('live');
    expect(s.health.lastSuccessAt).toBe(T);
    expect(s.health.consecutiveFailures).toBe(0);
  });

  it('counts failures and keeps the last error', () => {
    const s = run(
      initialState('live', T),
      { type: 'error', message: 'ネットワークエラー', at: T },
      { type: 'connection', state: 'offline', at: T + 1000, detail: 'つながりません' },
    );
    expect(s.health.consecutiveFailures).toBeGreaterThanOrEqual(2);
    expect(s.health.lastError).toBe('つながりません');
    expect(s.health.state).toBe('offline');
  });

  it('treats offline and stale as untrustworthy', () => {
    const offline = run(initialState('live', T), { type: 'connection', state: 'offline', at: T });
    expect(isDataUntrustworthy(offline)).toBe(true);
    const live = run(initialState('live', T), { type: 'connection', state: 'live', at: T });
    expect(isDataUntrustworthy(live)).toBe(false);
  });
});

describe('reducer — batch', () => {
  it('ingests events and auto-selects the newest one', () => {
    const s = run(initialState('live', T), {
      type: 'batch',
      events: [quake()],
      eews: [],
      tsunami: null,
      at: T,
      rejected: 0,
    });
    expect(s.events).toHaveLength(1);
    expect(s.selectedEventId).toBe(s.events[0]?.id);
    expect(selectEvent(s)?.epicenter?.name).toBe('熊本県熊本地方');
  });

  it('keeps an explicit selection that still exists', () => {
    const first = run(initialState('live', T), {
      type: 'batch',
      events: [quake()],
      eews: [],
      tsunami: null,
      at: T,
      rejected: 0,
    });
    const otherQuake = parseEarthquake({ ...quakeDetail, id: 'x', earthquake: { ...quakeDetail.earthquake, time: '2026/10/21 01:00:00' } }, T);
    if (!otherQuake.ok) throw new Error('bad fixture');
    const second = run(first, {
      type: 'batch',
      events: [otherQuake.value],
      eews: [],
      tsunami: null,
      at: T + 1,
      rejected: 0,
    });
    // The newer event is not auto-selected because a valid selection exists.
    expect(second.selectedEventId).toBe(first.selectedEventId);
  });

  it('raises and then revises the alert', () => {
    const first = run(initialState('live', T), {
      type: 'batch',
      events: [],
      eews: [alert()],
      tsunami: null,
      at: T,
      rejected: 0,
    });
    expect(first.alert?.state).toBe('warning');

    const second = run(first, {
      type: 'batch',
      events: [],
      eews: [alert({ ...eewWarning, issue: { ...eewWarning.issue, serial: '2' } }, T + 3000)],
      tsunami: null,
      at: T + 3000,
      rejected: 0,
    });
    expect(second.alert?.state).toBe('updated');
    expect(second.alertHistory.length).toBeGreaterThanOrEqual(1);
  });

  it('counts duplicates instead of letting them churn state', () => {
    const first = run(initialState('live', T), {
      type: 'batch',
      events: [],
      eews: [alert()],
      tsunami: null,
      at: T,
      rejected: 0,
    });
    const second = run(first, {
      type: 'batch',
      events: [],
      eews: [alert()],
      tsunami: null,
      at: T + 1000,
      rejected: 0,
    });
    expect(second.alert).toBe(first.alert);
    expect(second.diagnostics.duplicateAlertsIgnored).toBe(1);
  });

  it('counts rejected records without failing the batch', () => {
    const parsed = parseBatch([quakeDetail, { code: 551 }], T);
    const s = run(initialState('live', T), {
      type: 'batch',
      events: parsed.quakes,
      eews: parsed.eews,
      tsunami: null,
      at: T,
      rejected: parsed.rejected.length,
    });
    expect(s.events).toHaveLength(1);
    expect(s.diagnostics.rejectedRecords).toBe(1);
  });

  it('keeps the newest tsunami bulletin', () => {
    const older = {
      id: 'a',
      issuedAt: T,
      receivedAt: T,
      cancelled: false,
      areas: [],
      source: { authority: 'jma-via-p2pquake' as const, provider: 'p2p', official: true, relayed: true },
    };
    const newer = { ...older, id: 'b', receivedAt: T + 5000, issuedAt: T + 5000 };
    const first = run(initialState('live', T), { type: 'batch', events: [], eews: [], tsunami: older, at: T, rejected: 0 });
    const second = run(first, { type: 'batch', events: [], eews: [], tsunami: newer, at: T + 5000, rejected: 0 });
    const third = run(second, { type: 'batch', events: [], eews: [], tsunami: older, at: T + 6000, rejected: 0 });
    expect(second.tsunami?.id).toBe('b');
    expect(third.tsunami?.id).toBe('b'); // an out-of-order bulletin must not win
  });
});

describe('reducer — alert lifecycle', () => {
  it('expires an alert on tick', () => {
    const s = run(initialState('live', T), {
      type: 'batch',
      events: [],
      eews: [alert()],
      tsunami: null,
      at: T,
      rejected: 0,
    });
    expect(s.alert).not.toBeNull();
    const later = run(s, { type: 'tick', now: T + 10 * 60_000 });
    expect(later.alert).toBeNull();
  });

  it('clears cancelled alerts after their shorter TTL', () => {
    let s = run(initialState('live', T), { type: 'batch', events: [], eews: [alert()], tsunami: null, at: T, rejected: 0 });
    s = run(s, { type: 'batch', events: [], eews: [alert(eewCancelled, T + 1000)], tsunami: null, at: T + 1000, rejected: 0 });
    expect(s.alert?.state).toBe('cancelled');
    expect(run(s, { type: 'tick', now: T + 1000 + 91_000 }).alert).toBeNull();
  });

  it('can be dismissed manually', () => {
    const s = run(
      initialState('live', T),
      { type: 'batch', events: [], eews: [alert()], tsunami: null, at: T, rejected: 0 },
      { type: 'dismiss-alert' },
    );
    expect(s.alert).toBeNull();
  });
});

describe('reducer — modes and reset', () => {
  it('switches to demo mode without pretending data is live', () => {
    const s = run(initialState('live', T), { type: 'mode', mode: 'demo' });
    expect(s.mode).toBe('demo');
    // The transport state stays honest (it may still report failures); the mode
    // is what marks the data as simulated.
    expect(s.health.state).toBe('connecting');
  });

  it('keeps demo-mode connection failures visible', () => {
    const s = run(
      initialState('demo', T),
      { type: 'connection', state: 'offline', at: T, detail: 'ネットワークに接続できません（デモ）' },
    );
    expect(s.mode).toBe('demo');
    expect(s.health.state).toBe('offline');
    expect(isDataUntrustworthy(s)).toBe(true);
  });

  it('marks simulated payloads so the UI can label them', () => {
    const parsed = parseBatch([eewWarning, quakeDetail], T, DEMO_SOURCE);
    const s = run(initialState('demo', T), {
      type: 'batch',
      events: parsed.quakes,
      eews: parsed.eews,
      tsunami: null,
      at: T,
      rejected: 0,
    });
    expect(s.events.every((e) => e.simulated)).toBe(true);
    expect(s.alert?.simulated).toBe(true);
    expect(s.alert?.source.official).toBe(false);
    expect(s.events[0]?.source.authority).toBe('simulation');
  });

  it('reset-data clears events, alerts and diagnostics but not preferences', () => {
    const s = run(
      initialState('live', T),
      { type: 'preferences', patch: { soundEnabled: true } },
      { type: 'batch', events: [quake()], eews: [alert()], tsunami: null, at: T, rejected: 0 },
      { type: 'reset-data' },
    );
    expect(s.events).toHaveLength(0);
    expect(s.alert).toBeNull();
    expect(s.selectedEventId).toBeNull();
    expect(s.preferences.soundEnabled).toBe(true);
    expect(s.diagnostics.batches).toBe(0);
  });
});

describe('freshness', () => {
  it('labels age bands', () => {
    expect(freshnessOf(T, T + 10_000)).toBe('fresh');
    expect(freshnessOf(T, T + 90_000)).toBe('aging');
    expect(freshnessOf(T, T + 400_000)).toBe('stale');
    expect(freshnessOf(null, T)).toBe('no-data');
    expect(freshnessLabel('stale')).toBe('情報が古い');
  });
});

describe('Store', () => {
  it('notifies subscribers and ignores no-op actions', () => {
    const store = new Store(initialState('live', T));
    let calls = 0;
    store.subscribe(() => {
      calls += 1;
    });
    store.dispatch({ type: 'select', id: 'a' });
    store.dispatch({ type: 'select', id: 'a' });
    expect(calls).toBe(1);
  });
});

describe('reducer — selection stability', () => {
  it('auto-selects only on the first load, never re-opens a dismissed panel', () => {
    let s = run(initialState('live', T), { type: 'batch', events: [quake()], eews: [], tsunami: null, at: T, rejected: 0 });
    expect(s.selectedEventId).not.toBeNull();

    s = run(s, { type: 'select', id: null });
    expect(s.selectedEventId).toBeNull();

    // A later batch with new data must not steal the selection back.
    const another = parseEarthquake(
      { ...quakeDetail, id: 'later', earthquake: { ...quakeDetail.earthquake, time: '2026/10/22 06:00:00' } },
      T + 5000,
    );
    if (!another.ok) throw new Error('bad fixture');
    s = run(s, { type: 'batch', events: [another.value], eews: [], tsunami: null, at: T + 5000, rejected: 0 });
    expect(s.selectedEventId).toBeNull();
    expect(s.events).toHaveLength(2);
  });
});
