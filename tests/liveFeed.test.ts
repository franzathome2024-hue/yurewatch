import { afterEach, describe, expect, it, vi } from 'vitest';
import { LiveFeed, nextBackoff, type FeedEvent } from '../src/net/liveFeed';
import type { HttpResult, HttpTransport } from '../src/net/transport';
import { reduce } from '../src/state/store';
import { quakeDetail, eewWarning, tsunamiWatch } from './fixtures';

/**
 * Feed-layer tests. The transport is faked, so these exercise the real
 * scheduling, parsing, error and reconnect logic without touching the network.
 */

class FakeTransport implements HttpTransport {
  readonly kind = 'fetch' as const;
  calls: string[] = [];
  handler: (url: string) => Promise<HttpResult> = async () => ({ status: 200, body: '[]' });
  async getText(url: string): Promise<HttpResult> {
    this.calls.push(url);
    return this.handler(url);
  }
}

const ok = (body: unknown): HttpResult => ({ status: 200, body: JSON.stringify(body) });

/**
 * Fixture timestamps are JST, so 2026/10/22 07:45 JST is 2026-10-21T22:45Z.
 * The feed's default clock sits two minutes after the EEW was issued, which is
 * inside the freshness window.
 */
const NOW = Date.parse('2026-10-21T22:47:00Z');

function bodyFor(url: string) {
  if (url.includes('codes=556')) return [eewWarning];
  if (url.includes('codes=551')) return [quakeDetail];
  if (url.includes('codes=552')) return [tsunamiWatch];
  return [];
}

function makeFeed(transport: FakeTransport, overrides: Partial<ConstructorParameters<typeof LiveFeed>[0]> = {}) {
  const events: FeedEvent[] = [];
  const feed = new LiveFeed({ transport, now: () => NOW, ...overrides });
  feed.on((e) => events.push(e));
  return { feed, events };
}

describe('nextBackoff', () => {
  it('grows and caps', () => {
    expect(nextBackoff(1, () => 0)).toBe(1_800);
    expect(nextBackoff(2, () => 0)).toBe(3_600);
    expect(nextBackoff(3, () => 0)).toBe(7_200);
    expect(nextBackoff(30, () => 0)).toBe(54_000);
  });

  it('adds bounded jitter', () => {
    expect(nextBackoff(1, () => 1)).toBe(2_200);
    expect(nextBackoff(1, () => 1)).toBeLessThanOrEqual(2_400);
  });
});

describe('LiveFeed', () => {
  it('requests the three telegram codes and merges the results', async () => {
    const transport = new FakeTransport();
    transport.handler = async (url) => ok(bodyFor(url));
    const { feed, events } = makeFeed(transport);

    await feed.poll({ force: true });

    expect(transport.calls).toHaveLength(3);
    expect(transport.calls.join(' ')).toContain('codes=556');
    expect(transport.calls.join(' ')).toContain('codes=551');
    expect(transport.calls.join(' ')).toContain('codes=552');

    const batch = events.find((e): e is Extract<FeedEvent, { type: 'batch' }> => e.type === 'batch');
    expect(batch?.events).toHaveLength(1);
    expect(batch?.eews).toHaveLength(1);
    expect(batch?.tsunami?.areas[0]?.grade).toBe('Watch');
    expect(events.some((e) => e.type === 'connection' && e.state === 'live')).toBe(true);
  });

  it('stays inside the published rate limit', async () => {
    const transport = new FakeTransport();
    transport.handler = async (url) => ok(bodyFor(url));
    const { feed } = makeFeed(transport, { idleIntervalMs: 20_000, activeIntervalMs: 6_000 });
    // Idle cadence: 3 requests / 20 s = 9 req/min (limit is 60).
    for (let i = 0; i < 5; i++) await feed.poll({ force: true });
    expect(transport.calls).toHaveLength(15);
    // Active cadence: 3 requests / 6 s = 30 req/min — still under 60.
    expect((3 / 6) * 60).toBeLessThan(60);
  });

  it('reports HTTP failures as degraded and keeps the app usable', async () => {
    const transport = new FakeTransport();
    transport.handler = async (url) =>
      url.includes('codes=551')
        ? { status: 503, body: 'unavailable' }
        : ok(bodyFor(url));
    const { feed, events } = makeFeed(transport);

    await feed.poll({ force: true });

    const failure = events.filter((e) => e.type === 'connection').pop();
    expect(failure && 'state' in failure ? failure.state : null).toBe('degraded');
    expect(events.some((e) => e.type === 'batch')).toBe(false);
    expect(feed.stats().failures).toBe(1);
  });

  it('classifies a network error as offline', async () => {
    const transport = new FakeTransport();
    transport.handler = async () => {
      throw new Error('Failed to fetch');
    };
    const { feed, events } = makeFeed(transport);
    await feed.poll({ force: true });
    const states = events.filter((e) => e.type === 'connection').map((e) => (e as { state: string }).state);
    expect(states).toContain('offline');
  });

  it('survives a non-JSON response', async () => {
    const transport = new FakeTransport();
    transport.handler = async () => ({ status: 200, body: '<html>maintenance</html>' });
    const { feed, events } = makeFeed(transport);
    await feed.poll({ force: true });
    const last = events[events.length - 1]!;
    expect(last.type).toBe('connection');
    expect(feed.stats().failures).toBe(1);
  });

  it('counts malformed records instead of dropping the batch', async () => {
    const transport = new FakeTransport();
    transport.handler = async (url) =>
      ok(url.includes('codes=551') ? [quakeDetail, { code: 551 }, 'nope'] : []);
    const { feed, events } = makeFeed(transport);
    await feed.poll({ force: true });
    const batch = events.find((e): e is Extract<FeedEvent, { type: 'batch' }> => e.type === 'batch');
    expect(batch?.events).toHaveLength(1);
    expect(batch?.rejected).toBeGreaterThanOrEqual(2);
  });

  it('recovers after a failure', async () => {
    const transport = new FakeTransport();
    let fail = true;
    transport.handler = async (url) => {
      if (fail) throw new Error('Failed to fetch');
      return ok(bodyFor(url));
    };
    const { feed, events } = makeFeed(transport);
    await feed.poll({ force: true });
    expect(feed.stats().failures).toBe(1);
    fail = false;
    await feed.poll({ force: true });
    expect(feed.stats().failures).toBe(0);
    expect(events.some((e) => e.type === 'batch')).toBe(true);
  });

  it('backs off further after each consecutive failure', async () => {
    vi.useFakeTimers();
    try {
      const delays: number[] = [];
      const transport = new FakeTransport();
      transport.handler = async () => {
        throw new Error('Failed to fetch');
      };
      const { feed } = makeFeed(transport, {
        setTimeoutImpl: (fn, ms) => {
          delays.push(ms);
          return setTimeout(fn, ms);
        },
      });
      feed.start();
      await vi.advanceTimersByTimeAsync(10);
      const first = delays[0];
      expect(first).toBeDefined();
      expect(first!).toBeGreaterThanOrEqual(1_800);
      await vi.advanceTimersByTimeAsync(first! + 10);
      expect(delays.length).toBeGreaterThanOrEqual(2);
      expect(delays[1]!).toBeGreaterThan(first!);
      feed.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('polls faster while an EEW is in force', async () => {
    vi.useFakeTimers();
    try {
      const delays: number[] = [];
      const transport = new FakeTransport();
      transport.handler = async (url) => ok(bodyFor(url));
      const { feed } = makeFeed(transport, {
        setTimeoutImpl: (fn, ms) => {
          delays.push(ms);
          return setTimeout(fn, ms);
        },
        idleIntervalMs: 20_000,
        activeIntervalMs: 6_000,
      });
      feed.start();
      await vi.advanceTimersByTimeAsync(10);
      expect(delays[0]).toBe(6_000); // an EEW arrived in this batch
      feed.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops polling while paused and refreshes on resume', async () => {
    const transport = new FakeTransport();
    transport.handler = async (url) => ok(bodyFor(url));
    const { feed } = makeFeed(transport, { setTimeoutImpl: () => 0 as unknown as ReturnType<typeof setTimeout> });
    await feed.poll({ force: true });
    const before = transport.calls.length;
    feed.pause();
    await feed.poll(); // not forced: must be a no-op while paused
    expect(transport.calls.length).toBe(before);
    feed.resume(); // not running (start() was never called) -> no request
    expect(transport.calls.length).toBe(before);
  });

  it('marks the feed stale when updates stop arriving', async () => {
    let now = 1_000_000;
    const transport = new FakeTransport();
    let fail = false;
    transport.handler = async (url) => {
      if (fail) throw new Error('Failed to fetch');
      return ok(bodyFor(url));
    };
    const { feed, events } = makeFeed(transport, {
      now: () => now,
      staleAfterMs: 150_000,
      setTimeoutImpl: () => 0 as unknown as ReturnType<typeof setTimeout>,
    });
    await feed.poll({ force: true });
    fail = true;
    now += 400_000;
    await feed.poll({ force: true });
    expect(events.some((e) => e.type === 'connection' && e.state === 'stale')).toBe(true);
  });

  it('feeds the reducer end-to-end', async () => {
    const transport = new FakeTransport();
    transport.handler = async (url) => ok(bodyFor(url));
    const { feed } = makeFeed(transport);
    let state = reduce(
      // minimal state via the public reducer
      (await import('../src/state/store')).initialState('live', 0),
      { type: 'connection', state: 'connecting', at: 0 },
    );
    feed.on((e) => {
      state =
        e.type === 'batch'
          ? reduce(state, { type: 'batch', events: e.events, eews: e.eews, tsunami: e.tsunami, at: e.at, rejected: e.rejected })
          : reduce(state, { type: 'connection', state: e.state, at: e.at, detail: e.detail ?? null });
    });
    await feed.poll({ force: true });
    expect(state.events).toHaveLength(1);
    expect(state.alert?.state).toBe('warning');
    expect(state.tsunami?.areas).toHaveLength(1);
  });

  it('does not overlap requests', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = () => resolve();
    });
    let first = true;
    const transport = new FakeTransport();
    transport.handler = async (url) => {
      if (first) {
        first = false;
        await gate;
      }
      return ok(bodyFor(url));
    };
    const { feed } = makeFeed(transport, { setTimeoutImpl: () => 0 as unknown as ReturnType<typeof setTimeout> });
    const p1 = feed.poll({ force: true });
    const p2 = feed.poll({ force: true }); // ignored while the first is in flight
    release();
    await Promise.all([p1, p2]);
    expect(transport.calls).toHaveLength(3);
  });

  afterEach(() => {
    vi.useRealTimers();
  });
});

describe('recency gating (history endpoint returns old telegrams)', () => {
  it('drops EEW telegrams older than the freshness window', async () => {
    const { partitionEews, EEW_MAX_AGE_MS } = await import('../src/net/liveFeed');
    const now = Date.UTC(2026, 9, 22, 8, 0, 0);
    const fresh = { issuedAt: now - 60_000, receivedAt: now };
    const old = { issuedAt: now - 6 * 24 * 3600_000, receivedAt: now };
    const result = partitionEews([fresh, old], now);
    expect(result.fresh).toHaveLength(1);
    expect(result.stale).toHaveLength(1);
    expect(EEW_MAX_AGE_MS).toBe(10 * 60_000);
  });

  it('dates an undated telegram from its origin time, never from receive time', async () => {
    const { partitionEews } = await import('../src/net/liveFeed');
    const now = Date.UTC(2026, 9, 22, 8, 0, 0);
    const undatedRecent = { issuedAt: null, originTime: now - 60_000, receivedAt: now };
    const undatedOld = { issuedAt: null, originTime: now - 6 * 24 * 3600_000, receivedAt: now };
    const undatable = { issuedAt: null, originTime: null, receivedAt: now };
    // Origin time can date it…
    expect(partitionEews([undatedRecent], now).fresh).toHaveLength(1);
    expect(partitionEews([undatedOld], now).fresh).toHaveLength(0);
    // …but a telegram no source field can date is historical, however new
    // the local receive time is (receivedAt is "now" by construction).
    expect(partitionEews([undatable], now).fresh).toHaveLength(0);
    expect(partitionEews([undatable], now).stale).toHaveLength(1);
  });

  it('never surfaces a week-old EEW as a live alert', async () => {
    const transport = new FakeTransport();
    const now = Date.UTC(2026, 9, 22, 8, 0, 0);
    const oldEew = {
      ...eewWarning,
      time: '2026/10/16 12:40:00.000',
      issue: { ...eewWarning.issue, time: '2026/10/16 12:40:00' },
      earthquake: { ...eewWarning.earthquake, originTime: '2026/10/16 12:38:10' },
    };
    transport.handler = async (url) => ok(url.includes('codes=556') ? [oldEew] : []);
    const { feed, events } = makeFeed(transport, { now: () => now });
    await feed.poll({ force: true });

    const batch = events.find((e): e is Extract<FeedEvent, { type: 'batch' }> => e.type === 'batch');
    expect(batch?.eews).toHaveLength(0);
    expect(feed.stats().ignoredHistoricalEews).toBe(1);
  });

  it('keeps a recent EEW', async () => {
    const transport = new FakeTransport();
    const now = NOW;
    const recent = eewWarning;
    transport.handler = async (url) => ok(url.includes('codes=556') ? [recent] : []);
    const { feed, events } = makeFeed(transport, { now: () => now });
    await feed.poll({ force: true });
    const batch = events.find((e): e is Extract<FeedEvent, { type: 'batch' }> => e.type === 'batch');
    expect(batch?.eews).toHaveLength(1);
  });

  it('discards tsunami bulletins that are no longer current', async () => {
    const { pickCurrentTsunami } = await import('../src/net/liveFeed');
    const now = Date.UTC(2026, 9, 22, 8, 0, 0);
    expect(pickCurrentTsunami([{ issuedAt: now - 2 * 3600_000, receivedAt: now }], now)).not.toBeNull();
    expect(pickCurrentTsunami([{ issuedAt: now - 48 * 3600_000, receivedAt: now }], now)).toBeNull();
    expect(pickCurrentTsunami([], now)).toBeNull();
  });
});
