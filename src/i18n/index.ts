import { en } from './en';
import { ja, type MessageKey } from './ja';
import { STORAGE_KEY, readPreference, writePreference } from './storage';

/**
 * Localisation runtime.
 *
 * Design rules:
 *  - Japanese is the default for a fresh install regardless of the device
 *    language: the data is Japanese, and a Japanese reader must never have to
 *    find a setting before they can read an alert.
 *  - The choice is explicit and persisted; nothing reads `navigator.language`.
 *  - `t()` is the single translation entry point. Components never branch on a
 *    locale, so the two languages cannot drift apart functionally.
 *  - Every render pass reads the locale through `getLocaleVersion()`, which
 *    makes a language switch a pure re-render.
 */
export type Locale = 'ja' | 'en';
export type { MessageKey };

export const LOCALES: readonly Locale[] = ['ja', 'en'] as const;
export const DEFAULT_LOCALE: Locale = 'ja';

type Catalog = Record<string, string>;
const CATALOGS: Record<Locale, Catalog> = { ja: ja as unknown as Catalog, en: en as unknown as Catalog };

let locale: Locale = DEFAULT_LOCALE;
let version = 0;
let initialised = false;
const listeners = new Set<(next: Locale) => void>();

export function normalizeLocale(value: unknown): Locale | null {
  if (value === 'ja' || value === 'en') return value;
  if (typeof value !== 'string') return null;
  const lower = value.trim().toLowerCase();
  if (lower === 'ja' || lower === 'ja-jp' || lower.startsWith('ja-')) return 'ja';
  if (lower === 'en' || lower.startsWith('en-')) return 'en';
  return null;
}

export function getLocale(): Locale {
  return locale;
}

/** Increments on every locale change; used as a render-cache key. */
export function getLocaleVersion(): number {
  return version;
}

export function otherLocale(loc: Locale = locale): Locale {
  return loc === 'ja' ? 'en' : 'ja';
}

/** Read the persisted preference (or the default) without rendering anything. */
export function initLocale(): Locale {
  if (initialised) return locale;
  initialised = true;
  const stored = normalizeLocale(readPreference(STORAGE_KEY));
  locale = stored ?? DEFAULT_LOCALE;
  applyDocumentLanguage();
  return locale;
}

export function setLocale(next: Locale, options: { persist?: boolean } = {}): void {
  const persist = options.persist !== false;
  if (next === locale) {
    if (persist) writePreference(STORAGE_KEY, next);
    return;
  }
  locale = next;
  version += 1;
  if (persist) writePreference(STORAGE_KEY, next);
  initialised = true;
  applyDocumentLanguage();
  for (const listener of Array.from(listeners)) listener(locale);
}

export function onLocaleChange(listener: (next: Locale) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function applyDocumentLanguage(): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('lang', locale);
  document.title = t('app.title');
  const meta = document.querySelector('meta[name="description"]');
  if (meta) meta.setAttribute('content', t('app.description'));
}

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  );
}

/**
 * Translate a key. Falls back to Japanese, then to the key itself, so a missing
 * translation degrades to readable text instead of throwing during an alert.
 */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  return tIn(locale, key, params);
}

export function tIn(loc: Locale, key: MessageKey, params?: Record<string, string | number>): string {
  const table = CATALOGS[loc] ?? CATALOGS[DEFAULT_LOCALE];
  const template = table[key] ?? CATALOGS[DEFAULT_LOCALE][key] ?? key;
  return interpolate(template, params);
}

/** Keys present in a catalog — used by the parity test and by tooling. */
export function catalogKeys(loc: Locale): MessageKey[] {
  return Object.keys(CATALOGS[loc]) as MessageKey[];
}

/** Test-only: restore the initial state without touching storage. */
export function __resetI18nForTests(next: Locale = DEFAULT_LOCALE): void {
  locale = next;
  version += 1;
  // Leave the runtime uninitialised so the next `initLocale()` re-reads storage,
  // exactly like a fresh process would.
  initialised = false;
}

export { STORAGE_KEY as LOCALE_STORAGE_KEY };
