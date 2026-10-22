import { scaleStyle } from '../core/intensity';
import { formatAge, formatJst } from '../core/time';
import { tsunamiGradeLabel } from '../core/format';
import { LOCALES, getLocale, getLocaleVersion, setLocale, t, type Locale, type MessageKey } from '../i18n';
import { connectionLabel, effectiveFreshness, freshnessLabel, initialState, type AppState } from '../state/store';
import { disclosure, el, clear, badge } from './dom';
import { createDemoPanel } from './demoPanel';
import { tsunamiGradeColor, withAlpha } from '../map/scene';
import { matchRegionsByName, tsunamiLayer } from '../map/tsunamiData';

/**
 * The 情報 (information) panel.
 *
 * Operational facts first (connection, freshness, counters), then data that is
 * not connected, then settings, then clearly-marked developer tools, then the
 * caveats. Simulation controls live at the bottom of this panel, never beside
 * live earthquake information.
 */
export function createInfoPanel(handlers: {
  onToggleSound: () => void;
  onToggleTsunamiLayer: () => void;
  onToggleVoice?: () => void;
  /** Localised one-line reason the voice cannot be used, or '' when it can. */
  describeVoice?: () => string;
  onDemoStart: (id: string) => void;
  onDemoStop: () => void;
  onExport: () => void;
}): { el: HTMLElement; update: (s: AppState) => void } {
  const root = el('div', { class: 'info' });
  let stateRef: AppState | null = null;
  let builtLocale = -1;
  let updaters: Array<() => void> = [];
  let soundButton: HTMLButtonElement | null = null;
  let tsunamiButton: HTMLButtonElement | null = null;
  let voiceButton: HTMLButtonElement | null = null;
  let voiceNote: HTMLElement | null = null;
  let langButtons = new Map<Locale, HTMLButtonElement>();
  const getState = (): AppState => stateRef ?? initialState();

  const demoPanel = createDemoPanel({
    onStart: handlers.onDemoStart,
    onStop: handlers.onDemoStop,
    onExport: handlers.onExport,
  });

  function group(title: string, ...children: Array<HTMLElement | null>): HTMLElement {
    return el('section', { class: 'infoGroup' },
      el('h3', { class: 'infoGroup__title', text: title }),
      ...children,
    );
  }

  function build(): void {
    clear(root);
    updaters = [];
    langButtons = new Map();

    /* ---- 1. connection and freshness (operational, always open) ---- */
    const diagBody = el('dl', { class: 'meta meta--tight' });
    updaters.push(() => {
      const state = getState();
      const fresh = effectiveFreshness(state);
      clear(diagBody);
      diagBody.append(
        metaRow(t('diag.mode'), state.mode === 'demo' ? t('diag.mode.demo') : t('diag.mode.live')),
        metaRow(t('diag.conn'), connectionLabel(state.health.state)),
        metaRow(
          t('diag.lastOk'),
          state.health.lastSuccessAt
            ? `${formatJst(state.health.lastSuccessAt)}（${formatAge(state.health.lastSuccessAt, state.now)}）`
            : t('meta.emDash'),
        ),
        metaRow(t('diag.freshness'), freshnessLabel(fresh)),
        metaRow(t('diag.provider'), state.mode === 'demo' ? t('diag.provider.demo') : t('diag.provider.live')),
        metaRow(t('diag.batches'), `${state.diagnostics.batches}`),
        metaRow(t('diag.rejected'), `${state.diagnostics.rejectedRecords}`),
        metaRow(t('diag.dupes'), `${state.diagnostics.duplicateAlertsIgnored}`),
        metaRow(t('diag.lastError'), state.health.lastError ?? t('meta.emDash')),
      );
    });
    root.appendChild(
      group(t('diag.sectionTitle'), diagBody, el('p', { class: 'infoNote', text: t('diag.polling') })),
    );

    /* ---- 2. tsunami ---- */
    const tsunamiBody = el('div');
    updaters.push(() => {
      const state = getState();
      const ts = state.tsunami;
      clear(tsunamiBody);
      if (!ts) {
        tsunamiBody.appendChild(el('p', { class: 'infoNote', text: t('tsunami.notReceived') }));
        return;
      }
      if (ts.cancelled) {
        tsunamiBody.appendChild(el('p', { class: 'infoNote', text: t('tsunami.cancelled') }));
        return;
      }
      if (!ts.areas.length) {
        tsunamiBody.appendChild(el('p', { class: 'infoNote', text: t('tsunami.noAreas') }));
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
        el('p', { class: 'infoNote', text: t('tsunami.issued', { time: formatJst(ts.issuedAt), provider: ts.source.provider }) }),
      );
      // What the coloured geometry on the map actually is (and is not).
      const match = matchRegionsByName(ts.areas.map((a) => a.name));
      tsunamiBody.append(
        el('p', { class: 'infoNote', text: t('tsunami.layerBody') }),
        el('p', { class: 'infoNote', text: t('tsunami.layerNotInundation') }),
        el('p', {
          class: 'infoNote',
          text: state.preferences.tsunamiLayer
            ? t('tsunami.layerMatched', { n: match.matched.length })
            : t('tsunami.layerOff'),
        }),
      );
      if (match.unmatched.length) {
        tsunamiBody.appendChild(el('p', { class: 'infoNote infoNote--warn', text: t('tsunami.layerUnmatched', { n: match.unmatched.length }) }));
      }
      tsunamiBody.appendChild(
        el('p', { class: 'infoNote infoNote--mono', text: t('tsunami.layerSource', { date: tsunamiLayer().meta.datasetDate }) }),
      );
    });
    root.appendChild(
      disclosure({ title: t('tsunami.sectionTitle'), subtitle: t('tsunami.sectionSubtitle'), tone: 'warn', content: () => tsunamiBody }),
    );

    /* ---- 3. NIED (not connected) ---- */
    const niedBody = el('div');
    niedBody.append(
      el('p', { class: 'infoNote', text: t('nied.body1') }),
      el('p', { class: 'infoNote', text: t('nied.body2') }),
      el('p', { class: 'infoNote', text: t('nied.body3') }),
    );
    root.appendChild(
      disclosure({ title: t('nied.sectionTitle'), subtitle: t('nied.subtitle'), content: () => niedBody }),
    );

    /* ---- 4. settings ---- */
    soundButton = el('button', { class: 'segBtn', type: 'button' });
    soundButton.addEventListener('click', () => handlers.onToggleSound());

    voiceButton = el('button', { class: 'segBtn', type: 'button' });
    voiceButton.addEventListener('click', () => handlers.onToggleVoice?.());
    voiceNote = el('span', { class: 'setRow__help' });

    tsunamiButton = el('button', { class: 'segBtn', type: 'button' });
    tsunamiButton.addEventListener('click', () => handlers.onToggleTsunamiLayer());

    const langRow = el('div', { class: 'segmented', role: 'group', 'aria-label': t('set.language') });
    for (const locale of LOCALES) {
      const button = el('button', {
        class: 'segBtn',
        type: 'button',
        'data-locale': locale,
        lang: locale,
        text: t(`lang.${locale}`),
      });
      button.addEventListener('click', () => setLocale(locale));
      langButtons.set(locale, button);
      langRow.appendChild(button);
    }

    root.appendChild(
      group(
        t('set.title'),
        el('div', { class: 'setRow' },
          el('div', { class: 'setRow__text' },
            el('span', { class: 'setRow__label', text: t('set.language') }),
            el('span', { class: 'setRow__help', text: t('set.languageHelp') }),
          ),
          langRow,
        ),
        el('div', { class: 'setRow' },
          el('div', { class: 'setRow__text' },
            el('span', { class: 'setRow__label', text: t('set.sound') }),
            el('span', { class: 'setRow__help', text: t('set.soundHelp') }),
          ),
          soundButton,
        ),
        el('div', { class: 'setRow' },
          el('div', { class: 'setRow__text' },
            el('span', { class: 'setRow__label', text: t('set.voice') }),
            el('span', { class: 'setRow__help', text: t('set.voiceHelp') }),
            voiceNote,
          ),
          voiceButton,
        ),
        el('div', { class: 'setRow' },
          el('div', { class: 'setRow__text' },
            el('span', { class: 'setRow__label', text: t('set.tsunamiLayer') }),
            el('span', { class: 'setRow__help', text: t('set.tsunamiLayerHelp') }),
          ),
          tsunamiButton,
        ),
        el('p', { class: 'infoNote', text: t('set.sourceHelp') }),
      ),
    );

    /* ---- 5. developer: demo (clearly separated) ---- */
    root.appendChild(
      group(t('set.sectionDev'), demoPanel.el),
    );

    /* ---- 6. about ---- */
    const aboutBody = el('div');
    aboutBody.append(
      el('p', { class: 'infoNote', text: t('about.p1') }),
      el('ul', { class: 'bullets' },
        el('li', { text: t('about.li1') }),
        el('li', { text: t('about.li2') }),
        el('li', { text: t('about.li3') }),
        el('li', { text: t('about.li4') }),
        el('li', { text: t('about.li5') }),
      ),
      el('p', { class: 'infoNote', text: t('about.attribution') }),
      el('p', { class: 'infoNote infoNote--mono', text: t('set.version', { version: `v${__APP_VERSION__}` }) }),
    );
    root.appendChild(disclosure({ title: t('about.sectionTitle'), subtitle: t('about.subtitle'), content: () => aboutBody }));
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
      for (const u of updaters) u();

      if (voiceButton) {
        const on = state.preferences.voiceEnabled;
        voiceButton.textContent = on ? t('set.soundOn') : t('set.soundOff');
        voiceButton.setAttribute('aria-pressed', on ? 'true' : 'false');
        voiceButton.setAttribute('aria-label', `${t('set.voice')}: ${on ? t('set.soundOn') : t('set.soundOff')}`);
      }
      if (voiceNote) {
        voiceNote.textContent = handlers.describeVoice?.() ?? '';
      }

      if (tsunamiButton) {
        const on = state.preferences.tsunamiLayer;
        tsunamiButton.textContent = on ? t('set.soundOn') : t('set.soundOff');
        tsunamiButton.setAttribute('aria-pressed', on ? 'true' : 'false');
        tsunamiButton.setAttribute('aria-label', `${t('set.tsunamiLayer')}: ${on ? t('set.soundOn') : t('set.soundOff')}`);
      }

      if (soundButton) {
        const on = state.preferences.soundEnabled;
        soundButton.textContent = on ? t('set.soundOn') : t('set.soundOff');
        soundButton.setAttribute('aria-pressed', on ? 'true' : 'false');
        soundButton.setAttribute('aria-label', `${t('set.sound')}: ${on ? t('set.soundOn') : t('set.soundOff')}`);
        soundButton.classList.toggle('is-on', on);
      }
      const active = getLocale();
      for (const [locale, button] of langButtons) {
        const selected = locale === active;
        button.classList.toggle('is-active', selected);
        button.setAttribute('aria-pressed', selected ? 'true' : 'false');
        button.textContent = t(`lang.${locale}`);
      }
      demoPanel.update(state);
    },
  };
}

function metaRow(label: string, value: string): HTMLElement {
  return el('div', { class: 'meta__row' },
    el('dt', { class: 'meta__label', text: label }),
    el('dd', { class: 'meta__value', text: value }),
  );
}

const gradeLabel = tsunamiGradeLabel;

function gradeTone(grade: string): 'danger' | 'warn' | 'info' | 'neutral' {
  if (grade === 'MajorWarning' || grade === 'Warning') return 'danger';
  if (grade === 'Watch') return 'warn';
  if (grade === 'NonEffective') return 'info';
  return 'neutral';
}

/* ---------------------------------------------------------------- legend -- */

/**
 * Map legend. Collapsed by default so it does not eat map space, but always one
 * tap away, and it explains shapes as well as colours ("do not rely on colour
 * alone" applied to the legend itself).
 */
export function createLegend(): { el: HTMLElement; update: (s: AppState) => void; isOpen: () => boolean } {
  const items = el('div', { class: 'legend__items' });
  const panel = el('div', { class: 'legend__panel', hidden: 'hidden' });
  const toggle = el('button', {
    class: 'mapBtn mapBtn--legend',
    type: 'button',
    'aria-expanded': 'false',
  },
    el('span', { class: 'mapBtn__icon', 'aria-hidden': 'true', text: '?' }),
    el('span', { class: 'mapBtn__label' }),
  );
  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    panel.hidden = !open;
    root.classList.toggle('is-open', open);
  });

  const root = el('div', { class: 'legend' }, toggle, panel);
  let builtLocale = -1;

  const build = () => {
    clear(panel);
    items.remove();

    const swatches = el('div', { class: 'legend__swatches', 'aria-hidden': 'true' });
    for (const code of [10, 20, 30, 40, 45, 50, 55, 60, 70]) {
      const s = scaleStyle(code);
      swatches.appendChild(
        el('span', { class: 'legend__swatchItem' },
          el('span', { class: 'legend__swatch', style: `background:${s.fill}` }),
          el('span', { class: 'legend__swatchLabel', text: s.label }),
        ),
      );
    }

    panel.append(
      el('h3', { class: 'legend__title', text: t('map.legendTitle') }),
      el('p', { class: 'legend__sub', text: t('map.legendIntensity') }),
      swatches,
      el('ul', { class: 'legend__list' },
        el('li', { class: 'legend__row' },
          el('span', { class: 'legend__glyph legend__glyph--quake', 'aria-hidden': 'true' }),
          el('span', { text: t('map.legendQuakeMarker') }),
        ),
        el('li', { class: 'legend__row' },
          el('span', { class: 'legend__glyph legend__glyph--eew', 'aria-hidden': 'true' }, '×'),
          el('span', { text: t('map.legendEewMarker') }),
        ),
        el('li', { class: 'legend__row' },
          el('span', { class: 'legend__glyph legend__glyph--selected', 'aria-hidden': 'true' }),
          el('span', { text: t('map.legendSelected') }),
        ),
      ),
      el('p', { class: 'legend__sub', text: t('map.legendTsunami') }),
      el('div', { class: 'legend__swatches', 'aria-hidden': 'true' },
        ...[
          { grade: 'MajorWarning' as const, key: 'grade.majorWarning' as const },
          { grade: 'Warning' as const, key: 'grade.warning' as const },
          { grade: 'Watch' as const, key: 'grade.watch' as const },
          { grade: 'NonEffective' as const, key: 'grade.nonEffective' as const },
        ].map((g) =>
          el('span', { class: 'legend__swatchItem' },
            el('span', { class: 'legend__swatch legend__swatch--region', style: `border-color:${tsunamiGradeColor(g.grade)};background:${withAlpha(tsunamiGradeColor(g.grade), 0.34)}` }),
            el('span', { class: 'legend__swatchLabel', text: t(g.key) }),
          ),
        ),
      ),
      el('p', { class: 'legend__note', text: t('tsunami.layerNotInundation') }),
      el('p', { class: 'legend__note', text: t('map.legendUnavailable') }),
    );
    toggle.querySelector('.mapBtn__label')!.textContent = t('map.legend');
    toggle.setAttribute('aria-label', t('map.legend'));
  };

  return {
    el: root,
    isOpen: () => toggle.getAttribute('aria-expanded') === 'true',
    update() {
      const localeVersion = getLocaleVersion();
      if (localeVersion !== builtLocale) {
        builtLocale = localeVersion;
        build();
      }
    },
  };
}
