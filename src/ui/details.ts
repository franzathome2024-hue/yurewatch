import { hasIntensity, scaleStyle } from '../core/intensity';
import { coordinates, formatDepth, formatMagnitude, infoTypeLabel, tsunamiLabel } from '../core/format';
import { formatAge, formatJst } from '../core/time';
import { getLocaleVersion, t } from '../i18n';
import { selectEvent, type AppState } from '../state/store';
import { badge, clear, el } from './dom';

/**
 * Selected-event inspector. Shows what the source actually said, with the
 * provenance visible: telegram type, revision count, source name and age.
 */
export function createDetails(opts: { onClose: () => void }): { el: HTMLElement; update: (s: AppState) => void } {
  const body = el('div', { class: 'details__body' });
  const title = el('h2', { class: 'panel__title', text: t('details.title') });
  const close = el('button', { class: 'iconButton', type: 'button', text: '×' });
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
      const sig = ev
        ? `${ev.id}:${ev.revision}:${ev.maxIntensity}:${ev.points.length}#${getLocaleVersion()}`
        : `none#${getLocaleVersion()}`;
      if (sig === signature) return;
      signature = sig;

      title.textContent = t('details.title');
      close.setAttribute('aria-label', t('details.close'));
      clear(body);

      if (!ev) {
        body.appendChild(
          el('div', { class: 'details__empty' },
            el('p', { text: t('details.empty') }),
            el('p', { class: 'details__hint', text: t('details.emptyHint') }),
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
            el('span', { class: 'details__scaleLabel', text: t('details.scaleLabel') }),
            el('span', { class: 'details__scaleValue', text: hasIntensity(ev.maxIntensity) ? style.label : t('meta.emDash') }),
          ),
          el('div', { class: 'details__ident' },
            el('h3', { class: 'details__name', text: ev.epicenter?.name ?? t('feed.name.unknown') }),
            el('div', { class: 'details__chips' },
              ev.preliminary ? badge(t('details.badge.preliminary'), 'warn') : badge(t('details.badge.detailed'), 'ok'),
              ev.simulated ? badge(t('demo.simBadge'), 'sim') : null,
              ev.revision > 1 ? badge(t('alert.serial', { n: ev.revision }), 'neutral') : null,
            ),
            el('p', { class: 'details__time', text: t('details.approx', { time: formatJst(ev.originTime) }) }),
          ),
        ),
      );

      body.appendChild(
        el('dl', { class: 'kv' },
          kvPair(t('details.kv.magnitude'), formatMagnitude(magnitude)),
          kvPair(t('details.kv.depth'), formatDepth(ev.epicenter?.depthKm ?? -1)),
          kvPair(t('details.kv.epicenter'), coordinates(ev.epicenter)),
          kvPair(
            t('details.kv.issued'),
            ev.issuedAt
              ? `${formatJst(ev.issuedAt)}（${infoTypeLabel(ev.infoType)}）`
              : infoTypeLabel(ev.infoType),
          ),
          kvPair(t('details.kv.received'), `${formatJst(ev.receivedAt)}（${formatAge(ev.receivedAt, state.now)}）`),
        ),
      );

      body.appendChild(
        el('p', { class: `details__tsunami details__tsunami--${tsunami.tone}`, text: tsunami.text }),
      );

      if (ev.epicenter?.provisional) {
        body.appendChild(el('p', { class: 'details__warn', text: t('details.provisional') }));
      }

      // ---- observed intensities ---------------------------------------
      if (ev.points.length) {
        const sorted = [...ev.points].sort((a, b) => b.scale - a.scale);
        const max = sorted[0]!.scale;
        const shown = sorted.slice(0, 14);
        body.appendChild(
          el('div', { class: 'points' },
            el('div', { class: 'points__head' },
              el('h4', { text: t('details.points.title') }),
              el('span', { class: 'points__count', text: t('details.points.count', { n: ev.points.length }) }),
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
              ? el('p', { class: 'points__more', text: t('details.points.more', { n: ev.points.length - shown.length }) })
              : null,
          ),
        );
      } else {
        body.appendChild(el('p', { class: 'details__hint', text: t('details.points.pending') }));
      }

      body.appendChild(
        el('p', { class: 'details__source' },
          t('details.source', { provider: ev.source.provider }) +
            (ev.source.relayed ? t('details.sourceRelayed') : '') +
            (ev.sourceIds.length > 1 ? t('details.sourceMerged', { n: ev.sourceIds.length }) : ''),
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
