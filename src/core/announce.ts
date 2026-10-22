import { scaleStyle } from './intensity';
import type { EewAlert } from './models';
import { eewStateLabel, tsunamiGradeLabel } from './format';
import { t } from '../i18n';

/**
 * Announcement policy (pure).
 *
 * Decides *whether* an alert should be spoken and *what* to say, separately from
 * the speech engine, so the rules can be unit-tested without audio:
 *
 *  - one announcement per alert revision (dedupe on eventId + serial + state),
 *  - a cancellation is always spoken — it is a state change people must hear —
 *    but it never gets the urgent tone,
 *  - 訓練/試験 (test) transmissions are never spoken as real warnings,
 *  - simulated alerts are only spoken when the developer flag is on,
 *  - a newer alert supersedes the older one instead of queueing behind it,
 *  - missing fields are omitted from the sentence rather than guessed, so the
 *    voice never states an intensity or magnitude that JMA did not issue.
 */

export type AnnouncePriority = 'urgent' | 'notify' | 'state-change';

export interface Announcement {
  /** Stable de-duplication key: eventId + serial + state. */
  key: string;
  priority: AnnouncePriority;
  /** Sentence to speak, already localised. */
  text: string;
  alert: EewAlert;
}

export interface AnnounceContext {
  /** `preferences.soundEnabled` / `preferences.voiceEnabled`. */
  enabled: boolean;
  /** `preferences.demoAudio` — the only way a simulated alert may speak. */
  demoAllowed: boolean;
}

function stateWord(alert: EewAlert): string {
  switch (alert.state) {
    case 'warning':
      return t('alert.state.warning');
    case 'forecast':
      return t('alert.state.forecast');
    case 'updated':
      return t('alert.state.updated');
    case 'cancelled':
      return t('alert.state.cancelled');
    default:
      return t('alert.state.idle');
  }
}

/**
 * Build the spoken sentence. Reads the same numbers the banner shows; anything
 * that is not known is left out (`—` would be read as "dash" and a fabricated
 * number would be worse than silence).
 */
export function announcementText(alert: EewAlert): string {
  if (alert.state === 'cancelled') {
    return `${t('voice.cancelled')} ${t('voice.cancelledNote')}`;
  }

  const parts: string[] = [t('voice.headline'), stateWord(alert)];

  if (alert.epicenter?.name) {
    parts.push(t('voice.epicenter', { name: alert.epicenter.name }));
  }
  if (alert.maxScaleTo > 0) {
    parts.push(t('voice.intensity', { scale: scaleStyle(alert.maxScaleTo).label }));
  }
  if (alert.epicenter && alert.epicenter.magnitude > 0) {
    parts.push(t('voice.magnitude', { magnitude: alert.epicenter.magnitude.toFixed(1) }));
  }
  if (alert.epicenter && alert.epicenter.depthKm >= 0) {
    parts.push(t('voice.depth', { depth: String(Math.round(alert.epicenter.depthKm)) }));
  }
  if (alert.serial > 1) {
    parts.push(t('voice.report', { n: String(alert.serial) }));
  }
  parts.push(alert.state === 'forecast' ? t('voice.adviceForecast') : t('voice.adviceWarning'));

  // A plain space: the fragments already carry their own punctuation, and a
  // punctuation separator would double it ("速報。。警報").
  return parts.join(' ');
}

/**
 * Decide what (if anything) to speak for a newly accepted alert.
 *
 * @param alert   the alert after the reducer accepted it
 * @param spoken  keys already spoken this session (mutated by the caller)
 */
export function planAnnouncement(
  alert: EewAlert | null,
  spoken: Set<string>,
  ctx: AnnounceContext,
): Announcement | null {
  if (!alert || !ctx.enabled) return null;
  if (alert.isTest) return null;
  if (alert.simulated && !ctx.demoAllowed) return null;

  const key = `${alert.eventId}:${alert.serial}:${alert.state}`;
  if (spoken.has(key)) return null;

  const priority: AnnouncePriority =
    alert.state === 'cancelled' ? 'state-change' : alert.state === 'forecast' ? 'notify' : 'urgent';

  return { key, priority, text: announcementText(alert), alert };
}

/** Tsunami bulletins are spoken too, at lower priority than an EEW. */
export function planTsunamiAnnouncement(
  info: { id: string; cancelled: boolean; areas: Array<{ name: string; grade: string }> } | null,
  spoken: Set<string>,
  ctx: AnnounceContext,
): Announcement | null {
  if (!info || !ctx.enabled) return null;
  const key = `tsunami:${info.id}:${info.cancelled ? 'cancelled' : 'issued'}`;
  if (spoken.has(key)) return null;
  const parts: string[] = [t('tsunami.sectionTitle')];
  if (info.cancelled) {
    parts.push(t('voice.cancelled'));
  } else {
    const ranked = [...info.areas].sort((a, b) => rank(b.grade) - rank(a.grade));
    const top = ranked[0];
    if (top) parts.push(`${tsunamiGradeLabel(top.grade)}`, t('voice.epicenter', { name: top.name }));
    if (info.areas.length > 1) parts.push(t('voice.areasMore', { n: String(info.areas.length) }));
  }
  return {
    key,
    priority: 'notify',
    text: parts.join(' '),
    // Tsunami bulletins have no EewAlert; the field is only used for logging.
    alert: null as unknown as EewAlert,
  };
}

function rank(grade: string): number {
  switch (grade) {
    case 'MajorWarning':
      return 5;
    case 'Warning':
      return 4;
    case 'Watch':
      return 3;
    case 'NonEffective':
      return 2;
    default:
      return 0;
  }
}
