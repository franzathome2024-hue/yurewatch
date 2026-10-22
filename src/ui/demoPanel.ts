import { DEMO_SCENARIOS, scenarioMessageKeys } from '../demo/scenarios';
import { getLocaleVersion, t } from '../i18n';
import type { AppState } from '../state/store';
import { badge, clear, disclosure, el } from './dom';

/**
 * Developer/demo controls, collapsed by default so they never crowd the
 * earthquake feed. Every entry point is labelled SIMULATION so a demo can never
 * be mistaken for a live feed — including in screenshots.
 */
export function createDemoPanel(handlers: {
  onStart: (id: string) => void;
  onStop: () => void;
  onExport: () => void;
}): { el: HTMLElement; update: (s: AppState) => void } {
  const body = el('div', { class: 'demo__body' });
  const subtitle = el('span', { class: 'disclosure__subtitle' });
  const title = el('span', { class: 'disclosure__title' });
  const simBadge = badge(t('demo.simBadge'), 'sim');

  const toggle = el('button', {
    class: 'disclosure__toggle',
    type: 'button',
    'aria-expanded': 'false',
  },
    el('span', { class: 'disclosure__chevron', 'aria-hidden': 'true', text: '›' }),
    el('span', { class: 'disclosure__titles' }, title, subtitle),
    el('span', { class: 'panel__spacer' }),
    simBadge,
  );

  const inner = el('div', { class: 'disclosure__body' }, body);
  const root = el('section', { class: 'panel panel--demo disclosure' }, toggle, inner);
  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    root.classList.toggle('is-open', open);
  });

  let signature = '';
  let builtLocale = -1;

  return {
    el: root,
    update(state) {
      title.textContent = t('demo.title');
      const scenario = state.demo ? DEMO_SCENARIOS.find((s) => s.id === state.demo?.scenarioId) : undefined;
      subtitle.textContent = state.demo
        ? t('demo.status', {
            label: scenario ? t(scenarioMessageKeys(scenario.id).label) : state.demo.label,
            state: state.demo.status === 'running' ? t('demo.running') : t('demo.finished'),
          })
        : t('demo.subtitle');

      const sig = `${state.demo?.scenarioId ?? '-'}:${state.demo?.status ?? '-'}#${getLocaleVersion()}`;
      if (sig === signature) return;
      signature = sig;
      builtLocale = getLocaleVersion();
      clear(body);

      body.appendChild(el('p', { class: 'demo__note' }, t('demo.note')));

      const grid = el('div', { class: 'demo__grid' });
      for (const item of DEMO_SCENARIOS) {
        const keys = scenarioMessageKeys(item.id);
        const active = state.demo?.scenarioId === item.id && state.demo?.status === 'running';
        const button = el('button', {
          class: `demo__scenario${active ? ' is-active' : ''}`,
          type: 'button',
          'aria-pressed': active ? 'true' : 'false',
        },
          el('span', { class: 'demo__scenarioLabel', text: t(keys.label) }),
          el('span', { class: 'demo__scenarioSummary', text: t(keys.summary) }),
        );
        button.addEventListener('click', () => handlers.onStart(item.id));
        grid.appendChild(button);
      }
      body.appendChild(grid);

      const actions = el('div', { class: 'demo__actions' });
      const stop = el('button', { class: 'button button--ghost', type: 'button', text: t('demo.stop') });
      stop.addEventListener('click', () => handlers.onStop());
      const exportBtn = el('button', { class: 'button button--ghost', type: 'button', text: t('demo.export') });
      exportBtn.addEventListener('click', () => handlers.onExport());
      actions.append(stop, exportBtn);
      body.appendChild(actions);

      if (state.demo) {
        body.appendChild(
          el('div', { class: 'demo__status' },
            el('span', { class: 'demo__statusLabel', text: scenario ? t(scenarioMessageKeys(scenario.id).label) : state.demo.label }),
            el('span', { class: 'demo__statusState', text: state.demo.status === 'running' ? t('demo.running') : t('demo.finished') }),
            el('span', { class: 'demo__progress', 'aria-hidden': 'true' },
              el('span', { class: 'demo__progressBar', style: `width:${Math.round(state.demo.progress * 100)}%` }),
            ),
          ),
        );
      }
      void builtLocale;
    },
  };
}

export { disclosure };
