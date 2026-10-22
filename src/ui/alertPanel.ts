import { hasIntensity, scaleStyle } from '../core/intensity';
import type { EewAlert } from '../core/models';
import { eewStateLabel, eewStateLabelEn, formatDepth, formatMagnitude } from '../core/format';
import { formatAge, formatJst, formatJstClock } from '../core/time';
import { strongestAreas } from '../state/alert';
import type { AppState } from '../state/store';
import { badge, clear, el } from './dom';

/**
 * The EEW panel. This is the one element that must be readable at a glance from
 * across a room, so it is the only place in the app that uses full-saturation
 * colour, oversized numerals and a hard border.
 *
 * Honesty rules encoded here:
 *  - "予報" and "警報" are visually and textually distinct; a forecast never
 *    borrows the warning styling.
 *  - Simulated and test alerts get their own badge and refuse the red warning
 *    treatment.
 *  - A predicted intensity is always labelled 予測 (prediction).
 *  - No countdown is invented; arrival times come from the source, per area.
 */
export function createAlertPanel(): { el: HTMLElement; update: (s: AppState) => void } {
  const root = el('section', { class: 'alert', 'aria-live': 'polite', 'aria-atomic': 'false' });
  root.setAttribute('role', 'status');

  return {
    el: root,
    update(state) {
      clear(root);
      const alert = state.alert;
      const offline = state.health.state === 'offline';
      root.dataset.state = alert?.state ?? (offline ? 'unavailable' : 'idle');
      root.classList.toggle('alert--active', Boolean(alert && alert.state !== 'cancelled'));
      root.classList.toggle('alert--cancelled', alert?.state === 'cancelled');
      root.classList.toggle('alert--sim', Boolean(alert?.simulated));

      if (!alert) {
        renderIdle(root, state, offline);
        return;
      }
      renderAlert(root, state, alert);
    },
  };
}

function renderIdle(root: HTMLElement, state: AppState, offline: boolean): void {
  const head = el('div', { class: 'alert__head' },
    el('span', { class: 'alert__kicker', text: '緊急地震速報' }),
    badge(offline ? '状態不明' : '待機中', offline ? 'warn' : 'neutral'),
  );

  const lastAlert = state.alertHistory[0];
  const body = el('div', { class: 'alert__idle' },
    el('p', { class: 'alert__idleMain', text: offline ? '接続が切れているため、速報の有無を確認できません。' : '現在、緊急地震速報は発表されていません（受信範囲内）。' }),
    el('p', { class: 'alert__note' },
      offline
        ? 'ネットワークが復旧すると自動的に再取得します。この表示は「発表がない」ことの証明ではありません。'
        : '情報は数十秒おきに更新されます。速報が間に合わない場合があるため、この画面だけに頼らないでください。',
    ),
    lastAlert
      ? el('p', { class: 'alert__meta' }, `最終受信: ${formatJst(lastAlert.issuedAt ?? lastAlert.receivedAt)}（${formatAge(lastAlert.issuedAt ?? lastAlert.receivedAt, state.now)}）`)
      : null,
  );
  root.append(head, body);
}

function renderAlert(root: HTMLElement, state: AppState, alert: EewAlert): void {
  const style = hasIntensity(alert.maxScaleTo) ? scaleStyle(alert.maxScaleTo) : null;
  const isForecast = alert.state === 'forecast';
  const isCancelled = alert.state === 'cancelled';
  const isTest = alert.isTest;
  const sim = alert.simulated;

  root.classList.toggle('alert--forecast', isForecast);
  root.classList.toggle('alert--warning', !isForecast && !isCancelled);

  const head = el('div', { class: 'alert__head' },
    el('span', { class: 'alert__kicker', text: eewStateLabel(alert.state) }),
    el('span', { class: 'alert__en', text: eewStateLabelEn(alert.state) }),
    el('span', { class: 'alert__spacer' }),
    alert.serial > 0 ? badge(`第${alert.serial}報`, 'neutral') : null,
    sim ? badge('SIMULATION', 'sim') : null,
    isTest ? badge('訓練/試験', 'warn') : null,
  );

  // ---- headline: predicted intensity ---------------------------------
  const headline = el('div', { class: 'alert__headline' });
  if (isCancelled) {
    headline.appendChild(
      el('div', { class: 'alert__cancelled' },
        el('strong', { text: '発表された緊急地震速報は取消されました' }),
        el('span', { text: '取消は「揺れが無かった」ことを意味しません。実際の揺れの情報を確認してください。' }),
      ),
    );
  } else if (style) {
    headline.appendChild(
      el('div', { class: 'alert__scaleBlock', style: `--scale-color:${style.fill};--scale-text:${style.text}` },
        el('span', { class: 'alert__scaleLabel', text: '予測最大震度' }),
        el('span', { class: 'alert__scaleValue', text: style.label }),
      ),
    );
    headline.appendChild(
      el('div', { class: 'alert__facts' },
        fact('震源', alert.epicenter?.name ?? '震源不明'),
        fact('規模', formatMagnitude(alert.epicenter?.magnitude ?? -1)),
        fact('深さ', formatDepth(alert.epicenter?.depthKm ?? -1)),
      ),
    );
  } else {
    headline.appendChild(
      el('div', { class: 'alert__facts' },
        fact('震源', alert.epicenter?.name ?? '震源不明'),
        fact('規模', formatMagnitude(alert.epicenter?.magnitude ?? -1)),
        fact('深さ', formatDepth(alert.epicenter?.depthKm ?? -1)),
        fact('予測震度', '情報なし'),
      ),
    );
  }

  // ---- times ---------------------------------------------------------
  const times = el('div', { class: 'alert__times' },
    timeChip('発生', formatJst(alert.originTime), alert.originTime),
    timeChip('発表', formatJst(alert.issuedAt), alert.issuedAt),
    el('span', { class: 'alert__age', text: `${formatAge(alert.issuedAt ?? alert.receivedAt, state.now)}受信` }),
  );

  const blocks: HTMLElement[] = [head, headline, times];

  if (alert.epicenter?.provisional) {
    blocks.push(
      el('p', { class: 'alert__flag' },
        '震源は「仮定震源要素」です。後続の情報で大きく変わる可能性があります。',
      ),
    );
  }

  // ---- arrival (source-provided only) --------------------------------
  if (!isCancelled) {
    const withArrival = alert.areas.filter((a) => a.arrivalTime !== null);
    if (withArrival.length) {
      const soonest = withArrival.reduce((min, a) => (a.arrivalTime! < min.arrivalTime! ? a : min), withArrival[0]!);
      const past = soonest.arrivalTime! <= state.now;
      blocks.push(
        el('div', { class: 'alert__arrival' },
          el('span', { class: 'alert__arrivalLabel', text: past ? '主要動到達予測（経過）' : '最短の主要動到達予測' }),
          el('span', { class: 'alert__arrivalValue', text: formatJstClock(soonest.arrivalTime) }),
          el('span', { class: 'alert__arrivalArea', text: `${soonest.name}（気象庁の予測）` }),
          el('span', { class: 'alert__arrivalNote', text: '現在地の到達時刻ではありません' }),
        ),
      );
    } else {
      blocks.push(
        el('div', { class: 'alert__arrival alert__arrival--none' },
          el('span', { class: 'alert__arrivalLabel', text: '主要動到達予測' }),
          el('span', { class: 'alert__arrivalArea', text: 'この電文には到達予測時刻が含まれていません' }),
        ),
      );
    }
  }

  // ---- areas ---------------------------------------------------------
  if (alert.areas.length) {
    const top = strongestAreas(alert, 6);
    blocks.push(
      el('div', { class: 'alert__areas' },
        el('div', { class: 'alert__areasHead' },
          el('span', { text: `警報対象区域（${alert.areas.length}）` }),
          el('span', { class: 'alert__areasNote', text: '予測震度の高い順' }),
        ),
        el('ul', { class: 'alert__areaList' },
          ...top.map((a) => {
            const s = scaleStyle(a.scaleTo);
            const range = a.scaleFrom === a.scaleTo ? s.label : `${scaleStyle(a.scaleFrom).label}〜${s.label}`;
            return el('li', { class: 'alert__area' },
              el('span', { class: 'alert__areaDot', style: `background:${s.fill}` }),
              el('span', { class: 'alert__areaName', text: a.name || a.pref }),
              el('span', { class: 'alert__areaScale', text: range }),
              el('span', { class: 'alert__areaKind', text: kindLabel(a.kindCode) }),
            );
          }),
        ),
        alert.areas.length > top.length
          ? el('p', { class: 'alert__more', text: `他 ${alert.areas.length - top.length} 区域` })
          : null,
      ),
    );
  } else if (!isCancelled) {
    blocks.push(
      el('p', { class: 'alert__flag' },
        'この電文には警報対象区域が含まれていません。警報として扱わないでください。',
      ),
    );
  }

  // ---- footer note ---------------------------------------------------
  blocks.push(
    el('p', { class: 'alert__disclaimer' },
      sim
        ? 'SIMULATION: この速報はアプリ内のデモデータです。実際の地震情報ではありません。'
        : '予測には誤差があり、続報で震源・震度・対象区域が変わることがあります。必ず気象庁の発表と自治体の指示を確認してください。',
    ),
  );

  root.append(...blocks.filter(Boolean) as HTMLElement[]);
}

function fact(label: string, value: string): HTMLElement {
  return el('div', { class: 'alert__fact' },
    el('span', { class: 'alert__factLabel', text: label }),
    el('span', { class: 'alert__factValue', text: value }),
  );
}

function timeChip(label: string, value: string, at: number | null): HTMLElement {
  return el('span', { class: 'alert__time' },
    el('span', { class: 'alert__timeLabel', text: label }),
    el('span', { class: 'alert__timeValue', text: at === null ? '不明' : value }),
  );
}

function kindLabel(code: string): string {
  switch (code) {
    case '10':
      return '主要動 未到達';
    case '11':
      return '主要動 到達';
    case '19':
      return 'PLUM法';
    default:
      return '';
  }
}
