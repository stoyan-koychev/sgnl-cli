/**
 * Regression test for the fetchAllRankedPages / fetchAllRankedQueries
 * pagination bug: prior to the fix, `startRow` was initialised to 0 and
 * never incremented, so the loop returned at most the first 25k rows and
 * silently dropped everything beyond.
 */

import axios from 'axios';
import { fetchAllRankedPages, fetchAllRankedQueries } from '../../src/analysis/gsc';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

function makeRow(i: number): any {
  return {
    keys: [`https://example.com/page-${i}`],
    clicks: 1,
    impressions: 10,
    ctr: 0.1,
    position: 1 + (i % 10),
  };
}

function makeQueryRow(i: number): any {
  return {
    keys: [`q${i}`],
    clicks: 1,
    impressions: 10,
    ctr: 0.1,
    position: 1 + (i % 10),
  };
}

describe('fetchAllRankedPages — pagination', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('paginates past the 25k row limit by incrementing startRow', async () => {
    const page1 = Array.from({ length: 25000 }, (_, i) => makeRow(i));
    const page2 = Array.from({ length: 25000 }, (_, i) => makeRow(25000 + i));
    const page3 = Array.from({ length: 5000 }, (_, i) => makeRow(50000 + i));

    mockedAxios.post
      .mockResolvedValueOnce({ data: { rows: page1 } } as any)
      .mockResolvedValueOnce({ data: { rows: page2 } } as any)
      .mockResolvedValueOnce({ data: { rows: page3 } } as any);

    const result = await fetchAllRankedPages('sc-domain:example.com', 'token', { limit: 60000 });

    expect(result.length).toBe(55000);
    expect(mockedAxios.post).toHaveBeenCalledTimes(3);

    const call1Body = mockedAxios.post.mock.calls[0][1] as any;
    const call2Body = mockedAxios.post.mock.calls[1][1] as any;
    const call3Body = mockedAxios.post.mock.calls[2][1] as any;

    expect(call1Body.startRow).toBe(0);
    expect(call2Body.startRow).toBe(25000);
    expect(call3Body.startRow).toBe(50000);

    // Last-page batch was less than batchSize → loop should have terminated.
    expect(result[0].page).toBe('https://example.com/page-0');
    expect(result[25000].page).toBe('https://example.com/page-25000');
    expect(result[54999].page).toBe('https://example.com/page-54999');
  });

  it('stops paginating when the API returns fewer rows than the batch size', async () => {
    const page1 = Array.from({ length: 12345 }, (_, i) => makeRow(i));
    mockedAxios.post.mockResolvedValueOnce({ data: { rows: page1 } } as any);

    const result = await fetchAllRankedPages('sc-domain:example.com', 'token', { limit: 60000 });

    expect(result.length).toBe(12345);
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
  });

  it('respects an explicit smaller limit without over-fetching', async () => {
    const page1 = Array.from({ length: 25000 }, (_, i) => makeRow(i));
    mockedAxios.post.mockResolvedValueOnce({ data: { rows: page1 } } as any);

    const result = await fetchAllRankedPages('sc-domain:example.com', 'token', { limit: 100 });

    expect(result.length).toBe(100);
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    const body = mockedAxios.post.mock.calls[0][1] as any;
    expect(body.rowLimit).toBe(100);
    expect(body.startRow).toBe(0);
  });

  it('returns partial results on mid-pagination error without throwing', async () => {
    const page1 = Array.from({ length: 25000 }, (_, i) => makeRow(i));
    mockedAxios.post
      .mockResolvedValueOnce({ data: { rows: page1 } } as any)
      .mockRejectedValueOnce(new Error('boom'));

    const result = await fetchAllRankedPages('sc-domain:example.com', 'token', { limit: 60000 });

    // First batch succeeded, second failed → caller gets the first 25k.
    expect(result.length).toBe(25000);
  });
});

describe('fetchAllRankedQueries — pagination', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('paginates past the 25k row limit', async () => {
    const page1 = Array.from({ length: 25000 }, (_, i) => makeQueryRow(i));
    const page2 = Array.from({ length: 7500 }, (_, i) => makeQueryRow(25000 + i));

    mockedAxios.post
      .mockResolvedValueOnce({ data: { rows: page1 } } as any)
      .mockResolvedValueOnce({ data: { rows: page2 } } as any);

    const result = await fetchAllRankedQueries('sc-domain:example.com', 'token', { limit: 40000 });

    expect(result.length).toBe(32500);
    expect(mockedAxios.post).toHaveBeenCalledTimes(2);
    expect((mockedAxios.post.mock.calls[0][1] as any).startRow).toBe(0);
    expect((mockedAxios.post.mock.calls[1][1] as any).startRow).toBe(25000);
  });
});
