import { detectCommunities } from '../../../src/explorer/graph-algorithms/community-detection';
import type { D3Node } from '../../../src/explorer/types';

type NodeStub = Pick<D3Node, 'id' | 'type'>;

function node(id: string, type: D3Node['type'] = 'normal'): NodeStub {
  return { id, type };
}

describe('detectCommunities', () => {
  test('returns empty maps for empty input', () => {
    const result = detectCommunities([]);
    expect(result.communities.size).toBe(0);
    expect(result.segMap.size).toBe(0);
  });

  test('pages with same path segment share a community', () => {
    const nodes = [
      node('https://example.com/blog/a'),
      node('https://example.com/blog/b'),
    ];
    const { communities } = detectCommunities(nodes);
    expect(communities.get('https://example.com/blog/a'))
      .toBe(communities.get('https://example.com/blog/b'));
  });

  test('pages with different path segments get different communities', () => {
    const nodes = [
      node('https://example.com/blog/a'),
      node('https://example.com/products/b'),
    ];
    const { communities } = detectCommunities(nodes);
    expect(communities.get('https://example.com/blog/a'))
      .not.toBe(communities.get('https://example.com/products/b'));
  });

  test('root pages (no path segment) are grouped as "root"', () => {
    const nodes = [
      node('https://example.com/'),
      node('https://example.com'),
    ];
    const { communities, segMap } = detectCommunities(nodes);
    expect(segMap.has('root')).toBe(true);
    const rootId = segMap.get('root');
    for (const n of nodes) {
      expect(communities.get(n.id)).toBe(rootId);
    }
  });

  test('external nodes are grouped together', () => {
    const nodes = [
      node('ext:example.com', 'external'),
      node('ext:other.com',   'external'),
    ];
    const { communities, segMap } = detectCommunities(nodes);
    expect(segMap.has('external')).toBe(true);
    const extId = segMap.get('external');
    expect(communities.get('ext:example.com')).toBe(extId);
    expect(communities.get('ext:other.com')).toBe(extId);
  });

  test('segMap entries are unique community IDs', () => {
    const nodes = [
      node('https://example.com/blog/1'),
      node('https://example.com/docs/1'),
      node('https://example.com/'),
    ];
    const { segMap } = detectCommunities(nodes);
    const ids = [...segMap.values()];
    expect(new Set(ids).size).toBe(ids.length); // all unique
  });
});
