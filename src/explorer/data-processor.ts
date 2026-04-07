import type { ExplorerResult, PageData } from './crawler';
import type { PageStats } from '../analysis/page-stats';
import type { D3Node, D3Edge, CompactLinkMapData } from './types';
import { computePageRank } from './graph-algorithms/pagerank';
import { detectCommunities } from './graph-algorithms/community-detection';

const TYPE_MAP: Record<string, number> = {
  home: 0, normal: 1, orphan: 2, error_4xx: 3, error_5xx: 5, external: 4,
};

export function buildCompactData(
  result: ExplorerResult,
  pageStats?: Map<string, PageStats>
): CompactLinkMapData {
  const { baseUrl, pages, graph, errors, sitemapUrls, depths } = result;
  const baseNorm = baseUrl.replace(/\/$/, '');

  // Inlink counts
  const inlinkCount = new Map<string, number>();
  for (const [, links] of graph) {
    for (const link of links) {
      if (link.type === 'internal') {
        inlinkCount.set(link.target, (inlinkCount.get(link.target) ?? 0) + 1);
      }
    }
  }

  // PageRank
  const internalUrls = [...pages.keys()];
  const pageRankMap = computePageRank(graph, internalUrls);

  // Build internal nodes
  const nodes: D3Node[] = [];
  const allCrawledUrls = new Set<string>([...pages.keys(), ...errors.keys()]);

  for (const url of allCrawledUrls) {
    const page: PageData | undefined = pages.get(url);
    const status = page?.status ?? 0;
    const inlinks = inlinkCount.get(url) ?? 0;
    const links = graph.get(url) ?? [];
    const outlinks = links.filter(l => l.type === 'internal').length;
    const outExternal = links.filter(l => l.type === 'external').length;
    const crawlDepth = depths.get(url) ?? 0;
    const pageRank = pageRankMap.get(url) ?? 0;

    const urlNorm = url.replace(/\/$/, '');
    const isHome = urlNorm === baseNorm || url === baseUrl;
    const isError4xx = (status >= 400 && status < 500) || (errors.has(url) && !page && status < 500);
    const isError5xx = status >= 500;
    const isOrphan = !isHome && inlinks === 0 && !!page;

    let type: D3Node['type'];
    if (isHome)          type = 'home';
    else if (isError5xx) type = 'error_5xx';
    else if (isError4xx) type = 'error_4xx';
    else if (isOrphan)   type = 'orphan';
    else                 type = 'normal';

    const rawTitle = page?.title ?? '';
    const shortPath = new URL(url).pathname || '/';
    const label = rawTitle || shortPath;

    nodes.push({
      id: url,
      label: label.slice(0, 80),
      type,
      status,
      inlinks,
      outlinks,
      outExternal,
      crawlDepth,
      linkDepth: 0,
      pageRank,
      isDeadEnd: outlinks === 0 && !isError4xx && !isError5xx,
      isDeepPage: crawlDepth > 3,
      tooManyExternal: outExternal > 5,
      inSitemap: sitemapUrls.size === 0 ? true : sitemapUrls.has(url),
      indexable: page?.isIndexable ?? false,
      canonical: page?.canonical ?? null,
      extUrl: null,
      h1: page?.h1 ?? '',
      metaRobots: page?.metaRobots ?? '',
    });
  }

  // Compute link depth via BFS over the full link graph
  const linkDepthMap = new Map<string, number>();
  const bfsQ: [string, number][] = [[baseUrl, 0]];
  const bfsVisited = new Set<string>([baseUrl]);
  linkDepthMap.set(baseUrl, 0);
  while (bfsQ.length) {
    const [url, d] = bfsQ.shift()!;
    for (const link of graph.get(url) ?? []) {
      if (link.type === 'internal' && !bfsVisited.has(link.target)) {
        bfsVisited.add(link.target);
        linkDepthMap.set(link.target, d + 1);
        bfsQ.push([link.target, d + 1]);
      }
    }
  }
  // Back-fill linkDepth on nodes now that the map is complete
  for (const n of nodes) {
    n.linkDepth = linkDepthMap.get(n.id) ?? n.crawlDepth;
  }

  // Build edges (deduplicated internal)
  const edgeSet = new Set<string>();
  const edges: D3Edge[] = [];

  for (const [source, links] of graph) {
    for (const link of links) {
      if (link.type !== 'internal') continue;
      const key = `${source}\u2192${link.target}`;
      if (edgeSet.has(key)) continue;
      edgeSet.add(key);
      if (allCrawledUrls.has(link.target)) {
        edges.push({ source, target: link.target, follow: link.follow });
      }
    }
  }

  // External domain nodes + edges
  const extDomains = new Map<string, number>();
  for (const [, links] of graph) {
    for (const link of links) {
      if (link.type === 'external') {
        try {
          const domain = new URL(link.target).hostname;
          extDomains.set(domain, (extDomains.get(domain) ?? 0) + 1);
        } catch { /* skip */ }
      }
    }
  }
  const topExternalDomains = [...extDomains.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10) as [string, number][];

  const extEdgeSet = new Set<string>();
  for (const [source, links] of graph) {
    for (const link of links) {
      if (link.type !== 'external') continue;
      let domain: string;
      try { domain = new URL(link.target).hostname; } catch { continue; }
      const nodeId = `ext:${domain}`;
      if (!nodes.find(n => n.id === nodeId)) {
        nodes.push({
          id: nodeId, label: domain, type: 'external',
          status: 0, inlinks: extDomains.get(domain) ?? 0, outlinks: 0, outExternal: 0,
          crawlDepth: 0, linkDepth: 0, pageRank: 0,
          isDeadEnd: false, isDeepPage: false, tooManyExternal: false,
          inSitemap: false, indexable: false, canonical: null, extUrl: link.target,
          h1: '', metaRobots: '',
        });
      }
      const key = `${source}\u2192${nodeId}`;
      if (!extEdgeSet.has(key)) {
        extEdgeSet.add(key);
        edges.push({ source, target: nodeId, follow: link.follow });
      }
    }
  }

  // Meta lists
  const orphans             = nodes.filter(n => n.type === 'orphan').map(n => n.id);
  const deadEnds            = nodes.filter(n => n.isDeadEnd && n.type !== 'external').map(n => n.id);
  const deepPages           = nodes.filter(n => n.isDeepPage).map(n => n.id);
  const tooManyExternalList = nodes.filter(n => n.tooManyExternal).map(n => n.id);
  const notInSitemap        = nodes
    .filter(n => !['home', 'error', 'external'].includes(n.type) && !n.inSitemap)
    .map(n => n.id);
  const uncrawledSitemap = [...sitemapUrls].filter(u => !allCrawledUrls.has(u));

  // Community detection (server-side)
  const communityResult = detectCommunities(nodes);

  // Pack into compact wire format
  const urlSet = new Set<string>();
  for (const n of nodes) {
    urlSet.add(n.id);
    if (n.canonical) urlSet.add(n.canonical);
    if (n.extUrl) urlSet.add(n.extUrl);
  }
  for (const u of uncrawledSitemap) urlSet.add(u);

  const urls = [...urlSet];
  const urlToIdx = new Map<string, number>(urls.map((u, i) => [u, i]));

  return {
    v: 3,
    urls,
    meta: {
      baseUrl,
      crawledAt: new Date().toISOString(),
      orphans:          orphans.map(u => urlToIdx.get(u)!),
      notInSitemap:     notInSitemap.map(u => urlToIdx.get(u)!),
      uncrawledSitemap: uncrawledSitemap.map(u => urlToIdx.get(u)!),
      deadEnds:         deadEnds.map(u => urlToIdx.get(u)!),
      deepPages:        deepPages.map(u => urlToIdx.get(u)!),
      tooManyExternal:  tooManyExternalList.map(u => urlToIdx.get(u)!),
      topExternalDomains,
    },
    nodes: {
      idx:         nodes.map(n => urlToIdx.get(n.id)!),
      label:       nodes.map(n => n.label),
      type:        nodes.map(n => TYPE_MAP[n.type] ?? 1),
      status:      nodes.map(n => n.status),
      inlinks:     nodes.map(n => n.inlinks),
      outlinks:    nodes.map(n => n.outlinks),
      outExternal: nodes.map(n => n.outExternal),
      crawlDepth:  nodes.map(n => n.crawlDepth),
      linkDepth:   nodes.map(n => n.linkDepth),
      pageRank:    nodes.map(n => Math.round(n.pageRank * 10000) / 10000),
      flags:       nodes.map(n =>
        (n.isDeadEnd       ? 1  : 0) |
        (n.isDeepPage      ? 2  : 0) |
        (n.tooManyExternal ? 4  : 0) |
        (n.inSitemap       ? 8  : 0) |
        (n.indexable       ? 16 : 0)
      ),
      canonical:  nodes.map(n => n.canonical != null ? (urlToIdx.get(n.canonical) ?? null) : null),
      extUrl:     nodes.map(n => n.extUrl != null ? (urlToIdx.get(n.extUrl) ?? null) : null),
      h1:         nodes.map(n => n.h1),
      metaRobots: nodes.map(n => n.metaRobots),
      pageStats:  pageStats
        ? nodes.map(n => pageStats.get(n.id) ?? null)
        : undefined,
    },
    edges: edges.map(e => [urlToIdx.get(e.source)!, urlToIdx.get(e.target)!, e.follow ? 1 : 0]),
    communities: nodes.map(n => communityResult.communities.get(n.id) ?? 0),
    segMap:      [...communityResult.segMap.entries()],
  };
}
