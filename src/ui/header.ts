import { formatJstClock } from '../core/time';
import { LOCALES, getLocale, setLocale, t, type Locale } from '../i18n';
import { connectionLabel, freshnessLabel, freshnessOf } from '../state/store';
import type { AppState } from '../state/store';
import { el } from './dom';

/**
 * Top bar: product identity, data mode, connection health, the JST clock and the
 * language switch.
 *
 * The mode chip is intentionally loud — a viewer must never be ambiguous about
 * whether it is showing live JMA information or a simulation. The language
 * switch is deliberately quiet: it is a preference, not an alert instrument.
 */
export function createHeader(): { el: HTMLElement; update: (s: AppState) => void } {
  const brandName = el('span', { class: 'brand__name', text: 'YureWatch' });
  const brandSub = el('span', { class: 'brand__sub' });

  const brand = el('div', { class: 'brand' },
    el('span', { class: 'brand__mark', 'aria-hidden': 'true' }),
    el('span', { class: 'brand__text' }, brandName, brandSub),
  );

  const modeChip = el('span', { class: 'chip chip--mode' });
  const connChip = el('span', { class: 'chip chip--conn' });
  const clockValue = el('span', { class: 'header__clockValue' });
  const clockZone = el('span', { class: 'header__clockZone', text: t('meta.jst') });
  const clock = el('span', { class: 'header__clock' }, clockValue, ' ', clockZone);
  const freshness = el('span', { class: 'header__freshness' });

  // ---- language switch: 日本語 | English -------------------------------
  const switchEl = el('div', { class: 'langSwitch', role: 'group' });
  const langButtons = new Map<Locale, HTMLButtonElement>();
  for (const locale of LOCALES) {
    const button = el('button', {
      class: 'langSwitch__btn',
      type: 'button',
      'data-locale': locale,
      lang: locale,
      text: t(`lang.${locale}`),
    });
    button.addEventListener('click', () => setLocale(locale));
    langButtons.set(locale, button);
    switchEl.appendChild(button);
  }

  const el_ = el('header', { class: 'header' },
    brand,
    el('div', { class: 'header__status' },
      modeChip,
      connChip,
      clock,
      freshness,
    ),
    switchEl,
  );

  return {
    el: el_,
    update(state: AppState) {
      const demo = state.mode === 'demo';
      brandSub.textContent = t('app.brandSub');

      modeChip.textContent = demo ? t('mode.demo') : t('mode.live');
      modeChip.classList.toggle('chip--demo', demo);
      modeChip.classList.toggle('chip--live', !demo);
      modeChip.setAttribute('aria-label', demo ? t('mode.aria.demo') : t('mode.aria.live'));

      const health = state.health.state;
      const connText = connectionLabel(health);
      // The DEMO chip already says "simulated"; this chip reports the transport.
      connChip.textContent = demo ? `${t('mode.connPrefix.demo')}${connText}` : connText;
      connChip.classList.toggle('chip--ok', health === 'live');
      connChip.classList.toggle('chip--warn', health === 'connecting' || health === 'degraded' || health === 'stale');
      connChip.classList.toggle('chip--danger', health === 'offline');
      connChip.setAttribute(
        'aria-label',
        t('conn.aria', { state: demo ? `${t('mode.connPrefix.demo')}${connText}` : connText }),
      );

      clockValue.textContent = formatJstClock(state.now);
      clockZone.textContent = t('meta.jst');
      clock.setAttribute('aria-label', `${formatJstClock(state.now)} ${t('meta.jst')}`);
      const fresh = freshnessOf(state.health.lastSuccessAt, state.now);
      freshness.textContent = freshnessLabel(fresh);
      freshness.dataset.freshness = fresh;

      const active = getLocale();
      switchEl.setAttribute('aria-label', t('lang.label'));
      for (const [locale, button] of langButtons) {
        const selected = locale === active;
        button.classList.toggle('is-active', selected);
        button.setAttribute('aria-pressed', selected ? 'true' : 'false');
        button.textContent = t(`lang.${locale}`);
        button.setAttribute('aria-label', t('lang.aria', { name: t(`lang.${locale}`) }));
      }
    },
  };
}
