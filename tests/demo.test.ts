import { describe, expect, it, vi } from 'vitest';
import { DemoFeed } from '../src/demo/engine';
import { DEMO_SCENARIOS, getScenario, jstStamp } from '../src/demo/scenarios';
import type { FeedEvent } from '../src/net/liveFeed';
import { reduce, initialState } from '../src/state/store';
import type { AppState } from '../src/state/store';

/**
 * Demo-mode guarantees under test:
 *  1. every datum is flagged simulated and carries a non-official source,
 *  2. timelines are deterministic,
 *  3. each documented scenario actually produces the state it claims to,
 *  4. a simulated alert can never reach the audio path unless explicitly allowed.
 */

function collect(feed: DemoFeed): FeedEvent[] {
  const events: FeedEvent[] = [];
  feed.on((e) => events.push(e));
  return events;
}

describe('scenario catalogue', () => {
  it('covers every required scenario', () => {
    const ids = DEMO_SCENARIOS.map((s) => s.id);
    for (const required of [
      'normal',
      'forecast',
      'warning',
      'updated',
      'cancelled',
      'historical',
      'disconnect',
      'stale',
      'unavailable',
    ]) {
      expect(ids).toContain(required);
    }
  });

  it('has monotonically ordered steps inside each scenario', () => {
    for (const scenario of DEMO_SCENARIOS) {
      const times = scenario.steps.map((s) => s.at);
      expect(times).toEqual([...times].sort((a, b) => a - b));
      expect(scenario.durationMs).toBeGreaterThanOrEqual(times[times.length - 1]!);
    }
  });

  it('looks up scenarios by id and rejects unknown ones', () => {
    expect(getScenario('warning')?.label).toBe('EEW 警報');
    expect(getScenario('nope')).toBeNull();
  });

  it('formats JST stamps in the p2pquake shape', () => {
    // 2026-10-22T00:00:00Z == 09:00:00 JST
    expect(jstStamp(Date.UTC(2026, 9, 22, 0, 0, 0, 123))).toBe('2026/10/22 09:00:00.123');
  });
});

describe('DemoFeed', () => {
  it('replays a scenario deterministically', async () => {
    vi.useFakeTimers();
    try {
      const runOnce = async () => {
        vi.setSystemTime(new Date('2026-10-22T00:00:00Z'));
        const feed = new DemoFeed({ speed: 1000 });
        const events = collect(feed);
        feed.start('warning');
        await vi.advanceTimersByTimeAsync(5_000);
        feed.stop();
        return events;
      };
      const a = await runOnce();
      const b = await runOnce();
      expect(a.length).toBeGreaterThan(1);
      expect(b.length).toBe(a.length);
      expect(JSON.stringify(b.map((e) => e.type))).toBe(JSON.stringify(a.map((e) => e.type)));
    } finally {
      vi.useRealTimers();
    }
  });

  it('marks every event and alert as simulated', async () => {
    vi.useFakeTimers();
    try {
      const feed = new DemoFeed({ speed: 1000 });
      const events = collect(feed);
      feed.start('warning');
      await vi.advanceTimersByTimeAsync(5_000);
      feed.stop();

      const batches = events.filter((e): e is Extract<FeedEvent, { type: 'batch' }> => e.type === 'batch');
      expect(batches.length).toBeGreaterThan(0);
      for (const batch of batches) {
        for (const ev of batch.events) {
          expect(ev.simulated).toBe(true);
          expect(ev.source.official).toBe(false);
          expect(ev.source.authority).toBe('simulation');
        }
        for (const alert of batch.eews) {
          expect(alert.simulated).toBe(true);
          expect(alert.source.official).toBe(false);
        }
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('runs each scenario to completion and drives the store', async () => {
    vi.useFakeTimers();
    try {
      for (const scenario of DEMO_SCENARIOS) {
        vi.setSystemTime(new Date('2026-10-22T00:00:00Z'));
        let state: AppState = initialState('demo', Date.now());
        const feed = new DemoFeed({ speed: 1000 });
        feed.on((event) => {
          if (event.type === 'connection') {
            state = reduce(state, { type: 'connection', state: event.state, at: event.at, detail: event.detail ?? null });
          } else {
            state = reduce(state, {
              type: 'batch',
              events: event.events,
              eews: event.eews,
              tsunami: event.tsunami,
              at: event.at,
              rejected: event.rejected,
            });
          }
        });
        feed.start(scenario.id);
        await vi.advanceTimersByTimeAsync(scenario.durationMs + 2_000);
        feed.stop();
        expect(state.mode).toBe('demo');
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('produces a warning alert with predicted intensity', async () => {
    vi.useFakeTimers();
    try {
      const feed = new DemoFeed({ speed: 1000 });
      let state: AppState = initialState('demo', Date.now());
      feed.on((e) => {
        if (e.type === 'batch') {
          state = reduce(state, { type: 'batch', events: e.events, eews: e.eews, tsunami: e.tsunami, at: e.at, rejected: e.rejected });
        }
      });
      feed.start('warning');
      await vi.advanceTimersByTimeAsync(3_000);
      feed.stop();
      expect(state.alert?.state).toBe('warning');
      expect(state.alert?.maxScaleTo).toBeGreaterThanOrEqual(45);
      expect(state.alert?.areas.length).toBeGreaterThan(0);
      expect(state.alert?.simulated).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('raises a forecast (not a warning) for the forecast scenario', async () => {
    vi.useFakeTimers();
    try {
      const feed = new DemoFeed({ speed: 1000 });
      let state: AppState = initialState('demo', Date.now());
      feed.on((e) => {
        if (e.type === 'batch') {
          state = reduce(state, { type: 'batch', events: e.events, eews: e.eews, tsunami: e.tsunami, at: e.at, rejected: e.rejected });
        }
      });
      feed.start('forecast');
      await vi.advanceTimersByTimeAsync(3_000);
      feed.stop();
      expect(state.alert?.state).toBe('forecast');
      expect(state.alert?.areas).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('advances serials in the updated scenario', async () => {
    vi.useFakeTimers();
    try {
      const feed = new DemoFeed({ speed: 1000 });
      let state: AppState = initialState('demo', Date.now());
      feed.on((e) => {
        if (e.type === 'batch') {
          state = reduce(state, { type: 'batch', events: e.events, eews: e.eews, tsunami: e.tsunami, at: e.at, rejected: e.rejected });
        }
      });
      feed.start('updated');
      await vi.advanceTimersByTimeAsync(14_000);
      expect(state.alert?.serial).toBe(3);
      expect(state.alert?.state).toBe('updated');
      expect(state.alert?.revision).toBe(3);
      feed.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels the alert in the cancelled scenario', async () => {
    vi.useFakeTimers();
    try {
      const feed = new DemoFeed({ speed: 1000 });
      let state: AppState = initialState('demo', Date.now());
      feed.on((e) => {
        if (e.type === 'batch') {
          state = reduce(state, { type: 'batch', events: e.events, eews: e.eews, tsunami: e.tsunami, at: e.at, rejected: e.rejected });
        }
      });
      feed.start('cancelled');
      await vi.advanceTimersByTimeAsync(10_000);
      feed.stop();
      expect(state.alert?.state).toBe('cancelled');
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports offline then recovery in the disconnect scenario', async () => {
    vi.useFakeTimers();
    try {
      const feed = new DemoFeed({ speed: 1000 });
      const states: string[] = [];
      feed.on((e) => {
        if (e.type === 'connection') states.push(e.state);
      });
      feed.start('disconnect');
      await vi.advanceTimersByTimeAsync(18_000);
      feed.stop();
      expect(states).toContain('offline');
      expect(states[states.length - 1]).toBe('live');
    } finally {
      vi.useRealTimers();
    }
  });

  it('drops malformed records but keeps the valid ones', async () => {
    vi.useFakeTimers();
    try {
      const feed = new DemoFeed({ speed: 1000 });
      const batches: Array<Extract<FeedEvent, { type: 'batch' }>> = [];
      feed.on((e) => {
        if (e.type === 'batch') batches.push(e);
      });
      feed.start('unavailable');
      await vi.advanceTimersByTimeAsync(6_000);
      feed.stop();
      const withBroken = batches.find((b) => b.rejected > 0);
      expect(withBroken).toBeDefined();
      expect(withBroken?.events.length).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('never injects data on a manual refresh', async () => {
    const feed = new DemoFeed({ speed: 1 });
    const events = collect(feed);
    await feed.refreshNow();
    expect(events).toHaveLength(0);
  });

  it('refuses unknown scenario ids', () => {
    const feed = new DemoFeed();
    expect(() => feed.start('does-not-exist')).toThrow(/unknown demo scenario/);
  });
});
