import { DEMO_SCENARIOS, scenarioMessageKeys } from '../demo/scenarios';
import { getLocaleVersion, t } from '../i18n';
import type { AppState } from '../state/store';
import { badge, clear, el } from './dom';

/**
 * Demo controls. Rendered inside the 情報 panel's clearly-labelled developer
 * group — never beside live earthquake information, and never without the
 * SIMULATION badge.
 */
export function createDemoPanel(handlers: {
  onStart: (id: string) => void;
  onStop: () => void;
  onExport: () => void;
}): { el: HTMLElement; update: (s: AppState) => void } {
  const status = el('div', { class: 'demo__status', hidden: 'hidden' });
  const grid = el('div', { class: 'demo__grid' });
  const note = el('p', { class: 'infoNote', text: t('demo.note') });

  const root = el('div', { class: 'demo' },
    el('div', { class: 'demo__head' }, badge(t('demo.simBadge'), 'sim'), note),
    grid,
    status,
  );

  let signature = '';
  let builtLocale = -1;

  return {
    el: root,
    update(state) {
      const sig = `${state.demo?.scenarioId ?? '-'}:${state.demo?.status ?? '-'}#${getLocaleVersion()}`;
      if (sig === signature) return;
      signature = sig;

      if (builtLocale !== getLocaleVersion()) {
        builtLocale = getLocaleVersion();
        note.textContent = t('demo.note');
        clear(grid);
        for (const item of DEMO_SCENARIOS) {
          const keys = scenarioMessageKeys(item.id);
          const button = el('button', {
            class: 'demoItem',
            type: 'button',
            'data-scenario': item.id,
          },
            el('span', { class: 'demoItem__label', text: t(keys.label) }),
            el('span', { class: 'demoItem__summary', text: t(keys.summary) }),
          );
          button.addEventListener('click', () => handlers.onStart(item.id));
          grid.appendChild(button);
        }
      }

      for (const button of Array.from(grid.querySelectorAll<HTMLButtonElement>('[data-scenario]'))) {
        const active = state.demo?.scenarioId === button.dataset.scenario && state.demo?.status === 'running';
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
      }

      status.hidden = !state.demo;
      if (state.demo) {
        clear(status);
        const scenario = DEMO_SCENARIOS.find((s) => s.id === state.demo?.scenarioId);
        status.append(
          el('span', { class: 'demo__statusLabel', text: scenario ? t(scenarioMessageKeys(scenario.id).label) : state.demo.label }),
          el('span', { class: 'demo__statusState', text: state.demo.status === 'running' ? t('demo.running') : t('demo.finished') }),
          el('span', { class: 'demo__progress', 'aria-hidden': 'true' },
            el('span', { class: 'demo__progressBar', style: `width:${Math.round(state.demo.progress * 100)}%` }),
          ),
        );
      }

      const actions = root.querySelector('.demo__actions');
      if (!actions) {
        const acts = el('div', { class: 'demo__actions' });
        const stop = el('button', { class: 'btn btn--quiet', type: 'button', text: t('demo.stop') });
        stop.addEventListener('click', () => handlers.onStop());
        const exportBtn = el('button', { class: 'btn btn--quiet', type: 'button', text: t('demo.export') });
        exportBtn.addEventListener('click', () => handlers.onExport());
        acts.append(stop, exportBtn);
        root.appendChild(acts);
      } else {
        const [stop, exportBtn] = Array.from(actions.querySelectorAll('button'));
        if (stop) stop.textContent = t('demo.stop');
        if (exportBtn) exportBtn.textContent = t('demo.export');
      }
    },
  };
}
