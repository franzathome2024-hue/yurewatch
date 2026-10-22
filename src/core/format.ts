import { hasIntensity, scaleStyle } from './intensity';
import { getLocale, t, tIn, type MessageKey } from '../i18n';
import type { EewAlert, Epicenter, EarthquakeEvent, TsunamiGrade } from './models';

/** Display formatting helpers shared by all panels. Every string is localised. */

export function formatMagnitude(m: number | null | undefined): string {
  if (m === null || m === undefined || m < 0 || !Number.isFinite(m)) return t('meta.unknown');
  return `M${m.toFixed(1)}`;
}

export function formatDepth(km: number | null | undefined): string {
  if (km === null || km === undefined || km < 0) return t('meta.unknown');
  if (Math.round(km) === 0) return t('details.depthShallow');
  return `${Math.round(km)}km`;
}

/** `M5.8` + `深さ10km` + `最大震度3` as separate tokens — never merged into a claim. */
export function eventSummary(ev: EarthquakeEvent): string {
  const bits: string[] = [];
  if (ev.epicenter) bits.push(formatMagnitude(ev.epicenter.magnitude));
  if (ev.epicenter) bits.push(`${t('details.kv.depth')}${formatDepth(ev.epicenter.depthKm)}`);
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
  const map: Record<string, MessageKey> = {
    None: 'tsunami.none',
    NonEffective: 'tsunami.nonEffective',
    Watch: 'tsunami.watch',
    Warning: 'tsunami.warning',
    MajorWarning: 'tsunami.majorWarning',
    Checking: 'tsunami.checking',
  };
  const tone: Record<string, TsunamiLabel['tone']> = {
    None: 'neutral',
    NonEffective: 'info',
    Watch: 'warn',
    Warning: 'danger',
    MajorWarning: 'danger',
    Checking: 'warn',
  };
  const key = grade ? map[grade] : undefined;
  if (!key) return { text: t('tsunami.unknown'), tone: 'neutral' };
  return { text: t(key), tone: tone[grade as string] ?? 'neutral' };
}

const INFO_TYPE_KEYS: Record<string, MessageKey> = {
  ScalePrompt: 'infoType.scalePrompt',
  Destination: 'infoType.destination',
  ScaleAndDestination: 'infoType.scaleAndDestination',
  DetailScale: 'infoType.detailScale',
  Foreign: 'infoType.foreign',
  Other: 'infoType.other',
};

export function infoTypeLabel(type: string): string {
  return t(INFO_TYPE_KEYS[type] ?? 'infoType.default');
}

export function epicenterName(c: Epicenter | null): string {
  return c?.name?.trim() || t('alert.epicenterUnknown');
}

export function coordinates(c: Epicenter | null): string {
  if (!c) return t('meta.emDash');
  const lat = `${Math.abs(c.latitude).toFixed(1)}°${c.latitude >= 0 ? 'N' : 'S'}`;
  const lon = `${Math.abs(c.longitude).toFixed(1)}°${c.longitude >= 0 ? 'E' : 'W'}`;
  return `${lat} ${lon}`;
}

/** Highest predicted intensity across EEW areas, as a short label. */
export function eewIntensityLabel(alert: EewAlert): string {
  if (!hasIntensity(alert.maxScaleTo)) return t('meta.unknown');
  const style = scaleStyle(alert.maxScaleTo);
  return style.label;
}

const EEW_STATE_KEYS: Record<string, MessageKey> = {
  forecast: 'alert.state.forecast',
  warning: 'alert.state.warning',
  updated: 'alert.state.updated',
  cancelled: 'alert.state.cancelled',
  unavailable: 'alert.state.unavailable',
  idle: 'alert.state.idle',
};

export function eewStateLabel(state: EewAlert['state'] | 'idle'): string {
  return t(EEW_STATE_KEYS[state] ?? 'alert.state.idle');
}

/**
 * The same state in the *other* language, shown small next to the headline so a
 * warning reads correctly to both a Japanese and an English speaker standing in
 * front of the same screen.
 */
export function eewStateLabelSecondary(state: EewAlert['state']): string {
  return tIn(getLocale() === 'ja' ? 'en' : 'ja', EEW_STATE_KEYS[state] ?? 'alert.state.idle');
}

/** JMA tsunami grade → message key. Unknown grades fall back to a neutral label. */
const GRADE_KEYS: Record<string, 'grade.majorWarning' | 'grade.warning' | 'grade.watch' | 'grade.nonEffective'> = {
  MajorWarning: 'grade.majorWarning',
  Warning: 'grade.warning',
  Watch: 'grade.watch',
  NonEffective: 'grade.nonEffective',
};

export function tsunamiGradeLabel(grade: string): string {
  const key = GRADE_KEYS[grade];
  return key ? t(key) : t('grade.default');
}
