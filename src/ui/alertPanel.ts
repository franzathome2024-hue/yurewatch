import { hasIntensity, scaleStyle } from '../core/intensity';
import type { EewAlert } from '../core/models';
import { eewStateLabel, eewStateLabelSecondary, formatDepth, formatMagnitude } from '../core/format';
import { formatAge, formatJst, formatJstClock } from '../core/time';
import { t, type MessageKey } from '../i18n';
import { strongestAreas } from '../state/alert';
import type { AppState } from '../state/store';
import { badge, clear, el } from './dom';

/**
 * The EEW panel. This is the one element that must be readable at a glance from
 * across a room, so it is the only place in the app that uses full-saturation
 * colour, oversized numerals and a hard border.
 *
 * Honesty rules encoded here:
 *  - 予報 / Forecast and 警報 / Warning are visually and textually distinct; a
 *    forecast never borrows the warning styling.
 *  - Simulated and test alerts get their own badge and refuse the red warning
 *    treatment.
 *  - A predicted intensity is always labelled as an estimate.
 *  - No countdown is invented; arrival times come from the source, per area.
 *  - The headline is shown in the active language with the other language
 *    underneath, so one screen reads correctly for both audiences.
 */
export function createAlertPanel(): { el: HTMLElement; update: (s: AppState) => void } {
  const root = el('section', { class: 'alert', 'aria-live': 'polite', 'aria-atomic': 'false' });
  root.setAttribute('role', 'status');

  return {
    el: root,
    update(state) {
      clear(root);
      const alert = state.alert;
      const offline = state.health.state === 'offline';
      root.dataset.state = alert?.state ?? (offline ? 'unavailable' : 'idle');
      root.classList.toggle('alert--active', Boolean(alert && alert.state !== 'cancelled'));
      root.classList.toggle('alert--cancelled', alert?.state === 'cancelled');
      root.classList.toggle('alert--sim', Boolean(alert?.simulated));

      if (!alert) {
        renderIdle(root, state, offline);
        return;
      }
      renderAlert(root, state, alert);
    },
  };
}

function renderIdle(root: HTMLElement, state: AppState, offline: boolean): void {
  const head = el('div', { class: 'alert__head' },
    el('span', { class: 'alert__kicker', text: t('alert.kicker') }),
    badge(offline ? t('alert.badge.unknown') : t('alert.badge.waiting'), offline ? 'warn' : 'neutral'),
  );

  const lastAlert = state.alertHistory[0];
  const body = el('div', { class: 'alert__idle' },
    el('p', { class: 'alert__idleMain', text: offline ? t('alert.idle.offlineMain') : t('alert.idle.onlineMain') }),
    el('p', { class: 'alert__note', text: offline ? t('alert.idle.offlineNote') : t('alert.idle.onlineNote') }),
    lastAlert
      ? el('p', { class: 'alert__meta' }, t('alert.idle.lastReceived', {
          time: formatJst(lastAlert.issuedAt ?? lastAlert.receivedAt),
          age: formatAge(lastAlert.issuedAt ?? lastAlert.receivedAt, state.now),
        }))
      : null,
  );
  root.append(head, body);
}

function renderAlert(root: HTMLElement, state: AppState, alert: EewAlert): void {
  const style = hasIntensity(alert.maxScaleTo) ? scaleStyle(alert.maxScaleTo) : null;
  const isForecast = alert.state === 'forecast';
  const isCancelled = alert.state === 'cancelled';
  const isTest = alert.isTest;
  const sim = alert.simulated;

  root.classList.toggle('alert--forecast', isForecast);
  root.classList.toggle('alert--warning', !isForecast && !isCancelled);

  const head = el('div', { class: 'alert__head' },
    el('span', { class: 'alert__kicker', text: eewStateLabel(alert.state) }),
    el('span', { class: 'alert__en', text: eewStateLabelSecondary(alert.state) }),
    el('span', { class: 'alert__spacer' }),
    alert.serial > 0 ? badge(t('alert.serial', { n: alert.serial }), 'neutral') : null,
    sim ? badge(t('demo.simBadge'), 'sim') : null,
    isTest ? badge(t('alert.badge.test'), 'warn') : null,
  );

  // ---- headline: estimated intensity ---------------------------------
  const headline = el('div', { class: 'alert__headline' });
  if (isCancelled) {
    headline.appendChild(
      el('div', { class: 'alert__cancelled' },
        el('strong', { text: t('alert.cancelledTitle') }),
        el('span', { text: t('alert.cancelledNote') }),
      ),
    );
  } else if (style) {
    headline.appendChild(
      el('div', { class: 'alert__scaleBlock', style: `--scale-color:${style.fill};--scale-text:${style.text}` },
        el('span', { class: 'alert__scaleLabel', text: t('alert.scaleLabel') }),
        el('span', { class: 'alert__scaleValue', text: style.label }),
      ),
    );
    headline.appendChild(
      el('div', { class: 'alert__facts' },
        fact(t('alert.fact.epicenter'), alert.epicenter?.name ?? t('alert.epicenterUnknown')),
        fact(t('alert.fact.magnitude'), formatMagnitude(alert.epicenter?.magnitude ?? -1)),
        fact(t('alert.fact.depth'), formatDepth(alert.epicenter?.depthKm ?? -1)),
      ),
    );
  } else {
    headline.appendChild(
      el('div', { class: 'alert__facts' },
        fact(t('alert.fact.epicenter'), alert.epicenter?.name ?? t('alert.epicenterUnknown')),
        fact(t('alert.fact.magnitude'), formatMagnitude(alert.epicenter?.magnitude ?? -1)),
        fact(t('alert.fact.depth'), formatDepth(alert.epicenter?.depthKm ?? -1)),
        fact(t('alert.fact.intensity'), t('alert.value.noInfo')),
      ),
    );
  }

  // ---- times ---------------------------------------------------------
  const times = el('div', { class: 'alert__times' },
    timeChip(t('alert.time.origin'), formatJst(alert.originTime), alert.originTime),
    timeChip(t('alert.time.issued'), formatJst(alert.issuedAt), alert.issuedAt),
    el('span', { class: 'alert__age', text: t('age.received', { age: formatAge(alert.issuedAt ?? alert.receivedAt, state.now) }) }),
  );

  const blocks: Array<HTMLElement | null> = [head, headline, times];

  if (alert.epicenter?.provisional) {
    blocks.push(el('p', { class: 'alert__flag' }, t('alert.provisional')));
  }

  // ---- arrival (source-provided only) --------------------------------
  if (!isCancelled) {
    const withArrival = alert.areas.filter((a) => a.arrivalTime !== null);
    if (withArrival.length) {
      const soonest = withArrival.reduce((min, a) => (a.arrivalTime! < min.arrivalTime! ? a : min), withArrival[0]!);
      const past = soonest.arrivalTime! <= state.now;
      blocks.push(
        el('div', { class: 'alert__arrival' },
          el('span', { class: 'alert__arrivalLabel', text: past ? t('alert.arrival.past') : t('alert.arrival.soonest') }),
          el('span', { class: 'alert__arrivalValue', text: formatJstClock(soonest.arrivalTime) }),
          el('span', { class: 'alert__arrivalArea', text: t('alert.arrival.source', { area: soonest.name }) }),
          el('span', { class: 'alert__arrivalNote', text: t('alert.arrival.disclaimer') }),
        ),
      );
    } else {
      blocks.push(
        el('div', { class: 'alert__arrival alert__arrival--none' },
          el('span', { class: 'alert__arrivalLabel', text: t('alert.arrival.noneTitle') }),
          el('span', { class: 'alert__arrivalArea', text: t('alert.arrival.noneBody') }),
        ),
      );
    }
  }

  // ---- areas ---------------------------------------------------------
  if (alert.areas.length) {
    const top = strongestAreas(alert, 6);
    blocks.push(
      el('div', { class: 'alert__areas' },
        el('div', { class: 'alert__areasHead' },
          el('span', { text: t('alert.areas.title', { n: alert.areas.length }) }),
          el('span', { class: 'alert__areasNote', text: t('alert.areas.order') }),
        ),
        el('ul', { class: 'alert__areaList' },
          ...top.map((a) => {
            const s = scaleStyle(a.scaleTo);
            const range = a.scaleFrom === a.scaleTo ? s.label : `${scaleStyle(a.scaleFrom).label}〜${s.label}`;
            return el('li', { class: 'alert__area' },
              el('span', { class: 'alert__areaDot', style: `background:${s.fill}` }),
              el('span', { class: 'alert__areaName', text: a.name || a.pref }),
              el('span', { class: 'alert__areaScale', text: range }),
              el('span', { class: 'alert__areaKind', text: kindLabel(a.kindCode) }),
            );
          }),
        ),
        alert.areas.length > top.length
          ? el('p', { class: 'alert__more', text: t('alert.areas.more', { n: alert.areas.length - top.length }) })
          : null,
      ),
    );
  } else if (!isCancelled) {
    blocks.push(el('p', { class: 'alert__flag' }, t('alert.areas.missing')));
  }

  // ---- footer note ---------------------------------------------------
  blocks.push(el('p', { class: 'alert__disclaimer' }, sim ? t('alert.sim') : t('alert.disclaimer')));

  root.append(...(blocks.filter(Boolean) as HTMLElement[]));
}

function fact(label: string, value: string): HTMLElement {
  return el('div', { class: 'alert__fact' },
    el('span', { class: 'alert__factLabel', text: label }),
    el('span', { class: 'alert__factValue', text: value }),
  );
}

function timeChip(label: string, value: string, at: number | null): HTMLElement {
  return el('span', { class: 'alert__time' },
    el('span', { class: 'alert__timeLabel', text: label }),
    el('span', { class: 'alert__timeValue', text: at === null ? t('meta.unknown') : value }),
  );
}

const KIND_KEYS: Record<string, MessageKey> = {
  '10': 'kind.mainNotArrived',
  '11': 'kind.mainArrived',
  '19': 'kind.plum',
};

function kindLabel(code: string): string {
  const key = KIND_KEYS[code];
  return key ? t(key) : '';
}
