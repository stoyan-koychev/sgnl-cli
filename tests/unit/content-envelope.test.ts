/**
 * Envelope + flag tests for the rewritten `sgnl content <url>` command.
 *
 * The command emits `{ request, content }` where `content` is the payload
 * from content_extract.py (language-neutral stats + body + inventories).
 * We stub safeFetch + runPythonScriptSafe and drive the command through
 * commander to avoid subprocess networking.
 */

import { Command } from 'commander';

jest.mock('../../src/analysis/fetch', () => ({
  renderFetch: jest.fn(),
}));
jest.mock('../../src/analysis/python', () => ({
  runPythonScriptSafe: jest.fn(),
}));

import { renderFetch } from '../../src/analysis/fetch';
import { runPythonScriptSafe } from '../../src/analysis/python';
import { registerContentCommand } from '../../src/commands/content';

const mockSafeFetch = renderFetch as jest.MockedFunction<typeof renderFetch>;
const mockRunPy = runPythonScriptSafe as jest.MockedFunction<typeof runPythonScriptSafe>;

function makeExtractPayload(bodyLen: number = 200): Record<string, any> {
  return {
    metadata: {
      detected_language: 'en',
      title: 'Test Page',
      meta_description: 'A description',
      h1: 'Hello',
      url: 'https://example.com',
      canonical: null,
      published: null,
      modified: null,
    },
    stats: {
      volume: { word_count: 100, char_count: 600, char_count_no_spaces: 500, sentence_count: 10, paragraph_count: 5 },
      distribution: {
        paragraph_length: { min: 5, max: 30, p50: 20, p90: 28 },
        sentence_length: { min: 3, max: 25, p50: 10, p90: 22 },
      },
      derived: {
        reading_time_minutes: 0.5,
        lexical_diversity: 0.65,
        lexical_diversity_label: 'high',
        content_to_chrome_ratio: 0.4,
      },
      structure: {
        h1_count: 1, h2_count: 2, h3_count: 0, h4plus_count: 0,
        heading_hierarchy_valid: true, skipped_levels: [],
        lists_ordered: 0, lists_unordered: 1, list_items_total: 3,
        tables: 0, table_details: [], code_blocks: 0, inline_code: 0, blockquotes: 0,
      },
      media: { image_count: 2, images_with_alt: 1, images_missing_alt: 1, alt_coverage: 0.5 },
      links: { total: 2, internal: 1, external: 1, naked_urls: 0 },
      duplication: { duplicate_paragraphs: 0, duplicate_sentences: 0 },
      patterns: { year_mentions: [2024, 2025], percentage_count: 1, url_in_body_count: 0 },
    },
    outline: [{ level: 1, text: 'Hello', children: [{ level: 2, text: 'Sub', children: [] }] }],
    link_inventory: [{ url: 'https://example.com/a', anchor: 'A', internal: true }],
    image_inventory: [{ src: '/img.png', alt: 'An image' }],
    body: 'x'.repeat(bodyLen),
  };
}

describe('sgnl content — rewritten command', () => {
  let stdoutWriteSpy: jest.SpiedFunction<typeof process.stdout.write>;
  let exitSpy: jest.SpiedFunction<typeof process.exit>;
  let consoleLogSpy: jest.SpiedFunction<typeof console.log>;
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>;
  let captured: string;

  beforeEach(() => {
    captured = '';
    stdoutWriteSpy = jest.spyOn(process.stdout, 'write').mockImplementation((chunk: any, _enc?: any, cb?: any) => {
      captured += typeof chunk === 'string' ? chunk : chunk.toString();
      if (typeof _enc === 'function') _enc();
      else if (typeof cb === 'function') cb();
      return true;
    });
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(((_code?: number) => undefined) as any);
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    mockSafeFetch.mockResolvedValue({
      status: 200,
      html: '<html><head><title>Test</title><meta name="description" content="desc"></head><body><h1>Hi</h1><p>one two three</p></body></html>',
      headers: { 'content-type': 'text/html; charset=utf-8', 'content-length': '42' },
      ttfb_ms: 120,
      redirect_chain: [],
      error: null,
    });
    mockRunPy.mockImplementation(async (script: string) => {
      if (script === 'split.py') {
        return { success: true, data: { markdown: '# Test\n\nHello world.' } as any };
      }
      if (script === 'content_extract.py') {
        return { success: true, data: makeExtractPayload(200) as any };
      }
      return { success: false, error: 'unknown script' };
    });
  });

  afterEach(() => {
    stdoutWriteSpy.mockRestore();
    exitSpy.mockRestore();
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    jest.clearAllMocks();
  });

  function parseCapturedJson(): any {
    const jsonStart = captured.indexOf('{');
    expect(jsonStart).toBeGreaterThanOrEqual(0);
    return JSON.parse(captured.slice(jsonStart));
  }

  it('emits { request, content } with all 8 request fields when --output json', async () => {
    const program = new Command();
    program.exitOverride();
    registerContentCommand(program);

    await program.parseAsync(['node', 'sgnl', 'content', 'https://example.com', '--output', 'json']);
    await new Promise((r) => setImmediate(r));

    const parsed = parseCapturedJson();
    expect(parsed).toHaveProperty('request');
    expect(parsed).toHaveProperty('content');
    expect(parsed.request.url).toBe('https://example.com');
    expect(parsed.request.final_url).toBe('https://example.com');
    expect(parsed.request.status).toBe(200);
    expect(parsed.request.ttfb_ms).toBe(120);
    expect(parsed.request.content_type).toBe('text/html; charset=utf-8');
    expect(parsed.request.content_length).toBe(42);
    expect(parsed.request.device).toBe('mobile');
    expect(parsed.request.redirect_chain).toEqual([]);

    // Content payload carries the new shape.
    expect(parsed.content.metadata.detected_language).toBe('en');
    expect(parsed.content.stats.volume.word_count).toBe(100);
    expect(parsed.content.stats.derived.reading_time_minutes).toBe(0.5);
    expect(parsed.content.outline).toBeDefined();
    expect(parsed.content.link_inventory).toBeDefined();
    expect(parsed.content.image_inventory).toBeDefined();
    expect(parsed.content.body).toBeDefined();
  });

  it('--stats-only omits body, outline, link_inventory, image_inventory', async () => {
    const program = new Command();
    program.exitOverride();
    registerContentCommand(program);

    await program.parseAsync(['node', 'sgnl', 'content', 'https://example.com', '--output', 'json', '--stats-only']);
    await new Promise((r) => setImmediate(r));

    const parsed = parseCapturedJson();
    expect(parsed.content.stats).toBeDefined();
    expect(parsed.content.body).toBeUndefined();
    expect(parsed.content.outline).toBeUndefined();
    expect(parsed.content.link_inventory).toBeUndefined();
    expect(parsed.content.image_inventory).toBeUndefined();
  });

  it('--body-only emits metadata + body only', async () => {
    const program = new Command();
    program.exitOverride();
    registerContentCommand(program);

    await program.parseAsync(['node', 'sgnl', 'content', 'https://example.com', '--output', 'json', '--body-only']);
    await new Promise((r) => setImmediate(r));

    const parsed = parseCapturedJson();
    expect(parsed.content.metadata).toBeDefined();
    expect(typeof parsed.content.body).toBe('string');
    expect(parsed.content.stats).toBeUndefined();
    expect(parsed.content.outline).toBeUndefined();
    expect(parsed.content.link_inventory).toBeUndefined();
    expect(parsed.content.image_inventory).toBeUndefined();
  });

  it('--max-body-chars truncates the body and sets body_truncated: true', async () => {
    const program = new Command();
    program.exitOverride();
    registerContentCommand(program);

    // Payload body is 200 chars; truncate to 50.
    await program.parseAsync([
      'node', 'sgnl', 'content', 'https://example.com',
      '--output', 'json', '--max-body-chars', '50',
    ]);
    await new Promise((r) => setImmediate(r));

    const parsed = parseCapturedJson();
    expect(parsed.content.body.length).toBe(50);
    expect(parsed.content.body_truncated).toBe(true);
  });

  it('--max-body-chars leaves body alone when under the limit', async () => {
    const program = new Command();
    program.exitOverride();
    registerContentCommand(program);

    await program.parseAsync([
      'node', 'sgnl', 'content', 'https://example.com',
      '--output', 'json', '--max-body-chars', '9999',
    ]);
    await new Promise((r) => setImmediate(r));

    const parsed = parseCapturedJson();
    expect(parsed.content.body.length).toBe(200);
    expect(parsed.content.body_truncated).toBeUndefined();
  });

  it('--device desktop flows through into request.device', async () => {
    const program = new Command();
    program.exitOverride();
    registerContentCommand(program);

    await program.parseAsync([
      'node', 'sgnl', 'content', 'https://example.com',
      '--output', 'json', '--device', 'desktop',
    ]);
    await new Promise((r) => setImmediate(r));

    const parsed = parseCapturedJson();
    expect(parsed.request.device).toBe('desktop');
  });

  it('passes raw_html_word_count into content_extract.py meta argv', async () => {
    const program = new Command();
    program.exitOverride();
    registerContentCommand(program);

    await program.parseAsync(['node', 'sgnl', 'content', 'https://example.com', '--output', 'json']);
    await new Promise((r) => setImmediate(r));

    // content_extract.py is the second python call. Inspect its argv (index 3).
    const extractCall = mockRunPy.mock.calls.find(c => c[0] === 'content_extract.py');
    expect(extractCall).toBeDefined();
    const argv1 = extractCall![3];
    expect(typeof argv1).toBe('string');
    const parsedMeta = JSON.parse(argv1!);
    expect(parsedMeta).toHaveProperty('raw_html_word_count');
    expect(typeof parsedMeta.raw_html_word_count).toBe('number');
  });
});
