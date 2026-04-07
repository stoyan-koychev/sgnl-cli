import { computePageRank } from '../../../src/explorer/graph-algorithms/pagerank';
import type { LinkInfo } from '../../../src/explorer/crawler';

function link(target: string): LinkInfo {
  return { target, follow: true, type: 'internal' };
}

describe('computePageRank', () => {
  test('returns empty map for empty input', () => {
    const result = computePageRank(new Map(), []);
    expect(result.size).toBe(0);
  });

  test('single node gets rank 1 (normalised)', () => {
    const graph = new Map([['https://a.com/', []]]);
    const result = computePageRank(graph, ['https://a.com/']);
    expect(result.get('https://a.com/')).toBeCloseTo(1, 3);
  });

  test('symmetric 2-node graph produces equal ranks', () => {
    const a = 'https://example.com/a';
    const b = 'https://example.com/b';
    const graph = new Map([
      [a, [link(b)]],
      [b, [link(a)]],
    ]);
    const result = computePageRank(graph, [a, b]);
    const ra = result.get(a)!;
    const rb = result.get(b)!;
    expect(Math.abs(ra - rb)).toBeLessThan(0.001);
  });

  test('hub page receives higher rank than leaf', () => {
    const home = 'https://example.com/';
    const leaf = 'https://example.com/leaf';
    const external = 'https://example.com/external';
    // home and external both link to leaf; leaf doesn't link back
    const graph = new Map([
      [home,     [link(leaf)]],
      [external, [link(leaf)]],
      [leaf,     []],
    ]);
    const result = computePageRank(graph, [home, leaf, external]);
    expect(result.get(leaf)!).toBeGreaterThan(result.get(home)!);
  });

  test('disconnected graph: unreferenced node still gets a rank', () => {
    const a = 'https://example.com/a';
    const b = 'https://example.com/b';
    const graph = new Map([
      [a, []],
      [b, []],
    ]);
    const result = computePageRank(graph, [a, b]);
    expect(result.has(a)).toBe(true);
    expect(result.has(b)).toBe(true);
  });
});
