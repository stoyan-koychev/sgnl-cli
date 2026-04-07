import type { PageStats } from '../analysis/page-stats';
import type { LinkInfo } from './crawler';

export type { PageStats };
export type { LinkInfo };

// ---------------------------------------------------------------------------
// Server-side node/edge types (used during HTML generation only)
// ---------------------------------------------------------------------------

export interface D3Node {
  id: string;
  label: string;
  type: 'home' | 'normal' | 'orphan' | 'error_4xx' | 'error_5xx' | 'external';
  status: number;
  inlinks: number;
  outlinks: number;
  outExternal: number;
  crawlDepth: number;
  linkDepth: number;
  pageRank: number;
  isDeadEnd: boolean;
  isDeepPage: boolean;
  tooManyExternal: boolean;
  inSitemap: boolean;
  indexable: boolean;
  canonical: string | null;
  extUrl: string | null;
  h1: string;
  metaRobots: string;
}

export interface D3Edge {
  source: string;
  target: string;
  follow: boolean;
}

// ---------------------------------------------------------------------------
// Algorithm result types
// ---------------------------------------------------------------------------

export interface CommunityResult {
  /** nodeId → communityId */
  communities: Map<string, number>;
  /** URL path segment → communityId */
  segMap: Map<string, number>;
}

// ---------------------------------------------------------------------------
// Compact wire format (v3) — URL index table + pre-computed communities
// ---------------------------------------------------------------------------

export interface CompactLinkMapData {
  v: 3;
  urls: string[];
  meta: {
    baseUrl: string;
    crawledAt: string;
    orphans: number[];
    notInSitemap: number[];
    uncrawledSitemap: number[];
    deadEnds: number[];
    deepPages: number[];
    tooManyExternal: number[];
    topExternalDomains: [string, number][];
    errors4xx?: number[];
    errors5xx?: number[];
    uncrawledReasons?: Record<string, string>;
  };
  nodes: {
    idx: number[];
    label: string[];
    type: number[];
    status: number[];
    inlinks: number[];
    outlinks: number[];
    outExternal: number[];
    crawlDepth: number[];
    linkDepth: number[];
    pageRank: number[];
    flags: number[];
    canonical: (number | null)[];
    extUrl: (number | null)[];
    h1: string[];
    metaRobots: string[];
    pageStats?: (PageStats | null)[];
    gscPosition?: (number | null)[];
  };
  edges: [number, number, 0 | 1][];
  /** communityId parallel to nodes.idx */
  communities: number[];
  /** serialized Map<segment, communityId> */
  segMap: [string, number][];
}
