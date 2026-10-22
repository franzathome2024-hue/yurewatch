import { DEMO_SCENARIOS } from '../demo/scenarios';
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
  const subtitle = el('span', { class: 'disclosure__subtitle', text: '模擬データを再生（SIMULATION）' });

  const toggle = el('button', {
    class: 'disclosure__toggle',
    type: 'button',
    'aria-expanded': 'false',
  },
    el('span', { class: 'disclosure__chevron', 'aria-hidden': 'true', text: '›' }),
    el('span', { class: 'disclosure__titles' },
      el('span', { class: 'disclosure__title', text: 'デモ / テスト' }),
      subtitle,
    ),
    el('span', { class: 'panel__spacer' }),
    badge('SIMULATION', 'sim'),
  );

  const inner = el('div', { class: 'disclosure__body' }, body);
  const root = el('section', { class: 'panel panel--demo disclosure' }, toggle, inner);
  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    root.classList.toggle('is-open', open);
  });

  let signature = '';

  return {
    el: root,
    update(state) {
      subtitle.textContent = state.demo
        ? `${state.demo.label} — ${state.demo.status === 'running' ? '再生中' : '終了'}`
        : '模擬データを再生（SIMULATION）';
      const sig = `${state.demo?.scenarioId ?? '-'}:${state.demo?.status ?? '-'}`;
      if (sig === signature) return;
      signature = sig;
      clear(body);

      body.appendChild(
        el('p', { class: 'demo__note' },
          'ここから実行するデータはすべてアプリ内で生成した模擬データです。実際の地震情報ではありません。',
        ),
      );

      const grid = el('div', { class: 'demo__grid' });
      for (const scenario of DEMO_SCENARIOS) {
        const active = state.demo?.scenarioId === scenario.id && state.demo?.status === 'running';
        const button = el('button', {
          class: `demo__scenario${active ? ' is-active' : ''}`,
          type: 'button',
          'aria-pressed': active ? 'true' : 'false',
        },
          el('span', { class: 'demo__scenarioLabel', text: scenario.label }),
          el('span', { class: 'demo__scenarioSummary', text: scenario.summary }),
        );
        button.addEventListener('click', () => handlers.onStart(scenario.id));
        grid.appendChild(button);
      }
      body.appendChild(grid);

      const actions = el('div', { class: 'demo__actions' });
      const stop = el('button', { class: 'button button--ghost', type: 'button', text: 'デモを停止してライブへ' });
      stop.addEventListener('click', () => handlers.onStop());
      const exportBtn = el('button', { class: 'button button--ghost', type: 'button', text: '状態をJSONで書き出す' });
      exportBtn.addEventListener('click', () => handlers.onExport());
      actions.append(stop, exportBtn);
      body.appendChild(actions);

      if (state.demo) {
        body.appendChild(
          el('div', { class: 'demo__status' },
            el('span', { class: 'demo__statusLabel', text: state.demo.label }),
            el('span', { class: 'demo__statusState', text: state.demo.status === 'running' ? '再生中' : '終了' }),
            el('span', { class: 'demo__progress', 'aria-hidden': 'true' },
              el('span', { class: 'demo__progressBar', style: `width:${Math.round(state.demo.progress * 100)}%` }),
            ),
          ),
        );
      }
    },
  };
}

export { disclosure };
