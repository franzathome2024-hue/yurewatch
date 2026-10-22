import { hasIntensity, scaleStyle } from '../core/intensity';
import type { TsunamiGrade } from '../core/models';
import { formatDepth, formatMagnitude, tsunamiGradeLabel } from '../core/format';
import { formatJstClock } from '../core/time';
import { t, type MessageKey } from '../i18n';
import { nextArrival } from '../state/alert';
import type { AppState } from '../state/store';
import { clear, el } from './dom';

/**
 * The compact EEW monitor window anchored to the map's top-right corner —
 * the always-visible instrument readout, in the spirit of dedicated seismic
 * monitors (JQuake and kin). The wide alert banner remains the detailed,
 * transient announcement; this window is the persistent state of the EEW
 * itself: standby, forecast, warning, revised, cancelled, test/simulated,
 * and feed-unavailable/stale are all distinct, labelled states.
 *
 * Honesty rules, enforced here rather than by convention:
 * - a value the source did not supply renders as `---` — never 0, never a
 *   guess (arrival estimates come only from `EewArea.arrivalTime` via
 *   `nextArrival`, exactly as the banner phrases them);
 * - raw realtime (Rt) ground-motion noise is never shown here: this window
 *   speaks only official JMA EEW values;
 * - tsunami status is shown only when a bulletin exists in state, graded
 *   with the same labels as the tsunami panel.
 *
 * The window is deliberately NOT an aria-live region: it re-renders on the
 * 1 Hz tick for the countdown, and announcements remain the banner's job.
 */

const DASH = '---';

const STATE_CHIP: Record<string, MessageKey> = {
  warning: 'eew.state.warning',
  forecast: 'eew.state.forecast',
  updated: 'eew.state.revised',
  cancelled: 'eew.state.cancelled',
  unavailable: 'eew.state.unavailable',
};

const GRADE_RANK: Record<TsunamiGrade, number> = {
  MajorWarning: 3,
  Warning: 2,
  Watch: 1,
  NonEffective: 0,
  Unknown: -1,
  None: -1,
  Checking: -1,
};

function countdownText(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `-${m}:${String(s).padStart(2, '0')}`;
}

export function createEewWindow(): { el: HTMLElement; update: (s: AppState) => void } {
  const root = el('section', { class: 'eewWin', 'aria-label': t('eew.title'), 'data-state': 'standby' });

  const row = (label: string, value: string, rowClass = '') =>
    el('div', { class: `eewWin__row ${rowClass}`.trim() },
      el('span', { class: 'eewWin__label', text: label }),
      el('span', { class: 'eewWin__value', text: value }),
    );

  const update = (state: AppState): void => {
    clear(root);
    const alert = state.alert;

    if (!alert) {
      root.dataset.state = 'standby';
      const feed = state.health.state;
      const noteKey: MessageKey =
        feed === 'offline' ? 'eew.feed.offline'
        : feed === 'stale' || feed === 'degraded' ? 'eew.feed.stale'
        : feed === 'idle' || feed === 'connecting' ? 'eew.feed.connecting'
        : 'eew.monitoring';
      root.append(
        el('div', { class: 'eewWin__head' },
          el('span', { class: 'eewWin__chip', text: t('eew.state.standby') }),
          el('span', { class: 'eewWin__note', text: t(noteKey) }),
        ),
        row(t('alert.arrival.soonest'), DASH),
        row(t('alert.scaleLabel'), DASH),
        row(t('alert.fact.epicenter'), DASH),
        row(t('alert.fact.magnitude'), DASH, 'eewWin__row--mag'),
        row(t('alert.fact.depth'), DASH, 'eewWin__row--meta'),
        row(t('tsunami.sectionTitle'), DASH, 'eewWin__row--tsunami'),
      );
      return;
    }

    root.dataset.state = alert.state;
    const style = hasIntensity(alert.maxScaleTo) ? scaleStyle(alert.maxScaleTo) : null;
    const arrival = nextArrival(alert, state.now);
    const tsunami = state.tsunami;
    const topGrade = tsunami && !tsunami.cancelled && tsunami.areas.length
      ? tsunami.areas.reduce((a, b) => (GRADE_RANK[b.grade] > GRADE_RANK[a.grade] ? b : a)).grade
      : null;

    root.append(
      el('div', { class: 'eewWin__head' },
        el('span', { class: 'eewWin__chip', text: t(STATE_CHIP[alert.state] ?? 'eew.state.unavailable') }),
        alert.isTest ? el('span', { class: 'eewWin__badge eewWin__badge--warn', text: t('alert.badge.test') }) : null,
        alert.simulated ? el('span', { class: 'eewWin__badge', text: t('feed.badge.sim') }) : null,
        el('span', { class: 'eewWin__serial', text: t('alert.serial', { n: alert.serial }) }),
      ),
      arrival
        ? el('div', { class: 'eewWin__row eewWin__row--arrival' },
            el('span', { class: 'eewWin__label', text: t(arrival.reached ? 'alert.arrival.past' : 'alert.arrival.soonest') }),
            el('span', { class: 'eewWin__value', text: formatJstClock(arrival.at) }),
            arrival.reached
              ? null
              : el('span', { class: 'eewWin__count', text: countdownText(arrival.at - state.now) }),
          )
        : row(t('alert.arrival.soonest'), DASH),
      el('div', { class: 'eewWin__row eewWin__row--scale' },
        el('span', { class: 'eewWin__label', text: t('alert.scaleLabel') }),
        el('span', {
          class: 'eewWin__scaleValue',
          text: style ? style.label : DASH,
          ...(style ? { style: `--scale-color:${style.fill};--scale-text:${style.text}` } : {}),
        }),
      ),
      row(t('alert.fact.epicenter'), alert.epicenter?.name ?? DASH),
      el('div', { class: 'eewWin__row eewWin__row--mag' },
        el('span', { class: 'eewWin__label', text: t('alert.fact.magnitude') }),
        el('span', { class: 'eewWin__value', text: alert.epicenter ? formatMagnitude(alert.epicenter.magnitude) : DASH }),
      ),
      el('div', { class: 'eewWin__row eewWin__row--meta' },
        el('span', { class: 'eewWin__label', text: t('alert.fact.depth') }),
        el('span', { class: 'eewWin__value', text: alert.epicenter ? formatDepth(alert.epicenter.depthKm) : DASH }),
        el('span', { class: 'eewWin__issued', text: alert.issuedAt !== null ? formatJstClock(alert.issuedAt) : DASH }),
      ),
      el('div', { class: 'eewWin__row eewWin__row--tsunami' },
        el('span', { class: 'eewWin__label', text: t('tsunami.sectionTitle') }),
        el('span', {
          class: 'eewWin__value',
          text: tsunami
            ? tsunami.cancelled
              ? t('eew.tsunami.cancelled')
              : topGrade
                ? tsunamiGradeLabel(topGrade)
                : DASH
            : DASH,
        }),
      ),
    );
  };

  return { el: root, update };
}
