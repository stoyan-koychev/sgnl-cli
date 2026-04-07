import { buildCompactData } from '../../../src/explorer/data-processor';
import type { ExplorerResult } from '../../../src/explorer/crawler';

function makeResult(overrides: Partial<ExplorerResult> = {}): ExplorerResult {
  return {
    baseUrl: 'https://example.com',
    pages: new Map([
      ['https://example.com/', { url: 'https://example.com/', status: 200, title: 'Home', h1: 'Home', canonical: null, metaRobots: '', wordCount: 100, isIndexable: true }],
      ['https://example.com/about', { url: 'https://example.com/about', status: 200, title: 'About', h1: 'About Us', canonical: null, metaRobots: '', wordCount: 50, isIndexable: true }],
    ]),
    graph: new Map([
      ['https://example.com/', [{ target: 'https://example.com/about', follow: true, type: 'internal' }]],
      ['https://example.com/about', []],
    ]),
    errors: new Map(),
    sitemapUrls: new Set(),
    sitemapLastmod: new Map(),
    depths: new Map([
      ['https://example.com/', 0],
      ['https://example.com/about', 1],
    ]),
    crawledUrls: new Set(['https://example.com/', 'https://example.com/about']),
    robotsBlocked: new Set(),
    queueRemainder: new Set(),
    ...overrides,
  };
}

describe('buildCompactData', () => {
  test('produces v3 wire format', () => {
    const data = buildCompactData(makeResult());
    expect(data.v).toBe(3);
  });

  test('communities array length equals nodes array length', () => {
    const data = buildCompactData(makeResult());
    expect(data.communities).toHaveLength(data.nodes.idx.length);
  });

  test('segMap is an array of [string, number] pairs', () => {
    const data = buildCompactData(makeResult());
    expect(Array.isArray(data.segMap)).toBe(true);
    for (const entry of data.segMap) {
      expect(typeof entry[0]).toBe('string');
      expect(typeof entry[1]).toBe('number');
    }
  });

  test('edges reference valid URL indices', () => {
    const data = buildCompactData(makeResult());
    for (const [src, tgt] of data.edges) {
      expect(src).toBeGreaterThanOrEqual(0);
      expect(src).toBeLessThan(data.urls.length);
      expect(tgt).toBeGreaterThanOrEqual(0);
      expect(tgt).toBeLessThan(data.urls.length);
    }
  });

  test('baseUrl is preserved in meta', () => {
    const data = buildCompactData(makeResult());
    expect(data.meta.baseUrl).toBe('https://example.com');
  });

  test('home page gets type 0', () => {
    const data = buildCompactData(makeResult());
    const homeIdx = data.urls.indexOf('https://example.com/');
    const nodePos = data.nodes.idx.indexOf(homeIdx);
    expect(data.nodes.type[nodePos]).toBe(0); // TYPE_MAP.home = 0
  });

  test('pageStats field is undefined when not provided', () => {
    const data = buildCompactData(makeResult());
    expect(data.nodes.pageStats).toBeUndefined();
  });
});
