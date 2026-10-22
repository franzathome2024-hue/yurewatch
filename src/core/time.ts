/**
 * Time helpers.
 *
 * The app displays JST (Asia/Tokyo) regardless of device timezone, because the
 * data is about Japan. All instants are epoch ms internally.
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

/** `2026/10/22 07:56:14` in JST. */
export function formatJst(epochMs: number | null | undefined, withSeconds = true): string {
  if (epochMs === null || epochMs === undefined || !Number.isFinite(epochMs)) return '—';
  const p = jstParts(epochMs);
  const base = `${p.year}/${pad(p.month)}/${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}`;
  return withSeconds ? `${base}:${pad(p.second)}` : base;
}

/** `10/22 07:56` — compact form for list rows. */
export function formatJstShort(epochMs: number | null | undefined): string {
  if (epochMs === null || epochMs === undefined) return '—';
  const p = jstParts(epochMs);
  return `${pad(p.month)}/${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}`;
}

/** `07:56:14` in JST. */
export function formatJstClock(epochMs: number | null | undefined): string {
  if (epochMs === null || epochMs === undefined) return '—';
  const p = jstParts(epochMs);
  return `${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
}

/** Relative age in Japanese, e.g. `12秒前`, `3分前`. */
export function formatAge(fromMs: number | null | undefined, nowMs: number): string {
  if (fromMs === null || fromMs === undefined) return '—';
  const diff = Math.max(0, nowMs - fromMs);
  const s = Math.round(diff / 1000);
  if (s < 60) return `${s}秒前`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}分前`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}時間前`;
  return `${Math.round(h / 24)}日前`;
}

/** Coarse relative phrase used in the event feed. */
export function formatAgeCoarse(epochMs: number | null | undefined, nowMs: number): string {
  if (epochMs === null || epochMs === undefined) return '時刻不明';
  const diff = Math.max(0, nowMs - epochMs);
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'たった今';
  if (m < 60) return `${m}分前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}時間前`;
  return `${Math.floor(h / 24)}日前`;
}

/** Seconds between two instants, clamped at zero. */
export function secondsBetween(a: number, b: number): number {
  return Math.max(0, Math.round((b - a) / 1000));
}
