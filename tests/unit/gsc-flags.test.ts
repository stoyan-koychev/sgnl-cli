/**
 * Unit tests for GSC flag → API request body plumbing.
 *
 * Covers date range resolution, search type forwarding, and country/device
 * filter translation into the API's dimensionFilterGroups shape.
 */

import axios from 'axios';
import {
  computeDateRange,
  computePreviousRange,
  buildDimensionFilterGroups,
  fetchAllRankedPages,
  fetchSearchAnalytics,
} from '../../src/analysis/gsc';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('computeDateRange', () => {
  it('defaults to 28 days ending today', () => {
    const r = computeDateRange();
    expect(r.days).toBe(28);
    expect(r.start_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(r.end_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('honours explicit start+end and computes the day count', () => {
    const r = computeDateRange({ startDate: '2026-01-01', endDate: '2026-01-10' });
    expect(r.start_date).toBe('2026-01-01');
    expect(r.end_date).toBe('2026-01-10');
    expect(r.days).toBe(10);
  });

  it('honours --days over the default', () => {
    const r = computeDateRange({ days: 7 });
    expect(r.days).toBe(7);
  });
});

describe('computePreviousRange', () => {
  it('returns an equal-length window ending the day before start', () => {
    const cur = { start_date: '2026-01-15', end_date: '2026-01-21', days: 7 };
    const prev = computePreviousRange(cur);
    expect(prev.days).toBe(7);
    expect(prev.end_date).toBe('2026-01-14');
    expect(prev.start_date).toBe('2026-01-08');
  });
});

describe('buildDimensionFilterGroups', () => {
  it('returns an empty object when no filters are supplied', () => {
    expect(buildDimensionFilterGroups()).toEqual({});
    expect(buildDimensionFilterGroups({})).toEqual({});
  });

  it('emits country filter lowercased', () => {
    const g = buildDimensionFilterGroups({ country: 'USA' });
    expect(g.dimensionFilterGroups[0].filters[0]).toEqual({
      dimension: 'country',
      expression: 'usa',
    });
  });

  it('emits device filter uppercased', () => {
    const g = buildDimensionFilterGroups({ device: 'mobile' });
    expect(g.dimensionFilterGroups[0].filters[0]).toEqual({
      dimension: 'device',
      expression: 'MOBILE',
    });
  });

  it('combines country, device and page into one group', () => {
    const g = buildDimensionFilterGroups({
      country: 'deu',
      device: 'desktop',
      page: 'https://example.com/x',
    });
    expect(g.dimensionFilterGroups[0].filters).toHaveLength(3);
  });
});

describe('fetchAllRankedPages — flag plumbing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('forwards searchType, date range, and filters into the API body', async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: { rows: [] } } as any);

    await fetchAllRankedPages('sc-domain:example.com', 'token', {
      limit: 50,
      searchType: 'image',
      dateRange: { start_date: '2026-02-01', end_date: '2026-02-28', days: 28 },
      filters: { country: 'usa', device: 'mobile' },
    });

    const body = mockedAxios.post.mock.calls[0][1] as any;
    expect(body.type).toBe('image');
    expect(body.startDate).toBe('2026-02-01');
    expect(body.endDate).toBe('2026-02-28');
    expect(body.dimensions).toEqual(['page']);
    expect(body.rowLimit).toBe(50);
    expect(body.startRow).toBe(0);
    expect(body.dimensionFilterGroups[0].filters).toEqual(
      expect.arrayContaining([
        { dimension: 'country', expression: 'usa' },
        { dimension: 'device', expression: 'MOBILE' },
      ]),
    );
  });
});

describe('fetchSearchAnalytics — flag plumbing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('filters to the target URL and honours searchType + date range', async () => {
    mockedAxios.post
      .mockResolvedValueOnce({ data: { rows: [{ clicks: 5, impressions: 50, ctr: 0.1, position: 3.2 }] } } as any)
      .mockResolvedValueOnce({
        data: {
          rows: [
            { keys: ['seo tips'], clicks: 3, impressions: 30, ctr: 0.1, position: 2.5 },
          ],
        },
      } as any);

    const result = await fetchSearchAnalytics(
      'https://example.com/blog',
      'sc-domain:example.com',
      'token',
      {
        dateRange: { start_date: '2026-03-01', end_date: '2026-03-14', days: 14 },
        searchType: 'news',
        filters: { country: 'gbr' },
      },
    );

    expect(result).not.toBeNull();
    expect(result!.total_clicks).toBe(5);
    expect(result!.top_queries.length).toBe(1);
    expect(result!.top_queries[0].query).toBe('seo tips');

    // Both calls should carry the same filters + dateRange + type.
    const body1 = mockedAxios.post.mock.calls[0][1] as any;
    const body2 = mockedAxios.post.mock.calls[1][1] as any;
    for (const body of [body1, body2]) {
      expect(body.type).toBe('news');
      expect(body.startDate).toBe('2026-03-01');
      expect(body.endDate).toBe('2026-03-14');
      const filters = body.dimensionFilterGroups[0].filters;
      expect(filters).toEqual(
        expect.arrayContaining([
          { dimension: 'country', expression: 'gbr' },
          { dimension: 'page', expression: 'https://example.com/blog' },
        ]),
      );
    }
    expect(body1.dimensions).toEqual(['page']);
    expect(body2.dimensions).toEqual(['query']);
  });

  it('returns null on API error without throwing', async () => {
    mockedAxios.post.mockRejectedValue(new Error('quota exceeded'));
    const result = await fetchSearchAnalytics('https://example.com/x', 'sc-domain:example.com', 'tok');
    expect(result).toBeNull();
  });
});
