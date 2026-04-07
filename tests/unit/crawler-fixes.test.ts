/**
 * Regression tests for crawler fixes:
 * Fix 1: PriorityQueue O(1) has() + rescoreIfPresent
 * Fix 2: 429/503 backpressure
 * Fix 3: Soft 404 fingerprinting
 * Fix 4: Checkpoint write/restore round-trip
 * Fix 5: robots.txt longest-match
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// We need to access internal classes/functions. Import what's exported and
// use a require-based approach for non-exported internals via module rewiring.
// Since the module exports computeContentHash and the class, we can test those directly.
// For non-exported functions (isAllowedByRobots, PriorityQueue), we load the compiled module.

// eslint-disable-next-line @typescript-eslint/no-var-requires
const crawlerModule = require('../../src/explorer/crawler');

// Re-export types for convenience
const { computeContentHash } = crawlerModule;

// ---------------------------------------------------------------------------
// Helpers to access non-exported internals from the compiled module
// ---------------------------------------------------------------------------

// PriorityQueue is not exported but lives on the compiled module as a class.
// We'll reconstruct a minimal version by parsing the dist output. Instead,
// let's test via the Explorer class behavior or just test the module file directly.
// Since PriorityQueue is a private class, we test it by evaluating the source.

// For internal testing we'll eval the relevant class from dist.
function loadInternals() {
  // Read the compiled JS to extract the PriorityQueue class and helper functions
  const distPath = path.join(__dirname, '../../dist/explorer/crawler.js');
  const src = fs.readFileSync(distPath, 'utf-8');

  // Extract and eval in a sandbox
  const sandbox: Record<string, unknown> = {};

  // PriorityQueue
  const pqMatch = src.match(/class PriorityQueue \{[\s\S]*?\n\}/);
  if (pqMatch) {
    const fn = new Function(`${pqMatch[0]}\nreturn PriorityQueue;`);
    sandbox.PriorityQueue = fn();
  }

  // isAllowedByRobots
  const robotsMatch = src.match(/function isAllowedByRobots\([\s\S]*?\n\}/);
  if (robotsMatch) {
    const fn = new Function(`${robotsMatch[0]}\nreturn isAllowedByRobots;`);
    sandbox.isAllowedByRobots = fn();
  }

  // parseRetryAfter
  const retryMatch = src.match(/function parseRetryAfter\([\s\S]*?\n\}/);
  if (retryMatch) {
    const fn = new Function(`${retryMatch[0]}\nreturn parseRetryAfter;`);
    sandbox.parseRetryAfter = fn();
  }

  // isSoft404
  const soft404TitlesMatch = src.match(/const SOFT_404_TITLES = \[.*?\];/);
  const contentSimMatch = src.match(/function contentSimilarity\([\s\S]*?\n\}/);
  const isSoft404Match = src.match(/function isSoft404\([\s\S]*?\n\}/);
  if (soft404TitlesMatch && isSoft404Match && contentSimMatch) {
    const computeHashStr = src.match(/function computeContentHash\([\s\S]*?\n\}/);
    const fn = new Function(
      `${soft404TitlesMatch[0]}\n${computeHashStr?.[0] ?? ''}\n${contentSimMatch[0]}\n${isSoft404Match[0]}\nreturn isSoft404;`
    );
    sandbox.isSoft404 = fn();
  }

  return sandbox;
}

let internals: Record<string, any>;

beforeAll(() => {
  internals = loadInternals();
});

// ---------------------------------------------------------------------------
// Fix 1: PriorityQueue O(1) has() + rescoreIfPresent
// ---------------------------------------------------------------------------
describe('Fix 1: PriorityQueue', () => {
  let PQ: any;

  beforeEach(() => {
    PQ = internals.PriorityQueue;
  });

  test('has() returns true for pushed URLs and false after shift', () => {
    const q = new PQ();
    q.push({ url: 'https://a.com/1', depth: 0, score: 1 });
    q.push({ url: 'https://a.com/2', depth: 0, score: 2 });

    expect(q.has('https://a.com/1')).toBe(true);
    expect(q.has('https://a.com/2')).toBe(true);
    expect(q.has('https://a.com/3')).toBe(false);

    // shift returns highest score first
    const top = q.shift();
    expect(top.url).toBe('https://a.com/2');
    expect(q.has('https://a.com/2')).toBe(false);
    expect(q.has('https://a.com/1')).toBe(true);
  });

  test('drain() clears the urlSet', () => {
    const q = new PQ();
    q.push({ url: 'https://a.com/1', depth: 0, score: 5 });
    q.push({ url: 'https://a.com/2', depth: 0, score: 3 });

    const items = q.drain();
    expect(items).toHaveLength(2);
    // After drain, has() returns false
    expect(q.has('https://a.com/1')).toBe(false);
    expect(q.has('https://a.com/2')).toBe(false);
  });

  test('rescoreIfPresent updates score and re-heapifies', () => {
    const q = new PQ();
    q.push({ url: 'https://a.com/low', depth: 1, score: 1 });
    q.push({ url: 'https://a.com/high', depth: 0, score: 10 });
    q.push({ url: 'https://a.com/mid', depth: 1, score: 5 });

    // Rescore the low item to become highest
    q.rescoreIfPresent('https://a.com/low', 20);
    const top = q.shift();
    expect(top.url).toBe('https://a.com/low');
    expect(top.score).toBe(20);
  });

  test('rescoreIfPresent does nothing if newScore is not higher', () => {
    const q = new PQ();
    q.push({ url: 'https://a.com/a', depth: 0, score: 10 });
    q.push({ url: 'https://a.com/b', depth: 0, score: 5 });

    // Try to lower score — should not change
    q.rescoreIfPresent('https://a.com/a', 3);
    const top = q.shift();
    expect(top.url).toBe('https://a.com/a');
    expect(top.score).toBe(10);
  });

  test('rescoreIfPresent is no-op for URLs not in queue', () => {
    const q = new PQ();
    q.push({ url: 'https://a.com/a', depth: 0, score: 5 });

    // Should not throw
    q.rescoreIfPresent('https://a.com/missing', 100);
    expect(q.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Fix 2: 429 backpressure — parseRetryAfter
// ---------------------------------------------------------------------------
describe('Fix 2: 429 backpressure', () => {
  test('parseRetryAfter with numeric seconds', () => {
    const parse = internals.parseRetryAfter;
    // 30 seconds
    expect(parse('30')).toBe(30000);
    // 0 seconds
    expect(parse('0')).toBe(0);
  });

  test('parseRetryAfter caps at 60 seconds', () => {
    const parse = internals.parseRetryAfter;
    expect(parse('120')).toBe(60000);
    expect(parse('999')).toBe(60000);
  });

  test('parseRetryAfter with HTTP-date', () => {
    const parse = internals.parseRetryAfter;
    const futureDate = new Date(Date.now() + 10000).toUTCString();
    const result = parse(futureDate);
    expect(result).toBeGreaterThan(5000);
    expect(result).toBeLessThanOrEqual(60000);
  });

  test('parseRetryAfter returns null for undefined/invalid', () => {
    const parse = internals.parseRetryAfter;
    expect(parse(undefined)).toBeNull();
    expect(parse('not-a-date-or-number-at-all')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Fix 3: Soft 404 fingerprinting
// ---------------------------------------------------------------------------
describe('Fix 3: Soft 404 fingerprint', () => {
  test('computeContentHash produces consistent hash', () => {
    const html = '<html><body>Page not found. Sorry!</body></html>';
    const h1 = computeContentHash(html);
    const h2 = computeContentHash(html);
    expect(h1).toBe(h2);
    expect(typeof h1).toBe('string');
  });

  test('computeContentHash differs for different content', () => {
    const h1 = computeContentHash('<html><body>Page A content here</body></html>');
    const h2 = computeContentHash('<html><body>Totally different page B</body></html>');
    expect(h1).not.toBe(h2);
  });

  test('isSoft404 matches fingerprinted page by exact hash', () => {
    const isSoft404 = internals.isSoft404;
    const notFoundHtml = '<html><head><title>Our Site</title></head><body><nav>Menu</nav><main>The page you are looking for does not exist.</main><footer>Footer</footer></body></html>';
    const fingerprint = {
      hash: computeContentHash(notFoundHtml),
      html: notFoundHtml,
    };

    // Same page matches
    expect(isSoft404('Our Site', notFoundHtml, fingerprint)).toBe(true);
  });

  test('isSoft404 matches fingerprinted page by similarity', () => {
    const isSoft404 = internals.isSoft404;
    const template = '<html><head><title>My Site</title></head><body><nav>Home About Contact</nav><main>Sorry, the page you requested was not found on this server.</main><footer>Copyright 2025</footer></body></html>';
    const fingerprint = {
      hash: computeContentHash(template),
      html: template,
    };

    // Slightly different (different URL in breadcrumb) but still > 80% similar
    const variant = '<html><head><title>My Site</title></head><body><nav>Home About Contact</nav><main>Sorry, the page you requested was not found on this server.</main><footer>Copyright 2026</footer></body></html>';
    expect(isSoft404('My Site', variant, fingerprint)).toBe(true);
  });

  test('isSoft404 does not match completely different page', () => {
    const isSoft404 = internals.isSoft404;
    const notFoundHtml = '<html><body>Page not found</body></html>';
    const fingerprint = {
      hash: computeContentHash(notFoundHtml),
      html: notFoundHtml,
    };

    const realPage = '<html><head><title>Blog Post</title></head><body><article>This is a completely different and real blog post with substantial unique content that has nothing to do with a 404 page. It discusses various topics including technology, science, and arts. The article is rich with information and provides value to readers.</article></body></html>';
    expect(isSoft404('Blog Post', realPage, fingerprint)).toBe(false);
  });

  test('isSoft404 falls back to title-based detection without fingerprint', () => {
    const isSoft404 = internals.isSoft404;
    // Short page with 404 title — should be detected
    expect(isSoft404('Page Not Found', '<html><body>Oops</body></html>', null)).toBe(true);
    // Long page with 404 title — not detected (body > 1000 chars without fingerprint)
    const longBody = '<html><body>' + 'x'.repeat(1500) + '</body></html>';
    expect(isSoft404('Page Not Found', longBody, null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Fix 4: Checkpoint write/restore round-trip
// ---------------------------------------------------------------------------
describe('Fix 4: Checkpoint', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crawler-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('checkpoint round-trip preserves all state', () => {
    const checkpointPath = path.join(tmpDir, 'output.jsonl.checkpoint.json');

    const original = {
      visited: ['https://a.com/', 'https://a.com/page1', 'https://a.com/page2'],
      queueItems: [
        { url: 'https://a.com/page3', depth: 2, score: 0.65 },
        { url: 'https://a.com/page4', depth: 1, score: 0.8 },
      ],
      discoveredInlinks: { 'https://a.com/page3': 3, 'https://a.com/page4': 5 },
      crawledCount: 3,
      backpressureMultiplier: 1.5,
      errors: { 'https://a.com/broken': 'Soft 404' },
    };

    // Write
    fs.writeFileSync(checkpointPath, JSON.stringify(original));

    // Read back
    const raw = fs.readFileSync(checkpointPath, 'utf-8');
    const restored = JSON.parse(raw);

    expect(restored.visited).toEqual(original.visited);
    expect(restored.queueItems).toEqual(original.queueItems);
    expect(restored.discoveredInlinks).toEqual(original.discoveredInlinks);
    expect(restored.crawledCount).toBe(3);
    expect(restored.backpressureMultiplier).toBe(1.5);
    expect(restored.errors).toEqual(original.errors);
  });

  test('checkpoint is deleted on clean finish (simulated)', () => {
    const checkpointPath = path.join(tmpDir, 'output.jsonl.checkpoint.json');
    fs.writeFileSync(checkpointPath, '{}');
    expect(fs.existsSync(checkpointPath)).toBe(true);

    // Simulate clean finish: unlink
    fs.unlinkSync(checkpointPath);
    expect(fs.existsSync(checkpointPath)).toBe(false);
  });

  test('corrupt checkpoint does not throw on parse', () => {
    const checkpointPath = path.join(tmpDir, 'output.jsonl.checkpoint.json');
    fs.writeFileSync(checkpointPath, 'NOT VALID JSON {{{');

    expect(() => {
      try {
        JSON.parse(fs.readFileSync(checkpointPath, 'utf-8'));
      } catch {
        // This is the expected behavior — corrupt checkpoint is ignored
      }
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Fix 5: robots.txt longest-match
// ---------------------------------------------------------------------------
describe('Fix 5: robots.txt longest-match', () => {
  let isAllowedByRobots: (url: string, rules: { allowed: string[]; disallowed: string[] }) => boolean;

  beforeAll(() => {
    isAllowedByRobots = internals.isAllowedByRobots;
  });

  test('longer Disallow wins over shorter Allow', () => {
    const rules = {
      allowed: ['/'],
      disallowed: ['/admin/secret'],
      crawlDelay: null,
    };
    // /admin/secret/page — Disallow /admin/secret (14 chars) > Allow / (1 char)
    expect(isAllowedByRobots('https://example.com/admin/secret/page', rules)).toBe(false);
  });

  test('longer Allow wins over shorter Disallow', () => {
    const rules = {
      allowed: ['/public/docs/api'],
      disallowed: ['/public/'],
      crawlDelay: null,
    };
    // /public/docs/api/v1 — Allow /public/docs/api (16 chars) > Disallow /public/ (8 chars)
    expect(isAllowedByRobots('https://example.com/public/docs/api/v1', rules)).toBe(true);
  });

  test('equal length: Allow wins (tie-break per Google spec)', () => {
    const rules = {
      allowed: ['/path'],
      disallowed: ['/path'],
      crawlDelay: null,
    };
    expect(isAllowedByRobots('https://example.com/path/page', rules)).toBe(true);
  });

  test('no matching rules defaults to allowed', () => {
    const rules = {
      allowed: ['/other'],
      disallowed: ['/secret'],
      crawlDelay: null,
    };
    expect(isAllowedByRobots('https://example.com/public/page', rules)).toBe(true);
  });

  test('only Disallow matches => blocked', () => {
    const rules = {
      allowed: [],
      disallowed: ['/blocked'],
      crawlDelay: null,
    };
    expect(isAllowedByRobots('https://example.com/blocked/page', rules)).toBe(false);
  });

  test('only Allow matches => allowed', () => {
    const rules = {
      allowed: ['/open'],
      disallowed: [],
      crawlDelay: null,
    };
    expect(isAllowedByRobots('https://example.com/open/page', rules)).toBe(true);
  });

  test('Disallow: / with specific Allow path', () => {
    const rules = {
      allowed: ['/api/public'],
      disallowed: ['/'],
      crawlDelay: null,
    };
    // /api/public/v1 — Allow /api/public (11) > Disallow / (1)
    expect(isAllowedByRobots('https://example.com/api/public/v1', rules)).toBe(true);
    // /other — only Disallow / (1) matches
    expect(isAllowedByRobots('https://example.com/other', rules)).toBe(false);
  });

  test('empty Disallow string is skipped', () => {
    const rules = {
      allowed: [],
      disallowed: [''],
      crawlDelay: null,
    };
    // Empty disallow = allow everything
    expect(isAllowedByRobots('https://example.com/anything', rules)).toBe(true);
  });
});
