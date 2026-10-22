import { describe, expect, it } from 'vitest';
import type { EewAlert } from '../src/core/models';
import {
  DEFAULT_ALERT_POLICY,
  expireAlert,
  ingestEew,
  nextArrival,
  pendingAreas,
  strongestAreas,
} from '../src/state/alert';
import { parseEew } from '../src/sources/p2pquake/parse';
import { eewCancelled, eewForecast, eewWarning } from './fixtures';

const T = Date.parse('2026-10-22T07:50:00Z');

function alert(raw: unknown, at = T): EewAlert {
  const r = parseEew(raw, at);
  if (!r.ok) throw new Error(r.reason);
  return r.value;
}

describe('ingestEew', () => {
  it('accepts a first warning', () => {
    const res = ingestEew(null, alert(eewWarning));
    expect(res.outcome).toBe('new');
    expect(res.alert?.state).toBe('warning');
  });

  it('turns a higher serial into an update and bumps the revision', () => {
    const first = ingestEew(null, alert(eewWarning)).alert!;
    const second = alert({ ...eewWarning, issue: { ...eewWarning.issue, serial: '2' } }, T + 2000);
    const res = ingestEew(first, second);
    expect(res.outcome).toBe('updated');
    expect(res.alert?.state).toBe('updated');
    expect(res.alert?.revision).toBe(2);
    expect(res.alert?.serial).toBe(2);
  });

  it('ignores duplicates of the same serial', () => {
    const first = ingestEew(null, alert(eewWarning)).alert!;
    const res = ingestEew(first, alert(eewWarning, T + 500));
    expect(res.outcome).toBe('duplicate');
    expect(res.accepted).toBe(false);
    expect(res.alert).toBe(first);
  });

  it('ignores out-of-order (older serial) telegrams', () => {
    const first = ingestEew(null, alert({ ...eewWarning, issue: { ...eewWarning.issue, serial: '5' } })).alert!;
    const stale = alert({ ...eewWarning, issue: { ...eewWarning.issue, serial: '3' } }, T + 100);
    const res = ingestEew(first, stale);
    expect(res.outcome).toBe('out-of-order');
    expect(res.alert?.serial).toBe(5);
  });

  it('applies a cancellation to its own event', () => {
    const first = ingestEew(null, alert(eewWarning)).alert!;
    const res = ingestEew(first, alert(eewCancelled, T + 60_000));
    expect(res.outcome).toBe('cancelled');
    expect(res.alert?.state).toBe('cancelled');
    expect(res.alert?.areas).toHaveLength(0);
  });

  it('ignores a cancellation for an event it never saw', () => {
    const res = ingestEew(null, alert(eewCancelled));
    expect(res.outcome).toBe('ignored-cancel-for-unknown-event');
    expect(res.alert).toBeNull();
  });

  it('never lets a test transmission displace a live warning (production wiring)', () => {
    const live = ingestEew(null, alert(eewWarning)).alert!;
    // A 訓練/試験 bulletin for a *different* event, ingested the way the store
    // does it (test bulletins displayable), must leave the live warning alone.
    const test = alert({
      ...eewWarning,
      test: true,
      issue: { ...eewWarning.issue, eventId: 'test-event-1' },
    });
    const res = ingestEew(live, test, { allowTest: true });
    expect(res.outcome).toBe('ignored-test');
    expect(res.accepted).toBe(false);
    expect(res.alert).toBe(live);
    expect(res.alert?.isTest).toBe(false);
  });

  it('still shows a test transmission when no live alert is on screen', () => {
    const test = alert({ ...eewWarning, test: true });
    const res = ingestEew(null, test, { allowTest: true });
    expect(res.accepted).toBe(true);
    expect(res.alert?.isTest).toBe(true);
  });

  it('refuses test transmissions when they are not allowed', () => {
    const first = ingestEew(null, alert(eewWarning)).alert!;
    const test = alert({ ...eewWarning, test: true, issue: { ...eewWarning.issue, serial: '2' } });
    const res = ingestEew(first, test, { allowTest: false });
    expect(res.outcome).toBe('ignored-test');
    expect(res.alert).toBe(first);
  });

  it('keeps previously known areas when a revision omits them', () => {
    const first = ingestEew(null, alert(eewWarning)).alert!;
    const sparser = alert({ ...eewWarning, areas: [], issue: { ...eewWarning.issue, serial: '2' } });
    const res = ingestEew(first, sparser);
    expect(res.alert?.areas).toHaveLength(3);
    expect(res.alert?.maxScaleTo).toBe(55);
  });

  it('switches to a new event id', () => {
    const first = ingestEew(null, alert(eewWarning)).alert!;
    const other = alert({ ...eewForecast, issue: { ...eewForecast.issue, eventId: 'other-event' } });
    const res = ingestEew(first, other);
    expect(res.outcome).toBe('new');
    expect(res.alert?.eventId).toBe('other-event');
    expect(res.alert?.state).toBe('forecast');
  });
});

describe('expireAlert', () => {
  it('keeps a fresh warning on screen', () => {
    const a = alert(eewWarning);
    expect(expireAlert(a, T + 1000)).toBe(a);
  });

  it('removes a warning once its TTL passes', () => {
    const a = alert(eewWarning);
    expect(expireAlert(a, T + DEFAULT_ALERT_POLICY.warningTtlMs + 1)).toBeNull();
  });

  it('expires forecasts earlier than warnings', () => {
    const f = alert(eewForecast);
    expect(expireAlert(f, T + DEFAULT_ALERT_POLICY.forecastTtlMs + 1)).toBeNull();
    const w = alert(eewWarning);
    expect(expireAlert(w, T + DEFAULT_ALERT_POLICY.forecastTtlMs + 1)).not.toBeNull();
  });

  it('expires cancellations so the panel returns to normal', () => {
    const first = ingestEew(null, alert(eewWarning)).alert!;
    const cancelled = ingestEew(first, alert(eewCancelled, T + 1000)).alert!;
    expect(expireAlert(cancelled, T + 1000 + DEFAULT_ALERT_POLICY.cancelledTtlMs + 1)).toBeNull();
  });

  it('ignores the clock for alerts that are already idle', () => {
    const idle: EewAlert = { ...alert(eewWarning), state: 'idle' };
    expect(expireAlert(idle, T + 10 * 60_000)).toBe(idle);
  });
});

describe('alert helpers', () => {
  it('returns the soonest future arrival, not a user-location countdown', () => {
    const a = alert(eewWarning);
    const next = nextArrival(a, Date.UTC(2026, 9, 21, 22, 45, 5));
    expect(next?.areaName).toBe('茨城県南部');
    expect(next?.reached).toBe(false);
  });

  it('reports "reached" when every predicted arrival is in the past', () => {
    const a = alert(eewWarning);
    const next = nextArrival(a, Date.UTC(2026, 9, 21, 22, 46, 0));
    expect(next?.reached).toBe(true);
  });

  it('returns null when the source supplied no arrival times', () => {
    const a = alert({ ...eewWarning, areas: [{ ...eewWarning.areas[0]!, arrivalTime: null }] });
    expect(nextArrival(a, T)).toBeNull();
  });

  it('lists only areas the source says have not been reached', () => {
    const a = alert(eewWarning);
    const pending = pendingAreas(a);
    expect(pending.every((p) => p.kindCode === '10')).toBe(true);
    expect(pending).toHaveLength(2);
  });

  it('picks the strongest areas for the headline', () => {
    const a = alert(eewWarning);
    const top = strongestAreas(a, 2);
    expect(top[0]?.scaleTo).toBe(55);
    expect(top).toHaveLength(2);
  });
});
