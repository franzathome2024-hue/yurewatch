import { hasIntensity, scaleStyle } from '../core/intensity';
import { formatAgeCoarse, formatJstShort } from '../core/time';
import { getLocaleVersion, t } from '../i18n';
import { tsunamiLabel } from '../core/format';
import type { AppState } from '../state/store';
import { badge, clear, el } from './dom';

/**
 * Recent earthquakes — the companion list to the map.
 *
 * One row per event, aligned on a grid so magnitude, intensity and age can be
 * compared down the column instead of being re-read line by line. Rows are
 * separated by a hairline, not by a card each.
 */
export function createEventList(opts: {
  onSelect: (id: string) => void;
  title?: string;
}): { el: HTMLElement; update: (s: AppState) => void } {
  const list = el('ul', { class: 'feed', role: 'list' });
  const count = el('span', { class: 'feed__headCount' });

  const headScale = el('span', { class: 'feed__headScale' });
  const headMain = el('span', { class: 'feed__headMain' });
  const headMag = el('span', { class: 'feed__headMag' });
  // Magnitude and the event count share the last column, which is sized `auto`
  // in the rows themselves — otherwise the header labels drift off the columns
  // they describe (the header used a fixed 46/64/56 track set, rows used 42/auto).
  // Count first, then the column label, so "規模" right-aligns with the M
  // values below it instead of the count pushing it off its own column.
  const headRight = el('div', { class: 'feed__headRight' }, count, headMag);
  const head = el('div', { class: 'feed__head', 'aria-hidden': 'true' }, headScale, headMain, headRight);

  const root = el('section', { class: 'panel panel--feed' }, head, list);

  let signature = '';

  return {
    el: root,
    update(state) {
      const events = state.events;
      const sig =
        events.map((e) => `${e.id}:${e.revision}:${e.maxIntensity}`).join('|') +
        `#${state.selectedEventId}#${state.health.state}#${Math.floor(state.now / 30_000)}#${getLocaleVersion()}`;
      if (sig === signature) return;
      signature = sig;

      // Column labels are localized too: a cached list that keeps Japanese
      // headers while the rows switch to English looks broken.
      headScale.textContent = t('feed.headScale');
      headMain.textContent = t('alert.fact.epicenter');
      headMag.textContent = t('alert.fact.magnitude');
      clear(list);
      count.textContent = events.length ? t('feed.count', { n: events.length }) : '';

      if (!events.length) {
        list.appendChild(
          el('li', { class: 'feed__empty' },
            el('p', { class: 'feed__emptyTitle', text: state.health.state === 'offline' ? t('feed.empty.offline') : t('feed.empty.online') }),
            el('p', { class: 'feed__emptyNote', text: t('feed.empty.note') }),
          ),
        );
        return;
      }

      for (const ev of events) {
        const style = scaleStyle(ev.maxIntensity);
        const selected = ev.id === state.selectedEventId;
        const tsunami = tsunamiLabel(ev.tsunami);
        const name = ev.epicenter?.name ?? t('feed.name.unknown');
        const time = formatJstShort(ev.originTime);
        const magnitude = ev.epicenter ? `M${ev.epicenter.magnitude > 0 ? ev.epicenter.magnitude.toFixed(1) : t('meta.unknown')}` : t('meta.emDash');
        const depth = ev.epicenter
          ? t('feed.meta.depth', { depth: ev.epicenter.depthKm >= 0 ? `${Math.round(ev.epicenter.depthKm)}km` : t('meta.unknown') })
          : '';

        const row = el('li', { class: 'feed__item' + (selected ? ' is-selected' : '') },
          el('button', {
            class: 'feed__button',
            type: 'button',
            'aria-pressed': selected ? 'true' : 'false',
            'data-event-id': ev.id,
            'aria-label': t('feed.aria.select', { name, time }),
          },
            el('span', {
              class: 'feed__scale',
              style: `background:${hasIntensity(ev.maxIntensity) ? style.fill : '#292D32'};color:${hasIntensity(ev.maxIntensity) ? style.text : '#B3BAC2'}`,
              text: hasIntensity(ev.maxIntensity) ? style.label : t('meta.emDash'),
            }),
            el('span', { class: 'feed__main' },
              el('span', { class: 'feed__line1' },
                el('span', { class: 'feed__name', text: name }),
                ev.simulated ? badge(t('feed.badge.sim'), 'sim') : null,
                ev.preliminary ? badge(t('feed.badge.preliminary'), 'warn') : null,
                ev.revision > 1 ? badge(t('alert.serial', { n: ev.revision }), 'neutral') : null,
              ),
              el('span', { class: 'feed__line2' },
                el('time', { class: 'feed__time', text: time }),
                depth ? el('span', { class: 'feed__depth', text: depth }) : null,
                tsunami.tone === 'warn' || tsunami.tone === 'danger'
                  ? el('span', { class: `feed__tsunami feed__tsunami--${tsunami.tone}`, text: tsunami.text })
                  : null,
              ),
            ),
            el('span', { class: 'feed__side' },
              el('span', { class: 'feed__mag', text: magnitude }),
              el('span', { class: 'feed__age', text: formatAgeCoarse(ev.originTime ?? ev.receivedAt, state.now) }),
            ),
          ),
        );
        row.querySelector('button')?.addEventListener('click', () => opts.onSelect(ev.id));
        list.appendChild(row);
      }
    },
  };
}
