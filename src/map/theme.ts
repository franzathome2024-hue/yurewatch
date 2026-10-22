/**
 * Map palette.
 *
 * The reference application is a near-black monitoring screen where the map is
 * the dominant element and colour is reserved for seismic information. We keep
 * that discipline: the basemap is desaturated blue-grey, and saturation is spent
 * only on intensity, epicentres and EEW warnings.
 */
export interface MapTheme {
  oceanTop: string;
  oceanBottom: string;
  landFill: string;
  landStroke: string;
  prefFill: string;
  prefStroke: string;
  prefStrokeStrong: string;
  graticule: string;
  label: string;
  labelShadow: string;
  markerRing: string;
  markerHalo: string;
  selected: string;
  eew: string;
  eewGlow: string;
  eewAreaFill: string;
  eewAreaStroke: string;
  attribution: string;
  scaleBar: string;
}

export const DARK_MAP_THEME: MapTheme = {
  oceanTop: '#0a1420',
  oceanBottom: '#0d1a27',
  landFill: '#141f2b',
  landStroke: '#233549',
  prefFill: '#1b2937',
  prefStroke: '#31465c',
  prefStrokeStrong: '#4a6b8a',
  graticule: 'rgba(120,160,200,0.075)',
  label: 'rgba(196,216,238,0.82)',
  labelShadow: 'rgba(3,8,14,0.9)',
  markerRing: 'rgba(255,255,255,0.92)',
  markerHalo: 'rgba(4,10,18,0.75)',
  selected: '#ffffff',
  eew: '#ff3b4e',
  eewGlow: 'rgba(255,59,78,0.28)',
  eewAreaFill: 'rgba(255,80,72,0.16)',
  eewAreaStroke: 'rgba(255,120,110,0.85)',
  attribution: 'rgba(160,186,212,0.75)',
  scaleBar: 'rgba(190,212,236,0.8)',
};
