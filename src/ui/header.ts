import { formatJstClock } from '../core/time';
import { connectionLabel, freshnessLabel, freshnessOf } from '../state/store';
import type { AppState } from '../state/store';
import { el } from './dom';

/**
 * Top bar: product identity, data mode, connection health and the JST clock.
 * The mode chip is intentionally loud — a viewer must never be ambiguous about
 * whether it is showing live JMA information or a simulation.
 */
export function createHeader(): { el: HTMLElement; update: (s: AppState) => void } {
  const brand = el('div', { class: 'brand' },
    el('span', { class: 'brand__mark', 'aria-hidden': 'true' }),
    el('span', { class: 'brand__text' },
      el('span', { class: 'brand__name', text: 'YureWatch' }),
      el('span', { class: 'brand__sub', text: '日本 地震・緊急地震速報ビューア' }),
    ),
  );

  const modeChip = el('span', { class: 'chip chip--mode' });
  const connChip = el('span', { class: 'chip chip--conn' });
  const clock = el('span', { class: 'header__clock' });
  const freshness = el('span', { class: 'header__freshness' });

  const el_ = el('header', { class: 'header' },
    brand,
    el('div', { class: 'header__status' },
      modeChip,
      connChip,
      clock,
      freshness,
    ),
  );

  return {
    el: el_,
    update(state: AppState) {
      const demo = state.mode === 'demo';
      modeChip.textContent = demo ? 'DEMO' : 'LIVE';
      modeChip.classList.toggle('chip--demo', demo);
      modeChip.classList.toggle('chip--live', !demo);
      modeChip.setAttribute('aria-label', demo ? 'デモモード（模擬データ）' : 'ライブモード（公開データ）');

      const health = state.health.state;
      // The DEMO chip already says "simulated"; this chip reports the transport.
      connChip.textContent = demo ? `デモ・${connectionLabel(health)}` : connectionLabel(health);
      connChip.classList.toggle('chip--ok', health === 'live');
      connChip.classList.toggle('chip--warn', health === 'connecting' || health === 'degraded' || health === 'stale');
      connChip.classList.toggle('chip--danger', health === 'offline');
      connChip.setAttribute('aria-label', `接続状態: ${demo ? 'デモ・' : ''}${connectionLabel(health)}`);

      clock.textContent = formatJstClock(state.now) + ' JST';
      const fresh = freshnessOf(state.health.lastSuccessAt, state.now);
      freshness.textContent = freshnessLabel(fresh);
      freshness.dataset.freshness = fresh;
    },
  };
}
