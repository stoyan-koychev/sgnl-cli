/**
 * Explorer query utilities — load compact.json from latest run
 * and provide data access helpers.
 */

import * as fs from 'fs';
import * as path from 'path';
import { loadConfig } from '../config';
import type { CompactLinkMapData } from './types';

export interface DecodedNode {
  url: string;
  label: string;
  type: string;
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
  h1: string;
  metaRobots: string;
  communityId: number;
  gscPosition: number | null;
}

export interface DecodedEdge {
  source: string;
  target: string;
  follow: boolean;
}

export interface LoadedRun {
  compact: CompactLinkMapData;
  nodes: DecodedNode[];
  edges: DecodedEdge[];
  nodeByUrl: Map<string, DecodedNode>;
  runPath: string;
}

const NODE_TYPES = ['home', 'normal', 'orphan', 'error_4xx', 'external', 'error_5xx'];

/** Decode compact SoA format into usable node objects */
function decodeNodes(compact: CompactLinkMapData): DecodedNode[] {
  const URLS = compact.urls;
  const N = compact.nodes;
  return N.idx.map((urlIdx: number, i: number) => {
    const flags = N.flags[i];
    return {
      url: URLS[urlIdx],
      label: N.label[i] || URLS[urlIdx],
      type: NODE_TYPES[N.type[i]] || 'normal',
      status: N.status[i],
      inlinks: N.inlinks[i],
      outlinks: N.outlinks[i],
      outExternal: N.outExternal[i],
      crawlDepth: N.crawlDepth[i],
      linkDepth: N.linkDepth[i],
      pageRank: N.pageRank[i],
      isDeadEnd: !!(flags & 1),
      isDeepPage: !!(flags & 2),
      tooManyExternal: !!(flags & 4),
      inSitemap: !!(flags & 8),
      indexable: !!(flags & 16),
      canonical: N.canonical[i] != null ? URLS[N.canonical[i]!] : null,
      h1: N.h1?.[i] ?? '',
      metaRobots: N.metaRobots?.[i] ?? '',
      communityId: compact.communities?.[i] ?? 0,
      gscPosition: N.gscPosition?.[i] ?? null,
    };
  });
}

function decodeEdges(compact: CompactLinkMapData): DecodedEdge[] {
  const URLS = compact.urls;
  return compact.edges.map((e: [number, number, number]) => ({
    source: URLS[e[0]],
    target: URLS[e[1]],
    follow: e[2] === 1,
  }));
}

/** Find the most recent explorer run for a domain */
export function findLatestRun(domain: string, runDirOverride?: string): string | null {
  if (runDirOverride) {
    const compactPath = path.join(runDirOverride, 'compact.json');
    if (fs.existsSync(compactPath)) return runDirOverride;
    return null;
  }

  const { runsPath } = loadConfig();
  const base = runsPath ?? path.join(process.cwd(), 'runs');
  const domainDir = domain.replace(/\./g, '_');
  const domainPath = path.join(base, domainDir);

  if (!fs.existsSync(domainPath)) return null;

  // List timestamp dirs, sort descending (most recent first)
  const dirs = fs.readdirSync(domainPath)
    .filter(d => fs.statSync(path.join(domainPath, d)).isDirectory())
    .sort()
    .reverse();

  for (const d of dirs) {
    const candidate = path.join(domainPath, d);
    if (fs.existsSync(path.join(candidate, 'compact.json'))) {
      return candidate;
    }
  }
  return null;
}

/** Load and decode an explorer run */
export function loadRun(runPath: string): LoadedRun {
  const compactPath = path.join(runPath, 'compact.json');
  const compact: CompactLinkMapData = JSON.parse(fs.readFileSync(compactPath, 'utf-8'));
  const nodes = decodeNodes(compact);
  const edges = decodeEdges(compact);
  const nodeByUrl = new Map<string, DecodedNode>();
  for (const n of nodes) nodeByUrl.set(n.url, n);
  return { compact, nodes, edges, nodeByUrl, runPath };
}

/** Resolve domain from a URL or hostname string */
export function resolveDomain(input: string): string {
  try {
    return new URL(input.includes('://') ? input : `https://${input}`).hostname;
  } catch {
    return input;
  }
}

/** Format a table row with padding */
export function padRow(cols: string[], widths: number[]): string {
  return cols.map((c, i) => c.padEnd(widths[i] || 0)).join('  ');
}
