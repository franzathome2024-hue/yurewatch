/**
 * Wire types for the P2P地震情報 JSON API v2.
 *
 * Source of truth: https://www.p2pquake.net/swagger-ui/specification.yaml
 * (retrieved 2026-10-22, spec version 2.3.0). Field names/values are JMA XML
 * vocabulary; this file only describes them, all interpretation lives in
 * `parse.ts`.
 */

/** Fields present on every item (`BasicData`). */
interface BasicData {
  id: string;
  code: number;
  /** 受信日時, `2006/01/02 15:04:05.999` (JST). */
  time: string;
}

/** 551 — 地震情報 (JMAQuake). */
export interface RawJmaQuake extends BasicData {
  code: 551;
  issue: {
    source?: string;
    time: string;
    type: string;
    correct?: string;
  };
  earthquake: {
    time: string;
    hypocenter?: {
      name?: string;
      latitude?: number;
      longitude?: number;
      depth?: number;
      magnitude?: number;
    };
    maxScale?: number;
    domesticTsunami?: string;
    foreignTsunami?: string;
  };
  points?: Array<{ pref?: string; addr?: string; isArea?: boolean; scale?: number }>;
  comments?: { freeFormComment?: string };
}

/** 556 — 緊急地震速報（警報） (EEW). */
export interface RawEew extends BasicData {
  code: 556;
  test?: boolean;
  cancelled: boolean;
  earthquake?: {
    originTime?: string;
    arrivalTime?: string;
    condition?: string;
    hypocenter?: {
      name?: string;
      reduceName?: string;
      latitude?: number;
      longitude?: number;
      depth?: number;
      magnitude?: number;
    };
  } | null;
  issue: { time?: string; eventId: string; serial: string };
  areas?: Array<{
    pref: string;
    name: string;
    scaleFrom: number;
    scaleTo: number;
    kindCode?: string;
    arrivalTime?: string | null;
  }> | null;
}

/** 552 — 津波予報 (JMATsunami). */
export interface RawTsunami extends BasicData {
  code: 552;
  cancelled: boolean;
  issue: { source?: string; time: string; type: string };
  areas?: Array<{
    grade?: string;
    name?: string;
    immediate?: boolean;
    firstHeight?: { arrivalTime?: string | null; condition?: string };
    maxHeight?: { description?: string; value?: number };
  }> | null;
}

export type RawItem = RawJmaQuake | RawEew | RawTsunami | { id?: string; code: number } & Record<string, unknown>;

/** Everything that can arrive from a feed, before parsing. */
export interface RawBatch {
  items: unknown[];
  fetchedAt: number;
}

export interface WireSourceMeta {
  /** Endpoint actually used, for the diagnostics panel. */
  endpoint: string;
  /** Provider display name. */
  provider: string;
  official: boolean;
  relayed: boolean;
  url?: string;
}
