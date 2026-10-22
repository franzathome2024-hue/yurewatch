import { getLocale, t } from '../i18n';

/**
 * Time helpers.
 *
 * The app displays JST (Asia/Tokyo) regardless of device timezone, because the
 * data is about Japan. All instants are epoch ms internally.
 *
 * Japanese uses JMA's own `YYYY/MM/DD HH:mm:ss` shape; English uses the
 * unambiguous `YYYY-MM-DD HH:mm:ss`. Neither depends on the device locale, so a
 * timestamp can never be misread across languages.
 */

export const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** Parse JMA-style `2006/01/02 15:04:05.999` (JST) into epoch ms. */
export function parseJst(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,3}))?$/.exec(
    value.trim(),
  );
  if (!m) return null;
  const [, y, mo, d, h, mi, s, ms] = m;
  const utc = Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(s ?? 0),
    Number((ms ?? '0').padEnd(3, '0')),
  );
  if (!Number.isFinite(utc)) return null;
  return utc - JST_OFFSET_MS;
}

function jstParts(epochMs: number) {
  const d = new Date(epochMs + JST_OFFSET_MS);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
  };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** `2026/10/22 07:56:14` (ja) or `2026-10-22 07:56:14` (en), in JST. */
export function formatJst(epochMs: number | null | undefined, withSeconds = true): string {
  if (epochMs === null || epochMs === undefined || !Number.isFinite(epochMs)) return t('meta.emDash');
  const p = jstParts(epochMs);
  const sep = getLocale() === 'ja' ? '/' : '-';
  const date = [p.year, pad(p.month), pad(p.day)].join(sep);
  const base = `${date} ${pad(p.hour)}:${pad(p.minute)}`;
  return withSeconds ? `${base}:${pad(p.second)}` : base;
}

/** `10/22 07:56` — compact form for list rows. */
export function formatJstShort(epochMs: number | null | undefined): string {
  if (epochMs === null || epochMs === undefined) return t('meta.emDash');
  const p = jstParts(epochMs);
  return `${pad(p.month)}/${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}`;
}

/** `07:56:14` in JST. */
export function formatJstClock(epochMs: number | null | undefined): string {
  if (epochMs === null || epochMs === undefined) return t('meta.emDash');
  const p = jstParts(epochMs);
  return `${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
}

/** Relative age, e.g. `12秒前` / `12s ago`. */
export function formatAge(fromMs: number | null | undefined, nowMs: number): string {
  if (fromMs === null || fromMs === undefined) return t('meta.emDash');
  const diff = Math.max(0, nowMs - fromMs);
  const s = Math.round(diff / 1000);
  if (s < 60) return t('age.seconds', { n: s });
  const m = Math.round(s / 60);
  if (m < 60) return t('age.minutes', { n: m });
  const h = Math.round(m / 60);
  if (h < 24) return t('age.hours', { n: h });
  return t('age.days', { n: Math.round(h / 24) });
}

/** Coarse relative phrase used in the event feed. */
export function formatAgeCoarse(epochMs: number | null | undefined, nowMs: number): string {
  if (epochMs === null || epochMs === undefined) return t('age.unknownTime');
  const diff = Math.max(0, nowMs - epochMs);
  const m = Math.floor(diff / 60000);
  if (m < 1) return t('meta.now');
  if (m < 60) return t('age.minutes', { n: m });
  const h = Math.floor(m / 60);
  if (h < 24) return t('age.hours', { n: h });
  return t('age.days', { n: Math.floor(h / 24) });
}

/** Seconds between two instants, clamped at zero. */
export function secondsBetween(a: number, b: number): number {
  return Math.max(0, Math.round((b - a) / 1000));
}
