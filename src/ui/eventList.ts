import { hasIntensity, scaleStyle } from '../core/intensity';
import { formatAgeCoarse, formatJstShort } from '../core/time';
import { getLocaleVersion, t } from '../i18n';
import { tsunamiLabel, infoTypeLabel } from '../core/format';
import type { AppState } from '../state/store';
import { badge, clear, el } from './dom';

/**
 * The event feed. Compact rows, numbers in a fixed order (time · magnitude ·
 * depth), and an unambiguous marker for simulated and preliminary records.
 */
export function createEventList(opts: {
  onSelect: (id: string) => void;
  title?: string;
}): { el: HTMLElement; update: (s: AppState) => void } {
  const list = el('ul', { class: 'feed' });
  const count = el('span', { class: 'panel__count' });
  const title = el('h2', { class: 'panel__title' });
  const root = el('section', { class: 'panel panel--feed' },
    el('header', { class: 'panel__head' }, title, count),
    list,
  );

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

      title.textContent = opts.title ?? t('feed.title');
      clear(list);
      count.textContent = events.length ? t('feed.count', { n: events.length }) : '';

      if (!events.length) {
        list.appendChild(
          el('li', { class: 'feed__empty' },
            el('p', { text: state.health.state === 'offline' ? t('feed.empty.offline') : t('feed.empty.online') }),
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
              style: `background:${hasIntensity(ev.maxIntensity) ? style.fill : '#2a3644'};color:${hasIntensity(ev.maxIntensity) ? style.text : '#a9b8c9'}`,
              text: hasIntensity(ev.maxIntensity) ? style.label : t('meta.emDash'),
            }),
            el('span', { class: 'feed__main' },
              el('span', { class: 'feed__title' },
                el('span', { class: 'feed__name', text: name }),
                ev.simulated ? badge(t('feed.badge.sim'), 'sim') : null,
                ev.preliminary ? badge(t('feed.badge.preliminary'), 'warn') : null,
                ev.revision > 1 ? badge(t('alert.serial', { n: ev.revision }), 'neutral') : null,
              ),
              el('span', { class: 'feed__meta' },
                time,
                ev.epicenter ? `・M${ev.epicenter.magnitude > 0 ? ev.epicenter.magnitude.toFixed(1) : t('meta.unknown')}` : '',
                ev.epicenter
                  ? `・${t('feed.meta.depth', {
                      depth: ev.epicenter.depthKm >= 0 ? `${Math.round(ev.epicenter.depthKm)}km` : t('meta.unknown'),
                    })}`
                  : '',
              ),
              el('span', { class: 'feed__sub' },
                infoTypeLabel(ev.infoType),
                `・${formatAgeCoarse(ev.originTime ?? ev.receivedAt, state.now)}`,
                tsunami.tone === 'warn' || tsunami.tone === 'danger' ? tsunami.text : '',
              ),
            ),
          ),
        );
        const button = row.querySelector('button');
        button?.addEventListener('click', () => opts.onSelect(ev.id));
        list.appendChild(row);
      }
    },
  };
}
