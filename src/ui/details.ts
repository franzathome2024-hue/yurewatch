import { hasIntensity, scaleStyle } from '../core/intensity';
import { coordinates, formatDepth, formatMagnitude, infoTypeLabel, tsunamiLabel } from '../core/format';
import { formatAge, formatJst } from '../core/time';
import { selectEvent, type AppState } from '../state/store';
import { badge, clear, el } from './dom';

/**
 * Selected-event inspector. Shows what the source actually said, with the
 * provenance visible: telegram type, revision count, source name and age.
 */
export function createDetails(opts: { onClose: () => void }): { el: HTMLElement; update: (s: AppState) => void } {
  const body = el('div', { class: 'details__body' });
  const title = el('h2', { class: 'panel__title', text: '地震の詳細' });
  const close = el('button', { class: 'iconButton', type: 'button', 'aria-label': '詳細を閉じる', text: '×' });
  close.addEventListener('click', () => opts.onClose());

  const root = el('section', { class: 'panel panel--details' },
    el('header', { class: 'panel__head' },
      title,
      el('span', { class: 'panel__spacer' }),
      close,
    ),
    body,
  );

  let signature = '';

  return {
    el: root,
    update(state) {
      const ev = selectEvent(state);
      const sig = ev ? `${ev.id}:${ev.revision}:${ev.maxIntensity}:${ev.points.length}` : 'none';
      if (sig === signature) return;
      signature = sig;
      clear(body);

      if (!ev) {
        body.appendChild(
          el('div', { class: 'details__empty' },
            el('p', { text: '地図または一覧から地震を選択してください。' }),
            el('p', { class: 'details__hint', text: '震源・規模・各地の震度を表示します。' }),
          ),
        );
        return;
      }

      const style = scaleStyle(ev.maxIntensity);
      const tsunami = tsunamiLabel(ev.tsunami);
      const magnitude = ev.epicenter?.magnitude ?? -1;

      body.appendChild(
        el('div', { class: 'details__hero' },
          el('div', {
            class: 'details__scale',
            style: `background:${hasIntensity(ev.maxIntensity) ? style.fill : '#2a3644'};color:${hasIntensity(ev.maxIntensity) ? style.text : '#a9b8c9'}`,
          },
            el('span', { class: 'details__scaleLabel', text: '最大震度' }),
            el('span', { class: 'details__scaleValue', text: hasIntensity(ev.maxIntensity) ? style.label : '—' }),
          ),
          el('div', { class: 'details__ident' },
            el('h3', { class: 'details__name', text: ev.epicenter?.name ?? '震源不明' }),
            el('div', { class: 'details__chips' },
              ev.preliminary ? badge('暫定情報', 'warn') : badge('詳細情報', 'ok'),
              ev.simulated ? badge('SIMULATION', 'sim') : null,
              ev.revision > 1 ? badge(`第${ev.revision}報`, 'neutral') : null,
            ),
            el('p', { class: 'details__time', text: `${formatJst(ev.originTime)} ごろ` }),
          ),
        ),
      );

      body.appendChild(
        el('dl', { class: 'kv' },
          kvPair('マグニチュード', formatMagnitude(magnitude)),
          kvPair('深さ', formatDepth(ev.epicenter?.depthKm ?? -1)),
          kvPair('震央', coordinates(ev.epicenter)),
          kvPair('発表', ev.issuedAt ? `${formatJst(ev.issuedAt)}（${infoTypeLabel(ev.infoType)}）` : infoTypeLabel(ev.infoType)),
          kvPair('受信', `${formatJst(ev.receivedAt)}（${formatAge(ev.receivedAt, state.now)}）`),
        ),
      );

      body.appendChild(
        el('p', { class: `details__tsunami details__tsunami--${tsunami.tone}`, text: tsunami.text }),
      );

      if (ev.epicenter?.provisional) {
        body.appendChild(el('p', { class: 'details__warn', text: '震源は仮定震源要素です。確定値ではありません。' }));
      }

      // ---- observed intensities ---------------------------------------
      if (ev.points.length) {
        const sorted = [...ev.points].sort((a, b) => b.scale - a.scale);
        const max = sorted[0]!.scale;
        const shown = sorted.slice(0, 14);
        body.appendChild(
          el('div', { class: 'points' },
            el('div', { class: 'points__head' },
              el('h4', { text: '各地の震度' }),
              el('span', { class: 'points__count', text: `${ev.points.length}地点` }),
            ),
            el('ul', { class: 'points__list' },
              ...shown.map((p) => {
                const s = scaleStyle(p.scale);
                return el('li', { class: 'points__row' },
                  el('span', { class: 'points__bar', style: `background:${s.fill};width:${Math.max(12, (p.scale / Math.max(10, max)) * 64)}px` }),
                  el('span', { class: 'points__scale', text: s.label }),
                  el('span', { class: 'points__name', text: `${p.pref} ${p.name}` }),
                );
              }),
            ),
            ev.points.length > shown.length
              ? el('p', { class: 'points__more', text: `他 ${ev.points.length - shown.length} 地点（上位のみ表示）` })
              : null,
          ),
        );
      } else {
        body.appendChild(el('p', { class: 'details__hint', text: '各地の震度はまだ発表されていません。' }));
      }

      body.appendChild(
        el('p', { class: 'details__source' },
          `情報源: ${ev.source.provider}${ev.source.relayed ? '（気象庁の情報を中継）' : ''}`,
          ev.sourceIds.length > 1 ? `・電文 ${ev.sourceIds.length}件を統合` : '',
        ),
      );
    },
  };
}

function kvPair(label: string, value: string): HTMLElement {
  return el('div', { class: 'kv__row' },
    el('dt', { text: label }),
    el('dd', { text: value }),
  );
}
