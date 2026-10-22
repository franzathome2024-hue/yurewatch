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
  // Neutral basemap: land reads as a surface, ocean reads as space, and only
  // seismic information carries saturation.
  oceanTop: '#121619',
  oceanBottom: '#14181c',
  landFill: '#23272b',
  landStroke: '#343a40',
  prefFill: '#282d33',
  prefStroke: '#3a4148',
  prefStrokeStrong: '#4b535b',
  graticule: 'rgba(255,255,255,0.045)',
  label: 'rgba(200,208,216,0.85)',
  labelShadow: 'rgba(10,12,14,0.92)',
  markerRing: 'rgba(255,255,255,0.9)',
  markerHalo: 'rgba(10,13,16,0.8)',
  selected: '#ffffff',
  eew: '#e5484d',
  eewGlow: 'rgba(229,72,77,0.22)',
  eewAreaFill: 'rgba(229,72,77,0.14)',
  eewAreaStroke: 'rgba(229,72,77,0.8)',
  attribution: 'rgba(179,186,194,0.72)',
  scaleBar: 'rgba(179,186,194,0.75)',
};
