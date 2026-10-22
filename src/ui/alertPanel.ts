import { hasIntensity, scaleStyle } from '../core/intensity';
import type { EewAlert } from '../core/models';
import { eewStateLabel, eewStateLabelSecondary, formatDepth, formatMagnitude } from '../core/format';
import { formatAge, formatJst, formatJstClock } from '../core/time';
import { t, type MessageKey } from '../i18n';
import { strongestAreas } from '../state/alert';
import type { AppState } from '../state/store';
import { badge, clear, el } from './dom';

/**
 * EEW surface.
 *
 * Normal conditions get a single thin strip (what was last checked, and whether
 * anything is in effect). A real alert expands into a compact banner: the
 * classification first, then the numbers, then the areas. The banner never
 * covers the map, and it is the only place in the application that uses
 * full-saturation colour.
 *
 * Honesty rules:
 *  - 予報 (forecast) and 警報 (warning) are visually and textually distinct; a
 *    forecast never borrows the warning styling.
 *  - Simulated/test alerts get their own badge and never the red treatment.
 *  - An unavailable source never renders as "no alert".
 *  - No countdown is invented; arrival times are shown only when the source
 *    supplies them, with the area they belong to.
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
        renderStrip(root, state, offline);
        return;
      }
      renderBanner(root, state, alert);
    },
  };
}

/* ------------------------------------------------------------------ idle -- */

function renderStrip(root: HTMLElement, state: AppState, offline: boolean): void {
  const last = state.alertHistory[0];
  const lastAt = last ? (last.issuedAt ?? last.receivedAt) : state.health.lastSuccessAt;

  const strip = el('div', { class: 'strip' },
    el('span', { class: 'strip__label', text: t('alert.strip.label') }),
    offline
      ? el('span', { class: 'strip__state strip__state--unknown', text: t('alert.strip.unknown') })
      : el('span', { class: 'strip__state', text: t('alert.strip.none') }),
    el('span', { class: 'strip__spacer' }),
    offline
      ? el('span', { class: 'strip__meta strip__meta--warn', text: t('alert.strip.offline') })
      : lastAt !== null
        ? el('span', { class: 'strip__meta', text: t('alert.strip.checked', { time: formatJstClock(lastAt) }) })
        : null,
    el('span', { class: 'strip__age', text: offline ? t('status.noData') : t('fresh.fresh') }),
  );

  // The full statement stays in the accessibility tree: a strip is compact for
  // the eye, not for a screen reader.
  const detail = el('p', { class: 'srOnly', text: offline ? t('alert.idle.offlineMain') : t('alert.idle.onlineMain') });
  root.append(strip, detail);
}

/* ----------------------------------------------------------------- active -- */

function renderBanner(root: HTMLElement, state: AppState, alert: EewAlert): void {
  const style = hasIntensity(alert.maxScaleTo) ? scaleStyle(alert.maxScaleTo) : null;
  const isForecast = alert.state === 'forecast';
  const isCancelled = alert.state === 'cancelled';
  const sim = alert.simulated;

  root.classList.toggle('alert--forecast', isForecast);
  root.classList.toggle('alert--warning', !isForecast && !isCancelled);

  // ---- header row: classification -----------------------------------
  const head = el('div', { class: 'banner__head' },
    badge(eewStateLabel(alert.state), isForecast ? 'warn' : isCancelled ? 'neutral' : 'danger', 'badge--class'),
    el('span', { class: 'banner__alt', text: eewStateLabelSecondary(alert.state) }),
    el('span', { class: 'banner__spacer' }),
    alert.serial > 0 ? el('span', { class: 'banner__serial', text: t('alert.serial', { n: alert.serial }) }) : null,
    sim ? badge(t('demo.simBadge'), 'sim') : null,
    alert.isTest ? badge(t('alert.badge.test'), 'warn') : null,
    alert.issuedAt !== null
      ? el('span', { class: 'banner__time', text: `${formatJst(alert.issuedAt)}` })
      : null,
  );

  // ---- body: numbers -------------------------------------------------
  const body = el('div', { class: 'banner__body' });

  if (isCancelled) {
    body.appendChild(
      el('p', { class: 'banner__cancelled' },
        el('strong', { text: t('alert.cancelledTitle') }),
        el('span', { text: t('alert.cancelledNote') }),
      ),
    );
  } else {
    const scale = el('div', {
      class: 'banner__scale',
      style: `--scale-color:${style?.fill ?? '#393E44'};--scale-text:${style?.text ?? '#F0F2F4'}`,
    },
      el('span', { class: 'banner__scaleLabel', text: t('alert.scaleLabel') }),
      el('span', { class: 'banner__scaleValue', text: style ? style.label : t('meta.unknown') }),
    );

    const facts = el('dl', { class: 'banner__facts' },
      fact(t('alert.fact.epicenter'), alert.epicenter?.name ?? t('alert.epicenterUnknown')),
      fact(t('alert.fact.magnitude'), formatMagnitude(alert.epicenter?.magnitude ?? -1)),
      fact(t('alert.fact.depth'), formatDepth(alert.epicenter?.depthKm ?? -1)),
    );

    // Source-provided arrival estimate only.
    const withArrival = alert.areas.filter((a) => a.arrivalTime !== null);
    let arrival: HTMLElement | null = null;
    if (withArrival.length) {
      const soonest = withArrival.reduce((min, a) => (a.arrivalTime! < min.arrivalTime! ? a : min), withArrival[0]!);
      const past = soonest.arrivalTime! <= state.now;
      arrival = el('div', { class: 'banner__arrival' },
        el('span', { class: 'banner__arrivalLabel', text: past ? t('alert.arrival.past') : t('alert.arrival.soonest') }),
        el('span', { class: 'banner__arrivalValue', text: formatJstClock(soonest.arrivalTime) }),
        el('span', { class: 'banner__arrivalArea', text: t('alert.arrival.source', { area: soonest.name }) }),
        el('span', { class: 'banner__hint', text: t('alert.arrival.disclaimer') }),
      );
    }

    body.append(scale, facts);
    if (arrival) body.appendChild(arrival);
  }

  // ---- areas ---------------------------------------------------------
  let areas: HTMLElement | null = null;
  if (alert.areas.length) {
    const top = strongestAreas(alert, 8);
    areas = el('div', { class: 'banner__areas' },
      el('span', { class: 'banner__areasTitle', text: t('alert.areas.title', { n: alert.areas.length }) }),
      el('ul', { class: 'banner__areaList' },
        ...top.map((a) => {
          const s = scaleStyle(a.scaleTo);
          const range = a.scaleFrom === a.scaleTo ? s.label : `${scaleStyle(a.scaleFrom).label}–${s.label}`;
          return el('li', { class: 'areaPill' },
            el('span', { class: 'areaPill__dot', style: `background:${s.fill}`, 'aria-hidden': 'true' }),
            el('span', { class: 'areaPill__name', text: a.name || a.pref }),
            el('span', { class: 'areaPill__scale', text: range }),
            kindLabel(a.kindCode) ? el('span', { class: 'areaPill__kind', text: kindLabel(a.kindCode) }) : null,
          );
        }),
      ),
      alert.areas.length > top.length
        ? el('span', { class: 'banner__more', text: t('alert.areas.more', { n: alert.areas.length - top.length }) })
        : null,
    );
  } else if (!isCancelled) {
    areas = el('p', { class: 'banner__flag', text: t('alert.areas.missing') });
  }

  // ---- footnotes -----------------------------------------------------
  const flags: HTMLElement[] = [];
  if (alert.epicenter?.provisional) flags.push(el('p', { class: 'banner__flag' }, t('alert.provisional')));

  const note = el('p', { class: 'banner__note', text: sim ? t('alert.sim') : t('alert.disclaimer') });

  const age = t('age.received', { age: formatAge(alert.issuedAt ?? alert.receivedAt, state.now) });
  const times = el('div', { class: 'banner__times' },
    el('span', { text: `${t('alert.time.origin')} ${formatJst(alert.originTime)}` }),
    el('span', { text: `${t('alert.time.issued')} ${formatJst(alert.issuedAt)}` }),
    el('span', { class: 'banner__age', text: age }),
  );

  root.append(...([head, body, areas, ...flags, times, note].filter(Boolean) as HTMLElement[]));
}

function fact(label: string, value: string): HTMLElement {
  return el('div', { class: 'banner__fact' },
    el('dt', { text: label }),
    el('dd', { text: value }),
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
