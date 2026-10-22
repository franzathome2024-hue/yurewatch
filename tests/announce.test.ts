import { beforeEach, describe, expect, it } from 'vitest';
import { announcementText, planAnnouncement, planTsunamiAnnouncement } from '../src/core/announce';
import type { EewAlert } from '../src/core/models';
import { __resetI18nForTests, setLocale } from '../src/i18n';
import { eewCancelled, eewForecast, eewWarning } from './fixtures';
import { parseEew } from '../src/sources/p2pquake/parse';

const T = Date.parse('2026-10-22T07:50:00Z');
const CTX = { enabled: true, demoAllowed: false };

function alert(fixture: unknown, overrides: Partial<EewAlert> = {}): EewAlert {
  const parsed = parseEew(fixture, T);
  if (!parsed.ok) throw new Error(parsed.reason);
  return { ...parsed.value, ...overrides };
}

beforeEach(() => __resetI18nForTests('ja'));

describe('announcement policy', () => {
  it('does not speak while the user has alerts off', () => {
    const a = alert(eewWarning);
    expect(planAnnouncement(a, new Set(), { ...CTX, enabled: false })).toBeNull();
  });

  it('speaks once per revision', () => {
    const a = alert(eewWarning);
    const spoken = new Set<string>();
    const first = planAnnouncement(a, spoken, CTX);
    expect(first?.priority).toBe('urgent');
    spoken.add(first!.key);
    expect(planAnnouncement(a, spoken, CTX)).toBeNull();
    // A new serial is a new announcement.
    const updated = { ...a, serial: a.serial + 1, state: 'updated' as const };
    expect(planAnnouncement(updated, spoken, CTX)?.priority).toBe('urgent');
  });

  it('never speaks a test transmission as a warning', () => {
    const a = alert(eewWarning, { isTest: true });
    expect(planAnnouncement(a, new Set(), CTX)).toBeNull();
  });

  it('never speaks a simulated alert unless the developer opts in', () => {
    const a = alert(eewWarning, { simulated: true });
    expect(planAnnouncement(a, new Set(), CTX)).toBeNull();
    expect(planAnnouncement(a, new Set(), { ...CTX, demoAllowed: true })?.priority).toBe('urgent');
  });

  it('speaks a forecast at notify priority and a cancellation as a state change', () => {
    expect(planAnnouncement(alert(eewForecast), new Set(), CTX)?.priority).toBe('notify');
    const cancelled = planAnnouncement(alert(eewCancelled), new Set(), CTX);
    expect(cancelled?.priority).toBe('state-change');
    // A cancellation must carry the "not a safety all-clear" nuance into speech.
    expect(cancelled?.text).toContain('取り消されました');
    expect(cancelled?.text).toContain('揺れが無かったことを意味するものではありません');
  });

  it('says the numbers it has and omits the ones JMA did not issue', () => {
    const full = announcementText(alert(eewWarning));
    expect(full).toContain('緊急地震速報');
    expect(full).toContain('茨城県南部');
    expect(full).toContain('6弱');

    const bare: EewAlert = {
      ...alert(eewWarning),
      epicenter: null,
      maxScaleTo: -1,
      areas: [],
    };
    const text = announcementText(bare);
    // Nothing invented: no magnitude, no intensity, no depth clause.
    expect(text).not.toContain('マグニチュード');
    expect(text).not.toContain('予測最大震度');
    expect(text).not.toContain('深さ');
    expect(text).toContain('緊急地震速報');
  });

  it('localises the spoken sentence with the interface language', () => {
    setLocale('en');
    const text = announcementText(alert(eewWarning));
    expect(text).toContain('Earthquake early warning');
    expect(text).toContain('Estimated maximum intensity 6-');
  });
});

describe('tsunami announcements', () => {
  const bulletin = {
    id: 't-1',
    cancelled: false,
    areas: [
      { name: '福島県', grade: 'Watch' },
      { name: '宮城県', grade: 'Warning' },
    ],
  };

  it('leads with the strongest grade', () => {
    const plan = planTsunamiAnnouncement(bulletin, new Set(), CTX);
    expect(plan?.priority).toBe('notify');
    expect(plan?.text.startsWith('津波情報')).toBe(true);
    expect(plan?.text).toContain('津波警報');
    expect(plan?.text).toContain('宮城県');
  });

  it('deduplicates the same bulletin', () => {
    const spoken = new Set<string>();
    const plan = planTsunamiAnnouncement(bulletin, spoken, CTX)!;
    spoken.add(plan.key);
    expect(planTsunamiAnnouncement(bulletin, spoken, CTX)).toBeNull();
  });

  it('stays silent for a cancelled bulletin when cancelled', () => {
    const plan = planTsunamiAnnouncement({ ...bulletin, cancelled: true }, new Set(), CTX);
    expect(plan?.text).toContain('取り消されました');
  });
});
