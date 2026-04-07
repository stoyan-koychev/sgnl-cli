/**
 * Google Search Console data fetcher.
 *
 * Fetches Search Analytics, URL Inspection, and Sitemaps data
 * for URLs that belong to verified GSC properties.
 */

import axios from 'axios';
import { loadConfig } from '../config';
import type { ResolvedConfig } from '../config';
import { getAccessToken } from '../auth/google-oauth';
import { logger } from '../utils/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GSCQuery {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface GSCSearchPerformance {
  total_clicks: number;
  total_impressions: number;
  average_ctr: number;
  average_position: number;
  top_queries: GSCQuery[];
}

export interface GSCIndexStatus {
  verdict: string;
  coverage_state: string;
  crawl_timestamp?: string;
  google_canonical?: string;
  user_canonical?: string;
  is_page_indexed: boolean;
  rich_results?: string[];
  mobile_usability_verdict?: string;
  mobile_usability_issues?: string[];
  robots_txt_state?: string;
  indexing_state?: string;
  page_fetch_state?: string;
  referring_urls?: string[];
  sitemap?: string[];
}

export interface GSCSitemap {
  path: string;
  last_submitted?: string;
  last_downloaded?: string;
  is_pending?: boolean;
  is_sitemaps_index?: boolean;
  type?: string;
  errors: number;
  warnings: number;
  contents?: Array<{ type?: string; submitted?: number; indexed?: number }>;
}

export interface GSCData {
  search_performance: GSCSearchPerformance;
  index_status: GSCIndexStatus;
  sitemaps?: GSCSitemap[];
}

export interface GSCPageRow {
  page: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

/**
 * Filter knobs for Search Analytics queries. All fields are optional.
 * searchType maps to the API `type` field (web|image|video|news|discover).
 */
export interface GSCAnalyticsFilters {
  country?: string; // ISO-3 (e.g. 'usa', 'deu') — GSC uses lowercase ISO-3166-1 alpha-3
  device?: 'desktop' | 'mobile' | 'tablet';
}

export interface GSCDateRange {
  start_date: string; // YYYY-MM-DD
  end_date: string;   // YYYY-MM-DD
  days: number;
}

// ---------------------------------------------------------------------------
// Date + filter helpers
// ---------------------------------------------------------------------------

const fmtDate = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * Resolve a date range from optional start/end/days inputs.
 * Precedence: explicit start+end > days from today > default 28 days.
 */
export function computeDateRange(opts?: {
  startDate?: string;
  endDate?: string;
  days?: number;
}): GSCDateRange {
  if (opts?.startDate && opts?.endDate) {
    const s = new Date(opts.startDate);
    const e = new Date(opts.endDate);
    const days = Math.max(1, Math.round((e.getTime() - s.getTime()) / 86_400_000) + 1);
    return { start_date: opts.startDate, end_date: opts.endDate, days };
  }
  const days = opts?.days && opts.days > 0 ? opts.days : 28;
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days);
  return { start_date: fmtDate(start), end_date: fmtDate(end), days };
}

/**
 * Compute the previous equal-length window immediately before the given range.
 * Used by --compare to produce period-over-period deltas.
 */
export function computePreviousRange(range: GSCDateRange): GSCDateRange {
  const curStart = new Date(range.start_date);
  const prevEnd = new Date(curStart);
  prevEnd.setDate(prevEnd.getDate() - 1);
  const prevStart = new Date(prevEnd);
  prevStart.setDate(prevStart.getDate() - (range.days - 1));
  return {
    start_date: fmtDate(prevStart),
    end_date: fmtDate(prevEnd),
    days: range.days,
  };
}

/**
 * Build the dimensionFilterGroups fragment for country/device/page filters.
 * Returns an empty object when no filters apply so it can be spread into a request body.
 */
export function buildDimensionFilterGroups(
  filters?: GSCAnalyticsFilters & { page?: string },
): Record<string, any> {
  const items: Array<{ dimension: string; expression: string }> = [];
  if (filters?.country) {
    items.push({ dimension: 'country', expression: filters.country.toLowerCase() });
  }
  if (filters?.device) {
    items.push({ dimension: 'device', expression: filters.device.toUpperCase() });
  }
  if (filters?.page) {
    items.push({ dimension: 'page', expression: filters.page });
  }
  if (items.length === 0) return {};
  return { dimensionFilterGroups: [{ filters: items }] };
}

// ---------------------------------------------------------------------------
// Property Resolution
// ---------------------------------------------------------------------------

/**
 * Resolve which GSC property (if any) covers the given URL.
 *
 * GSC properties come in two formats:
 *   - Domain property: "sc-domain:example.com" (covers all URLs on domain)
 *   - URL prefix: "https://example.com/" (covers URLs with that prefix)
 */
export function resolveGSCProperty(url: string, properties: string[]): string | null {
  if (!properties || properties.length === 0) return null;

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return null;
  }

  const hostname = parsedUrl.hostname.replace(/^www\./, '');

  // First try domain properties (most permissive)
  for (const prop of properties) {
    if (prop.startsWith('sc-domain:')) {
      const propDomain = prop.slice('sc-domain:'.length).replace(/^www\./, '');
      if (hostname === propDomain || hostname.endsWith(`.${propDomain}`)) {
        return prop;
      }
    }
  }

  // Then try URL-prefix properties
  for (const prop of properties) {
    if (!prop.startsWith('sc-domain:')) {
      try {
        if (url.startsWith(prop) || url.replace(/^http:/, 'https:').startsWith(prop)) {
          return prop;
        }
      } catch {
        // skip invalid properties
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// API Fetchers
// ---------------------------------------------------------------------------

export interface FetchSearchAnalyticsOptions {
  dateRange?: GSCDateRange;
  searchType?: string;
  filters?: GSCAnalyticsFilters;
  topQueriesLimit?: number;
}

/**
 * Fetch Search Analytics data for a specific URL.
 * Makes two calls:
 *   1. Page-level totals (accurate clicks/impressions — no query anonymization)
 *   2. Top queries by clicks (may sum to less than totals due to GSC privacy thresholds)
 */
export async function fetchSearchAnalytics(
  url: string,
  property: string,
  accessToken: string,
  opts?: FetchSearchAnalyticsOptions,
): Promise<GSCSearchPerformance | null> {
  const range = opts?.dateRange ?? computeDateRange();
  const encodedProperty = encodeURIComponent(property);
  const pageFilterGroups = buildDimensionFilterGroups({ ...opts?.filters, page: url });
  const searchType = opts?.searchType ?? 'web';
  const topLimit = opts?.topQueriesLimit ?? 10;

  try {
    const [pageTotalsRes, queryBreakdownRes] = await Promise.all([
      axios.post(
        `https://www.googleapis.com/webmasters/v3/sites/${encodedProperty}/searchAnalytics/query`,
        {
          startDate: range.start_date,
          endDate: range.end_date,
          dimensions: ['page'],
          ...pageFilterGroups,
          rowLimit: 1,
          type: searchType,
        },
        { headers: { Authorization: `Bearer ${accessToken}` }, timeout: 15_000 },
      ),
      axios.post(
        `https://www.googleapis.com/webmasters/v3/sites/${encodedProperty}/searchAnalytics/query`,
        {
          startDate: range.start_date,
          endDate: range.end_date,
          dimensions: ['query'],
          ...pageFilterGroups,
          rowLimit: topLimit,
          type: searchType,
        },
        { headers: { Authorization: `Bearer ${accessToken}` }, timeout: 15_000 },
      ),
    ]);

    const pageRow = pageTotalsRes.data?.rows?.[0];
    const totalClicks = pageRow?.clicks ?? 0;
    const totalImpressions = pageRow?.impressions ?? 0;
    const averageCtr = pageRow?.ctr ?? 0;
    const averagePosition = pageRow?.position ?? 0;

    const rows = queryBreakdownRes.data?.rows ?? [];
    const queries: GSCQuery[] = rows.map((row: any) => ({
      query: row.keys?.[0] ?? '',
      clicks: row.clicks ?? 0,
      impressions: row.impressions ?? 0,
      ctr: row.ctr ?? 0,
      position: row.position ?? 0,
    }));

    return {
      total_clicks: totalClicks,
      total_impressions: totalImpressions,
      average_ctr: averageCtr,
      average_position: averagePosition,
      top_queries: queries,
    };
  } catch (err: any) {
    logger.debug(`fetchSearchAnalytics failed for ${url}: ${err?.message ?? err}`);
    return null;
  }
}

/**
 * Fetch URL Inspection data (index status, canonical, rich results, mobile usability).
 */
export async function fetchURLInspection(
  url: string,
  property: string,
  accessToken: string,
): Promise<GSCIndexStatus | null> {
  try {
    const response = await axios.post(
      'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect',
      {
        inspectionUrl: url,
        siteUrl: property,
      },
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 15_000,
      },
    );

    const result = response.data?.inspectionResult;
    if (!result) return null;

    const indexStatus = result.indexStatusResult;
    const richResults = result.richResultsResult;
    const mobileUsability = result.mobileUsabilityResult;

    return {
      verdict: indexStatus?.verdict ?? 'NEUTRAL',
      coverage_state: indexStatus?.coverageState ?? 'Unknown',
      crawl_timestamp: indexStatus?.lastCrawlTime ?? undefined,
      google_canonical: indexStatus?.googleCanonical ?? undefined,
      user_canonical: indexStatus?.userCanonical ?? undefined,
      is_page_indexed: indexStatus?.verdict === 'PASS',
      rich_results: richResults?.detectedItems?.map((item: any) => item.richResultType) ?? undefined,
      mobile_usability_verdict: mobileUsability?.verdict ?? undefined,
      mobile_usability_issues: Array.isArray(mobileUsability?.issues)
        ? mobileUsability.issues.map((i: any) => i.issueType ?? i.message).filter(Boolean)
        : undefined,
      robots_txt_state: indexStatus?.robotsTxtState ?? undefined,
      indexing_state: indexStatus?.indexingState ?? undefined,
      page_fetch_state: indexStatus?.pageFetchState ?? undefined,
      referring_urls: indexStatus?.referringUrls ?? undefined,
      sitemap: indexStatus?.sitemap ?? undefined,
    };
  } catch (err: any) {
    logger.debug(`fetchURLInspection failed for ${url}: ${err?.message ?? err}`);
    return null;
  }
}

/**
 * Fetch submitted sitemaps for the property.
 */
export async function fetchSitemaps(
  property: string,
  accessToken: string,
): Promise<GSCSitemap[] | null> {
  const encodedProperty = encodeURIComponent(property);

  try {
    const response = await axios.get(
      `https://www.googleapis.com/webmasters/v3/sites/${encodedProperty}/sitemaps`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 10_000,
      },
    );

    const sitemaps = response.data?.sitemap ?? [];
    return sitemaps.map((sm: any) => ({
      path: sm.path ?? '',
      last_submitted: sm.lastSubmitted ?? undefined,
      last_downloaded: sm.lastDownloaded ?? undefined,
      is_pending: sm.isPending ?? undefined,
      is_sitemaps_index: sm.isSitemapsIndex ?? undefined,
      type: sm.type ?? undefined,
      errors: Number(sm.errors ?? 0),
      warnings: Number(sm.warnings ?? 0),
      contents: Array.isArray(sm.contents)
        ? sm.contents.map((c: any) => ({
            type: c.type,
            submitted: Number(c.submitted ?? 0),
            indexed: Number(c.indexed ?? 0),
          }))
        : undefined,
    }));
  } catch (err: any) {
    logger.debug(`fetchSitemaps failed for ${property}: ${err?.message ?? err}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// All Ranked Pages / Queries Fetchers
// ---------------------------------------------------------------------------

export interface FetchRankedOptions {
  limit?: number;
  searchType?: string;
  dateRange?: GSCDateRange;
  filters?: GSCAnalyticsFilters;
}

const GSC_API_MAX_ROW_LIMIT = 25000;

/**
 * Fetch all ranked pages for a GSC property.
 * Paginates through the API `startRow` param in 25k batches until the requested
 * limit is reached or the API returns fewer rows than the batch size.
 */
export async function fetchAllRankedPages(
  property: string,
  accessToken: string,
  options?: FetchRankedOptions,
): Promise<GSCPageRow[]> {
  const range = options?.dateRange ?? computeDateRange();
  const encodedProperty = encodeURIComponent(property);
  const requestedLimit = options?.limit && options.limit > 0 ? options.limit : GSC_API_MAX_ROW_LIMIT;
  const filterGroups = buildDimensionFilterGroups(options?.filters);
  const searchType = options?.searchType ?? 'web';

  const allPages: GSCPageRow[] = [];
  let startRow = 0;

  try {
    // Paginate — each page up to 25k rows.
    while (allPages.length < requestedLimit) {
      const remaining = requestedLimit - allPages.length;
      const batchSize = Math.min(remaining, GSC_API_MAX_ROW_LIMIT);

      const response = await axios.post(
        `https://www.googleapis.com/webmasters/v3/sites/${encodedProperty}/searchAnalytics/query`,
        {
          startDate: range.start_date,
          endDate: range.end_date,
          dimensions: ['page'],
          ...filterGroups,
          rowLimit: batchSize,
          startRow,
          type: searchType,
        },
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          timeout: 30_000,
        },
      );

      const rows = response.data?.rows ?? [];
      for (const row of rows) {
        allPages.push({
          page: row.keys?.[0] ?? '',
          clicks: row.clicks ?? 0,
          impressions: row.impressions ?? 0,
          ctr: row.ctr ?? 0,
          position: row.position ?? 0,
        });
      }

      // End of data: fewer rows than requested means we've drained the result set.
      if (rows.length < batchSize) break;
      startRow += batchSize;
    }
  } catch (err: any) {
    logger.debug(`fetchAllRankedPages failed for ${property}: ${err?.message ?? err}`);
  }

  return allPages.slice(0, requestedLimit);
}

/**
 * Fetch all ranked queries for a GSC property (site-wide, not per-URL).
 * Paginates the same way as fetchAllRankedPages.
 */
export async function fetchAllRankedQueries(
  property: string,
  accessToken: string,
  options?: FetchRankedOptions,
): Promise<GSCQuery[]> {
  const range = options?.dateRange ?? computeDateRange();
  const encodedProperty = encodeURIComponent(property);
  const requestedLimit = options?.limit && options.limit > 0 ? options.limit : GSC_API_MAX_ROW_LIMIT;
  const filterGroups = buildDimensionFilterGroups(options?.filters);
  const searchType = options?.searchType ?? 'web';

  const allQueries: GSCQuery[] = [];
  let startRow = 0;

  try {
    while (allQueries.length < requestedLimit) {
      const remaining = requestedLimit - allQueries.length;
      const batchSize = Math.min(remaining, GSC_API_MAX_ROW_LIMIT);

      const response = await axios.post(
        `https://www.googleapis.com/webmasters/v3/sites/${encodedProperty}/searchAnalytics/query`,
        {
          startDate: range.start_date,
          endDate: range.end_date,
          dimensions: ['query'],
          ...filterGroups,
          rowLimit: batchSize,
          startRow,
          type: searchType,
        },
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          timeout: 30_000,
        },
      );

      const rows = response.data?.rows ?? [];
      for (const row of rows) {
        allQueries.push({
          query: row.keys?.[0] ?? '',
          clicks: row.clicks ?? 0,
          impressions: row.impressions ?? 0,
          ctr: row.ctr ?? 0,
          position: row.position ?? 0,
        });
      }

      if (rows.length < batchSize) break;
      startRow += batchSize;
    }
  } catch (err: any) {
    logger.debug(`fetchAllRankedQueries failed for ${property}: ${err?.message ?? err}`);
  }

  return allQueries.slice(0, requestedLimit);
}

// ---------------------------------------------------------------------------
// Main GSC Data Fetcher (analyze pipeline — do not break behaviour)
// ---------------------------------------------------------------------------

/**
 * Fetch all GSC data for a URL.
 *
 * Returns null if:
 * - GSC is not configured
 * - URL doesn't match any verified property
 * - Authentication fails
 */
export async function fetchGSCData(url: string, resolvedConfig?: ResolvedConfig): Promise<GSCData | null> {
  // Use injected config when provided, otherwise fall back to file config
  const fileConfig = loadConfig();
  const clientId = resolvedConfig?.gsc?.clientId ?? fileConfig.gsc?.clientId;
  const clientSecret = resolvedConfig?.gsc?.clientSecret ?? fileConfig.gsc?.clientSecret;
  const properties = resolvedConfig?.gsc?.properties ?? fileConfig.gsc?.properties;

  if (!clientId || !clientSecret) return null;
  if (!properties || properties.length === 0) return null;

  const property = resolveGSCProperty(url, properties);
  if (!property) return null;

  let accessToken: string | null;
  if (resolvedConfig?.gsc?.tokens?.access_token) {
    // Use injected OAuth tokens directly (multi-tenant / library path).
    // NOTE: If the injected token is expired and a refresh_token is present,
    // callers must refresh before passing tokens. This path does not auto-refresh.
    accessToken = resolvedConfig.gsc.tokens.access_token;
  } else {
    accessToken = await getAccessToken(clientId, clientSecret);
  }
  if (!accessToken) return null;

  // Fetch all GSC data in parallel
  const [searchPerformance, indexStatus, sitemaps] = await Promise.allSettled([
    fetchSearchAnalytics(url, property, accessToken),
    fetchURLInspection(url, property, accessToken),
    fetchSitemaps(property, accessToken),
  ]);

  const sp = searchPerformance.status === 'fulfilled' ? searchPerformance.value : null;
  const is = indexStatus.status === 'fulfilled' ? indexStatus.value : null;
  const sm = sitemaps.status === 'fulfilled' ? sitemaps.value : null;

  // Return null if we got nothing useful
  if (!sp && !is) return null;

  return {
    search_performance: sp ?? {
      total_clicks: 0,
      total_impressions: 0,
      average_ctr: 0,
      average_position: 0,
      top_queries: [],
    },
    index_status: is ?? {
      verdict: 'NEUTRAL',
      coverage_state: 'Unknown',
      is_page_indexed: false,
    },
    ...(sm ? { sitemaps: sm } : {}),
  };
}
