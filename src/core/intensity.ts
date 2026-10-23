import type { JmaScale } from './models';

/**
 * JMA seismic intensity helpers.
 *
 * The colour ramp is the JMA's own published shindo scheme (the colours of
 * the 震度分布図 and broadcast graphics): near-white 1, sky 2, blue 3, pale
 * yellow 4, yellow 5弱, orange-yellow 5強, orange 6弱, red 6強, dark red 7.
 * Text/background pairs were checked for >= 4.5:1 contrast.
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
  [-1]: { code: -1, labelJa: '—', labelEn: '—', fill: '#33363b', text: '#d8d8d2' },
  [0]: { code: 0, labelJa: '0', labelEn: '0', fill: '#3c4046', text: '#ecece6' },
  [10]: { code: 10, labelJa: '1', labelEn: '1', fill: '#f2f2ff', text: '#23232e' },
  [20]: { code: 20, labelJa: '2', labelEn: '2', fill: '#a0d8ef', text: '#0b2a3c' },
  [30]: { code: 30, labelJa: '3', labelEn: '3', fill: '#0041ff', text: '#ffffff' },
  [40]: { code: 40, labelJa: '4', labelEn: '4', fill: '#fae696', text: '#2e2a08' },
  [45]: { code: 45, labelJa: '5弱', labelEn: '5-', fill: '#ffe600', text: '#2a2300' },
  [50]: { code: 50, labelJa: '5強', labelEn: '5+', fill: '#ff9900', text: '#2b1600' },
  [55]: { code: 55, labelJa: '6弱', labelEn: '6-', fill: '#ff7300', text: '#2b1200' },
  [60]: { code: 60, labelJa: '6強', labelEn: '6+', fill: '#ff2800', text: '#2b0800' },
  [70]: { code: 70, labelJa: '7', labelEn: '7', fill: '#a50021', text: '#ffffff' },
  [99]: { code: 99, labelJa: '以上', labelEn: 'or higher', fill: '#a50021', text: '#ffffff' },
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
