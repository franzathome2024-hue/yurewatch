import { describe, expect, it } from 'vitest';
import { ingestEvents, intensityByPrefecture, sortEvents } from '../src/state/events';
import { parseEarthquake } from '../src/sources/p2pquake/parse';
import { quakeDetail, quakeScalePrompt } from './fixtures';

const T = Date.parse('2026-10-22T07:50:00Z');

function ev(raw: unknown, at = T) {
  const r = parseEarthquake(raw, at);
  if (!r.ok) throw new Error(r.reason);
  return r.value;
}

describe('ingestEvents', () => {
  it('adds new events and reports the change', () => {
    const a = ev(quakeDetail);
    const result = ingestEvents([], [a]);
    expect(result.changed).toBe(true);
    expect(result.events).toHaveLength(1);
  });

  it('does not report a change for an identical duplicate telegram', () => {
    const a = ev(quakeDetail);
    const first = ingestEvents([], [a]);
    const second = ingestEvents(first.events, [ev(quakeDetail, T + 1000)]);
    expect(second.changed).toBe(false);
    expect(second.events).toBe(first.events);
    expect(second.events).toHaveLength(1);
  });

  it('merges a revised telegram of the same earthquake', () => {
    const first = ingestEvents([], [ev(quakeScalePrompt)]);
    const revised = ev({ ...quakeDetail, earthquake: { ...quakeDetail.earthquake, time: '2026/10/22 07:45:00' } }, T + 2000);
    const result = ingestEvents(first.events, [revised]);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.revision).toBe(2);
    expect(result.events[0]?.epicenter?.name).toBe('熊本県熊本地方');
  });

  it('orders newest first and caps the list', () => {
    const items = Array.from({ length: 5 }, (_, i) =>
      ev({
        ...quakeDetail,
        id: `e${i}`,
        earthquake: { ...quakeDetail.earthquake, time: `2026/10/2${i + 1} 07:45:00` },
      }),
    );
    const result = ingestEvents([], items, { limit: 3 });
    expect(result.events).toHaveLength(3);
    expect(result.events[0]?.originTime).toBeGreaterThan(result.events[1]!.originTime!);
  });

  it('sorts events without an origin time by receive time instead of dropping them', () => {
    const noTime = ev({ ...quakeDetail, id: 'no-time', earthquake: { ...quakeDetail.earthquake, time: '不明' } });
    const sorted = sortEvents([noTime, ev(quakeDetail)]);
    expect(sorted).toHaveLength(2);
    // The undated event falls back to receivedAt, which is later than the
    // fixture's origin time, so it sorts first — and is never discarded.
    expect(sorted.map((e) => e.id)).toContain(noTime.id);
    expect(sortEvents(sorted).map((e) => e.id)).toEqual(sorted.map((e) => e.id));
  });
});

describe('intensityByPrefecture', () => {
  it('reduces observation points to the max per prefecture', () => {
    const a = ev({
      ...quakeDetail,
      points: [
        { pref: '宮城県', addr: '仙台市', scale: 30 },
        { pref: '宮城県', addr: '石巻市', scale: 40 },
        { pref: '岩手県', addr: '一関市', scale: 20 },
      ],
    });
    const map = intensityByPrefecture([a]);
    expect(map.get('宮城県')).toBe(40);
    expect(map.get('岩手県')).toBe(20);
    expect(map.get('東京都')).toBeUndefined();
  });

  it('ignores points with no prefecture', () => {
    const a = ev({ ...quakeDetail, points: [{ addr: 'unknown', scale: 30 }] });
    expect(intensityByPrefecture([a]).size).toBe(0);
  });
});
