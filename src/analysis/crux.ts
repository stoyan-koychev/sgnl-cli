import axios from 'axios';
import { FieldData, HistogramBucket } from './psi';
import { SgnlError } from '../errors';
import { withRetry } from '../utils/retry';
import type { ResolvedConfig } from '../config';

/**
 * Custom error for CrUX API failures
 */
export class CrUXError extends SgnlError {
  constructor(message: string) {
    super(message, 'CRUX_ERROR');
    this.name = 'CrUXError';
  }
}

/**
 * A single CrUX metric with histogram and p75 percentile
 */
export interface CrUXMetric {
  value: number;
  percentile: number;
  distribution: HistogramBucket[];
}

/**
 * Collection period returned by the CrUX API.
 * Rendered as ISO dates in terminal/markdown output.
 */
export interface CruxCollectionPeriod {
  firstDate?: string; // YYYY-MM-DD
  lastDate?: string;  // YYYY-MM-DD
}

/**
 * The full CrUX record returned by the API
 */
export interface CrUXRecord {
  collectionPeriod: { startTime: string; endTime: string };
  metrics: {
    largest_contentful_paint?: CrUXMetric;
    cumulative_layout_shift?: CrUXMetric;
    first_input_delay?: CrUXMetric;
    interaction_to_next_paint?: CrUXMetric;
  };
}

/**
 * Raw API histogram bucket from CrUX response
 */
interface RawHistogramBucket {
  start: number;
  end?: number;
  density: number;
}

/**
 * Parse a raw CrUX metric from the API response into our CrUXMetric interface.
 * CrUX returns p75 in metric.percentiles.p75 and histogram buckets.
 *
 * NOTE on CLS scaling: the standalone CrUX API returns CLS as the raw score (e.g. 0.05),
 * NOT the score×100 form that PSI's loadingExperience endpoint uses. Do NOT divide.
 * See extractFieldDataFromLighthouse in psi.ts for the PSI-side scaling fix.
 */
function parseCrUXMetric(raw: any): CrUXMetric | undefined {
  if (!raw) return undefined;

  const p75 = raw.percentiles?.p75;
  if (p75 === undefined && p75 !== 0) {
    // Try to calculate p75 from histogram
    if (!raw.histogram || raw.histogram.length === 0) return undefined;
  }

  const histogram: RawHistogramBucket[] = raw.histogram ?? [];

  const distribution: HistogramBucket[] = histogram.map((bucket: RawHistogramBucket) => ({
    min: bucket.start ?? 0,
    max: bucket.end ?? Infinity,
    proportion: bucket.density ?? 0,
  }));

  // p75 value — use from percentiles if available, otherwise estimate from distribution
  let percentileValue = p75 ?? 0;
  if (percentileValue === undefined || percentileValue === null) {
    percentileValue = estimateP75FromDistribution(distribution);
  }

  return {
    value: percentileValue,
    percentile: percentileValue,
    distribution,
  };
}

/**
 * Estimate p75 value from a distribution (histogram) when percentiles are not provided.
 * Walks buckets accumulating proportion until we cross 0.75.
 */
export function estimateP75FromDistribution(
  distribution: Array<{ min: number; max: number; proportion: number }>,
): number {
  if (!distribution || distribution.length === 0) return 0;

  let cumulative = 0;
  for (const bucket of distribution) {
    cumulative += bucket.proportion;
    if (cumulative >= 0.75) {
      const bucketMax = isFinite(bucket.max) ? bucket.max : bucket.min * 2;
      return Math.round((bucket.min + bucketMax) / 2);
    }
  }

  const last = distribution[distribution.length - 1];
  const lastMax = isFinite(last.max) ? last.max : last.min * 2;
  return Math.round((last.min + lastMax) / 2);
}

function lcpStatus(value: number): 'good' | 'warn' | 'fail' {
  return value <= 2500 ? 'good' : value <= 4000 ? 'warn' : 'fail';
}

function clsStatus(value: number): 'good' | 'warn' | 'fail' {
  return value <= 0.1 ? 'good' : value <= 0.25 ? 'warn' : 'fail';
}

function fidStatus(value: number): 'good' | 'warn' | 'fail' {
  return value <= 100 ? 'good' : value <= 300 ? 'warn' : 'fail';
}

function inpStatus(value: number): 'good' | 'warn' | 'fail' {
  return value <= 200 ? 'good' : value <= 500 ? 'warn' : 'fail';
}

/**
 * Format a CrUX `{year,month,day}` structure as an ISO date string (YYYY-MM-DD).
 */
function formatCruxDate(d: any): string | undefined {
  if (!d || typeof d !== 'object') return undefined;
  const y = d.year;
  const m = d.month;
  const day = d.day;
  if (typeof y !== 'number' || typeof m !== 'number' || typeof day !== 'number') return undefined;
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Result shape returned by fetchCrUXData. Includes the parsed FieldData plus
 * metadata (collection period, which scope resolved, raw response for debug).
 */
export interface CruxFetchResult {
  data: FieldData | null;
  raw: any | null;
  collectionPeriod?: CruxCollectionPeriod;
  scope?: 'url' | 'origin';
}

/**
 * Build a CrUX metric → FieldData entry, carrying distribution through.
 */
function buildFieldDataFromMetrics(metrics: any): FieldData | null {
  const lcp = parseCrUXMetric(metrics.largest_contentful_paint);
  const cls = parseCrUXMetric(metrics.cumulative_layout_shift);
  const fid = parseCrUXMetric(metrics.first_input_delay);
  const inp = parseCrUXMetric(metrics.interaction_to_next_paint);

  if (!lcp && !cls && !fid && !inp) return null;

  return {
    lcp: lcp
      ? { value: lcp.value, unit: 'ms', status: lcpStatus(lcp.value), target: 2500, distribution: lcp.distribution }
      : { value: 0, unit: 'ms', status: 'fail', target: 2500 },
    cls: cls
      ? { value: cls.value, unit: 'score', status: clsStatus(cls.value), target: 0.1, distribution: cls.distribution }
      : { value: 0, unit: 'score', status: 'fail', target: 0.1 },
    fid: fid
      ? { value: fid.value, unit: 'ms', status: fidStatus(fid.value), target: 100, distribution: fid.distribution }
      : { value: 0, unit: 'ms', status: 'fail', target: 100 },
    inp: inp
      ? { value: inp.value, unit: 'ms', status: inpStatus(inp.value), target: 200, distribution: inp.distribution }
      : { value: 0, unit: 'ms', status: 'fail', target: 200 },
    // FCP not in CrUX basic metrics — default
    fcp: { value: 0, unit: 'ms', status: 'fail', target: 1800 },
  };
}

type CruxBodyIdentifier = { url: string } | { origin: string };

/**
 * Issue a single CrUX queryRecord request with the given identifier (url or origin)
 * and optional formFactor. Returns `null` on 404/400 (no data), throws on other errors.
 */
async function queryCruxRecord(
  apiKey: string,
  identifier: CruxBodyIdentifier,
  formFactor?: 'PHONE' | 'DESKTOP' | 'TABLET',
): Promise<{ data: FieldData | null; raw: any; collectionPeriod?: CruxCollectionPeriod } | null> {
  const endpoint = 'https://www.googleapis.com/chromeuxreport/v1/records:queryRecord';
  const body: Record<string, any> = {
    ...identifier,
    metrics: [
      'largest_contentful_paint',
      'cumulative_layout_shift',
      'first_input_delay',
      'interaction_to_next_paint',
    ],
  };
  if (formFactor) body.formFactor = formFactor;

  try {
    const response = await withRetry(
      () => axios.post(endpoint, body, {
        params: { key: apiKey },
        timeout: 10000,
        headers: { 'Content-Type': 'application/json' },
      }),
      { maxAttempts: 2, retryOn: (e: any) => e?.response?.status === 429 || e?.code === 'ECONNABORTED' },
    );

    const raw = response.data;
    const record = raw?.record;
    if (!record?.metrics) {
      return { data: null, raw };
    }

    const data = buildFieldDataFromMetrics(record.metrics);

    const cpRaw = record.collectionPeriod;
    const collectionPeriod: CruxCollectionPeriod | undefined = cpRaw
      ? { firstDate: formatCruxDate(cpRaw.firstDate), lastDate: formatCruxDate(cpRaw.lastDate) }
      : undefined;

    return { data, raw, collectionPeriod };
  } catch (err: any) {
    if (err?.code === 'ECONNABORTED' || err?.message?.includes('timeout')) {
      throw new CrUXError(`CrUX request timed out: ${err.message}`);
    }
    // 404 / 400 — no data for this identifier
    if (err?.response?.status === 404 || err?.response?.status === 400) {
      return null;
    }
    if (err?.response?.status === 403) {
      throw new CrUXError(`CrUX API authentication failed: ${err.response?.data?.error?.message || err.message}`);
    }
    if (err?.response?.status === 429) {
      throw new CrUXError(`CrUX API rate limit exceeded`);
    }
    if (err?.response?.status) {
      return null;
    }
    throw new CrUXError(`CrUX request failed: ${err.message}`);
  }
}

/**
 * Fetch Core Web Vitals field data from the Chrome UX Report API.
 *
 * Behavior:
 *   1. Query by URL (most specific). If data is returned, use it with `scope: 'url'`.
 *   2. If the URL-level query returns 404/400 or an empty record, retry with
 *      `{ origin }` and flag the result as `scope: 'origin'` so the UI can show
 *      "(origin-level data)".
 *   3. `formFactor` (PHONE / DESKTOP / TABLET) is forwarded when provided to avoid
 *      mixing phone + desktop + tablet buckets into one distribution.
 *
 * Returns `{ data: null, raw: null }` (no throw) when:
 * - No API key is set
 * - Both URL and origin queries have no data
 * - Non-auth HTTP error (graceful degradation)
 *
 * Throws CrUXError on auth (403), rate limit (429), or timeout so the caller can decide.
 */
export async function fetchCrUXData(
  url: string,
  config?: ResolvedConfig,
  opts?: { formFactor?: 'PHONE' | 'DESKTOP' | 'TABLET' },
): Promise<CruxFetchResult> {
  const apiKey = config?.psiKey ?? process.env.SGNL_PSI_KEY;
  if (!apiKey) {
    return { data: null, raw: null };
  }

  const formFactor = opts?.formFactor;

  // Step 1: URL-level lookup.
  const urlResult = await queryCruxRecord(apiKey, { url }, formFactor);
  if (urlResult && urlResult.data) {
    return {
      data: urlResult.data,
      raw: urlResult.raw,
      collectionPeriod: urlResult.collectionPeriod,
      scope: 'url',
    };
  }

  // Step 2: Origin-level fallback. Only attempt if we can derive an origin.
  let origin: string | null = null;
  try {
    origin = new URL(url).origin;
  } catch {
    origin = null;
  }

  if (origin) {
    const originResult = await queryCruxRecord(apiKey, { origin }, formFactor);
    if (originResult && originResult.data) {
      return {
        data: originResult.data,
        raw: originResult.raw,
        collectionPeriod: originResult.collectionPeriod,
        scope: 'origin',
      };
    }
    // Return the origin-level raw response even if data is empty, so callers can
    // inspect why (e.g. empty record, quota).
    if (originResult) {
      return { data: null, raw: originResult.raw };
    }
  }

  // Both queries returned null (no data)
  return { data: null, raw: urlResult?.raw ?? null };
}
