import type { JmaScale } from './models';

/**
 * JMA seismic intensity helpers.
 *
 * The colour ramp follows the *convention* used by JMA/public broadcasters
 * (cool → warm as intensity rises) but is a palette designed in-house for this
 * app's dark theme; it is not the JMA's own stylesheet. Text/background pairs
 * were checked for >= 4.5:1 contrast.
 */

import { getLocale } from '../i18n';

export interface ScaleStyle {
  code: JmaScale;
  /** Short label as printed by JMA: 1, 2, 3, 4, 5弱, 5強, 6弱, 6強, 7 (5-/5+ in English). */
  readonly label: string;
  /** Longer spoken form. */
  readonly longLabel: string;
  fill: string;
  /** Text colour that has adequate contrast on `fill`. */
  text: string;
}

interface ScaleDefinition {
  code: JmaScale;
  labelJa: string;
  labelEn: string;
  fill: string;
  text: string;
}

/**
 * Labels are resolved on read rather than baked in: the same style object is
 * shared everywhere, so a language switch only needs a re-render.
 */
const TABLE: Record<number, ScaleDefinition> = {
  [-1]: { code: -1, labelJa: '—', labelEn: '—', fill: '#2a3644', text: '#c9d6e5' },
  [0]: { code: 0, labelJa: '0', labelEn: '0', fill: '#3a4a5e', text: '#e8eef6' },
  [10]: { code: 10, labelJa: '1', labelEn: '1', fill: '#3b6fe0', text: '#ffffff' },
  [20]: { code: 20, labelJa: '2', labelEn: '2', fill: '#17b0a7', text: '#04211f' },
  [30]: { code: 30, labelJa: '3', labelEn: '3', fill: '#ffd23f', text: '#221a00' },
  [40]: { code: 40, labelJa: '4', labelEn: '4', fill: '#ffa726', text: '#241200' },
  [45]: { code: 45, labelJa: '5弱', labelEn: '5-', fill: '#ff7043', text: '#2a0d00' },
  [50]: { code: 50, labelJa: '5強', labelEn: '5+', fill: '#f4511e', text: '#ffffff' },
  [55]: { code: 55, labelJa: '6弱', labelEn: '6-', fill: '#e53935', text: '#ffffff' },
  [60]: { code: 60, labelJa: '6強', labelEn: '6+', fill: '#b71c1c', text: '#ffffff' },
  [70]: { code: 70, labelJa: '7', labelEn: '7', fill: '#7f0000', text: '#ffffff' },
  [99]: { code: 99, labelJa: '以上', labelEn: 'or higher', fill: '#7f0000', text: '#ffffff' },
};

const UNKNOWN_DEF = TABLE[-1] as ScaleDefinition;

const LONG_EN: Record<number, string> = {
  [-1]: 'Intensity unknown',
  [0]: 'Intensity 0',
  [10]: 'Intensity 1',
  [20]: 'Intensity 2',
  [30]: 'Intensity 3',
  [40]: 'Intensity 4',
  [45]: 'Intensity 5 lower',
  [50]: 'Intensity 5 upper',
  [55]: 'Intensity 6 lower',
  [60]: 'Intensity 6 upper',
  [70]: 'Intensity 7',
  [99]: 'Intensity unknown (at or above)',
};

const CACHE = new Map<number, ScaleStyle>();

function build(def: ScaleDefinition): ScaleStyle {
  return {
    code: def.code,
    get label() {
      return getLocale() === 'ja' ? def.labelJa : def.labelEn;
    },
    get longLabel() {
      return getLocale() === 'ja' ? `震度${def.labelJa}` : (LONG_EN[def.code] ?? 'Intensity unknown');
    },
    fill: def.fill,
    text: def.text,
  };
}

/** Look up the presentation for a JMA scale code; unknown codes degrade safely. */
export function scaleStyle(code: number | null | undefined): ScaleStyle {
  const key = code === null || code === undefined ? -1 : Math.round(code);
  const cached = CACHE.get(key);
  if (cached) return cached;
  const built = build(TABLE[key] ?? UNKNOWN_DEF);
  CACHE.set(key, built);
  return built;
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
