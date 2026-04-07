/**
 * Unit tests for CrUX API module
 * Tests: fetchCrUXData, parseCrUXMetric, estimateP75FromDistribution
 */

import axios from 'axios';
import { fetchCrUXData, CrUXError, estimateP75FromDistribution } from '../../src/analysis/crux';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCrUXResponse(metricsOverrides: Record<string, any> = {}) {
  return {
    data: {
      record: {
        key: { url: 'https://example.com' },
        metrics: {
          largest_contentful_paint: {
            histogram: [
              { start: 0, end: 2500, density: 0.70 },
              { start: 2500, end: 4000, density: 0.20 },
              { start: 4000, density: 0.10 },
            ],
            percentiles: { p75: 2100 },
          },
          cumulative_layout_shift: {
            histogram: [
              { start: 0, end: 0.1, density: 0.80 },
              { start: 0.1, end: 0.25, density: 0.15 },
              { start: 0.25, density: 0.05 },
            ],
            percentiles: { p75: 0.05 },
          },
          first_input_delay: {
            histogram: [
              { start: 0, end: 100, density: 0.90 },
              { start: 100, end: 300, density: 0.07 },
              { start: 300, density: 0.03 },
            ],
            percentiles: { p75: 12 },
          },
          interaction_to_next_paint: {
            histogram: [
              { start: 0, end: 200, density: 0.85 },
              { start: 200, end: 500, density: 0.10 },
              { start: 500, density: 0.05 },
            ],
            percentiles: { p75: 150 },
          },
          ...metricsOverrides,
        },
        collectionPeriod: {
          firstDate: { year: 2025, month: 1, day: 1 },
          lastDate: { year: 2025, month: 3, day: 1 },
        },
      },
    },
    status: 200,
  };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.resetAllMocks();
  process.env.SGNL_PSI_KEY = 'test-api-key';
});

afterEach(() => {
  delete process.env.SGNL_PSI_KEY;
});

// ---------------------------------------------------------------------------
// 1. Valid response parsing
// ---------------------------------------------------------------------------

describe('fetchCrUXData — valid response', () => {
  it('returns FieldData with all four metrics', async () => {
    mockedAxios.post.mockResolvedValue(makeCrUXResponse());

    const result = await fetchCrUXData('https://example.com');

    expect(result.data).not.toBeNull();
    expect(result.data!.lcp.value).toBe(2100);
    expect(result.data!.cls.value).toBe(0.05);
    expect(result.data!.fid.value).toBe(12);
    expect(result.data!.inp.value).toBe(150);
  });

  it('assigns correct units for each metric', async () => {
    mockedAxios.post.mockResolvedValue(makeCrUXResponse());

    const result = await fetchCrUXData('https://example.com');

    expect(result.data!.lcp.unit).toBe('ms');
    expect(result.data!.cls.unit).toBe('score');
    expect(result.data!.fid.unit).toBe('ms');
    expect(result.data!.inp.unit).toBe('ms');
  });

  it('assigns correct targets for each metric', async () => {
    mockedAxios.post.mockResolvedValue(makeCrUXResponse());

    const result = await fetchCrUXData('https://example.com');

    expect(result.data!.lcp.target).toBe(2500);
    expect(result.data!.cls.target).toBe(0.1);
    expect(result.data!.fid.target).toBe(100);
    expect(result.data!.inp.target).toBe(200);
  });

  it('sets status=good for LCP ≤ 2500ms', async () => {
    mockedAxios.post.mockResolvedValue(makeCrUXResponse());

    const result = await fetchCrUXData('https://example.com');
    expect(result.data!.lcp.status).toBe('good');
  });

  it('sets status=warn for LCP between 2500 and 4000ms', async () => {
    mockedAxios.post.mockResolvedValue(makeCrUXResponse({
      largest_contentful_paint: {
        histogram: [{ start: 0, end: 4000, density: 1 }],
        percentiles: { p75: 3000 },
      },
    }));

    const result = await fetchCrUXData('https://example.com');
    expect(result.data!.lcp.status).toBe('warn');
  });

  it('sets status=fail for LCP > 4000ms', async () => {
    mockedAxios.post.mockResolvedValue(makeCrUXResponse({
      largest_contentful_paint: {
        histogram: [{ start: 0, density: 1 }],
        percentiles: { p75: 5000 },
      },
    }));

    const result = await fetchCrUXData('https://example.com');
    expect(result.data!.lcp.status).toBe('fail');
  });

  it('sets status=good for CLS ≤ 0.1', async () => {
    mockedAxios.post.mockResolvedValue(makeCrUXResponse());
    const result = await fetchCrUXData('https://example.com');
    expect(result.data!.cls.status).toBe('good');
  });

  it('sets status=warn for CLS between 0.1 and 0.25', async () => {
    mockedAxios.post.mockResolvedValue(makeCrUXResponse({
      cumulative_layout_shift: {
        histogram: [{ start: 0, density: 1 }],
        percentiles: { p75: 0.15 },
      },
    }));
    const result = await fetchCrUXData('https://example.com');
    expect(result.data!.cls.status).toBe('warn');
  });

  it('includes fcp field as fallback default (not in basic CrUX metrics)', async () => {
    mockedAxios.post.mockResolvedValue(makeCrUXResponse());
    const result = await fetchCrUXData('https://example.com');
    expect(result.data!.fcp).toBeDefined();
    expect(result.data!.fcp.value).toBe(0);
  });

  it('POSTs to the correct CrUX API endpoint', async () => {
    mockedAxios.post.mockResolvedValue(makeCrUXResponse());

    await fetchCrUXData('https://example.com');

    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://www.googleapis.com/chromeuxreport/v1/records:queryRecord',
      expect.objectContaining({ url: 'https://example.com' }),
      expect.objectContaining({ params: { key: 'test-api-key' } }),
    );
  });

  it('requests all four Core Web Vitals metrics', async () => {
    mockedAxios.post.mockResolvedValue(makeCrUXResponse());

    await fetchCrUXData('https://example.com');

    expect(mockedAxios.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        metrics: expect.arrayContaining([
          'largest_contentful_paint',
          'cumulative_layout_shift',
          'first_input_delay',
          'interaction_to_next_paint',
        ]),
      }),
      expect.any(Object),
    );
  });
});

// ---------------------------------------------------------------------------
// 2. Missing metrics (partial data)
// ---------------------------------------------------------------------------

describe('fetchCrUXData — partial data', () => {
  it('returns FieldData with defaults when LCP is missing', async () => {
    mockedAxios.post.mockResolvedValue(makeCrUXResponse({
      largest_contentful_paint: undefined,
    }));

    const result = await fetchCrUXData('https://example.com');
    expect(result.data).not.toBeNull();
    expect(result.data!.lcp.value).toBe(0);
    expect(result.data!.lcp.status).toBe('fail');
  });

  it('returns FieldData with defaults when INP is missing', async () => {
    mockedAxios.post.mockResolvedValue(makeCrUXResponse({
      interaction_to_next_paint: undefined,
    }));

    const result = await fetchCrUXData('https://example.com');
    expect(result.data).not.toBeNull();
    expect(result.data!.inp.value).toBe(0);
  });

  it('returns null when ALL metrics are missing', async () => {
    mockedAxios.post.mockResolvedValue({
      data: {
        record: {
          metrics: {},
        },
      },
    });

    const result = await fetchCrUXData('https://example.com');
    expect(result.data).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. No CrUX data (404) — graceful null
// ---------------------------------------------------------------------------

describe('fetchCrUXData — no data available', () => {
  it('returns null on 404 (no CrUX data for URL)', async () => {
    mockedAxios.post.mockRejectedValue({
      response: { status: 404, data: { error: { message: 'No data available' } } },
    });

    const result = await fetchCrUXData('https://example.com');
    expect(result.data).toBeNull();
  });

  it('returns null on 400 bad request', async () => {
    mockedAxios.post.mockRejectedValue({
      response: { status: 400, data: { error: { message: 'Bad request' } } },
    });

    const result = await fetchCrUXData('https://example.com');
    expect(result.data).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. Malformed response
// ---------------------------------------------------------------------------

describe('fetchCrUXData — malformed response', () => {
  it('returns null when response has no record field', async () => {
    mockedAxios.post.mockResolvedValue({ data: {} });

    const result = await fetchCrUXData('https://example.com');
    expect(result.data).toBeNull();
  });

  it('returns null when record has no metrics field', async () => {
    mockedAxios.post.mockResolvedValue({ data: { record: {} } });

    const result = await fetchCrUXData('https://example.com');
    expect(result.data).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 5. Timeout handling
// ---------------------------------------------------------------------------

describe('fetchCrUXData — timeout', () => {
  it('throws CrUXError on timeout (ECONNABORTED)', async () => {
    const timeoutErr = Object.assign(new Error('timeout of 10000ms exceeded'), {
      code: 'ECONNABORTED',
    });
    mockedAxios.post.mockRejectedValue(timeoutErr);

    await expect(fetchCrUXData('https://example.com')).rejects.toThrow(CrUXError);
    await expect(fetchCrUXData('https://example.com')).rejects.toThrow('timed out');
  });
});

// ---------------------------------------------------------------------------
// 6. Distribution → percentile calculation
// ---------------------------------------------------------------------------

describe('estimateP75FromDistribution', () => {
  it('returns 0 for empty distribution', () => {
    expect(estimateP75FromDistribution([])).toBe(0);
  });

  it('returns midpoint of bucket containing 75th percentile', () => {
    const dist = [
      { min: 0, max: 2500, proportion: 0.70 },
      { min: 2500, max: 4000, proportion: 0.20 },
      { min: 4000, max: 8000, proportion: 0.10 },
    ];
    // 0.70 < 0.75, 0.70+0.20 = 0.90 ≥ 0.75 → bucket [2500, 4000] → mid = 3250
    expect(estimateP75FromDistribution(dist)).toBe(3250);
  });

  it('handles single-bucket distribution', () => {
    const dist = [{ min: 0, max: 1000, proportion: 1.0 }];
    expect(estimateP75FromDistribution(dist)).toBe(500);
  });

  it('handles last bucket with Infinity max', () => {
    const dist = [
      { min: 0, max: 2500, proportion: 0.5 },
      { min: 2500, max: Infinity, proportion: 0.5 },
    ];
    // cumulative after first = 0.5 < 0.75; after second = 1.0 ≥ 0.75
    // last bucket: min=2500, max=Infinity → max becomes 5000 → mid=3750
    const result = estimateP75FromDistribution(dist);
    expect(result).toBeGreaterThan(2500);
  });
});

// ---------------------------------------------------------------------------
// 7. API key validation
// ---------------------------------------------------------------------------

describe('fetchCrUXData — API key', () => {
  it('returns null when SGNL_PSI_KEY is not set', async () => {
    delete process.env.SGNL_PSI_KEY;

    const result = await fetchCrUXData('https://example.com');
    expect(result.data).toBeNull();
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('throws CrUXError on 403 auth failure', async () => {
    mockedAxios.post.mockRejectedValue({
      response: {
        status: 403,
        data: { error: { message: 'API key not valid' } },
      },
    });

    await expect(fetchCrUXData('https://example.com')).rejects.toThrow(CrUXError);
    await expect(fetchCrUXData('https://example.com')).rejects.toThrow('authentication failed');
  });

  it('throws CrUXError on 429 rate limit', async () => {
    mockedAxios.post.mockRejectedValue({
      response: { status: 429 },
    });

    await expect(fetchCrUXData('https://example.com')).rejects.toThrow(CrUXError);
    await expect(fetchCrUXData('https://example.com')).rejects.toThrow('rate limit');
  });
});
