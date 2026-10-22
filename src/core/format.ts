import { hasIntensity, scaleStyle } from './intensity';
import type { EewAlert, Epicenter, EarthquakeEvent, TsunamiGrade } from './models';

/** Display formatting helpers shared by all panels. */

export function formatMagnitude(m: number | null | undefined): string {
  if (m === null || m === undefined || m < 0 || !Number.isFinite(m)) return '不明';
  return `M${m.toFixed(1)}`;
}

export function formatDepth(km: number | null | undefined): string {
  if (km === null || km === undefined || km < 0) return '不明';
  if (km === 0) return 'ごく浅い';
  return `${Math.round(km)}km`;
}

/** `M5.8` + `深さ10km` + `最大震度3` as separate tokens — never merged into a claim. */
export function eventSummary(ev: EarthquakeEvent): string {
  const bits: string[] = [];
  if (ev.epicenter) bits.push(formatMagnitude(ev.epicenter.magnitude));
  if (ev.epicenter) bits.push(`深さ${formatDepth(ev.epicenter.depthKm)}`);
  return bits.join('・');
}

export interface TsunamiLabel {
  text: string;
  tone: 'neutral' | 'info' | 'warn' | 'danger';
}

/**
 * Tsunami wording. JMA's 津波の有無 vocabulary is reproduced faithfully; we do
 * not upgrade "Checking" to "None" or vice versa.
 */
export function tsunamiLabel(grade: TsunamiGrade | null | undefined): TsunamiLabel {
  switch (grade) {
    case 'None':
      return { text: 'この地震による津波の心配はありません（気象庁）', tone: 'neutral' };
    case 'NonEffective':
      return { text: '若干の海面変動が予想されるが、被害の心配なし', tone: 'info' };
    case 'Watch':
      return { text: '津波注意報が発表されています', tone: 'warn' };
    case 'Warning':
      return { text: '津波警報が発表されています', tone: 'danger' };
    case 'MajorWarning':
      return { text: '大津波警報が発表されています', tone: 'danger' };
    case 'Checking':
      return { text: '津波の有無を調査中', tone: 'warn' };
    default:
      return { text: '津波情報は未受信です', tone: 'neutral' };
  }
}

export function infoTypeLabel(type: string): string {
  switch (type) {
    case 'ScalePrompt':
      return '震度速報';
    case 'Destination':
      return '震源に関する情報';
    case 'ScaleAndDestination':
      return '震度・震源に関する情報';
    case 'DetailScale':
      return '各地の震度に関する情報';
    case 'Foreign':
      return '遠地地震に関する情報';
    case 'Other':
      return 'その他の情報';
    default:
      return '地震情報';
  }
}

export function epicenterName(c: Epicenter | null): string {
  return c?.name?.trim() || '震源不明';
}

export function coordinates(c: Epicenter | null): string {
  if (!c) return '—';
  const lat = `${Math.abs(c.latitude).toFixed(1)}°${c.latitude >= 0 ? 'N' : 'S'}`;
  const lon = `${Math.abs(c.longitude).toFixed(1)}°${c.longitude >= 0 ? 'E' : 'W'}`;
  return `${lat} ${lon}`;
}

/** Highest predicted intensity across EEW areas, as a label. */
export function eewIntensityLabel(alert: EewAlert): string {
  if (!hasIntensity(alert.maxScaleTo)) return '不明';
  return scaleStyle(alert.maxScaleTo).longLabel.replace('震度', '');
}

export function eewStateLabel(state: EewAlert['state']): string {
  switch (state) {
    case 'forecast':
      return '緊急地震速報（予報）';
    case 'warning':
      return '緊急地震速報（警報）';
    case 'updated':
      return '緊急地震速報（続報）';
    case 'cancelled':
      return '緊急地震速報（取消）';
    case 'unavailable':
      return '緊急地震速報（状態不明）';
    default:
      return '緊急地震速報なし';
  }
}

/** English subtitle to avoid ambiguity for non-Japanese readers of docs/screenshots. */
export function eewStateLabelEn(state: EewAlert['state']): string {
  switch (state) {
    case 'forecast':
      return 'EEW FORECAST';
    case 'warning':
      return 'EEW WARNING';
    case 'updated':
      return 'EEW UPDATED';
    case 'cancelled':
      return 'EEW CANCELLED';
    case 'unavailable':
      return 'EEW UNKNOWN';
    default:
      return 'NORMAL';
  }
}
