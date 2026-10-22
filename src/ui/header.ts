import { formatJstClock } from '../core/time';
import { LOCALES, getLocale, setLocale, t, type Locale } from '../i18n';
import { connectionLabel } from '../state/store';
import type { AppState } from '../state/store';
import { el } from './dom';

/**
 * Application header — 52 px on desktop, 48 px on phones.
 *
 * Hierarchy: identity is quiet, the monitoring context says what this screen is,
 * and the right cluster answers the three questions an operator asks continuously
 * ("is it connected?", "how fresh is it?", "what time is it?"). Nothing here is
 * decorative and nothing is duplicated from the alert banner.
 */
export function createHeader(handlers: { onOpenInfo: () => void } = { onOpenInfo: () => {} }): {
  el: HTMLElement;
  update: (s: AppState) => void;
} {
  const mark = el('span', { class: 'hdr__mark', 'aria-hidden': 'true' });
  const name = el('span', { class: 'hdr__name', text: 'YureWatch' });
  const context = el('span', { class: 'hdr__context' });

  const connDot = el('span', { class: 'connDot', 'aria-hidden': 'true' });
  const connText = el('span', { class: 'conn__text' });
  const conn = el('span', { class: 'conn' }, connDot, connText);

  const clockValue = el('span', { class: 'hdr__clockValue' });
  const clockZone = el('span', { class: 'hdr__clockZone', text: t('meta.jst') });
  const clock = el('time', { class: 'hdr__clock' }, clockValue, ' ', clockZone);

  const langSwitch = el('div', { class: 'langSwitch', role: 'group' });
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
    langSwitch.appendChild(button);
  }

  const infoBtn = el('button', {
    class: 'hdr__btn',
    type: 'button',
    'data-action': 'info',
    html:
      '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
      '<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.7"/>' +
      '<path d="M12 11v5.5M12 7.6v.1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  });
  infoBtn.addEventListener('click', () => handlers.onOpenInfo());

  const el_ = el('header', { class: 'hdr' },
    el('div', { class: 'hdr__left' }, mark, name, context),
    el('div', { class: 'hdr__right' }, conn, clock, langSwitch, infoBtn),
  );

  return {
    el: el_,
    update(state: AppState) {
      const demo = state.mode === 'demo';
      context.textContent = t('app.context');

      const health = state.health.state;
      conn.dataset.conn = health;
      conn.classList.toggle('is-demo', demo);
      connText.textContent = demo ? `${t('mode.demo')}・${connectionLabel(health)}` : connectionLabel(health);
      conn.setAttribute(
        'aria-label',
        t('conn.aria', { state: demo ? `${t('mode.demo')}・${connectionLabel(health)}` : connectionLabel(health) }),
      );

      clockValue.textContent = formatJstClock(state.now);
      clockZone.textContent = t('meta.jst');
      clock.setAttribute('aria-label', `${formatJstClock(state.now)} ${t('meta.jst')}`);

      langSwitch.setAttribute('aria-label', t('lang.label'));
      const active = getLocale();
      for (const [locale, button] of langButtons) {
        const selected = locale === active;
        button.classList.toggle('is-active', selected);
        button.setAttribute('aria-pressed', selected ? 'true' : 'false');
        button.textContent = t(`lang.${locale}`);
        button.setAttribute('aria-label', t('lang.aria', { name: t(`lang.${locale}`) }));
      }
      infoBtn.setAttribute('aria-label', t('nav.info'));
      infoBtn.setAttribute('title', t('nav.info'));
    },
  };
}
