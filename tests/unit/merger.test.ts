import { mergeAnalysis, PythonAnalysis, AnalysisReport } from '../../src/analysis/merger';
import { FetchResult } from '../../src/analysis/fetch';
import { PSIResult, FieldData, LabData } from '../../src/analysis/psi';
import { DOMAnalysis, TechnicalSEO, OnPageSEO } from '../../src/analysis/scoring';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function mockFetch(overrides: Partial<FetchResult> = {}): FetchResult {
  return {
    status: 200,
    html: `
      <html>
        <head>
          <title>Test Page Title</title>
          <meta name="description" content="Test page description">
          <link rel="canonical" href="https://example.com/">
        </head>
        <body>
          <h1>Main Heading</h1>
          <p>Some content text here with enough words to pass the word count check.</p>
          <img src="logo.png" alt="Logo">
          <img src="banner.png">
          <a href="/about">About</a>
          <a href="https://external.com">External</a>
        </body>
      </html>
    `,
    headers: { 'content-type': 'text/html', 'content-encoding': 'gzip' },
    ttfb_ms: 120,
    redirect_chain: [],
    cdnDetected: 'cloudflare',
    compression: 'gzip',
    error: null,
    ...overrides,
  };
}

function mockFieldData(overrides: Partial<FieldData> = {}): FieldData {
  return {
    lcp: { value: 2000, unit: 'ms', status: 'good', target: 2500 },
    cls: { value: 0.05, unit: 'score', status: 'good', target: 0.1 },
    inp: { value: 150, unit: 'ms', status: 'good', target: 200 },
    fcp: { value: 900, unit: 'ms', status: 'good', target: 1800 },
    fid: { value: 60, unit: 'ms', status: 'good', target: 100 },
    ...overrides,
  };
}

function mockLabData(overrides: Partial<LabData> = {}): LabData {
  return {
    performance_score: 88,
    speed_index_s: 1.2,
    tti_s: 3.5,
    tbt_ms: 100,
    cls: 0.04,
    ...overrides,
  };
}

function mockPSI(overrides: Partial<PSIResult> = {}): PSIResult {
  return {
    url: 'https://example.com',
    strategy: 'mobile',
    field_data: mockFieldData(),
    lab_data: mockLabData(),
    opportunities: [],
    ...overrides,
  };
}

function mockTechnicalSEO(overrides: Partial<TechnicalSEO> = {}): TechnicalSEO {
  return {
    title_present: true,
    description_present: true,
    canonical_present: true,
    open_graph_present: true,
    is_indexable: true,
    ...overrides,
  };
}

function mockOnPageSEO(overrides: Partial<OnPageSEO> = {}): OnPageSEO {
  return {
    h1_count: 1,
    content_word_count: 500,
    image_alt_missing: 1,
    internal_links: 8,
    heading_hierarchy_valid: true,
    has_robots: true,
    ...overrides,
  };
}

function mockDOM(overrides: Partial<DOMAnalysis> = {}): DOMAnalysis {
  return {
    element_count: 120,
    div_ratio: 0.35,
    semantic_score: 5,
    heading_hierarchy_valid: true,
    duplicate_ids: 0,
    inline_event_handlers: 0,
    avg_element_depth: 7,
    ...overrides,
  };
}

function mockPython(overrides: Partial<PythonAnalysis> = {}): PythonAnalysis {
  return {
    technical_seo: mockTechnicalSEO(),
    onpage_seo: mockOnPageSEO(),
    dom: mockDOM(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helper to run merge with defaults
// ---------------------------------------------------------------------------
function runMerge(overrides: {
  url?: string;
  fetch?: FetchResult;
  psi?: PSIResult[];
  python?: PythonAnalysis;
  rawPythonData?: Record<string, any>;
} = {}): AnalysisReport {
  return mergeAnalysis(
    overrides.url ?? 'https://example.com',
    overrides.fetch ?? mockFetch(),
    overrides.psi ?? [mockPSI()],
    overrides.python ?? mockPython(),
    undefined,
    overrides.rawPythonData,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('mergeAnalysis', () => {

  // 1. URL validation in report
  describe('URL', () => {
    it('preserves the URL in the report', () => {
      const report = runMerge({ url: 'https://example.com/page' });
      expect(report.url).toBe('https://example.com/page');
    });

    it('preserves non-https URL as-is', () => {
      const report = runMerge({ url: 'http://example.com' });
      expect(report.url).toBe('http://example.com');
    });
  });

  // 2. HTTP status preserved
  describe('HTTP status', () => {
    it('preserves 200 status', () => {
      const report = runMerge({ fetch: mockFetch({ status: 200 }) });
      expect(report.http_status).toBe(200);
    });

    it('preserves 404 status', () => {
      const report = runMerge({ fetch: mockFetch({ status: 404 }) });
      expect(report.http_status).toBe(404);
    });

    it('preserves 301 status', () => {
      const report = runMerge({ fetch: mockFetch({ status: 301 }) });
      expect(report.http_status).toBe(301);
    });
  });

  // 3. HTTPS detection
  describe('HTTPS detection', () => {
    it('detects https from URL scheme', () => {
      const report = runMerge({ url: 'https://example.com' });
      expect(report.https).toBe(true);
    });

    it('detects non-https when URL is http', () => {
      const report = runMerge({
        url: 'http://example.com',
        fetch: mockFetch({ redirect_chain: [] }),
      });
      expect(report.https).toBe(false);
    });

    it('detects https from redirect chain', () => {
      const report = runMerge({
        url: 'http://example.com',
        fetch: mockFetch({ redirect_chain: ['https://example.com'] }),
      });
      expect(report.https).toBe(true);
    });

    it('detects https from x-forwarded-proto header', () => {
      const report = runMerge({
        url: 'http://example.com',
        fetch: mockFetch({
          redirect_chain: [],
          headers: { 'x-forwarded-proto': 'https' },
        }),
      });
      expect(report.https).toBe(true);
    });
  });

  // 4. CWV extraction (field + lab)
  describe('CWV extraction', () => {
    it('extracts CWV from field data', () => {
      const report = runMerge({
        psi: [mockPSI({ field_data: mockFieldData() })],
      });
      expect(report.performance.core_web_vitals.lcp_ms).toBe(2000);
      expect(report.performance.core_web_vitals.cls).toBe(0.05);
      expect(report.performance.core_web_vitals.inp_ms).toBe(150);
      expect(report.performance.core_web_vitals.fid_ms).toBe(60);
    });

    it('falls back to lab data CLS when no field data', () => {
      const report = runMerge({
        psi: [mockPSI({ field_data: null, lab_data: mockLabData({ cls: 0.12 }) })],
      });
      expect(report.performance.core_web_vitals.cls).toBe(0.12);
      expect(report.performance.core_web_vitals.lcp_ms).toBeUndefined();
    });

    it('returns empty CWV with null cwv_passing when no PSI provided', () => {
      const report = runMerge({ psi: [] });
      // With no PSI we still emit cwv_passing: null so consumers can distinguish
      // "insufficient data" from an actual PASS/FAIL verdict.
      expect(report.performance.core_web_vitals).toEqual({ cwv_passing: null });
    });

    it('prefers mobile PSI over desktop', () => {
      const desktop = mockPSI({ strategy: 'desktop', field_data: mockFieldData({ lcp: { value: 3000, unit: 'ms', status: 'warn', target: 2500 } }) });
      const mobile = mockPSI({ strategy: 'mobile', field_data: mockFieldData({ lcp: { value: 2000, unit: 'ms', status: 'good', target: 2500 } }) });
      const report = runMerge({ psi: [desktop, mobile] });
      expect(report.performance.core_web_vitals.lcp_ms).toBe(2000);
    });
  });

  // 5. Speed metrics extraction
  describe('Speed metrics extraction', () => {
    it('includes ttfb_ms from fetch result', () => {
      const report = runMerge({ fetch: mockFetch({ ttfb_ms: 250 }) });
      expect(report.performance.speed_metrics.ttfb_ms).toBe(250);
    });

    it('includes speed_index_s from lab data', () => {
      const report = runMerge({
        psi: [mockPSI({ lab_data: mockLabData({ speed_index_s: 2.1 }) })],
      });
      expect(report.performance.speed_metrics.speed_index_s).toBe(2.1);
    });

    it('includes tti_s from lab data', () => {
      const report = runMerge({
        psi: [mockPSI({ lab_data: mockLabData({ tti_s: 4.5 }) })],
      });
      expect(report.performance.speed_metrics.tti_s).toBe(4.5);
    });

    it('includes CDN and compression from fetch', () => {
      const report = runMerge({
        fetch: mockFetch({ cdnDetected: 'fastly', compression: 'brotli' }),
      });
      expect(report.performance.cdn).toBe('fastly');
      expect(report.performance.compression).toBe('brotli');
    });

    it('omits cdn/compression when not detected', () => {
      const fetch = mockFetch({});
      delete fetch.cdnDetected;
      delete fetch.compression;
      const report = runMerge({ fetch });
      expect(report.performance.cdn).toBeUndefined();
      expect(report.performance.compression).toBeUndefined();
    });
  });

  // 6. Technical SEO fields populated
  describe('Technical SEO fields', () => {
    it('extracts title from HTML', () => {
      const report = runMerge();
      expect(report.seo.technical.title).toBe('Test Page Title');
    });

    it('extracts description from HTML', () => {
      const report = runMerge();
      expect(report.seo.technical.description).toBe('Test page description');
    });

    it('extracts canonical from HTML', () => {
      const report = runMerge();
      expect(report.seo.technical.canonical).toBe('https://example.com/');
    });

    it('reports schema_count from schema_validation', () => {
      const report = runMerge({
        rawPythonData: { schemaValidation: { blocks_found: 3 } },
      });
      expect(report.seo.technical.schema_count).toBe(3);
    });

    it('reports open_graph from technical_seo', () => {
      const report = runMerge({
        python: mockPython({ technical_seo: mockTechnicalSEO({ open_graph_present: true }) }),
      });
      expect(report.seo.technical.open_graph).toBe(true);
    });

    it('reports indexable from technical_seo', () => {
      const report = runMerge({
        python: mockPython({ technical_seo: mockTechnicalSEO({ is_indexable: true }) }),
      });
      expect(report.seo.technical.indexable).toBe(true);
    });

    it('reports not indexable when is_indexable is false', () => {
      const report = runMerge({
        python: mockPython({ technical_seo: mockTechnicalSEO({ is_indexable: false }) }),
      });
      expect(report.seo.technical.indexable).toBe(false);
    });

    it('defaults indexable to true when technical_seo missing', () => {
      const report = runMerge({
        python: mockPython({ technical_seo: undefined }),
      });
      expect(report.seo.technical.indexable).toBe(true);
    });
  });

  // 7. Content metrics populated
  describe('Content metrics', () => {
    it('reports word_count from onpage_seo', () => {
      const report = runMerge({
        python: mockPython({ onpage_seo: mockOnPageSEO({ content_word_count: 750 }) }),
      });
      expect(report.seo.content.word_count).toBe(750);
    });

    it('reports h1_count from onpage_seo', () => {
      const report = runMerge({
        python: mockPython({ onpage_seo: mockOnPageSEO({ h1_count: 2 }) }),
      });
      expect(report.seo.content.h1_count).toBe(2);
    });

    it('reports headings_valid from dom when onpage missing', () => {
      const report = runMerge({
        python: mockPython({
          onpage_seo: mockOnPageSEO({ heading_hierarchy_valid: undefined }),
          dom: mockDOM({ heading_hierarchy_valid: true }),
        }),
      });
      expect(report.seo.content.headings_valid).toBe(true);
    });

    it('counts total images from HTML', () => {
      const report = runMerge();
      expect(report.seo.content.images_total).toBe(2); // logo.png + banner.png
    });

    it('reports images_alt_missing from onpage_seo when available', () => {
      const report = runMerge({
        python: mockPython({ onpage_seo: mockOnPageSEO({ image_alt_missing: 3 }) }),
      });
      expect(report.seo.content.images_alt_missing).toBe(3);
    });
  });

  // 8. Link metrics populated
  describe('Link metrics', () => {
    it('reports internal_total from onpage_seo', () => {
      const report = runMerge({
        python: mockPython({ onpage_seo: mockOnPageSEO({ internal_links: 15 }) }),
      });
      expect(report.seo.links.internal_total).toBe(15);
    });

    it('counts external links from HTML', () => {
      const report = runMerge();
      expect(report.seo.links.external_total).toBeGreaterThanOrEqual(1); // external.com
    });

    it('reports generic_anchor_text defaulting to 0', () => {
      const report = runMerge();
      expect(report.seo.links.generic_anchor_text).toBe(0);
    });
  });

  // 10. Issues categorized
  describe('Issues categorization', () => {
    it('adds critical issue for 4xx status', () => {
      const report = runMerge({ fetch: mockFetch({ status: 404 }) });
      expect(report.issues.critical.some(i => i.includes('404'))).toBe(true);
    });

    it('adds critical issue for 5xx status', () => {
      const report = runMerge({ fetch: mockFetch({ status: 500 }) });
      expect(report.issues.critical.some(i => i.includes('500'))).toBe(true);
    });

    it('adds critical issue when blocked by robots (is_indexable false)', () => {
      const report = runMerge({
        python: mockPython({ technical_seo: mockTechnicalSEO({ is_indexable: false }) }),
      });
      expect(report.issues.critical.some(i => i.toLowerCase().includes('block'))).toBe(true);
    });

    it('adds critical issue for missing title', () => {
      const report = runMerge({
        fetch: mockFetch({ html: '<html><head></head><body></body></html>' }),
        python: mockPython({ technical_seo: mockTechnicalSEO({ title_present: false }) }),
      });
      expect(report.issues.critical.some(i => i.toLowerCase().includes('title'))).toBe(true);
    });

    it('adds critical issue for non-HTTPS site', () => {
      const report = runMerge({
        url: 'http://example.com',
        fetch: mockFetch({ redirect_chain: [] }),
      });
      expect(report.issues.critical.some(i => i.toLowerCase().includes('https'))).toBe(true);
    });

    it('no critical issues for a healthy page', () => {
      const report = runMerge({
        url: 'https://example.com',
        fetch: mockFetch({ status: 200 }),
        python: mockPython({ technical_seo: mockTechnicalSEO({ title_present: true, is_indexable: true }) }),
      });
      expect(report.issues.critical).toHaveLength(0);
    });

    it('adds warning for missing meta description', () => {
      const report = runMerge({
        python: mockPython({ technical_seo: mockTechnicalSEO({ description_present: false }) }),
      });
      expect(report.issues.warning.some(i => i.toLowerCase().includes('description'))).toBe(true);
    });

    it('adds warning for poor LCP (field data)', () => {
      const report = runMerge({
        psi: [mockPSI({
          field_data: mockFieldData({ lcp: { value: 5000, unit: 'ms', status: 'fail', target: 2500 } }),
        })],
      });
      expect(report.issues.warning.some(i => i.toLowerCase().includes('lcp'))).toBe(true);
    });

    it('adds warning for poor CLS', () => {
      const report = runMerge({
        psi: [mockPSI({
          field_data: mockFieldData({ cls: { value: 0.4, unit: 'score', status: 'fail', target: 0.1 } }),
        })],
      });
      expect(report.issues.warning.some(i => i.toLowerCase().includes('cls'))).toBe(true);
    });

    it('adds warning for missing H1', () => {
      const report = runMerge({
        python: mockPython({ onpage_seo: mockOnPageSEO({ h1_count: 0 }) }),
      });
      expect(report.issues.warning.some(i => i.toLowerCase().includes('h1'))).toBe(true);
    });

    it('adds warning for images missing alt text', () => {
      const report = runMerge({
        python: mockPython({ onpage_seo: mockOnPageSEO({ image_alt_missing: 5 }) }),
      });
      expect(report.issues.warning.some(i => i.toLowerCase().includes('alt'))).toBe(true);
    });

    it('adds warning for multiple H1s', () => {
      const report = runMerge({
        python: mockPython({ onpage_seo: mockOnPageSEO({ h1_count: 3 }) }),
      });
      expect(report.issues.warning.some(i => i.toLowerCase().includes('h1'))).toBe(true);
    });

    it('adds info for low word count', () => {
      const report = runMerge({
        python: mockPython({ onpage_seo: mockOnPageSEO({ content_word_count: 150 }) }),
      });
      expect(report.issues.info.some(i => i.toLowerCase().includes('word'))).toBe(true);
    });

    it('adds info for high div ratio', () => {
      const report = runMerge({
        python: mockPython({ dom: mockDOM({ div_ratio: 0.85 }) }),
      });
      expect(report.issues.info.some(i => i.toLowerCase().includes('div'))).toBe(true);
    });
  });

  // 11. Timestamp ISO 8601 format
  describe('Timestamp', () => {
    it('has ISO 8601 timestamp', () => {
      const before = new Date().toISOString();
      const report = runMerge();
      const after = new Date().toISOString();

      expect(report.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(report.timestamp >= before).toBe(true);
      expect(report.timestamp <= after).toBe(true);
    });
  });

  // 12. Missing data gracefully handled
  describe('Missing data graceful handling', () => {
    it('handles empty python analysis', () => {
      const report = runMerge({ python: {} });
      expect(report.seo.technical.schema_count).toBe(0);
      expect(report.seo.content.word_count).toBe(0);
      expect(report.structure.dom_elements).toBe(0);
    });

    it('handles empty PSI array', () => {
      const report = runMerge({ psi: [] });
      expect(report.performance.core_web_vitals).toEqual({ cwv_passing: null });
      expect(report.performance.speed_metrics.ttfb_ms).toBe(120); // from fetch
      expect(report.performance.speed_metrics.speed_index_s).toBeUndefined();
    });

    it('handles zero ttfb_ms gracefully', () => {
      const report = runMerge({ fetch: mockFetch({ ttfb_ms: 0 }) });
      expect(report.performance.speed_metrics.ttfb_ms).toBe(0);
    });

    it('handles fetch status 0 (connection failure)', () => {
      const report = runMerge({
        fetch: mockFetch({ status: 0, html: '', redirect_chain: [] }),
      });
      expect(report.http_status).toBe(0);
      expect(report.crawlable).toBe(false);
      expect(report.issues.critical.some(i => i.toLowerCase().includes('unreachable'))).toBe(true);
    });

    it('handles null field_data in PSI', () => {
      expect(() => runMerge({
        psi: [mockPSI({ field_data: null })],
      })).not.toThrow();
    });
  });

  // 13. Raw data optional (not included unless _DEBUG=true)
  describe('Raw data', () => {
    it('does not include _raw by default', () => {
      const originalDebug = process.env._DEBUG;
      delete process.env._DEBUG;

      const report = runMerge();
      expect(report._raw).toBeUndefined();

      if (originalDebug !== undefined) process.env._DEBUG = originalDebug;
    });

    it('includes _raw when _DEBUG env is set', () => {
      process.env._DEBUG = 'true';

      const report = runMerge();
      expect(report._raw).toBeDefined();
      expect(report._raw?.fetch).toBeDefined();
      expect(report._raw?.python).toBeDefined();

      delete process.env._DEBUG;
    });
  });

  // 14. Structure fields
  describe('Structure fields', () => {
    it('populates dom_elements from DOM analysis', () => {
      const report = runMerge({
        python: mockPython({ dom: mockDOM({ element_count: 250 }) }),
      });
      expect(report.structure.dom_elements).toBe(250);
    });

    it('populates div_ratio from DOM analysis', () => {
      const report = runMerge({
        python: mockPython({ dom: mockDOM({ div_ratio: 0.42 }) }),
      });
      expect(report.structure.div_ratio).toBe(0.42);
    });

    it('populates semantic_score from DOM analysis', () => {
      const report = runMerge({
        python: mockPython({ dom: mockDOM({ semantic_score: 6 }) }),
      });
      expect(report.structure.semantic_score).toBe(6);
    });

    it('populates heading_hierarchy_valid from DOM analysis', () => {
      const report = runMerge({
        python: mockPython({ dom: mockDOM({ heading_hierarchy_valid: false }) }),
      });
      expect(report.structure.heading_hierarchy_valid).toBe(false);
    });

    it('defaults structure to zeros when dom is missing', () => {
      const report = runMerge({ python: { ...mockPython(), dom: undefined } });
      expect(report.structure.dom_elements).toBe(0);
      expect(report.structure.div_ratio).toBe(0);
      expect(report.structure.semantic_score).toBe(0);
      expect(report.structure.heading_hierarchy_valid).toBe(false);
    });
  });

  // 15. Crawlability detection
  describe('Crawlability', () => {
    it('marks page as crawlable on 200', () => {
      const report = runMerge({ fetch: mockFetch({ status: 200 }) });
      expect(report.crawlable).toBe(true);
    });

    it('marks page as not crawlable on 404', () => {
      const report = runMerge({ fetch: mockFetch({ status: 404 }) });
      expect(report.crawlable).toBe(false);
    });

    it('marks page as not crawlable when blocked by robots', () => {
      const report = runMerge({
        python: mockPython({ technical_seo: mockTechnicalSEO({ is_indexable: false }) }),
      });
      expect(report.crawlable).toBe(false);
    });

    it('marks page as crawlable on 301 redirect', () => {
      const report = runMerge({ fetch: mockFetch({ status: 301 }) });
      expect(report.crawlable).toBe(true); // 3xx = not a 4xx/5xx
    });
  });

  // analysis_detail
  describe('analysis_detail', () => {
    it('includes analysis_detail when raw Python data is provided', () => {
      const rawPythonData = {
        xray: { dom: { total_elements: 500 }, accessibility: { images_missing_alt: 2 } },
        techSeo: { meta: { title: { present: true } }, security_headers: { count: 5 } },
        onpage: { content: { word_count: 1200 }, images: { total: 10 } },
        contentAnalysis: { score: 75, detected_language: 'en', readability: { flesch_kincaid: 8.5 } },
      };
      const report = mergeAnalysis(
        'https://example.com',
        mockFetch(),
        [mockPSI()],
        mockPython(),
        null,
        rawPythonData,
      );
      expect(report.analysis_detail).toBeDefined();
      expect(report.analysis_detail!.xray).toEqual(rawPythonData.xray);
      expect(report.analysis_detail!.technical_seo).toEqual(rawPythonData.techSeo);
      expect(report.analysis_detail!.onpage).toEqual(rawPythonData.onpage);
      expect(report.analysis_detail!.content_analysis).toEqual(rawPythonData.contentAnalysis);
    });

    it('omits analysis_detail when no raw Python data is provided', () => {
      const report = runMerge();
      expect(report.analysis_detail).toBeUndefined();
    });
  });
});
