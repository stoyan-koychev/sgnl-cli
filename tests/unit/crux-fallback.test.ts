/**
 * Tests for CrUX origin-level fallback (Phase 2.3).
 *
 * When a URL-level CrUX query returns 404 (no data for that specific URL),
 * fetchCrUXData must automatically retry the same metrics with `{ origin: <origin> }`
 * and flag the result with `scope: 'origin'`. When the URL-level query succeeds,
 * the result must be flagged `scope: 'url'`.
 */

import axios from 'axios';
import { fetchCrUXData } from '../../src/analysis/crux';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.SGNL_PSI_KEY = 'test-api-key';
});

afterEach(() => {
  delete process.env.SGNL_PSI_KEY;
});

function makeSuccessResponse(label: string) {
  return {
    data: {
      record: {
        key: { [label.startsWith('origin') ? 'origin' : 'url']: 'https://example.com' },
        metrics: {
          largest_contentful_paint: {
            histogram: [{ start: 0, end: 2500, density: 0.85 }],
            percentiles: { p75: 2100 },
          },
          cumulative_layout_shift: {
            histogram: [{ start: 0, end: 0.1, density: 0.90 }],
            percentiles: { p75: 0.04 },
          },
          first_input_delay: {
            histogram: [{ start: 0, end: 100, density: 0.95 }],
            percentiles: { p75: 15 },
          },
          interaction_to_next_paint: {
            histogram: [{ start: 0, end: 200, density: 0.90 }],
            percentiles: { p75: 120 },
          },
        },
        collectionPeriod: {
          firstDate: { year: 2026, month: 3, day: 1 },
          lastDate: { year: 2026, month: 3, day: 28 },
        },
      },
    },
    status: 200,
  };
}

describe('fetchCrUXData — origin fallback', () => {
  it('flags URL-level success with scope: "url"', async () => {
    mockedAxios.post.mockResolvedValueOnce(makeSuccessResponse('url'));

    const result = await fetchCrUXData('https://example.com/blog/post');

    expect(result.data).not.toBeNull();
    expect(result.scope).toBe('url');
    expect(result.data!.lcp.value).toBe(2100);
    // Only one call — no fallback needed
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
  });

  it('falls back to origin when URL query returns 404', async () => {
    // First call: URL-level 404
    mockedAxios.post.mockRejectedValueOnce({
      response: { status: 404, data: { error: { message: 'not found' } } },
    });
    // Second call: origin-level success
    mockedAxios.post.mockResolvedValueOnce(makeSuccessResponse('origin'));

    const result = await fetchCrUXData('https://example.com/blog/post');

    expect(result.data).not.toBeNull();
    expect(result.scope).toBe('origin');
    expect(mockedAxios.post).toHaveBeenCalledTimes(2);

    // Second call body should contain `origin`, not `url`
    const secondCallBody = (mockedAxios.post.mock.calls[1] as any[])[1];
    expect(secondCallBody.origin).toBe('https://example.com');
    expect(secondCallBody.url).toBeUndefined();
  });

  it('returns no data when both URL and origin return 404', async () => {
    mockedAxios.post.mockRejectedValueOnce({ response: { status: 404 } });
    mockedAxios.post.mockRejectedValueOnce({ response: { status: 404 } });

    const result = await fetchCrUXData('https://example.com/deep/path');

    expect(result.data).toBeNull();
    expect(result.scope).toBeUndefined();
    expect(mockedAxios.post).toHaveBeenCalledTimes(2);
  });

  it('forwards formFactor to both URL and origin queries', async () => {
    mockedAxios.post.mockRejectedValueOnce({ response: { status: 404 } });
    mockedAxios.post.mockResolvedValueOnce(makeSuccessResponse('origin'));

    await fetchCrUXData('https://example.com/x', undefined, { formFactor: 'DESKTOP' });

    const firstBody = (mockedAxios.post.mock.calls[0] as any[])[1];
    const secondBody = (mockedAxios.post.mock.calls[1] as any[])[1];
    expect(firstBody.formFactor).toBe('DESKTOP');
    expect(secondBody.formFactor).toBe('DESKTOP');
  });

  it('surfaces the CrUX collection period', async () => {
    mockedAxios.post.mockResolvedValueOnce(makeSuccessResponse('url'));

    const result = await fetchCrUXData('https://example.com');

    expect(result.collectionPeriod?.firstDate).toBe('2026-03-01');
    expect(result.collectionPeriod?.lastDate).toBe('2026-03-28');
  });
});
