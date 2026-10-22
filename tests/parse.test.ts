import { describe, expect, it } from 'vitest';
import {
  DEMO_SOURCE,
  deriveEewLevel,
  mergeEarthquake,
  normaliseScale,
  normaliseTsunamiGrade,
  parseBatch,
  parseEarthquake,
  parseEew,
  parseEpicenter,
  parseTsunami,
} from '../src/sources/p2pquake/parse';
import { eewCancelled, eewForecast, eewWarning, quakeDetail, quakeScalePrompt, tsunamiWatch } from './fixtures';

const T = Date.parse('2026-10-22T07:50:00Z');

describe('normaliseScale', () => {
  it('keeps JMA codes and truncates the float artefact', () => {
    expect(normaliseScale(45.0)).toBe(45);
    expect(normaliseScale(45.5)).toBe(45);
    expect(normaliseScale(70)).toBe(70);
  });

  it('returns null for the -1 unknown sentinel and for junk', () => {
    expect(normaliseScale(-1)).toBeNull();
    expect(normaliseScale('50')).toBeNull();
    expect(normaliseScale(Number.NaN)).toBeNull();
    expect(normaliseScale(undefined)).toBeNull();
  });
});

describe('normaliseTsunamiGrade', () => {
  it('accepts documented grades and degrades unknown values', () => {
    expect(normaliseTsunamiGrade('Warning')).toBe('Warning');
    expect(normaliseTsunamiGrade('MajorWarning')).toBe('MajorWarning');
    expect(normaliseTsunamiGrade('不審')).toBe('Unknown');
    expect(normaliseTsunamiGrade(null)).toBe('Unknown');
  });
});

describe('parseEpicenter', () => {
  it('reads a normal hypocentre', () => {
    const epi = parseEpicenter({ name: '宮城県沖', latitude: 38, longitude: 142, depth: 50, magnitude: 5.2 });
    expect(epi).toEqual({
      name: '宮城県沖',
      latitude: 38,
      longitude: 142,
      depthKm: 50,
      magnitude: 5.2,
      provisional: false,
    });
  });

  it('treats JMA -200/-1 sentinels as "unknown", never as zero', () => {
    const epi = parseEpicenter({ name: '', latitude: -200, longitude: -200, depth: -1, magnitude: -1 });
    expect(epi).toBeNull();

    const partial = parseEpicenter({ latitude: 35, longitude: 139, depth: -1, magnitude: -1 });
    expect(partial?.depthKm).toBe(-1);
    expect(partial?.magnitude).toBe(-1);
    expect(partial?.name).toBeNull();
  });

  it('marks 仮定震源要素 hypocentres as provisional', () => {
    const epi = parseEpicenter({ latitude: 35, longitude: 139 }, '仮定震源要素');
    expect(epi?.provisional).toBe(true);
  });

  it('rejects coordinates outside the globe', () => {
    expect(parseEpicenter({ latitude: 200, longitude: 400 })).toBeNull();
    expect(parseEpicenter(undefined)).toBeNull();
  });
});

describe('parseEarthquake', () => {
  it('parses a 詳細情報 telegram', () => {
    const result = parseEarthquake(quakeDetail, T);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ev = result.value;
    expect(ev.id).toBe(`q-${new Date(Date.UTC(2026, 9, 21, 22, 45, 0)).toISOString()}`);
    expect(ev.epicenter?.magnitude).toBe(2.9);
    expect(ev.maxIntensity).toBe(10);
    expect(ev.points).toHaveLength(1);
    expect(ev.preliminary).toBe(false);
    expect(ev.tsunami).toBe('None');
    expect(ev.simulated).toBe(false);
    expect(ev.source.official).toBe(true);
    expect(ev.source.relayed).toBe(true);
  });

  it('marks 震度速報 as preliminary and derives intensity from points', () => {
    const result = parseEarthquake(quakeScalePrompt, T);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.preliminary).toBe(true);
    expect(result.value.epicenter).toBeNull();
    expect(result.value.maxIntensity).toBe(30);
    expect(result.value.tsunami).toBe('Unknown');
  });

  it('does not fabricate timestamps when they are unparsable', () => {
    const broken = { ...quakeDetail, earthquake: { ...quakeDetail.earthquake, time: 'ごめんなさい' } };
    const result = parseEarthquake(broken, T);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.originTime).toBeNull();
    expect(result.value.id).toMatch(/^q-fixture-quake-detail$/);
  });

  it('reports malformed input as a typed failure instead of throwing', () => {
    expect(parseEarthquake(null, T).ok).toBe(false);
    expect(parseEarthquake({ code: 551 }, T).ok).toBe(false);
    expect(parseEarthquake({ code: 552, id: 'x' }, T).ok).toBe(false);
    expect(parseEarthquake('nope', T).ok).toBe(false);
  });

  it('tags simulation sources', () => {
    const result = parseEarthquake(quakeDetail, T, DEMO_SOURCE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.simulated).toBe(true);
    expect(result.value.source.official).toBe(false);
    expect(result.value.source.authority).toBe('simulation');
  });
});

describe('mergeEarthquake', () => {
  it('merges revisions of the same earthquake and counts them', () => {
    const a = parseEarthquake(quakeScalePrompt, T);
    const b = parseEarthquake(
      {
        ...quakeDetail,
        earthquake: { ...quakeDetail.earthquake, time: '2026/10/22 07:45:00' },
      },
      T + 1000,
    );
    if (!a.ok || !b.ok) throw new Error('fixtures failed to parse');
    const merged = mergeEarthquake(a.value, b.value);

    expect(merged.revision).toBe(2);
    expect(merged.preliminary).toBe(false); // 詳細 report supersedes the prompt
    expect(merged.infoType).toBe('DetailScale');
    expect(merged.epicenter?.name).toBe('熊本県熊本地方');
    expect(merged.sourceIds).toHaveLength(2);
    expect(merged.points.length).toBeGreaterThan(0);
    // Highest intensity across revisions survives.
    expect(merged.maxIntensity).toBeGreaterThanOrEqual(30);
  });

  it('keeps the more complete epicentre when a newer telegram lacks one', () => {
    const a = parseEarthquake(quakeDetail, T);
    const b = parseEarthquake({ ...quakeScalePrompt, earthquake: { ...quakeScalePrompt.earthquake, time: '2026/10/22 07:45:00' } }, T + 500);
    if (!a.ok || !b.ok) throw new Error('fixtures failed to parse');
    const merged = mergeEarthquake(a.value, b.value);
    expect(merged.epicenter?.name).toBe('熊本県熊本地方');
  });
});

describe('parseEew', () => {
  it('parses a warning and computes predicted max intensity from areas', () => {
    const result = parseEew(eewWarning, T);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const alert = result.value;
    expect(alert.state).toBe('warning');
    expect(alert.serial).toBe(1);
    expect(alert.areas).toHaveLength(3);
    expect(alert.maxScaleTo).toBe(55);
    expect(alert.epicenter?.name).toBe('茨城県南部');
    expect(alert.isTest).toBe(false);
    // Sorted by predicted intensity, descending.
    expect(alert.areas[0]?.scaleTo).toBe(55);
    expect(alert.areas[0]?.arrivalTime).toBe(Date.UTC(2026, 9, 21, 22, 45, 12));
  });

  it('classifies an area-less message as a forecast, not a warning', () => {
    const result = parseEew(eewForecast, T);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.state).toBe('forecast');
    expect(result.value.areas).toHaveLength(0);
    expect(result.value.maxScaleTo).toBe(-1);
  });

  it('parses cancellations without inventing an epicentre', () => {
    const result = parseEew(eewCancelled, T);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.state).toBe('cancelled');
    expect(result.value.epicenter).toBeNull();
    expect(result.value.serial).toBe(4);
  });

  it('rejects telegrams without an event id or serial', () => {
    expect(parseEew({ code: 556, cancelled: false, issue: {} }, T).ok).toBe(false);
    expect(parseEew({ code: 556, issue: { eventId: 'e', serial: 'x' } }, T).ok).toBe(false);
  });

  it('carries the test flag through', () => {
    const result = parseEew({ ...eewWarning, test: true }, T);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.isTest).toBe(true);
  });
});

describe('deriveEewLevel', () => {
  it('requires areas for a warning', () => {
    expect(deriveEewLevel([], false)).toBe('forecast');
    expect(deriveEewLevel([], true)).toBe('cancelled');
    expect(
      deriveEewLevel(
        [{ pref: 'x', name: 'y', scaleFrom: 10, scaleTo: 20, kindCode: '10', arrivalTime: null }],
        false,
      ),
    ).toBe('warning');
  });
});

describe('parseTsunami', () => {
  it('parses grades, arrival and height', () => {
    const result = parseTsunami(tsunamiWatch, T);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.areas[0]?.grade).toBe('Watch');
    expect(result.value.areas[0]?.heightValue).toBe(1);
    expect(result.value.areas[0]?.arrivalTime).toBe('2026/10/22 08:10:00');
    expect(result.value.cancelled).toBe(false);
  });
});

describe('parseBatch', () => {
  it('keeps good records when bad ones are mixed in', () => {
    const result = parseBatch(
      [quakeDetail, { code: 551 }, null, { code: 561, area: 250 }, eewWarning, { code: 554, type: 'Full' }, 'x'],
      T,
    );
    expect(result.quakes).toHaveLength(1);
    expect(result.eews).toHaveLength(1);
    expect(result.rejected.length).toBeGreaterThanOrEqual(3);
  });

  it('ignores record types we do not present as official information', () => {
    const result = parseBatch([{ code: 561, area: 250 }, { code: 554, type: 'Full' }, { code: 9611 }], T);
    expect(result.quakes).toHaveLength(0);
    expect(result.eews).toHaveLength(0);
    expect(result.rejected).toHaveLength(0);
  });
});
