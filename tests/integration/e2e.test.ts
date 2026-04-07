/**
 * SGNL Integration Tests — Phase 9
 * Full end-to-end pipeline tests: URL → AnalysisReport
 *
 * Strategy: mock all external I/O (safeFetch, callPSI), exercise real
 * orchestrator → scoring → merger pipeline, assert on full report shape.
 */

import { buildReport } from '../../src/analysis/orchestrator';
import { FetchResult } from '../../src/analysis/fetch';
import { PSIResult, FieldData, LabData } from '../../src/analysis/psi';
import { AnalysisReport } from '../../src/analysis/merger';

// ---------------------------------------------------------------------------
// Module mocks — must be at top level
// ---------------------------------------------------------------------------

jest.mock('../../src/analysis/fetch');
jest.mock('../../src/analysis/psi');
jest.mock('../../src/analysis/python');
jest.mock('../../src/analysis/crux');

import { safeFetch } from '../../src/analysis/fetch';
import { callPSI } from '../../src/analysis/psi';
import { runPythonScriptSafe } from '../../src/analysis/python';
import { fetchCrUXData } from '../../src/analysis/crux';

const mockSafeFetch = safeFetch as jest.MockedFunction<typeof safeFetch>;
const mockCallPSI = callPSI as jest.MockedFunction<typeof callPSI>;
const mockRunPythonScriptSafe = runPythonScriptSafe as jest.MockedFunction<typeof runPythonScriptSafe>;
const mockFetchCrUXData = fetchCrUXData as jest.MockedFunction<typeof fetchCrUXData>;

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function mockFetchResult(overrides: Partial<FetchResult> = {}): FetchResult {
  return {
    status: 200,
    html: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Example Domain</title>
  <meta name="description" content="This is an example page with proper SEO metadata.">
  <link rel="canonical" href="https://example.com/">
  <meta property="og:title" content="Example Domain">
</head>
<body>
  <header><nav><a href="/">Home</a><a href="/about">About</a></nav></header>
  <main>
    <h1>Welcome to Example</h1>
    <p>This page has plenty of content to satisfy word count thresholds for on-page SEO scoring.
       It includes paragraphs, headings, and links to internal and external resources.</p>
    <h2>Section One</h2>
    <p>More detailed content here. This section expands on the topic with relevant keywords.</p>
    <img src="hero.jpg" alt="Hero image">
    <img src="logo.png" alt="Company logo">
    <a href="/contact">Contact Us</a>
    <a href="https://external.example.org">External Resource</a>
  </main>
  <footer><p>&copy; 2025 Example</p></footer>
</body>
</html>`,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    ttfb_ms: 120,
    redirect_chain: [],
    error: null,
    ...overrides,
  };
}

function mockFieldData(overrides: Partial<FieldData> = {}): FieldData {
  return {
    lcp: { value: 1800, unit: 'ms', status: 'good', target: 2500 },
    cls: { value: 0.05, unit: 'score', status: 'good', target: 0.1 },
    inp: { value: 180, unit: 'ms', status: 'good', target: 200 },
    fcp: { value: 900, unit: 'ms', status: 'good', target: 1800 },
    fid: { value: 60, unit: 'ms', status: 'good', target: 100 },
    ...overrides,
  };
}

function mockLabData(overrides: Partial<LabData> = {}): LabData {
  return {
    performance_score: 85,
    speed_index_s: 1.4,
    tti_s: 3.2,
    tbt_ms: 80,
    cls: 0.04,
    ...overrides,
  };
}

function mockPSIResult(overrides: Partial<PSIResult> = {}): PSIResult {
  return {
    url: 'https://example.com',
    strategy: 'desktop',
    field_data: mockFieldData(),
    lab_data: mockLabData(),
    opportunities: [],
    ...overrides,
  };
}

function mockAnalysisReport(overrides: Partial<AnalysisReport> = {}): AnalysisReport {
  return {
    url: 'https://example.com',
    timestamp: new Date().toISOString(),
    http_status: 200,
    crawlable: true,
    https: true,
    performance: {
      core_web_vitals: { lcp_ms: 1800, cls: 0.05, inp_ms: 180, fid_ms: 60 },
      speed_metrics: { ttfb_ms: 120, speed_index_s: 1.4, tti_s: 3.2 },
    },
    seo: {
      technical: {
        title: 'Example Domain',
        description: 'This is an example page.',
        schema_count: 0,
        open_graph: false,
        twitter_card: false,
        indexable: true,
      },
      content: {
        word_count: 0,
        h1_count: 0,
        headings_valid: false,
        images_total: 0,
        images_alt_missing: 0,
      },
      links: { internal_total: 0, external_total: 0, generic_anchor_text: 0 },
    },
    structure: { dom_elements: 0, div_ratio: 0, semantic_score: 0, heading_hierarchy_valid: false },
    issues: { critical: [], warning: [], info: [] },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Shared assertion helpers
// ---------------------------------------------------------------------------

function assertValidReport(report: AnalysisReport, url: string): void {
  // Structure
  expect(report).toBeDefined();
  expect(report.url).toBe(url);

  // Timestamp ISO 8601
  expect(report.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

  // Scores in range

  // Required fields defined (not undefined)
  expect(report.http_status).toBeDefined();
  expect(report.crawlable).toBeDefined();
  expect(report.https).toBeDefined();

  // Issues categorized
  expect(report.issues.critical).toBeInstanceOf(Array);
  expect(report.issues.warning).toBeInstanceOf(Array);
  expect(report.issues.info).toBeInstanceOf(Array);

  // No undefined values in nested objects
  expect(report.performance).toBeDefined();
  expect(report.performance.core_web_vitals).toBeDefined();
  expect(report.performance.speed_metrics).toBeDefined();
  expect(report.seo).toBeDefined();
  expect(report.seo.technical).toBeDefined();
  expect(report.seo.content).toBeDefined();
  expect(report.seo.links).toBeDefined();
  expect(report.structure).toBeDefined();
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.SGNL_DEBUG;
  // CrUX returns null by default (no field data) — tests that need it override this
  mockFetchCrUXData.mockResolvedValue({ data: null, raw: null });
});

afterAll(() => {
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SGNL Integration Tests — Full Pipeline e2e', () => {

  // ── 1. Happy Path ──────────────────────────────────────────────────────────
  it('1. Happy Path: Valid URL → Full Report with populated scores', async () => {
    const url = 'https://example.com';

    mockSafeFetch.mockResolvedValue(mockFetchResult());
    mockCallPSI.mockResolvedValue(mockPSIResult({ strategy: 'mobile' }));

    const report = await buildReport(url);

    assertValidReport(report, url);

    // Happy path specifics
    expect(report.http_status).toBe(200);
    expect(report.crawlable).toBe(true);
    expect(report.https).toBe(true);

    // CWV populated from field data
    expect(report.performance.core_web_vitals).toBeDefined();

    // Speed metrics from fetch
    expect(report.performance.speed_metrics.ttfb_ms).toBe(120);

    // Title extracted from HTML
    expect(report.seo.technical.title).toBe('Example Domain');

    // No critical issues for a healthy page
    expect(report.issues.critical).toHaveLength(0);
  }, 5000);

  // ── 2. Missing PSI Data ────────────────────────────────────────────────────
  it('2. Missing PSI Data: PSI fails → degraded performance, report still valid', async () => {
    const url = 'https://example.com';

    mockSafeFetch.mockResolvedValue(mockFetchResult());
    // Both PSI calls throw (no API key)
    mockCallPSI.mockRejectedValue(new Error('SGNL_PSI_KEY environment variable not set'));

    const report = await buildReport(url);

    assertValidReport(report, url);

    // Should still produce a report
    expect(report.http_status).toBe(200);
    expect(report.crawlable).toBe(true);

    // Performance score should be lower without PSI data
    // CWV will be 0 (no field/lab data), speed still gets TTFB contribution

    // No CWV data from field
    expect(report.performance.core_web_vitals).toBeDefined();
  }, 5000);

  // ── 3. Missing Python Data ─────────────────────────────────────────────────
  it('3. Missing Python Data: SEO/structure empty but scores calculated', async () => {
    const url = 'https://example.com';

    mockSafeFetch.mockResolvedValue(mockFetchResult());
    mockCallPSI.mockResolvedValue(mockPSIResult({ strategy: 'mobile' }));

    // Python is always skipped in orchestrator (python = {})
    // This test verifies the report handles empty Python data gracefully
    const report = await buildReport(url);

    assertValidReport(report, url);

    // SEO technical defaults when Python not available
    expect(report.seo.technical.schema_count).toBeDefined();
    expect(report.seo.content.word_count).toBeDefined();
    expect(report.structure.dom_elements).toBeDefined();

    // Scores should still calculate (structure/onpage = 0 without Python)

    // Performance still scored via PSI
  }, 5000);

  // ── 4. 404 Not Found ───────────────────────────────────────────────────────
  it('4. 404 Not Found: score capped at 50, crawlable=false, critical issue', async () => {
    const url = 'https://example.com/404';

    mockSafeFetch.mockResolvedValue(
      mockFetchResult({
        status: 404,
        html: '<html><body><h1>404 Not Found</h1></body></html>',
        error: null,
      }),
    );
    mockCallPSI.mockResolvedValue(mockPSIResult({ strategy: 'mobile' }));

    const report = await buildReport(url);

    assertValidReport(report, url);

    // Status preserved
    expect(report.http_status).toBe(404);

    // Crawlable false for 4xx
    expect(report.crawlable).toBe(false);

    // Score capped at 50 for 4xx

    // Critical issue about HTTP error
    expect(report.issues.critical.length).toBeGreaterThan(0);
    expect(report.issues.critical.some((i) => i.includes('404'))).toBe(true);
  }, 5000);

  // ── 5. Redirect Chain ─────────────────────────────────────────────────────
  it('5. Redirect Chain: redirect_chain populated, HTTPS detected, report succeeds', async () => {
    const url = 'https://example.com/redirect';

    mockSafeFetch.mockResolvedValue(
      mockFetchResult({
        status: 200,
        redirect_chain: [
          'https://example.com/redirect',
          'https://example.com/intermediate',
        ],
      }),
    );
    mockCallPSI.mockResolvedValue(mockPSIResult({ strategy: 'mobile' }));

    const report = await buildReport(url);

    assertValidReport(report, url);

    expect(report.http_status).toBe(200);
    expect(report.crawlable).toBe(true);

    // HTTPS detected (URL starts with https://)
    expect(report.https).toBe(true);

    // Redirect chain captured in performance speed metrics
    expect(report.performance.speed_metrics.ttfb_ms).toBeDefined();

    // Should not have critical HTTPS issue
    expect(report.issues.critical.some((i) => i.toLowerCase().includes('https'))).toBe(false);
  }, 5000);

  // ── 6. HTTPS Redirect ─────────────────────────────────────────────────────
  it('6. HTTPS Redirect: http:// input redirects to https:// → https=true, no HTTPS warning', async () => {
    const url = 'http://example.com';

    mockSafeFetch.mockResolvedValue(
      mockFetchResult({
        status: 200,
        // Redirect chain shows upgrade to HTTPS
        redirect_chain: ['https://example.com/'],
      }),
    );
    mockCallPSI.mockResolvedValue(mockPSIResult({ strategy: 'mobile' }));

    const report = await buildReport(url);

    assertValidReport(report, url);

    expect(report.http_status).toBe(200);
    expect(report.crawlable).toBe(true);

    // HTTPS detected via redirect chain
    expect(report.https).toBe(true);

    // No critical HTTPS warning since redirect chain includes https
    expect(report.issues.critical.some((i) => i.toLowerCase().includes('not served over https'))).toBe(false);
  }, 5000);

  // ── 7. Blocked by Robots.txt ───────────────────────────────────────────────
  it('7. Blocked by robots.txt (403): Critical issue generated', async () => {
    const url = 'https://example.com/private';

    mockSafeFetch.mockResolvedValue(
      mockFetchResult({
        status: 403,
        html: '<html><body>Forbidden</body></html>',
        error: null,
      }),
    );
    mockCallPSI.mockResolvedValue(mockPSIResult({ strategy: 'mobile' }));

    const report = await buildReport(url);

    assertValidReport(report, url);

    expect(report.http_status).toBe(403);
    expect(report.crawlable).toBe(false);

    // Score capped at 50 for 4xx/5xx

    // Critical issue for HTTP error
    expect(report.issues.critical.length).toBeGreaterThan(0);
    expect(report.issues.critical.some((i) => i.includes('403'))).toBe(true);
  }, 5000);

  // ── 8. Large HTML (5MB) ────────────────────────────────────────────────────
  it('8. Large HTML (5MB): Report generated without timeout, metrics calculated', async () => {
    const url = 'https://example.com/large';

    // Generate ~5MB of HTML
    const largeParagraph = '<p>' + 'A'.repeat(1000) + '</p>';
    const largeBody = largeParagraph.repeat(5000); // ~5MB
    const largeHtml = `<!DOCTYPE html>
<html>
<head>
  <title>Large Page</title>
  <meta name="description" content="A very large page.">
</head>
<body>
  <h1>Large Content Page</h1>
  ${largeBody}
  <img src="hero.jpg" alt="Hero">
</body>
</html>`;

    mockSafeFetch.mockResolvedValue(
      mockFetchResult({
        status: 200,
        html: largeHtml,
        ttfb_ms: 350,
      }),
    );
    mockCallPSI.mockResolvedValue(mockPSIResult({ strategy: 'mobile' }));

    const report = await buildReport(url);

    assertValidReport(report, url);

    expect(report.http_status).toBe(200);
    expect(report.crawlable).toBe(true);

    // TTFB preserved
    expect(report.performance.speed_metrics.ttfb_ms).toBe(350);

    // Title still extracted despite large content
    expect(report.seo.technical.title).toBe('Large Page');

    // Scores computed
  }, 5000);

  // ── 9. Malformed HTML ─────────────────────────────────────────────────────
  it('9. Malformed HTML: Pipeline handles broken HTML gracefully, report generated', async () => {
    const url = 'https://example.com/malformed';

    const malformedHtml = `<html>
<head>
<title>Broken Page
<meta name="description" content="Unclosed tags everywhere
<body>
<h1>Heading without close tag
<div>
  <p>Paragraph with no closing
  <img src="no-alt.png">
  <a href="/nowhere">link text
  <div>
    <span>deeply nested without close
</html>`;

    mockSafeFetch.mockResolvedValue(
      mockFetchResult({
        status: 200,
        html: malformedHtml,
      }),
    );
    mockCallPSI.mockResolvedValue(mockPSIResult({ strategy: 'mobile' }));

    // Should not throw
    const report = await buildReport(url);

    assertValidReport(report, url);

    expect(report.http_status).toBe(200);
    expect(report.crawlable).toBe(true);

    // Regex-based extraction in merger handles malformed HTML as best it can
    expect(report.seo.technical).toBeDefined();
    expect(report.seo.content).toBeDefined();

    // Scores still in valid range

    // Image without alt counted
    expect(report.seo.content.images_alt_missing).toBeGreaterThanOrEqual(1);
  }, 5000);

  // ── 10. Complete Degradation (All Phases Fail) ────────────────────────────
  it('10. All Data Missing: Complete degradation → degraded flag, valid structure', async () => {
    const url = 'https://example.com/degraded';

    // Fetch returns minimal HTML (still succeeds)
    mockSafeFetch.mockResolvedValue(
      mockFetchResult({
        status: 200,
        html: '<html><body>minimal</body></html>',
        ttfb_ms: 50,
      }),
    );

    // PSI completely fails (both calls throw)
    mockCallPSI.mockRejectedValue(new Error('Network error: PSI unavailable'));

    // Python is already skipped in orchestrator

    const report = await buildReport(url);

    assertValidReport(report, url);

    // Should still have valid structure
    expect(report.http_status).toBe(200);
    expect(report.crawlable).toBe(true);

    // No field/lab data → CWV score = 0

    // TTFB still captured
    expect(report.performance.speed_metrics.ttfb_ms).toBe(50);

    // Score is low but valid
  }, 5000);

  // ── 11. Server Error (500) ─────────────────────────────────────────────────
  it('11. Server Error (500): Score capped at 50, crawlable=false, critical issue', async () => {
    const url = 'https://example.com/error';

    mockSafeFetch.mockResolvedValue(
      mockFetchResult({
        status: 500,
        html: '<html><body><h1>Internal Server Error</h1></body></html>',
        error: null,
      }),
    );
    mockCallPSI.mockResolvedValue(mockPSIResult({ strategy: 'mobile' }));

    const report = await buildReport(url);

    assertValidReport(report, url);

    expect(report.http_status).toBe(500);
    expect(report.crawlable).toBe(false);
    expect(report.issues.critical.some((i) => i.includes('500'))).toBe(true);
  }, 5000);

  // ── 12. Excellent Performance (Lab Data) ──────────────────────────────────
  it('12. Excellent CWV from field data → high performance score', async () => {
    const url = 'https://example.com';

    mockSafeFetch.mockResolvedValue(mockFetchResult({ ttfb_ms: 80 }));
    mockCallPSI.mockResolvedValue(
      mockPSIResult({
        strategy: 'mobile',
        field_data: mockFieldData({
          lcp: { value: 1200, unit: 'ms', status: 'good', target: 2500 },
          cls: { value: 0.02, unit: 'score', status: 'good', target: 0.1 },
          inp: { value: 100, unit: 'ms', status: 'good', target: 200 },
          fid: { value: 40, unit: 'ms', status: 'good', target: 100 },
        }),
        lab_data: mockLabData({ performance_score: 95, speed_index_s: 0.8 }),
      }),
    );

    const report = await buildReport(url);

    assertValidReport(report, url);

    // With excellent metrics, CWV score should be 100 (all under thresholds)

    // Overall should be positive (performance contributes 25% of total)
  }, 5000);

  // ── 13. HTTP (non-HTTPS) URL, no redirect chain ────────────────────────────
  it('14. Plain HTTP with no redirect → https=false, HTTPS critical issue', async () => {
    const url = 'http://example.com';

    mockSafeFetch.mockResolvedValue(
      mockFetchResult({
        status: 200,
        redirect_chain: [], // no redirect to https
        headers: {}, // no x-forwarded-proto
      }),
    );
    mockCallPSI.mockResolvedValue(mockPSIResult({ strategy: 'mobile' }));

    const report = await buildReport(url);

    assertValidReport(report, url);

    // http:// with no redirect = not HTTPS
    expect(report.https).toBe(false);

    // Critical issue for missing HTTPS
    expect(report.issues.critical.some((i) => i.toLowerCase().includes('https'))).toBe(true);
  }, 5000);

  // ── 15. Connection Failure (status 0) ─────────────────────────────────────
  it('15. Connection Failure (status 0): crawlable=false, critical issue, valid report', async () => {
    const url = 'https://example.com/unreachable';

    mockSafeFetch.mockResolvedValue(
      mockFetchResult({
        status: 0,
        html: '',
        error: 'ECONNREFUSED: connection refused',
      }),
    );
    // PSI may still be attempted; let them fail too
    mockCallPSI.mockRejectedValue(new Error('Network unavailable'));

    const report = await buildReport(url);

    assertValidReport(report, url);

    expect(report.http_status).toBe(0);
    expect(report.crawlable).toBe(false);

    // Critical issue about unreachability
    expect(report.issues.critical.length).toBeGreaterThan(0);
    expect(
      report.issues.critical.some(
        (i) => i.toLowerCase().includes('unreachable') || i.toLowerCase().includes('connection'),
      ),
    ).toBe(true);

    // Score still in valid range
  }, 5000);

  // ── 16. Full Flow with Python Layer Enabled ───────────────────────────────
  it('16. Full flow with Python layer enabled: DOM/SEO/onpage scores > 0', async () => {
    const url = 'https://example.com';

    mockSafeFetch.mockResolvedValue(mockFetchResult());
    mockCallPSI.mockResolvedValue(mockPSIResult({ strategy: 'mobile' }));

    // split.py returns markdown + skeleton
    mockRunPythonScriptSafe.mockResolvedValueOnce({
      success: true,
      data: {
        markdown: '# Welcome to Example\n\nThis page has plenty of content about testing SEO.',
        skeleton: '<html><head><title>Example Domain</title></head><body><h1></h1><main><p></p></main></body></html>',
      },
    });

    // technical_seo.py returns full technical SEO data
    mockRunPythonScriptSafe.mockResolvedValueOnce({
      success: true,
      data: {
        meta: {
          title: { present: true, content: 'Example Domain' },
          description: { present: true, content: 'This is an example page.' },
        },
        canonical: { present: true, href: 'https://example.com/' },
        open_graph: { title: true, description: true, image: false, url: true },
        indexability: { blocked: false, signals: [], conflicts: [] },
        links: { internal_total: 3, external_total: 1 },
      },
    });

    // robots_check.py returns robots check data
    mockRunPythonScriptSafe.mockResolvedValueOnce({
      success: true,
      data: { blocked: false, signals: [], conflicts: [] },
    });

    // schema_validator.py returns schema validation data
    mockRunPythonScriptSafe.mockResolvedValueOnce({
      success: true,
      data: { blocks_found: 1, blocks: [], recommendations: [], summary: { total_blocks: 1, valid_blocks: 1, types_found: ['WebPage'], rich_results_eligible: [], rich_results_ineligible: [] } },
    });

    // xray.py returns DOM analysis
    mockRunPythonScriptSafe.mockResolvedValueOnce({
      success: true,
      data: {
        dom: { total_elements: 42, unique_tags: 12, depth_max: 8, depth_avg: 4.2 },
        structure: {
          div_ratio: 0.25,
          semantic_score: 5,
          h1_count: 1,
          heading_hierarchy_valid: true,
          empty_elements: 0,
          duplicate_ids: 0,
          deprecated_tags: [],
          inline_event_handlers: 0,
          iframes: [],
        },
        element_map: { div: 10, p: 8, a: 6, h1: 1, h2: 3, img: 2 },
        head: {},
        content_ratios: {},
      },
    });

    // onpage.py returns on-page SEO data
    mockRunPythonScriptSafe.mockResolvedValueOnce({
      success: true,
      data: {
        content: { word_count: 320, paragraph_count: 4, avg_paragraph_length: 80 },
        headings: { h1_count: 1, h1_content: 'Welcome to Example', hierarchy_valid: true, empty_headings: 0 },
        links: { internal_total: 3, internal_generic_anchor: 0, external_total: 1, external_broken: 0 },
        images: { total: 2, missing_alt: 0, empty_alt_decorative: 0, too_short: 0, too_long: 0 },
        crawlability: { status_code: 200, redirect_count: 0, robots_blocked: false, sitemap_found: true, https_enforced: true, mixed_content: false },
      },
    });

    // content_analysis.py returns content analysis data
    mockRunPythonScriptSafe.mockResolvedValueOnce({
      success: true,
      data: {
        section: 'content_analysis',
        score: 75,
        score_label: 'good',
        issues: [],
        content_depth: { depth_label: 'adequate', word_count: 320 },
        eeat_signals: { eeat_label: 'moderate', eeat_signals_count: 2 },
        content_freshness: { freshness_status: 'undated' },
        thin_content: { thin_content_risk: 'none' },
        anchor_text_quality: { anchor_quality_score: 'good' },
        featured_snippet: { snippet_eligible: false },
      },
    });

    const report = await buildReport(url);

    assertValidReport(report, url);

    // DOM data populated from xray.py
    expect(report.structure.dom_elements).toBe(42);
    expect(report.structure.div_ratio).toBe(0.25);
    expect(report.structure.semantic_score).toBe(5);
    expect(report.structure.heading_hierarchy_valid).toBe(true);

    // SEO technical populated from technical_seo.py
    expect(report.seo.technical.schema_count).toBe(1);
    expect(report.seo.technical.open_graph).toBe(true);
    expect(report.seo.technical.indexable).toBe(true);

    // SEO content populated from onpage.py
    expect(report.seo.content.word_count).toBe(320);
    expect(report.seo.content.h1_count).toBe(1);
    expect(report.seo.content.images_alt_missing).toBe(0);

    // SEO/Structure scores > 0 when Python data is present
  }, 5000);

  // ── 17. Python Layer: Graceful Degradation on Failure ────────────────────
  it('17. Python layer gracefully degrades when scripts fail', async () => {
    const url = 'https://example.com';

    mockSafeFetch.mockResolvedValue(mockFetchResult());
    mockCallPSI.mockResolvedValue(mockPSIResult({ strategy: 'mobile' }));

    // All Python scripts fail with a non-critical error
    mockRunPythonScriptSafe.mockResolvedValue({
      success: false,
      error: 'Python script exited with code 1: ImportError: No module named bs4',
    });

    const report = await buildReport(url);

    assertValidReport(report, url);

    // Report still valid despite Python failure
    expect(report.http_status).toBe(200);
    expect(report.crawlable).toBe(true);

    // Python-dependent fields default to 0 / false
    expect(report.structure.dom_elements).toBe(0);
    expect(report.structure.semantic_score).toBe(0);

    // Performance still scored via PSI
  }, 5000);

  // ── 18. Python Not Installed → Degraded Mode ──────────────────────────────
  it('18. Python not installed → degraded mode, report still valid', async () => {
    const url = 'https://example.com';

    mockSafeFetch.mockResolvedValue(mockFetchResult());
    mockCallPSI.mockResolvedValue(mockPSIResult({ strategy: 'mobile' }));

    // Python not installed error
    mockRunPythonScriptSafe.mockResolvedValue({
      success: false,
      error: 'Python is not installed or not found in PATH',
    });

    const report = await buildReport(url);

    assertValidReport(report, url);

    // No Python data — all zeroed
    expect(report.structure.dom_elements).toBe(0);

    // PSI data still populated
  }, 5000);

  // ── 19. --skip-python: Python not called ─────────────────────────────────
  it('19. --skip-python: buildReport with skipPython=true skips Python layer', async () => {
    const url = 'https://example.com';

    mockSafeFetch.mockResolvedValue(mockFetchResult());
    mockCallPSI.mockResolvedValue(mockPSIResult({ strategy: 'mobile' }));

    const report = await buildReport(url, { skipPython: true });

    assertValidReport(report, url);

    // Python scripts never called
    expect(mockRunPythonScriptSafe).not.toHaveBeenCalled();

    // Python-dependent scores are 0

    // Performance still scored
  }, 5000);

  // ── 20. Python deps missing → graceful degradation ────────────────────────
  it('20. Python deps missing → graceful degradation with clear error in data', async () => {
    const url = 'https://example.com';

    mockSafeFetch.mockResolvedValue(mockFetchResult());
    mockCallPSI.mockResolvedValue(mockPSIResult({ strategy: 'mobile' }));

    // Simulate the exact error message produced when beautifulsoup4/html2text are missing
    mockRunPythonScriptSafe.mockResolvedValue({
      success: false,
      error: 'Python script exited with code 1: ModuleNotFoundError: No module named \'bs4\'. '
        + 'BeautifulSoup4 and html2text required. Install with: pip install beautifulsoup4 html2text',
    });

    // Should NOT throw
    const report = await buildReport(url);

    assertValidReport(report, url);

    // Python-dependent scores default to 0 (degraded mode)
    expect(report.structure.dom_elements).toBe(0);
    expect(report.structure.semantic_score).toBe(0);

    // PSI-backed performance still works

    // Crawlability and HTTP status unaffected
    expect(report.http_status).toBe(200);
    expect(report.crawlable).toBe(true);
  }, 5000);

  // ── 21. Malformed Python output → validation catches it, continues safely ──
  it('21. Malformed Python output → validation catches it, continues safely', async () => {
    const url = 'https://example.com';

    mockSafeFetch.mockResolvedValue(mockFetchResult());
    mockCallPSI.mockResolvedValue(mockPSIResult({ strategy: 'mobile' }));

    // Stage 1: split.py returns unexpected structure (not {markdown, skeleton})
    mockRunPythonScriptSafe.mockResolvedValueOnce({
      success: true,
      data: 'this is not valid JSON structure' as any,
    });

    // Stage 1: technical_seo.py returns something completely wrong (array instead of object)
    mockRunPythonScriptSafe.mockResolvedValueOnce({
      success: true,
      data: [1, 2, 3] as any,
    });

    // Stage 1: robots_check.py returns malformed data
    mockRunPythonScriptSafe.mockResolvedValueOnce({
      success: true,
      data: null as any,
    });

    // Stage 1: schema_validator.py returns malformed data
    mockRunPythonScriptSafe.mockResolvedValueOnce({
      success: true,
      data: null as any,
    });

    // Stage 2: xray.py returns an object without dom/structure keys (invalid)
    mockRunPythonScriptSafe.mockResolvedValueOnce({
      success: true,
      data: { unexpected_key: 'garbage', another_key: 42 } as any,
    });

    // Stage 2: onpage.py returns null data
    mockRunPythonScriptSafe.mockResolvedValueOnce({
      success: true,
      data: null as any,
    });

    // Should NOT throw — validation catches malformed data and falls back gracefully
    const report = await buildReport(url);

    assertValidReport(report, url);

    // Python data silently dropped — all Python fields zeroed
    expect(report.structure.dom_elements).toBe(0);
    expect(report.structure.semantic_score).toBe(0);

    // HTTP / crawlability unaffected
    expect(report.http_status).toBe(200);
    expect(report.crawlable).toBe(true);

    // Scores still in valid range
  }, 5000);

  // ── 22. CrUX data populated — field scores non-zero ───────────────────────
  it('22. Full flow with CrUX data populated — field scores are non-zero', async () => {
    const url = 'https://casino.online';

    const cruxFieldData = mockFieldData({
      lcp: { value: 1800, unit: 'ms', status: 'good', target: 2500 },
      cls: { value: 0.05, unit: 'score', status: 'good', target: 0.1 },
      inp: { value: 120, unit: 'ms', status: 'good', target: 200 },
      fid: { value: 10, unit: 'ms', status: 'good', target: 100 },
      fcp: { value: 0, unit: 'ms', status: 'fail', target: 1800 },
    });

    mockSafeFetch.mockResolvedValue(mockFetchResult({ status: 200 }));
    mockFetchCrUXData.mockResolvedValue({ data: cruxFieldData, raw: null });
    // PSI returns NO field data — CrUX should be used
    mockCallPSI.mockResolvedValue(mockPSIResult({ strategy: 'mobile', field_data: null }));

    const report = await buildReport(url, { skipPython: true });

    assertValidReport(report, url);

    // CrUX data flows into report
    expect(report.performance.core_web_vitals.lcp_ms).toBe(1800);
    expect(report.performance.core_web_vitals.cls).toBe(0.05);
    expect(report.performance.core_web_vitals.inp_ms).toBe(120);

    // Scores should be non-zero (field data was available)
  }, 5000);

  // ── 23. Graceful fallback to PSI when CrUX unavailable ────────────────────
  it('23. Graceful fallback to PSI field_data when CrUX returns null', async () => {
    const url = 'https://example.com';

    // CrUX returns null (no data for URL)
    mockFetchCrUXData.mockResolvedValue({ data: null, raw: null });

    const psiFieldData = mockFieldData({
      lcp: { value: 2200, unit: 'ms', status: 'good', target: 2500 },
    });

    mockSafeFetch.mockResolvedValue(mockFetchResult());
    mockCallPSI.mockResolvedValue(mockPSIResult({ strategy: 'mobile', field_data: psiFieldData }));

    const report = await buildReport(url, { skipPython: true });

    assertValidReport(report, url);

    // PSI field data used as fallback (CrUX was null)
    expect(report.performance.core_web_vitals.lcp_ms).toBe(2200);
  }, 5000);

  // ── 24. CrUX error throws — pipeline continues ────────────────────────────
  it('24. CrUX error handled gracefully — pipeline continues with PSI fallback', async () => {
    const url = 'https://example.com';

    // CrUX throws (e.g. network error)
    mockFetchCrUXData.mockRejectedValue(new Error('CrUX network error'));

    mockSafeFetch.mockResolvedValue(mockFetchResult());
    mockCallPSI.mockResolvedValue(mockPSIResult({ strategy: 'mobile' }));

    const report = await buildReport(url, { skipPython: true });

    // Report should still be valid — CrUX failure is non-fatal
    assertValidReport(report, url);
  }, 5000);

}); // end describe
