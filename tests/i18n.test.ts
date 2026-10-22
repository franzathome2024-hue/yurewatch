import { beforeEach, describe, expect, it, vi } from 'vitest';
import { formatDepth, formatMagnitude, infoTypeLabel, tsunamiLabel } from '../src/core/format';
import { scaleStyle } from '../src/core/intensity';
import { formatAge, formatAgeCoarse, formatJst, formatJstShort } from '../src/core/time';
import {
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  LOCALES,
  __resetI18nForTests,
  catalogKeys,
  getLocale,
  getLocaleVersion,
  initLocale,
  normalizeLocale,
  onLocaleChange,
  otherLocale,
  setLocale,
  t,
  tIn,
} from '../src/i18n';
import { connectionLabel, freshnessLabel, initialState, reduce } from '../src/state/store';
import { createHeader } from '../src/ui/header';
import { createAlertPanel } from '../src/ui/alertPanel';
import { createEventList } from '../src/ui/eventList';
import { createDetails } from '../src/ui/details';
import { DEMO_SCENARIOS, scenarioMessageKeys } from '../src/demo/scenarios';
import { parseEarthquake, parseEew } from '../src/sources/p2pquake/parse';
import { eewWarning, quakeDetail } from './fixtures';

const T = Date.parse('2026-10-22T07:50:00Z');

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('lang');
  __resetI18nForTests('ja');
});

describe('message catalog parity', () => {
  it('has exactly the same keys in both languages', () => {
    const ja = [...catalogKeys('ja')].sort();
    const en = [...catalogKeys('en')].sort();
    expect(en).toEqual(ja);
  });

  it('has no empty messages', () => {
    for (const locale of LOCALES) {
      for (const key of catalogKeys(locale)) {
        expect(tIn(locale, key).trim().length, `${locale}:${key}`).toBeGreaterThan(0);
      }
    }
  });

  it('keeps the same placeholders in both languages', () => {
    const placeholders = (value: string) => (value.match(/\{(\w+)\}/g) ?? []).sort();
    for (const key of catalogKeys('ja')) {
      expect(placeholders(tIn('en', key)), key).toEqual(placeholders(tIn('ja', key)));
    }
  });

  it('has no English text left in the Japanese catalog', () => {
    // Proper nouns, product names and units are allowed to stay Latin; whole
    // sentences are not. Anything outside this list is a missed translation.
    const ALLOWED = new Set([
      'YureWatch',
      'Natural',
      'Earth',
      'P2P',
      'JSON',
      'API',
      'PLUM',
      'SIMULATION',
      'JST',
      'LIVE',
      'DEMO',
      'EEW',
      'English',
      'NIED',
      'JMA',
      'ENGINE',
      'Canvas',
      'dist',
      'yurewatch',
      'html',
      'JavaScript',
    ]);
    for (const key of catalogKeys('ja')) {
      // Placeholders are structural, not copy.
      const value = tIn('ja', key).replace(/\{\w+\}/g, '');
      const offenders = (value.match(/\b[A-Za-z]{4,}\b/g) ?? []).filter((word) => !ALLOWED.has(word));
      expect(offenders, key).toEqual([]);
    }
  });
});

describe('locale selection', () => {
  it('defaults to Japanese', () => {
    expect(DEFAULT_LOCALE).toBe('ja');
    initLocale();
    expect(getLocale()).toBe('ja');
  });

  it('ignores the device language', () => {
    // A fresh install on an English phone must still start in Japanese.
    vi.stubGlobal('navigator', { ...navigator, language: 'en-US', languages: ['en-US'] });
    initLocale();
    expect(getLocale()).toBe('ja');
    vi.unstubAllGlobals();
  });

  it('normalizes stored and requested values', () => {
    expect(normalizeLocale('ja')).toBe('ja');
    expect(normalizeLocale('ja-JP')).toBe('ja');
    expect(normalizeLocale('en-GB')).toBe('en');
    expect(normalizeLocale('fr')).toBeNull();
    expect(normalizeLocale(null)).toBeNull();
  });

  it('persists the choice and restores it on the next start', () => {
    initLocale();
    setLocale('en');
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('en');

    // Simulate a fresh process: reset the in-memory locale, keep storage.
    __resetI18nForTests('ja');
    initLocale();
    expect(getLocale()).toBe('en');
  });

  it('notifies listeners once per real change and bumps the render version', () => {
    const listener = vi.fn();
    const off = onLocaleChange(listener);
    const before = getLocaleVersion();
    setLocale('en');
    setLocale('en');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith('en');
    expect(getLocaleVersion()).toBe(before + 1);
    off();
    setLocale('ja');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('can switch without persisting', () => {
    initLocale();
    setLocale('en', { persist: false });
    expect(getLocale()).toBe('en');
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBeNull();
  });

  it('reports the other locale', () => {
    expect(otherLocale('ja')).toBe('en');
    expect(otherLocale('en')).toBe('ja');
  });

  it('updates the document language and title', () => {
    initLocale();
    setLocale('en');
    expect(document.documentElement.getAttribute('lang')).toBe('en');
    expect(document.title).toBe(t('app.title'));
    expect(document.title).toContain('Japan');
  });
});

describe('translation fallback', () => {
  it('interpolates parameters and leaves unknown ones intact', () => {
    expect(t('alert.serial', { n: 3 })).toBe('第3報');
    expect(tIn('en', 'alert.serial', { n: 3 })).toBe('Report #3');
    // @ts-expect-error deliberate bad key
    expect(t('does.not.exist')).toBe('does.not.exist');
  });

  it('never returns an empty string for a real key', () => {
    for (const key of catalogKeys('ja')) expect(tIn('ja', key).length).toBeGreaterThan(0);
  });
});

describe('localized formatting', () => {
  it('formats JST timestamps per locale, always in Asia/Tokyo', () => {
    const instant = Date.parse('2026-10-22T07:56:14Z'); // 16:56:14 JST
    setLocale('ja');
    expect(formatJst(instant)).toBe('2026/10/22 16:56:14');
    setLocale('en');
    expect(formatJst(instant)).toBe('2026-10-22 16:56:14');
    expect(formatJstShort(instant)).toBe('10/22 16:56');
  });

  it('formats relative ages per locale', () => {
    setLocale('ja');
    expect(formatAge(T - 12_000, T)).toBe('12秒前');
    expect(formatAge(T - 3 * 60_000, T)).toBe('3分前');
    expect(formatAgeCoarse(T - 10_000, T)).toBe('たった今');
    setLocale('en');
    expect(formatAge(T - 12_000, T)).toBe('12s ago');
    expect(formatAge(T - 3 * 60_000, T)).toBe('3m ago');
    expect(formatAgeCoarse(T - 10_000, T)).toBe('just now');
  });

  it('labels intensities in JMA notation per locale', () => {
    setLocale('ja');
    expect(scaleStyle(45).label).toBe('5弱');
    expect(scaleStyle(50).longLabel).toBe('震度5強');
    setLocale('en');
    expect(scaleStyle(45).label).toBe('5-');
    expect(scaleStyle(50).longLabel).toBe('Intensity 5 upper');
    // Colours are language-independent.
    expect(scaleStyle(50).fill).toBe('#f4511e');
  });

  it('localizes domain vocabulary', () => {
    setLocale('ja');
    expect(tsunamiLabel('Watch').text).toBe('津波注意報が発表されています');
    expect(infoTypeLabel('DetailScale')).toBe('各地の震度に関する情報');
    expect(formatMagnitude(-1)).toBe('不明');
    expect(formatDepth(0)).toBe('ごく浅い');
    setLocale('en');
    expect(tsunamiLabel('Watch').text).toBe('A tsunami advisory is in effect');
    expect(infoTypeLabel('DetailScale')).toBe('Intensity at each location');
    expect(formatMagnitude(-1)).toBe('Unknown');
    expect(formatDepth(0)).toBe('very shallow');
  });

  it('localizes connection and freshness labels', () => {
    setLocale('ja');
    expect(connectionLabel('offline')).toBe('オフライン');
    expect(freshnessLabel('stale')).toBe('情報が古い');
    setLocale('en');
    expect(connectionLabel('offline')).toBe('Offline');
    expect(freshnessLabel('stale')).toBe('Stale data');
  });
});

describe('UI follows the language', () => {
  const mounted = (el: HTMLElement) => {
    document.body.appendChild(el);
    return el;
  };

  it('renders the header language switch with Japanese active by default', () => {
    const header = createHeader();
    mounted(header.el);
    header.update(initialState('live', T));
    const buttons = Array.from(header.el.querySelectorAll<HTMLButtonElement>('.langSwitch__btn'));
    expect(buttons.map((b) => b.textContent)).toEqual(['日本語', 'English']);
    expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false']);
  });

  it('switches the whole interface immediately when a switch is clicked', () => {
    setLocale('ja');
    const header = createHeader();
    const alert = createAlertPanel();
    mounted(header.el);
    mounted(alert.el);
    const state = reduce(initialState('live', T), { type: 'connection', state: 'live', at: T });
    header.update(state);
    alert.update(state);

    expect(header.el.textContent).toContain('ライブ接続');
    expect(alert.el.textContent).toContain('緊急地震速報');

    const english = header.el.querySelector<HTMLButtonElement>('[data-locale="en"]')!;
    english.click();

    // Re-render exactly as main.ts does on a locale change.
    header.update(state);
    alert.update(state);

    expect(getLocale()).toBe('en');
    expect(header.el.textContent).toContain('Live');
    expect(header.el.textContent).not.toContain('ライブ接続');
    expect(header.el.textContent).toContain('Japan earthquake monitoring');
    expect(alert.el.textContent).toContain('Earthquake Early Warning');
    expect(alert.el.textContent).not.toContain('緊急地震速報');
    expect(document.documentElement.getAttribute('lang')).toBe('en');
  });

  it('re-renders cached lists when only the language changes', () => {
    const parsed = parseEarthquake(quakeDetail, T);
    if (!parsed.ok) throw new Error(parsed.reason);
    let state = initialState('live', T);
    state = reduce(state, { type: 'batch', events: [parsed.value], eews: [], tsunami: null, at: T, rejected: 0 });

    const list = createEventList({ onSelect: () => {} });
    mounted(list.el);
    list.update(state);
    expect(list.el.textContent).toContain('深さ10km');

    setLocale('en');
    list.update(state);
    expect(list.el.textContent).toContain('Depth 10km');
    // Column headers re-localize too, not only the rows.
    expect(list.el.textContent).toContain('Intensity');
    expect(list.el.textContent).toContain('Epicenter');
  });

  it('re-renders the details panel on a language change', () => {
    const parsed = parseEarthquake(quakeDetail, T);
    if (!parsed.ok) throw new Error(parsed.reason);
    let state = initialState('live', T);
    state = reduce(state, { type: 'batch', events: [parsed.value], eews: [], tsunami: null, at: T, rejected: 0 });
    state = reduce(state, { type: 'select', id: parsed.value.id });

    const details = createDetails({ onClose: () => {} });
    mounted(details.el);
    details.update(state);
    expect(details.el.textContent).toContain('マグニチュード');
    expect(details.el.textContent).toContain('情報源');

    setLocale('en');
    details.update(state);
    expect(details.el.textContent).toContain('Magnitude');
    expect(details.el.textContent).toContain('Source:');
    expect(details.el.textContent).not.toContain('マグニチュード');
  });

  it('shows the EEW headline in the active language with the other underneath', () => {
    const parsed = parseEew(eewWarning, T);
    if (!parsed.ok) throw new Error(parsed.reason);
    let state = initialState('live', T);
    state = reduce(state, { type: 'batch', events: [], eews: [parsed.value], tsunami: null, at: T, rejected: 0 });

    const panel = createAlertPanel();
    mounted(panel.el);
    panel.update(state);
    expect(panel.el.textContent).toContain('緊急地震速報（警報）');
    expect(panel.el.textContent).toContain('EEW (Warning)');

    setLocale('en');
    panel.update(state);
    expect(panel.el.textContent).toContain('EEW (Warning)');
    expect(panel.el.textContent).toContain('緊急地震速報（警報）');
    expect(panel.el.textContent).toContain('Estimated max intensity');
  });

  it('localizes every demo scenario label and summary', () => {
    for (const scenario of DEMO_SCENARIOS) {
      const keys = scenarioMessageKeys(scenario.id);
      const ja = tIn('ja', keys.label);
      const en = tIn('en', keys.label);
      // A missing catalog entry would fall back to the key itself.
      expect(ja).not.toContain('scenario.');
      expect(en).not.toContain('scenario.');
      expect(ja.length).toBeGreaterThan(1);
      expect(en.length).toBeGreaterThan(1);
    }
    expect(tIn('ja', scenarioMessageKeys('warning').label)).toBe('EEW 警報');
    expect(tIn('en', scenarioMessageKeys('warning').label)).toBe('EEW warning');
  });
});
