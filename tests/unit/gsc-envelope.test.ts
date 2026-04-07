/**
 * Envelope-parity tests for `sgnl gsc url`, `sgnl gsc inspect`, and
 * `sgnl gsc sitemaps` (new focused-command subcommands).
 *
 * Mocks the analysis/gsc fetchers + the config loader + the OAuth token
 * helper so the command can be driven programmatically through commander.
 */

import { Command } from 'commander';

jest.mock('../../src/analysis/gsc', () => {
  const actual = jest.requireActual('../../src/analysis/gsc');
  return {
    ...actual,
    fetchSearchAnalytics: jest.fn(),
    fetchURLInspection: jest.fn(),
    fetchSitemaps: jest.fn(),
    fetchAllRankedPages: jest.fn(),
    fetchAllRankedQueries: jest.fn(),
  };
});

jest.mock('../../src/config', () => ({
  loadConfig: jest.fn(() => ({
    gsc: {
      clientId: 'cid',
      clientSecret: 'secret',
      properties: ['sc-domain:example.com'],
    },
  })),
  saveConfig: jest.fn(),
}));

jest.mock('../../src/auth/google-oauth', () => ({
  runOAuthFlow: jest.fn(),
  removeTokens: jest.fn(),
  loadTokens: jest.fn(() => ({ refresh_token: 'refresh' })),
  getAccessToken: jest.fn(() => Promise.resolve('access')),
  fetchGSCProperties: jest.fn(),
}));

import {
  fetchSearchAnalytics,
  fetchURLInspection,
  fetchSitemaps,
  fetchAllRankedPages,
  fetchAllRankedQueries,
} from '../../src/analysis/gsc';
import { registerGSCCommand } from '../../src/commands/gsc';

const mockFetchSearchAnalytics = fetchSearchAnalytics as jest.MockedFunction<typeof fetchSearchAnalytics>;
const mockFetchURLInspection = fetchURLInspection as jest.MockedFunction<typeof fetchURLInspection>;
const mockFetchSitemaps = fetchSitemaps as jest.MockedFunction<typeof fetchSitemaps>;
const mockFetchAllPages = fetchAllRankedPages as jest.MockedFunction<typeof fetchAllRankedPages>;
const mockFetchAllQueries = fetchAllRankedQueries as jest.MockedFunction<typeof fetchAllRankedQueries>;

describe('sgnl gsc — { request, gsc } envelope', () => {
  let stdoutWriteSpy: jest.SpiedFunction<typeof process.stdout.write>;
  let exitSpy: jest.SpiedFunction<typeof process.exit>;
  let consoleLogSpy: jest.SpiedFunction<typeof console.log>;
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>;
  let captured: string;

  function makeProgram(): Command {
    const program = new Command();
    program.exitOverride();
    registerGSCCommand(program);
    return program;
  }

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
  });

  afterEach(() => {
    stdoutWriteSpy.mockRestore();
    exitSpy.mockRestore();
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    jest.clearAllMocks();
  });

  function parseEnvelope(): any {
    const jsonStart = captured.indexOf('{');
    expect(jsonStart).toBeGreaterThanOrEqual(0);
    return JSON.parse(captured.slice(jsonStart));
  }

  it('gsc url <url> emits { request, gsc: { url, totals, top_queries } }', async () => {
    mockFetchSearchAnalytics.mockResolvedValue({
      total_clicks: 123,
      total_impressions: 4567,
      average_ctr: 0.0269,
      average_position: 4.3,
      top_queries: [
        { query: 'seo tips', clicks: 50, impressions: 1000, ctr: 0.05, position: 3.1 },
      ],
    });

    const program = makeProgram();
    await program.parseAsync([
      'node', 'sgnl', 'gsc', 'url',
      'https://example.com/blog',
      '--output', 'json',
    ]);
    await new Promise((r) => setImmediate(r));

    const parsed = parseEnvelope();
    expect(parsed).toHaveProperty('request');
    expect(parsed).toHaveProperty('gsc');
    expect(parsed.request.property).toBe('sc-domain:example.com');
    expect(parsed.request.dimensions).toEqual(['page', 'query']);
    expect(parsed.request.search_type).toBe('web');
    expect(parsed.request.date_range.days).toBe(28);
    expect(parsed.request.url).toBe('https://example.com/blog');
    expect(parsed.gsc.url).toBe('https://example.com/blog');
    expect(parsed.gsc.totals.clicks).toBe(123);
    expect(parsed.gsc.totals.impressions).toBe(4567);
    expect(parsed.gsc.top_queries.length).toBe(1);
    expect(parsed.gsc.top_queries[0].query).toBe('seo tips');
  });

  it('gsc url honours --days, --country, --device, --search-type', async () => {
    mockFetchSearchAnalytics.mockResolvedValue({
      total_clicks: 0,
      total_impressions: 0,
      average_ctr: 0,
      average_position: 0,
      top_queries: [],
    });

    const program = makeProgram();
    await program.parseAsync([
      'node', 'sgnl', 'gsc', 'url',
      'https://example.com/x',
      '--output', 'json',
      '--days', '7',
      '--country', 'usa',
      '--device', 'mobile',
      '--search-type', 'image',
    ]);
    await new Promise((r) => setImmediate(r));

    const parsed = parseEnvelope();
    expect(parsed.request.date_range.days).toBe(7);
    expect(parsed.request.filters.country).toBe('usa');
    expect(parsed.request.filters.device).toBe('mobile');
    expect(parsed.request.search_type).toBe('image');

    // Verify the flags were threaded into the fetcher call.
    const call = mockFetchSearchAnalytics.mock.calls[0];
    const optsArg = call[3] as any;
    expect(optsArg.dateRange.days).toBe(7);
    expect(optsArg.filters).toEqual({ country: 'usa', device: 'mobile' });
    expect(optsArg.searchType).toBe('image');
  });

  it('gsc inspect <url> emits { request, gsc: { url, inspection } }', async () => {
    mockFetchURLInspection.mockResolvedValue({
      verdict: 'PASS',
      coverage_state: 'Submitted and indexed',
      is_page_indexed: true,
      crawl_timestamp: '2026-04-01T12:00:00Z',
      google_canonical: 'https://example.com/blog',
      rich_results: ['Article'],
    });

    const program = makeProgram();
    await program.parseAsync([
      'node', 'sgnl', 'gsc', 'inspect',
      'https://example.com/blog',
      '--output', 'json',
    ]);
    await new Promise((r) => setImmediate(r));

    const parsed = parseEnvelope();
    expect(parsed.request.property).toBe('sc-domain:example.com');
    expect(parsed.gsc.url).toBe('https://example.com/blog');
    expect(parsed.gsc.inspection.verdict).toBe('PASS');
    expect(parsed.gsc.inspection.is_page_indexed).toBe(true);
    expect(parsed.gsc.inspection.rich_results).toEqual(['Article']);
  });

  it('gsc sitemaps emits { request, gsc: { sitemaps } }', async () => {
    mockFetchSitemaps.mockResolvedValue([
      { path: 'https://example.com/sitemap.xml', errors: 0, warnings: 2, last_downloaded: '2026-04-01T00:00:00Z' },
      { path: 'https://example.com/news.xml', errors: 1, warnings: 0 },
    ]);

    const program = makeProgram();
    await program.parseAsync([
      'node', 'sgnl', 'gsc', 'sitemaps',
      '--output', 'json',
    ]);
    await new Promise((r) => setImmediate(r));

    const parsed = parseEnvelope();
    expect(parsed.request.property).toBe('sc-domain:example.com');
    expect(Array.isArray(parsed.gsc.sitemaps)).toBe(true);
    expect(parsed.gsc.sitemaps.length).toBe(2);
    expect(parsed.gsc.sitemaps[0].warnings).toBe(2);
  });

  it('gsc pages forwards --days + --country + --device into the fetcher and emits envelope', async () => {
    mockFetchAllPages.mockResolvedValue([
      { page: 'https://example.com/a', clicks: 10, impressions: 100, ctr: 0.1, position: 2.1 },
    ]);

    const program = makeProgram();
    await program.parseAsync([
      'node', 'sgnl', 'gsc', 'pages',
      '--output', 'json',
      '--days', '14',
      '--country', 'deu',
      '--device', 'desktop',
      '--limit', '10',
    ]);
    await new Promise((r) => setImmediate(r));

    const parsed = parseEnvelope();
    expect(parsed.request.dimensions).toEqual(['page']);
    expect(parsed.request.date_range.days).toBe(14);
    expect(parsed.request.filters).toEqual({ country: 'deu', device: 'desktop' });
    expect(parsed.gsc.pages.length).toBe(1);
    expect(parsed.gsc.totals.clicks).toBe(10);

    const optsArg = mockFetchAllPages.mock.calls[0][2] as any;
    expect(optsArg.filters).toEqual({ country: 'deu', device: 'desktop' });
    expect(optsArg.dateRange.days).toBe(14);
    expect(optsArg.limit).toBe(10);
  });

  it('gsc queries --json alias maps to json output', async () => {
    mockFetchAllQueries.mockResolvedValue([
      { query: 'foo', clicks: 5, impressions: 50, ctr: 0.1, position: 3 },
    ]);

    const program = makeProgram();
    await program.parseAsync([
      'node', 'sgnl', 'gsc', 'queries',
      '--json',
      '--limit', '5',
    ]);
    await new Promise((r) => setImmediate(r));

    const parsed = parseEnvelope();
    expect(parsed.gsc.queries.length).toBe(1);
    expect(parsed.request.dimensions).toEqual(['query']);
  });
});
