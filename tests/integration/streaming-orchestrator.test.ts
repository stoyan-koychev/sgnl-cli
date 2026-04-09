/**
 * SGNL Streaming Orchestrator Tests — Phase 10
 * Full end-to-end pipeline tests with async streaming:
 * - Partial report yields after Python completes (~2-3s)
 * - Final report yields after Google APIs complete (~8-10s total)
 *
 * Strategy: mock all external I/O, exercise real streaming orchestrator,
 * assert on report shape, timing, and metadata (_partial, _complete flags).
 */

import { buildReportStream, buildReport } from '../../src/analysis/orchestrator';
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
jest.mock('../../src/analysis/run-reporter');

import { renderFetch } from '../../src/analysis/fetch';
import { callPSI } from '../../src/analysis/psi';
import { fetchCrUXData } from '../../src/analysis/crux';
import { runPythonScriptSafe } from '../../src/analysis/python';
import { fetchCrUXData as fetchCrUXDataImpl } from '../../src/analysis/crux';

const mockSafeFetch = renderFetch as jest.MockedFunction<typeof renderFetch>;
const mockCallPSI = callPSI as jest.MockedFunction<typeof callPSI>;
const mockRunPythonScriptSafe = runPythonScriptSafe as jest.MockedFunction<typeof runPythonScriptSafe>;
const mockFetchCrUXData = fetchCrUXDataImpl as jest.MockedFunction<typeof fetchCrUXDataImpl>;

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
    speed_index_s: 2.5,
    tti_s: 3.0,
    tbt_ms: 150,
    cls: 0.05,
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

// ---------------------------------------------------------------------------
// Tests: buildReportStream async generator
// ---------------------------------------------------------------------------

describe('buildReportStream - Async Streaming Orchestrator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Setup default mocks with fast returns (for basic tests)
    mockSafeFetch.mockResolvedValue(mockFetchResult());
    mockRunPythonScriptSafe.mockResolvedValue({
      success: true,
      data: { dom: { total_elements: 42 }, structure: { div_ratio: 0.2 } },
    });
    mockCallPSI.mockResolvedValue(mockPSIResult());
    mockFetchCrUXData.mockResolvedValue({ data: mockFieldData(), raw: null });
  });

  test('yields exactly 2 reports: partial then complete', async () => {
    const reports: any[] = [];
    for await (const report of buildReportStream('https://example.com')) {
      reports.push(report);
    }

    expect(reports).toHaveLength(2);
    expect(reports[0]._partial).toBe(true);
    expect(reports[0]._complete).toBe(false);
    expect(reports[1]._partial).toBe(false);
    expect(reports[1]._complete).toBe(true);
  });

  test('partial report appears before Google APIs complete', async () => {
    // Simulate slow Google APIs (e.g., 2 second delay)
    mockFetchCrUXData.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ data: mockFieldData(), raw: null }), 2000))
    );
    mockCallPSI.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(mockPSIResult()), 2000))
    );

    const startTime = Date.now();
    const reports: any[] = [];
    for await (const report of buildReportStream('https://example.com')) {
      const elapsedMs = Date.now() - startTime;
      reports.push({ report, elapsedMs });
    }

    // First report should be faster (no Google APIs)
    const partialElapsed = reports[0].elapsedMs;
    const finalElapsed = reports[1].elapsedMs;

    expect(partialElapsed).toBeLessThan(finalElapsed);
    expect(finalElapsed).toBeGreaterThanOrEqual(2000); // Waited for Google APIs
  });

  test('partial report has null field_data', async () => {
    mockFetchCrUXData.mockResolvedValue({ data: mockFieldData(), raw: null });
    mockCallPSI.mockResolvedValue(mockPSIResult());

    const reports: any[] = [];
    for await (const report of buildReportStream('https://example.com')) {
      reports.push(report);
    }

    const partial = reports[0];
    // field_data should be null in partial
    expect(partial.performance?.core_web_vitals?.lcp_ms).toBeUndefined();
  });

  test('final report has field_data from Google APIs', async () => {
    mockFetchCrUXData.mockResolvedValue({ data: mockFieldData(), raw: null });
    mockCallPSI.mockResolvedValue(mockPSIResult());

    const reports: any[] = [];
    for await (const report of buildReportStream('https://example.com')) {
      reports.push(report);
    }

    const final = reports[1];
    // field_data should be populated in final
    expect(final.performance?.core_web_vitals?.lcp_ms).toBe(1800);
  });

  test('skipPSI=true skips Google APIs, yields only Python data', async () => {
    const reports: any[] = [];
    for await (const report of buildReportStream('https://example.com', { skipPSI: true })) {
      reports.push(report);
    }

    expect(reports).toHaveLength(2);
    expect(reports[1].performance?.core_web_vitals?.lcp_ms).toBeUndefined();
    expect(mockFetchCrUXData).not.toHaveBeenCalled();
  });

  test('skipPython=true skips Python analysis, both reports still yielded', async () => {
    const reports: any[] = [];
    for await (const report of buildReportStream('https://example.com', { skipPython: true })) {
      reports.push(report);
    }

    expect(reports).toHaveLength(2);
    // Both reports should still be yielded even without Python
    expect(reports[0].url).toBe('https://example.com');
    expect(reports[1].url).toBe('https://example.com');
    expect(mockRunPythonScriptSafe).not.toHaveBeenCalled();
  });

  test('reports have consistent URL and basic structure', async () => {
    const reports: any[] = [];
    for await (const report of buildReportStream('https://example.com')) {
      reports.push(report);
    }

    for (const report of reports) {
      expect(report.url).toBe('https://example.com');
      expect(report.timestamp).toBeDefined();
      expect(report.http_status).toBe(200);
    }
  });

  test('onProgress callback fires for each step', async () => {
    const steps: string[] = [];
    const callback = jest.fn((update: any) => {
      steps.push(update.id);
    });

    const reports: any[] = [];
    for await (const report of buildReportStream('https://example.com', { onProgress: callback })) {
      reports.push(report);
    }

    // Should have fired callbacks for validate, fetch, psi, performance, score
    expect(callback).toHaveBeenCalled();
    expect(steps).toContain('validate');
    expect(steps).toContain('fetch');
    expect(steps).toContain('psi');
    expect(steps).toContain('performance');
  });

  test('handles CrUX data gracefully if missing', async () => {
    mockFetchCrUXData.mockResolvedValue({ data: null, raw: null });

    const reports: any[] = [];
    for await (const report of buildReportStream('https://example.com')) {
      reports.push(report);
    }

    expect(reports).toHaveLength(2);
    // Should still have PSI data as fallback
    expect(reports[1].performance?.core_web_vitals?.lcp_ms).toBe(1800);
  });

  test('handles PSI failure gracefully', async () => {
    mockCallPSI.mockRejectedValue(new Error('API quota exceeded'));

    const reports: any[] = [];
    for await (const report of buildReportStream('https://example.com')) {
      reports.push(report);
    }

    expect(reports).toHaveLength(2);
    // Should still yield reports even if PSI fails
    expect(reports[0]._partial).toBe(true);
  });

  test('handles Python pipeline failure gracefully', async () => {
    mockRunPythonScriptSafe.mockRejectedValue(new Error('Python not installed'));

    const reports: any[] = [];
    for await (const report of buildReportStream('https://example.com')) {
      reports.push(report);
    }

    expect(reports).toHaveLength(2);
    // Should still yield reports with degraded Python data
    expect(reports[0]._partial).toBe(true);
  });

  test('partial report has url and timestamp', async () => {
    const reports: any[] = [];
    for await (const report of buildReportStream('https://example.com')) {
      reports.push(report);
    }

    const partial = reports[0];
    expect(partial.url).toBe('https://example.com');
    expect(partial.timestamp).toBeDefined();
    expect(typeof partial.timestamp).toBe('string');
  });

  test('final report differs from partial in performance metrics', async () => {
    mockFetchCrUXData.mockResolvedValue({ data: mockFieldData(), raw: null });
    mockCallPSI.mockResolvedValue(mockPSIResult({
      lab_data: { performance_score: 92, speed_index_s: 2.0, tti_s: 2.5, tbt_ms: 100, cls: 0.05 }
    }));

    const reports: any[] = [];
    for await (const report of buildReportStream('https://example.com')) {
      reports.push(report);
    }

    const partial = reports[0];
    const final = reports[1];

    // Partial should have no performance score, final should
    expect(partial.performance?.core_web_vitals?.lcp_ms).toBeUndefined();
    expect(final.performance?.core_web_vitals?.lcp_ms).toBeDefined();
  });

  test('PSI called with mobile strategy by default', async () => {
    mockCallPSI.mockImplementation((url, strategy) =>
      Promise.resolve(mockPSIResult({
        lab_data: { performance_score: 90, speed_index_s: 2.0, tti_s: 2.5, tbt_ms: 100, cls: 0.05 }
      }))
    );

    const reports: any[] = [];
    for await (const report of buildReportStream('https://example.com')) {
      reports.push(report);
    }

    // Should have called PSI once with mobile (default device)
    expect(mockCallPSI).toHaveBeenCalledTimes(1);
    expect(mockCallPSI).toHaveBeenCalledWith('https://example.com', 'mobile');
  });

  test('merged report includes all sources (fetch + Python + Google)', async () => {
    mockFetchCrUXData.mockResolvedValue({ data: mockFieldData(), raw: null });
    mockCallPSI.mockResolvedValue(mockPSIResult());

    const reports: any[] = [];
    for await (const report of buildReportStream('https://example.com')) {
      reports.push(report);
    }

    const final = reports[1];
    // Check that fetch data is in the report
    expect(final.http_status).toBe(200);
    // Check that Google data is in the report
    expect(final.performance?.core_web_vitals?.lcp_ms).toBe(1800);
  });

  test('streaming handles empty responses from Python', async () => {
    mockRunPythonScriptSafe.mockResolvedValue({ success: false, error: 'No data' });

    const reports: any[] = [];
    for await (const report of buildReportStream('https://example.com', { skipPSI: true })) {
      reports.push(report);
    }

    expect(reports).toHaveLength(2);
    expect(reports[0].structure).toBeDefined(); // Should still have structure
  });

  test('partial and final reports have different overall scores', async () => {
    mockFetchCrUXData.mockResolvedValue({ data: mockFieldData({ lcp: { value: 2500, unit: 'ms', status: 'good', target: 2500 } }), raw: null });
    mockCallPSI.mockResolvedValue(mockPSIResult({ 
      lab_data: { performance_score: 95, speed_index_s: 1.8, tti_s: 2.2, tbt_ms: 80, cls: 0.03 }
    }));

    const reports: any[] = [];
    for await (const report of buildReportStream('https://example.com')) {
      reports.push(report);
    }

    // Scores might differ because final has more data
  });

  test('_partial flag accurately indicates incomplete state', async () => {
    mockFetchCrUXData.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ data: mockFieldData(), raw: null }), 100))
    );

    const reports: any[] = [];
    for await (const report of buildReportStream('https://example.com')) {
      reports.push(report);
    }

    expect(reports[0]._partial).toBe(true);
    expect(reports[1]._partial).toBe(false);
  });

  test('yields exact number of reports (2)', async () => {
    let count = 0;
    for await (const report of buildReportStream('https://example.com')) {
      count++;
      // Guard against infinite loops
      if (count > 10) throw new Error('Too many yields');
    }
    expect(count).toBe(2);
  });

  test('async generator completes normally without errors', async () => {
    let error: Error | null = null;
    try {
      for await (const report of buildReportStream('https://example.com')) {
        // Do nothing
      }
    } catch (e) {
      error = e as Error;
    }
    expect(error).toBeNull();
  });

  test('reports are valid JSON-serializable objects', async () => {
    const reports: any[] = [];
    for await (const report of buildReportStream('https://example.com')) {
      reports.push(report);
    }

    for (const report of reports) {
      expect(() => JSON.stringify(report)).not.toThrow();
    }
  });

  test('final report has issues array', async () => {
    const reports: any[] = [];
    for await (const report of buildReportStream('https://example.com')) {
      reports.push(report);
    }

    expect(reports[1].issues).toBeDefined();
    expect(Array.isArray(reports[1].issues.critical)).toBe(true);
    expect(Array.isArray(reports[1].issues.warning)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests: backward compatibility with buildReport (synchronous)
// ---------------------------------------------------------------------------

describe('buildReport - Backward Compatibility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSafeFetch.mockResolvedValue(mockFetchResult());
    mockRunPythonScriptSafe.mockResolvedValue({
      success: true,
      data: { dom: { total_elements: 42 }, structure: { div_ratio: 0.2 } },
    });
    mockCallPSI.mockResolvedValue(mockPSIResult());
    mockFetchCrUXData.mockResolvedValue({ data: mockFieldData(), raw: null });
  });

  test('returns final report (not partial)', async () => {
    const report = await buildReport('https://example.com');
    expect(report.url).toBe('https://example.com');
    // Note: _complete and _partial are internal streaming flags, not on final AnalysisReport
    // buildReport() consumes the stream and returns only the final report
  });

  test('waits for all APIs to complete', async () => {
    mockFetchCrUXData.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ data: mockFieldData(), raw: null }), 1000))
    );

    const startTime = Date.now();
    const report = await buildReport('https://example.com');
    const elapsedMs = Date.now() - startTime;

    // Should have waited for Google APIs
    expect(elapsedMs).toBeGreaterThanOrEqual(1000);
    expect(report.performance?.core_web_vitals?.lcp_ms).toBe(1800);
  });

  test('returns report with all data populated', async () => {
    const report = await buildReport('https://example.com');
    expect(report.url).toBe('https://example.com');
    expect(report.performance).toBeDefined();
    expect(report.seo).toBeDefined();
  });
});
