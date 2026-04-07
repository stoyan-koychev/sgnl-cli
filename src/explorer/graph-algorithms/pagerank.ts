import type { LinkInfo } from '../types';

/**
 * Power-iteration PageRank (50 iterations, damping factor 0.85).
 * Returns scores normalised to [0, 1] relative to the highest-ranked page.
 */
export function computePageRank(
  graph: Map<string, LinkInfo[]>,
  urls: string[]
): Map<string, number> {
  const N = urls.length;
  if (N === 0) return new Map();

  const inLinks = new Map<string, string[]>();
  for (const [src, links] of graph) {
    for (const l of links) {
      if (l.type === 'internal') {
        if (!inLinks.has(l.target)) inLinks.set(l.target, []);
        inLinks.get(l.target)!.push(src);
      }
    }
  }
  const outDeg = new Map(
    urls.map(u => [u, (graph.get(u) ?? []).filter(l => l.type === 'internal').length])
  );

  let pr = new Map(urls.map(u => [u, 1 / N]));
  for (let i = 0; i < 50; i++) {
    const next = new Map<string, number>();
    for (const u of urls) {
      let rank = (1 - 0.85) / N;
      for (const src of (inLinks.get(u) ?? [])) {
        rank += 0.85 * (pr.get(src) ?? 0) / Math.max(1, outDeg.get(src) ?? 1);
      }
      next.set(u, rank);
    }
    pr = next;
  }

  const max = Math.max(...pr.values(), 1e-9);
  for (const [k, v] of pr) pr.set(k, v / max);
  return pr;
}
