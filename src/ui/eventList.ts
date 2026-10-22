import { hasIntensity, scaleStyle } from '../core/intensity';
import { infoTypeLabel, tsunamiLabel } from '../core/format';
import { formatAgeCoarse, formatJstShort } from '../core/time';
import type { AppState } from '../state/store';
import { badge, clear, el } from './dom';

/**
 * Scrollable earthquake feed. Rows are deliberately dense (the reference app
 * stacks ~9 of them under the map on a phone) but every row states its own
 * freshness and whether the report is still preliminary.
 */
export function createEventList(opts: {
  onSelect: (id: string) => void;
  title?: string;
}): { el: HTMLElement; update: (s: AppState) => void } {
  const list = el('ol', { class: 'feed__list' });
  const count = el('span', { class: 'panel__count' });
  const root = el('section', { class: 'panel panel--feed' },
    el('header', { class: 'panel__head' },
      el('h2', { class: 'panel__title', text: opts.title ?? '地震情報' }),
      count,
    ),
    list,
  );

  let signature = '';

  return {
    el: root,
    update(state) {
      const events = state.events;
      const sig = events.map((e) => `${e.id}:${e.revision}:${e.maxIntensity}`).join('|') + `#${state.selectedEventId}#${Math.floor(state.now / 30_000)}`;
      if (sig === signature) return;
      signature = sig;

      clear(list);
      count.textContent = events.length ? `${events.length}件` : '';

      if (!events.length) {
        list.appendChild(
          el('li', { class: 'feed__empty' },
            el('p', { text: state.health.state === 'offline' ? '地震情報を取得できません（オフライン）' : '地震情報がまだありません' }),
            el('p', { class: 'feed__emptyNote', text: '受信すると自動的にこの一覧へ追加されます。' }),
          ),
        );
        return;
      }

      for (const ev of events) {
        const style = scaleStyle(ev.maxIntensity);
        const selected = ev.id === state.selectedEventId;
        const tsunami = tsunamiLabel(ev.tsunami);
        const row = el('li', { class: 'feed__item' + (selected ? ' is-selected' : '') },
          el('button', {
            class: 'feed__button',
            type: 'button',
            'aria-pressed': selected ? 'true' : 'false',
            onclick: undefined,
            'data-event-id': ev.id,
          },
            el('span', {
              class: 'feed__scale',
              style: `background:${hasIntensity(ev.maxIntensity) ? style.fill : '#2a3644'};color:${hasIntensity(ev.maxIntensity) ? style.text : '#a9b8c9'}`,
              text: hasIntensity(ev.maxIntensity) ? style.label : '—',
            }),
            el('span', { class: 'feed__main' },
              el('span', { class: 'feed__title' },
                el('span', { class: 'feed__name', text: ev.epicenter?.name ?? '震源不明' }),
                ev.simulated ? badge('SIM', 'sim') : null,
                ev.preliminary ? badge('暫定', 'warn') : null,
                ev.revision > 1 ? badge(`第${ev.revision}報`, 'neutral') : null,
              ),
              el('span', { class: 'feed__meta' },
                formatJstShort(ev.originTime),
                ev.epicenter ? `・M${ev.epicenter.magnitude > 0 ? ev.epicenter.magnitude.toFixed(1) : '不明'}` : '',
                ev.epicenter ? `・深さ${ev.epicenter.depthKm >= 0 ? `${Math.round(ev.epicenter.depthKm)}km` : '不明'}` : '',
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
