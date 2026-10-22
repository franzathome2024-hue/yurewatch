import { hasIntensity, scaleStyle } from '../core/intensity';
import { coordinates, formatDepth, formatMagnitude, infoTypeLabel, tsunamiLabel } from '../core/format';
import { formatAge, formatJst } from '../core/time';
import { getLocaleVersion, t } from '../i18n';
import { selectEvent, type AppState } from '../state/store';
import { badge, clear, el } from './dom';

/**
 * Selected-event detail.
 *
 * Information order follows what an operator reads: where, how big, how strong,
 * how deep, when, then provenance. Values the source did not provide are shown
 * as unavailable rather than as zero, and report type / revision count are kept
 * visible because "震度速報" and "各地の震度に関する情報" are not the same claim.
 */
export function createDetails(opts: { onClose: () => void }): { el: HTMLElement; update: (s: AppState) => void } {
  const body = el('div', { class: 'detail__body' });
  const title = el('h2', { class: 'panelHead__title', text: t('details.title') });
  const close = el('button', { class: 'iconBtn', type: 'button', text: '×' });
  close.addEventListener('click', () => opts.onClose());

  const root = el('section', { class: 'panel panel--detail' },
    el('header', { class: 'panelHead' },
      title,
      el('span', { class: 'panelHead__spacer' }),
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
          el('div', { class: 'detail__empty' },
            el('p', { text: t('details.empty') }),
            el('p', { class: 'detail__hint', text: t('details.emptyHint') }),
          ),
        );
        return;
      }

      const style = scaleStyle(ev.maxIntensity);
      const tsunami = tsunamiLabel(ev.tsunami);

      // ---- identity ----------------------------------------------------
      body.appendChild(
        el('div', { class: 'detail__ident' },
          el('div', {
            class: 'detail__scale',
            style: `background:${hasIntensity(ev.maxIntensity) ? style.fill : '#292D32'};color:${hasIntensity(ev.maxIntensity) ? style.text : '#B3BAC2'}`,
          },
            el('span', { class: 'detail__scaleLabel', text: t('details.scaleLabel') }),
            el('span', { class: 'detail__scaleValue', text: hasIntensity(ev.maxIntensity) ? style.label : t('meta.emDash') }),
          ),
          el('div', { class: 'detail__identText' },
            el('h3', { class: 'detail__name', text: ev.epicenter?.name ?? t('feed.name.unknown') }),
            el('div', { class: 'detail__badges' },
              ev.preliminary ? badge(t('details.badge.preliminary'), 'warn') : badge(t('details.badge.detailed'), 'ok'),
              ev.simulated ? badge(t('demo.simBadge'), 'sim') : null,
              ev.revision > 1 ? badge(t('alert.serial', { n: ev.revision }), 'neutral') : null,
            ),
            el('p', { class: 'detail__approx', text: t('details.approx', { time: formatJst(ev.originTime) }) }),
          ),
        ),
      );

      // ---- metadata grid ----------------------------------------------
      body.appendChild(
        el('dl', { class: 'meta' },
          row(t('details.kv.magnitude'), formatMagnitude(ev.epicenter?.magnitude ?? -1), 'mag'),
          row(t('details.kv.depth'), formatDepth(ev.epicenter?.depthKm ?? -1)),
          row(t('details.kv.epicenter'), coordinates(ev.epicenter)),
          row(t('details.kv.issued'), ev.issuedAt ? formatJst(ev.issuedAt) : t('meta.emDash')),
          row(t('alert.fact.intensity'), hasIntensity(ev.maxIntensity) ? scaleStyle(ev.maxIntensity).longLabel : t('meta.unknown')),
          row(t('diag.classification'), infoTypeLabel(ev.infoType)),
          row(t('details.kv.received'), `${formatJst(ev.receivedAt)}（${formatAge(ev.receivedAt, state.now)}）`),
        ),
      );

      body.appendChild(el('p', { class: `detail__tsunami detail__tsunami--${tsunami.tone}`, text: tsunami.text }));

      if (ev.epicenter?.provisional) {
        body.appendChild(el('p', { class: 'detail__flag', text: t('details.provisional') }));
      }

      // ---- observed intensities ---------------------------------------
      if (ev.points.length) {
        const sorted = [...ev.points].sort((a, b) => b.scale - a.scale);
        const max = sorted[0]!.scale;
        const shown = sorted.slice(0, 16);
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
                  el('span', { class: 'points__bar' },
                    el('span', {
                      class: 'points__barFill',
                      style: `background:${s.fill};width:${Math.max(10, (p.scale / Math.max(10, max)) * 44)}px`,
                    }),
                  ),
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
        body.appendChild(el('p', { class: 'detail__hint', text: t('details.points.pending') }));
      }

      body.appendChild(
        el('p', { class: 'detail__source' },
          t('details.source', { provider: ev.source.provider }) +
            (ev.source.relayed ? t('details.sourceRelayed') : '') +
            (ev.sourceIds.length > 1 ? t('details.sourceMerged', { n: ev.sourceIds.length }) : ''),
        ),
      );
    },
  };
}

function row(label: string, value: string, extra = ''): HTMLElement {
  return el('div', { class: `meta__row${extra ? ` meta__row--${extra}` : ''}` },
    el('dt', { class: 'meta__label', text: label }),
    el('dd', { class: 'meta__value', text: value }),
  );
}
