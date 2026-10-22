import { describe, expect, it } from 'vitest';
import { PREFECTURES, findPrefecture, resolvePrefecture } from '../src/data/prefectures';
import { buildGeometry } from '../src/map/mapData';

/**
 * The map geometry and the prefecture lookup table are two independent
 * artefacts; these tests keep them from drifting apart, because a mismatch
 * silently breaks intensity shading on the map.
 */
describe('prefecture table', () => {
  const geometry = buildGeometry();

  it('contains exactly 47 prefectures with unique JIS codes', () => {
    expect(PREFECTURES).toHaveLength(47);
    expect(new Set(PREFECTURES.map((p) => p.code)).size).toBe(47);
    expect(new Set(PREFECTURES.map((p) => p.name)).size).toBe(47);
  });

  it('matches the map geometry names and codes one-to-one', () => {
    const mapNames = new Set(geometry.prefectures.map((p) => p.name));
    for (const pref of PREFECTURES) {
      expect(mapNames.has(pref.name)).toBe(true);
      expect(geometry.byName.get(pref.name)?.code).toBe(pref.code);
    }
    expect(geometry.prefectures).toHaveLength(PREFECTURES.length);
  });

  it('finds prefectures by exact name', () => {
    expect(findPrefecture('東京都')?.code).toBe('13');
    expect(findPrefecture(' 沖縄県 ')?.code).toBe('47');
    expect(findPrefecture('東京')).toBeNull();
    expect(findPrefecture(null)).toBeNull();
  });

  it('resolves JMA forecast-area names to their prefecture', () => {
    expect(resolvePrefecture('北海道道東')?.name).toBe('北海道');
    expect(resolvePrefecture('北海道道北')?.name).toBe('北海道');
    expect(resolvePrefecture('茨城県南部')?.name).toBe('茨城県');
    expect(resolvePrefecture('東京都２３区')?.name).toBe('東京都');
    expect(resolvePrefecture('愛媛県南予')?.name).toBe('愛媛県');
  });

  it('falls back through several candidates and gives up cleanly', () => {
    expect(resolvePrefecture('', '栃木県南部')?.name).toBe('栃木県');
    expect(resolvePrefecture('太平洋沿岸')).toBeNull();
    expect(resolvePrefecture(undefined, null)).toBeNull();
  });

  it('keeps region groupings plausible', () => {
    expect(findPrefecture('北海道')?.region).toBe('北海道');
    expect(findPrefecture('鹿児島県')?.region).toBe('九州');
  });
});

describe('map metadata', () => {
  it('records the public-domain source', () => {
    const geometry = buildGeometry();
    expect(geometry.meta.source).toContain('Natural Earth');
    expect(geometry.meta.sourceUrl).toContain('naturalearthdata.com');
  });
});
