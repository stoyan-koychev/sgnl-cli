import type { CommunityResult, D3Node } from '../types';

/**
 * Assigns each node to a community based on its URL path segment.
 * External nodes form their own "external" community.
 * Root pages (no path segment) form a "root" community.
 */
export function detectCommunities(
  nodes: Pick<D3Node, 'id' | 'type'>[]
): CommunityResult {
  const segMap = new Map<string, number>();
  let nextId = 0;
  const communities = new Map<string, number>();

  for (const n of nodes) {
    let seg = 'other';
    if (n.type === 'external') {
      seg = 'external';
    } else {
      try {
        const parts = new URL(n.id).pathname.split('/').filter(Boolean);
        seg = parts.length > 0 ? parts[0] : 'root';
      } catch (_) { /* keep seg = 'other' */ }
    }
    if (!segMap.has(seg)) segMap.set(seg, nextId++);
    communities.set(n.id, segMap.get(seg)!);
  }

  return { communities, segMap };
}
