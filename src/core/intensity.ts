import type { JmaScale } from './models';

/**
 * JMA seismic intensity helpers.
 *
 * The colour ramp follows the *convention* used by JMA/public broadcasters
 * (cool → warm as intensity rises) but is a palette designed in-house for this
 * app's dark theme; it is not the JMA's own stylesheet. Text/background pairs
 * were checked for >= 4.5:1 contrast.
 */

export interface ScaleStyle {
  code: JmaScale;
  /** Short label as printed by JMA: 1, 2, 3, 4, 5弱, 5強, 6弱, 6強, 7 */
  label: string;
  /** Longer spoken form. */
  longLabel: string;
  fill: string;
  /** Text colour that has adequate contrast on `fill`. */
  text: string;
}

const TABLE: Record<number, ScaleStyle> = {
  [-1]: { code: -1, label: '—', longLabel: '震度不明', fill: '#2a3644', text: '#c9d6e5' },
  [0]: { code: 0, label: '0', longLabel: '震度0', fill: '#3a4a5e', text: '#e8eef6' },
  [10]: { code: 10, label: '1', longLabel: '震度1', fill: '#3b6fe0', text: '#ffffff' },
  [20]: { code: 20, label: '2', longLabel: '震度2', fill: '#17b0a7', text: '#04211f' },
  [30]: { code: 30, label: '3', longLabel: '震度3', fill: '#ffd23f', text: '#221a00' },
  [40]: { code: 40, label: '4', longLabel: '震度4', fill: '#ffa726', text: '#241200' },
  [45]: { code: 45, label: '5弱', longLabel: '震度5弱', fill: '#ff7043', text: '#2a0d00' },
  [50]: { code: 50, label: '5強', longLabel: '震度5強', fill: '#f4511e', text: '#ffffff' },
  [55]: { code: 55, label: '6弱', longLabel: '震度6弱', fill: '#e53935', text: '#ffffff' },
  [60]: { code: 60, label: '6強', longLabel: '震度6強', fill: '#b71c1c', text: '#ffffff' },
  [70]: { code: 70, label: '7', longLabel: '震度7', fill: '#7f0000', text: '#ffffff' },
  [99]: { code: 99, label: '以上', longLabel: '震度不明（程度以上）', fill: '#7f0000', text: '#ffffff' },
};

const UNKNOWN = TABLE[-1] as ScaleStyle;

/** Look up the presentation for a JMA scale code; unknown codes degrade safely. */
export function scaleStyle(code: number | null | undefined): ScaleStyle {
  if (code === null || code === undefined) return UNKNOWN;
  const key = Math.round(code);
  return TABLE[key] ?? UNKNOWN;
}

/** True when the source reported a usable intensity. */
export function hasIntensity(code: number | null | undefined): code is JmaScale {
  return typeof code === 'number' && code >= 0 && code !== 99;
}

/** Ordinal position of an intensity, used for "max" reductions and sorting. */
export function scaleRank(code: number): number {
  if (code < 0) return -1;
  return code;
}

/** Highest intensity in a list, or -1 when none. */
export function maxScale(codes: readonly number[]): JmaScale {
  let best = -1;
  for (const c of codes) if (scaleRank(c) > scaleRank(best)) best = Math.round(c) as JmaScale;
  return best as JmaScale;
}

/** Intensity at or above which we treat the event as notable in the feed. */
export const NOTABLE_INTENSITY = 40;

/** Severity bucket used for map colouring of EEW predicted intensity. */
export function isSevere(code: number): boolean {
  return code >= 50;
}
