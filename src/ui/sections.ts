import { scaleStyle } from '../core/intensity';
import { formatAge, formatJst } from '../core/time';
import { getLocaleVersion, t, type MessageKey } from '../i18n';
import { connectionLabel, freshnessLabel, freshnessOf, initialState, type AppState } from '../state/store';
import { disclosure, el, clear, badge } from './dom';

/**
 * Progressive disclosure for secondary information. Nothing critical lives
 * here — warnings stay in the always-visible alert panel — but a reader needs to
 * be able to answer "where did this come from and is it still live?".
 *
 * The whole tree is rebuilt when the language changes; the content closures
 * re-read state, so a switch is instant and lossless.
 */
export function createSections(): { el: HTMLElement; update: (s: AppState) => void } {
  const root = el('div', { class: 'sections' });
  let stateRef: AppState | null = null;
  let builtLocale = -1;
  let updaters: Array<() => void> = [];
  let tsunamiSection: HTMLElement;
  let diagSection: HTMLElement;
  const getState = (): AppState => stateRef ?? initialState();

  function build(): void {
    clear(root);
    updaters = [];

    /* ---- tsunami ---- */
    const tsunamiBody = el('div');
    updaters.push(() => {
      const state = getState();
      const ts = state.tsunami;
      clear(tsunamiBody);
      if (!ts) {
        tsunamiBody.appendChild(el('p', { class: 'muted', text: t('tsunami.notReceived') }));
        return;
      }
      if (ts.cancelled) {
        tsunamiBody.appendChild(el('p', { class: 'muted', text: t('tsunami.cancelled') }));
        return;
      }
      if (!ts.areas.length) {
        tsunamiBody.appendChild(el('p', { class: 'muted', text: t('tsunami.noAreas') }));
        return;
      }
      tsunamiBody.appendChild(
        el('ul', { class: 'miniList' },
          ...ts.areas.slice(0, 12).map((a) =>
            el('li', { class: 'miniList__item' },
              el('span', { class: `miniList__tag miniList__tag--${gradeTone(a.grade)}`, text: gradeLabel(a.grade) }),
              el('span', { class: 'miniList__text', text: a.name }),
              el('span', { class: 'miniList__meta', text: a.heightLabel ?? (a.heightValue !== null ? `${a.heightValue}m` : '') }),
            ),
          ),
        ),
      );
      tsunamiBody.appendChild(
        el('p', { class: 'muted small', text: t('tsunami.issued', { time: formatJst(ts.issuedAt), provider: ts.source.provider }) }),
      );
    });

    /* ---- NIED ---- */
    const niedBody = el('div');
    niedBody.append(
      el('p', { class: 'muted', text: t('nied.body1') }),
      el('p', { class: 'muted small', text: t('nied.body2') }),
      el('p', { class: 'muted small', text: t('nied.body3') }),
    );

    /* ---- diagnostics ---- */
    const diagBody = el('div');
    updaters.push(() => {
      const state = getState();
      clear(diagBody);
      const fresh = freshnessOf(state.health.lastSuccessAt, state.now);
      diagBody.appendChild(
        el('dl', { class: 'kv kv--tight' },
          row(t('diag.mode'), state.mode === 'demo' ? t('diag.mode.demo') : t('diag.mode.live')),
          row(t('diag.conn'), connectionLabel(state.health.state)),
          row(
            t('diag.lastOk'),
            state.health.lastSuccessAt
              ? `${formatJst(state.health.lastSuccessAt)}（${formatAge(state.health.lastSuccessAt, state.now)}）`
              : t('meta.emDash'),
          ),
          row(t('diag.freshness'), freshnessLabel(fresh)),
          row(t('diag.batches'), `${state.diagnostics.batches}`),
          row(t('diag.rejected'), `${state.diagnostics.rejectedRecords}`),
          row(t('diag.dupes'), `${state.diagnostics.duplicateAlertsIgnored}`),
          row(t('diag.lastError'), state.health.lastError ?? t('meta.emDash')),
          row(t('diag.provider'), state.mode === 'demo' ? t('diag.provider.demo') : t('diag.provider.live')),
        ),
      );
      diagBody.appendChild(el('p', { class: 'muted small' }, t('diag.polling')));
    });

    /* ---- about / limitations ---- */
    const aboutBody = el('div');
    aboutBody.append(
      el('p', { class: 'muted' }, t('about.p1')),
      el('ul', { class: 'bullets' },
        el('li', { text: t('about.li1') }),
        el('li', { text: t('about.li2') }),
        el('li', { text: t('about.li3') }),
        el('li', { text: t('about.li4') }),
        el('li', { text: t('about.li5') }),
      ),
      el('p', { class: 'muted small', text: t('about.attribution') }),
    );

    tsunamiSection = disclosure({
      title: t('tsunami.sectionTitle'),
      subtitle: t('tsunami.sectionSubtitle'),
      tone: 'warn',
      content: () => tsunamiBody,
    });
    const niedSection = disclosure({
      title: t('nied.sectionTitle'),
      subtitle: t('nied.subtitle'),
      content: () => niedBody,
    });
    diagSection = disclosure({
      title: t('diag.sectionTitle'),
      subtitle: t('diag.subtitle'),
      content: () => diagBody,
    });
    const aboutSection = disclosure({
      title: t('about.sectionTitle'),
      subtitle: t('about.subtitle'),
      content: () => aboutBody,
    });

    root.append(tsunamiSection, niedSection, diagSection, aboutSection);
  }

  return {
    el: root,
    update(state) {
      stateRef = state;
      const localeVersion = getLocaleVersion();
      if (localeVersion !== builtLocale) {
        builtLocale = localeVersion;
        build();
      }
      // Subtitles reflect live state.
      const ts = state.tsunami;
      const sub = ts ? (ts.cancelled ? t('tsunami.cancelled') : t('tsunami.areas', { n: ts.areas.length })) : t('tsunami.receivedNone');
      const tsunamiSub = tsunamiSection.querySelector('.disclosure__subtitle');
      if (tsunamiSub) {
        const active = Boolean(ts && !ts.cancelled && ts.areas.length);
        tsunamiSub.textContent = active ? t('tsunami.present', { sub }) : sub;
      }
      const diagSub = diagSection.querySelector('.disclosure__subtitle');
      if (diagSub) {
        const f = freshnessOf(state.health.lastSuccessAt, state.now);
        diagSub.textContent = t('diag.subtitleValue', { conn: connectionLabel(state.health.state), fresh: freshnessLabel(f) });
      }
      for (const u of updaters) u();
    },
  };
}

function row(label: string, value: string): HTMLElement {
  return el('div', { class: 'kv__row' }, el('dt', { text: label }), el('dd', { text: value }));
}

const GRADE_KEYS: Record<string, MessageKey> = {
  MajorWarning: 'grade.majorWarning',
  Warning: 'grade.warning',
  Watch: 'grade.watch',
  NonEffective: 'grade.nonEffective',
};

function gradeLabel(grade: string): string {
  const key = GRADE_KEYS[grade];
  return key ? t(key) : t('grade.default');
}

function gradeTone(grade: string): 'danger' | 'warn' | 'info' | 'neutral' {
  if (grade === 'MajorWarning' || grade === 'Warning') return 'danger';
  if (grade === 'Watch') return 'warn';
  if (grade === 'NonEffective') return 'info';
  return 'neutral';
}

/** Small legend used under the map on larger screens. */
export function createLegend(): { el: HTMLElement; update: (s: AppState) => void } {
  const items = el('div', { class: 'legend__items' });
  const root = el('div', { class: 'legend' }, items);
  const codes: number[] = [10, 20, 30, 40, 45, 50, 55, 60, 70];
  let builtLocale = -1;

  const build = () => {
    clear(items);
    for (const code of codes) {
      const s = scaleStyle(code);
      items.appendChild(
        el('span', { class: 'legend__item' },
          el('span', { class: 'legend__swatch', style: `background:${s.fill}` }),
          el('span', { text: s.label }),
        ),
      );
    }
    items.appendChild(
      el('span', { class: 'legend__item legend__item--note' },
        badge('×', 'danger'),
        el('span', { text: t('map.legendEew') }),
      ),
    );
  };

  return {
    el: root,
    update() {
      const localeVersion = getLocaleVersion();
      if (localeVersion !== builtLocale) {
        builtLocale = localeVersion;
        build();
      }
    },
  };
}
