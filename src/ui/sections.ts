import { scaleStyle } from '../core/intensity';
import { formatAge, formatJst } from '../core/time';
import { connectionLabel, freshnessLabel, freshnessOf, initialState, type AppState } from '../state/store';
import { disclosure, el, clear, badge } from './dom';

/**
 * Progressive disclosure for secondary information. Nothing critical lives
 * here — warnings stay in the always-visible alert panel — but an operator needs
 * to be able to answer "where did this come from and is it still live?".
 */
export function createSections(): { el: HTMLElement; update: (s: AppState) => void } {
  const root = el('div', { class: 'sections' });
  const updaters: Array<() => void> = [];
  let stateRef: AppState | null = null;
  const getState = (): AppState => stateRef ?? initialState();

  /* ---- tsunami ---- */
  const tsunamiBody = el('div');
  updaters.push(() => {
    const state = getState();
    const t = state.tsunami;
    clear(tsunamiBody);
    if (!t) {
      tsunamiBody.appendChild(
        el('p', { class: 'muted', text: '津波予報は受信していません。地震情報の「津波の心配」表示も併せて確認してください。' }),
      );
      return;
    }
    if (t.cancelled) {
      tsunamiBody.appendChild(el('p', { class: 'muted', text: '津波予報は解除されました。' }));
      return;
    }
    if (!t.areas.length) {
      tsunamiBody.appendChild(el('p', { class: 'muted', text: '津波予報の区域情報がありません。' }));
      return;
    }
    tsunamiBody.appendChild(
      el('ul', { class: 'miniList' },
        ...t.areas.slice(0, 12).map((a) =>
          el('li', { class: 'miniList__item' },
            el('span', { class: `miniList__tag miniList__tag--${gradeTone(a.grade)}`, text: gradeLabel(a.grade) }),
            el('span', { class: 'miniList__text', text: a.name }),
            el('span', { class: 'miniList__meta', text: a.heightLabel ?? (a.heightValue !== null ? `${a.heightValue}m` : '') }),
          ),
        ),
      ),
    );
    tsunamiBody.appendChild(
      el('p', { class: 'muted small', text: `発表: ${formatJst(t.issuedAt)}（${t.source.provider}）` }),
    );
  });

  /* ---- NIED ---- */
  const niedBody = el('div');
  updaters.push(() => {
    clear(niedBody);
    niedBody.append(
      el('p', { class: 'muted', text: 'v0.1 では未実装です。推測や代替データで埋めることはしていません。' }),
      el('p', { class: 'muted small', text: '防災科学技術研究所のリアルタイム震度（長周期地震動モニタ）は、公式に提供されている機械可読 API が確認できていないため、本バージョンでは接続していません。利用条件を確認のうえ、データ提供元と合意できた場合に実装します。' }),
      el('p', { class: 'muted small', text: '現状の代替: 気象庁の「各地の震度」（地震情報）を表示しています。これは観測値であり、NIED の計測震度とは算出方法が異なります。' }),
    );
  });

  /* ---- diagnostics ---- */
  const diagBody = el('div');
  updaters.push(() => {
    const state = getState();
    clear(diagBody);
    const fresh = freshnessOf(state.health.lastSuccessAt, state.now);
    diagBody.appendChild(
      el('dl', { class: 'kv kv--tight' },
        row('モード', state.mode === 'demo' ? 'DEMO（模擬データ）' : 'LIVE（公開データ）'),
        row('接続状態', connectionLabel(state.health.state)),
        row('最終成功', state.health.lastSuccessAt ? `${formatJst(state.health.lastSuccessAt)}（${formatAge(state.health.lastSuccessAt, state.now)}）` : '—'),
        row('鮮度', freshnessLabel(fresh)),
        row('受信バッチ', `${state.diagnostics.batches}`),
        row('破棄レコード', `${state.diagnostics.rejectedRecords}`),
        row('重複/順序外の速報', `${state.diagnostics.duplicateAlertsIgnored}`),
        row('最終エラー', state.health.lastError ?? '—'),
        row('データ提供', state.mode === 'demo' ? 'YureWatch DEMO ENGINE' : 'P2P地震情報 JSON API v2（気象庁情報の中継）'),
      ),
    );
    diagBody.appendChild(
      el('p', { class: 'muted small' },
        'ポーリング間隔: 平常 20 秒 / 速報中 6 秒。API の公開レート制限（60 req/分）に対し、1回の更新で3リクエストを使用します。',
      ),
    );
  });

  /* ---- about / limitations ---- */
  const aboutBody = el('div');
  updaters.push(() => {
    clear(aboutBody);
    aboutBody.append(
      el('p', { class: 'muted' }, 'YureWatch は情報閲覧アプリです。地震を予測・独自検出するものではなく、警報が必ず揺れの前に届くことを保証しません。'),
      el('ul', { class: 'bullets' },
        el('li', { text: '緊急地震速報の予測は誤差を含み、続報で内容が変わります（誤報・空振りも含む）。' }),
        el('li', { text: '「予報」と「警報」は別物です。本アプリは両者を表示上で区別します。' }),
        el('li', { text: '深さ150km以深など、予想最大震度が発表されないケースがあります。' }),
        el('li', { text: '通信の遅延・欠落により、情報が届かない場合があります。' }),
        el('li', { text: '最終的な判断は気象庁の発表と自治体の指示に従ってください。' }),
      ),
      el('p', { class: 'muted small', text: '地図: Natural Earth（パブリックドメイン）。データ: P2P地震情報 JSON API v2（気象庁の情報を中継）。' }),
    );
  });

  const tsunamiSection = disclosure({
    title: '津波情報',
    subtitle: '警報・注意報・予報',
    tone: 'warn',
    content: () => tsunamiBody,
  });
  const niedSection = disclosure({
    title: 'NIED リアルタイム震度',
    subtitle: '未接続（v0.1 の制限）',
    content: () => niedBody,
  });
  const diagSection = disclosure({
    title: '接続とデータの鮮度',
    subtitle: 'ソース・タイムスタンプ・エラー',
    content: () => diagBody,
  });
  const aboutSection = disclosure({
    title: 'このアプリについて / 注意事項',
    subtitle: '情報の限界と免責',
    content: () => aboutBody,
  });

  root.append(tsunamiSection, niedSection, diagSection, aboutSection);

  return {
    el: root,
    update(state) {
      stateRef = state;
      // Update section subtitles that reflect live state.
      const tone = state.tsunami && !state.tsunami.cancelled && state.tsunami.areas.length ? 'warn' : 'neutral';
      const t = state.tsunami;
      const sub = t ? (t.cancelled ? '解除済み' : `${t.areas.length}区域`) : '受信なし';
      const toggle = tsunamiSection.querySelector('.disclosure__subtitle');
      if (toggle) toggle.textContent = tone === 'warn' ? `発表あり・${sub}` : sub;
      const diagSub = diagSection.querySelector('.disclosure__subtitle');
      if (diagSub) {
        const f = freshnessOf(state.health.lastSuccessAt, state.now);
        diagSub.textContent = `${connectionLabel(state.health.state)}・${freshnessLabel(f)}`;
      }
      for (const u of updaters) u();
    },
  };
}

function row(label: string, value: string): HTMLElement {
  return el('div', { class: 'kv__row' }, el('dt', { text: label }), el('dd', { text: value }));
}

function gradeLabel(grade: string): string {
  switch (grade) {
    case 'MajorWarning':
      return '大津波警報';
    case 'Warning':
      return '津波警報';
    case 'Watch':
      return '津波注意報';
    case 'NonEffective':
      return '若干の海面変動';
    default:
      return '津波予報';
  }
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
      el('span', { text: 'EEW震源（予測）' }),
    ),
  );
  return { el: root, update: () => {} };
}
