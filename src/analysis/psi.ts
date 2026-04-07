import axios from 'axios';
import { SgnlError } from '../errors';
import { withRetry } from '../utils/retry';
import type { ResolvedConfig } from '../config';

/**
 * Custom error types for PSI API
 */
export class RateLimitError extends SgnlError {
  constructor(message: string) {
    super(message, 'PSI_RATE_LIMIT', 'PageSpeed API rate limit exceeded. Wait a moment and retry, or add an API key.');
    this.name = 'RateLimitError';
  }
}

export class AuthError extends SgnlError {
  constructor(message: string) {
    super(message, 'PSI_AUTH_ERROR', 'PSI API key is invalid or missing. Run `sgnl init` to configure.');
    this.name = 'AuthError';
  }
}

export class NotFoundError extends SgnlError {
  constructor(message: string) {
    super(message, 'PSI_NOT_FOUND');
    this.name = 'NotFoundError';
  }
}

export class TimeoutError extends SgnlError {
  constructor(message: string) {
    super(message, 'PSI_TIMEOUT', 'PageSpeed API request timed out. The target page may be too slow or unreachable.');
    this.name = 'TimeoutError';
  }
}

/**
 * Histogram bucket distribution (good / needs-improvement / poor proportions)
 */
export interface HistogramBucket {
  min: number;
  max: number;
  proportion: number;
}

/**
 * Metric value extracted from PSI response (field or lab data).
 * `distribution` is populated when the source is CrUX (either direct API or PSI loadingExperience)
 * and carries the good / needs-improvement / poor proportions.
 */
export interface MetricValue {
  value: number;
  unit: string;
  status: 'good' | 'warn' | 'fail';
  target: number;
  distribution?: HistogramBucket[];
}

/**
 * Opportunity/audit extracted from PSI response
 */
export interface Opportunity {
  id: string;
  priority: number;
  savings_ms: number;
  savings_bytes?: number;
  status: 'pass' | 'warn' | 'fail';
  fix: string;
}

/**
 * Lab data from Lighthouse
 */
export interface LabData {
  performance_score: number;
  speed_index_s: number;
  tti_s: number;
  tbt_ms: number;
  cls: number;
}

/**
 * Category scores from Lighthouse (0-100).
 * All four categories are requested in `category` param.
 */
export interface CategoryScores {
  performance: number;
  accessibility: number;
  best_practices: number;
  seo: number;
}

/**
 * Field data from CrUX
 */
export interface FieldData {
  lcp: MetricValue;
  cls: MetricValue;
  inp: MetricValue;
  fcp: MetricValue;
  fid: MetricValue; // First Input Delay (from FIRST_INPUT_DELAY_MS)
}

/**
 * Resource summary — bytes AND request counts by type.
 */
export interface ResourceSummary {
  total_bytes: number;
  script_bytes: number;
  stylesheet_bytes: number;
  image_bytes: number;
  font_bytes: number;
  other_bytes: number;
  // Request counts (Phase 1.6)
  total_requests?: number;
  script_requests?: number;
  stylesheet_requests?: number;
  image_requests?: number;
  font_requests?: number;
  other_requests?: number;
}

/**
 * LCP element identifier from Lighthouse `largest-contentful-paint-element` audit.
 */
export interface LcpElement {
  selector?: string;
  snippet?: string;
  nodeLabel?: string;
}

/**
 * Layout-shift element entry from Lighthouse `layout-shift-elements` audit.
 */
export interface ClsElement {
  selector?: string;
  score?: number;
}

/**
 * Render-blocking resource entry from Lighthouse `render-blocking-resources` audit.
 */
export interface RenderBlockingResource {
  url: string;
  wastedMs?: number;
}

/**
 * Third-party summary entry from Lighthouse `third-party-summary` audit.
 */
export interface ThirdPartyEntry {
  entity: string;
  blockingTime?: number;
  transferSize?: number;
}

/**
 * JS bootup entry from Lighthouse `bootup-time` audit.
 */
export interface BootupEntry {
  url: string;
  scripting?: number;
  scriptParseCompile?: number;
}

/**
 * Diagnostics block (Lighthouse `diagnostics` audit).
 */
export interface PsiDiagnostics {
  dom_size?: number;
  network_rtt?: number;
  network_server_latency?: number;
  total_tasks?: number;
  main_document_transfer_size?: number;
}

/**
 * Complete PSI result
 */
export interface PSIResult {
  url: string;
  strategy: 'desktop' | 'mobile';
  field_data: FieldData | null;
  lab_data: LabData;
  opportunities: Opportunity[];
  resource_summary?: ResourceSummary;
  category_scores?: CategoryScores;
  lcp_element?: LcpElement;
  cls_elements?: ClsElement[];
  render_blocking?: RenderBlockingResource[];
  third_party?: ThirdPartyEntry[];
  bootup?: { total_ms?: number; items: BootupEntry[] };
  server_response_time_ms?: number;
  request_count?: number;
  diagnostics?: PsiDiagnostics;
  error?: string;
  _raw?: any;
}

/**
 * Extract field data from PSI loadingExperience response.
 * Reads metric.percentile with the correct uppercase key names from the API.
 *
 * CLS scaling note: the PSI `loadingExperience.metrics.CUMULATIVE_LAYOUT_SHIFT_SCORE.percentile`
 * value is reported as `score × 100` (e.g. 5 means CLS=0.05). This is a historical quirk of
 * the PSI API that does NOT exist in the standalone CrUX API (`crux.ts` returns the raw score).
 * Both code paths normalise to the actual CLS score.
 *
 * See tests/unit/psi.test.ts and tests/unit/crux-cls-scaling.test.ts for lockdown coverage.
 */
export function extractFieldDataFromLighthouse(response: any): FieldData | null {
  try {
    const m = response.loadingExperience?.metrics;
    if (!m) return null;

    const lcpP = m.LARGEST_CONTENTFUL_PAINT_MS?.percentile as number | undefined;
    const clsP = m.CUMULATIVE_LAYOUT_SHIFT_SCORE?.percentile as number | undefined;
    const inpP = m.INTERACTION_TO_NEXT_PAINT?.percentile as number | undefined;
    const fcpP = m.FIRST_CONTENTFUL_PAINT_MS?.percentile as number | undefined;
    const fidP = m.FIRST_INPUT_DELAY_MS?.percentile as number | undefined;

    if (lcpP == null && clsP == null && inpP == null) return null;

    // CLS percentile from PSI loadingExperience is score×100 — divide to get actual CLS score
    const clsVal = clsP != null ? clsP / 100 : 0;

    // Parse histogram distributions from PSI loadingExperience `distributions` array
    const dist = (key: string): HistogramBucket[] | undefined => {
      const buckets = m[key]?.distributions;
      if (!Array.isArray(buckets)) return undefined;
      return buckets.map((b: any) => ({
        min: b.min ?? 0,
        max: b.max ?? Infinity,
        proportion: b.proportion ?? 0,
      }));
    };

    return {
      lcp: { value: lcpP ?? 0, unit: 'ms',    status: (lcpP ?? 9999) <= 2500 ? 'good' : (lcpP ?? 9999) <= 4000 ? 'warn' : 'fail', target: 2500, distribution: dist('LARGEST_CONTENTFUL_PAINT_MS') },
      cls: { value: clsVal,    unit: 'score',  status: clsVal <= 0.1 ? 'good' : clsVal <= 0.25 ? 'warn' : 'fail',                   target: 0.1,  distribution: dist('CUMULATIVE_LAYOUT_SHIFT_SCORE') },
      inp: { value: inpP ?? 0, unit: 'ms',     status: (inpP ?? 9999) <= 200  ? 'good' : (inpP ?? 9999) <= 500  ? 'warn' : 'fail', target: 200,  distribution: dist('INTERACTION_TO_NEXT_PAINT') },
      fcp: { value: fcpP ?? 0, unit: 'ms',     status: (fcpP ?? 9999) <= 1800 ? 'good' : 'warn',                                   target: 1800, distribution: dist('FIRST_CONTENTFUL_PAINT_MS') },
      fid: { value: fidP ?? 0, unit: 'ms',     status: (fidP ?? 9999) <= 100  ? 'good' : (fidP ?? 9999) <= 300  ? 'warn' : 'fail', target: 100,  distribution: dist('FIRST_INPUT_DELAY_MS') },
    };
  } catch {
    return null;
  }
}

/**
 * Extract lab data (Lighthouse) from PSI response
 */
function extractLabData(response: any): LabData {
  try {
    const lighthouseResult = response.lighthouseResult || response.runPagespeedInsights;
    if (!lighthouseResult) {
      return {
        performance_score: 0,
        speed_index_s: 0,
        tti_s: 0,
        tbt_ms: 0,
        cls: 0,
      };
    }

    const audits = lighthouseResult.audits || {};
    const categories = lighthouseResult.categories || {};

    // Performance score (0-100)
    const performanceScore = categories.performance?.score
      ? Math.round(categories.performance.score * 100)
      : 0;

    // Speed Index (in seconds, convert from ms)
    const speedIndexAudit = audits['speed-index'];
    const speedIndexS = speedIndexAudit ? parseFloat((speedIndexAudit.numericValue / 1000).toFixed(2)) : 0;

    // TTI - Time to Interactive (in seconds, convert from ms)
    const ttiAudit = audits['interactive'];
    const ttiS = ttiAudit ? parseFloat((ttiAudit.numericValue / 1000).toFixed(2)) : 0;

    // TBT - Total Blocking Time (in ms)
    const tbtAudit = audits['total-blocking-time'];
    const tbtMs = tbtAudit ? parseFloat(tbtAudit.numericValue.toFixed(0)) : 0;

    // CLS - Cumulative Layout Shift
    const clsAudit = audits['cumulative-layout-shift'];
    const cls = clsAudit ? parseFloat(clsAudit.numericValue.toFixed(3)) : 0;

    return {
      performance_score: performanceScore,
      speed_index_s: speedIndexS,
      tti_s: ttiS,
      tbt_ms: tbtMs,
      cls,
    };
  } catch {
    return {
      performance_score: 0,
      speed_index_s: 0,
      tti_s: 0,
      tbt_ms: 0,
      cls: 0,
    };
  }
}

/**
 * Extract Lighthouse category scores (performance/accessibility/best-practices/seo).
 * Scores are 0-100 integers; missing categories return 0.
 */
export function extractCategoryScores(response: any): CategoryScores | undefined {
  try {
    const cats = response?.lighthouseResult?.categories;
    if (!cats) return undefined;
    const toPct = (s: any) => (typeof s === 'number' ? Math.round(s * 100) : 0);
    return {
      performance: toPct(cats.performance?.score),
      accessibility: toPct(cats.accessibility?.score),
      best_practices: toPct(cats['best-practices']?.score),
      seo: toPct(cats.seo?.score),
    };
  } catch {
    return undefined;
  }
}

/**
 * Extract resource summary from PSI Lighthouse audits — bytes + request counts per type.
 */
function extractResourceSummary(response: any): ResourceSummary | null {
  try {
    const audits = response?.lighthouseResult?.audits;
    if (!audits) return null;

    const summary = audits['resource-summary'];
    if (summary?.details?.items) {
      const items = summary.details.items as any[];
      const bytes: Record<string, number> = {};
      const counts: Record<string, number> = {};
      for (const item of items) {
        const t = item.resourceType;
        bytes[t] = item.transferSize ?? 0;
        counts[t] = item.requestCount ?? 0;
      }
      const total_bytes = Object.values(bytes).reduce((a, b) => a + b, 0);
      const total_requests = Object.values(counts).reduce((a, b) => a + b, 0);
      return {
        total_bytes,
        script_bytes: bytes['script'] ?? 0,
        stylesheet_bytes: bytes['stylesheet'] ?? 0,
        image_bytes: bytes['image'] ?? 0,
        font_bytes: bytes['font'] ?? 0,
        other_bytes: (bytes['other'] ?? 0) + (bytes['document'] ?? 0) + (bytes['media'] ?? 0),
        total_requests,
        script_requests: counts['script'] ?? 0,
        stylesheet_requests: counts['stylesheet'] ?? 0,
        image_requests: counts['image'] ?? 0,
        font_requests: counts['font'] ?? 0,
        other_requests: (counts['other'] ?? 0) + (counts['document'] ?? 0) + (counts['media'] ?? 0),
      };
    }

    // Fallback: 'total-byte-weight' audit
    const totalWeight = audits['total-byte-weight'];
    if (totalWeight?.numericValue) {
      return {
        total_bytes: Math.round(totalWeight.numericValue),
        script_bytes: 0,
        stylesheet_bytes: 0,
        image_bytes: 0,
        font_bytes: 0,
        other_bytes: 0,
      };
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Extract opportunities from PSI response. Includes `savings_bytes` from
 * `audit.details.overallSavingsBytes` when present.
 */
function extractOpportunities(response: any): Opportunity[] {
  try {
    const lighthouseResult = response.lighthouseResult || response.runPagespeedInsights;
    if (!lighthouseResult || !lighthouseResult.audits) {
      return [];
    }

    const audits = lighthouseResult.audits;
    const opportunities: Opportunity[] = [];

    const opportunityIds = [
      'render-blocking-resources',
      'unminified-javascript',
      'unminified-css',
      'unused-javascript',
      'unused-css',
      'modern-image-formats',
      'offscreen-images',
      'uses-webp-images',
      'uses-optimized-images',
      'legacy-javascript',
      'efficient-animated-gifs',
    ];

    opportunityIds.forEach((auditId) => {
      const audit = audits[auditId];
      if (!audit || !audit.details || audit.details.type !== 'opportunity') {
        return;
      }

      const savingsMs = audit.numericValue || 0;
      const savingsBytes = audit.details?.overallSavingsBytes;

      let status: 'pass' | 'warn' | 'fail' = 'pass';
      if (savingsMs > 1000) {
        status = 'fail';
      } else if (savingsMs > 100) {
        status = 'warn';
      }

      opportunities.push({
        id: auditId,
        priority: savingsMs,
        savings_ms: Math.round(savingsMs),
        ...(typeof savingsBytes === 'number' ? { savings_bytes: Math.round(savingsBytes) } : {}),
        status,
        fix: audit.title || audit.description || `Fix ${auditId}`,
      });
    });

    opportunities.sort((a, b) => b.savings_ms - a.savings_ms);

    return opportunities;
  } catch {
    return [];
  }
}

/**
 * Extract additional high-signal Lighthouse audits beyond the opportunity list.
 */
function extractAuditDetails(response: any): {
  lcp_element?: LcpElement;
  cls_elements?: ClsElement[];
  render_blocking?: RenderBlockingResource[];
  third_party?: ThirdPartyEntry[];
  bootup?: { total_ms?: number; items: BootupEntry[] };
  server_response_time_ms?: number;
  request_count?: number;
  diagnostics?: PsiDiagnostics;
} {
  const out: ReturnType<typeof extractAuditDetails> = {};
  try {
    const audits = response?.lighthouseResult?.audits;
    if (!audits) return out;

    // largest-contentful-paint-element
    const lcpElAudit = audits['largest-contentful-paint-element'];
    const lcpItem = lcpElAudit?.details?.items?.[0]?.items?.[0] ?? lcpElAudit?.details?.items?.[0];
    if (lcpItem && typeof lcpItem === 'object') {
      const node = lcpItem.node ?? lcpItem;
      const el: LcpElement = {};
      if (node?.selector) el.selector = String(node.selector);
      if (node?.snippet) el.snippet = String(node.snippet);
      if (node?.nodeLabel) el.nodeLabel = String(node.nodeLabel);
      if (Object.keys(el).length > 0) out.lcp_element = el;
    }

    // layout-shift-elements
    const clsElAudit = audits['layout-shift-elements'];
    const clsItems = clsElAudit?.details?.items;
    if (Array.isArray(clsItems) && clsItems.length > 0) {
      out.cls_elements = clsItems.slice(0, 5).map((it: any) => ({
        selector: it?.node?.selector ?? it?.selector,
        score: typeof it?.score === 'number' ? it.score : undefined,
      }));
    }

    // render-blocking-resources detail
    const rbAudit = audits['render-blocking-resources'];
    const rbItems = rbAudit?.details?.items;
    if (Array.isArray(rbItems) && rbItems.length > 0) {
      out.render_blocking = rbItems.slice(0, 5).map((it: any) => ({
        url: String(it?.url ?? ''),
        wastedMs: typeof it?.wastedMs === 'number' ? Math.round(it.wastedMs) : undefined,
      }));
    }

    // third-party-summary
    const tpAudit = audits['third-party-summary'];
    const tpItems = tpAudit?.details?.items;
    if (Array.isArray(tpItems) && tpItems.length > 0) {
      out.third_party = tpItems.slice(0, 5).map((it: any) => ({
        entity: typeof it?.entity === 'string'
          ? it.entity
          : (it?.entity?.text ?? String(it?.entity ?? '')),
        blockingTime: typeof it?.blockingTime === 'number' ? Math.round(it.blockingTime) : undefined,
        transferSize: typeof it?.transferSize === 'number' ? Math.round(it.transferSize) : undefined,
      }));
    }

    // bootup-time
    const buAudit = audits['bootup-time'];
    const buItems = buAudit?.details?.items;
    if (Array.isArray(buItems)) {
      out.bootup = {
        total_ms: typeof buAudit?.numericValue === 'number' ? Math.round(buAudit.numericValue) : undefined,
        items: buItems.slice(0, 5).map((it: any) => ({
          url: String(it?.url ?? ''),
          scripting: typeof it?.scripting === 'number' ? Math.round(it.scripting) : undefined,
          scriptParseCompile: typeof it?.scriptParseCompile === 'number' ? Math.round(it.scriptParseCompile) : undefined,
        })),
      };
    }

    // server-response-time
    const srtAudit = audits['server-response-time'];
    if (typeof srtAudit?.numericValue === 'number') {
      out.server_response_time_ms = Math.round(srtAudit.numericValue);
    }

    // network-requests count
    const nrAudit = audits['network-requests'];
    const nrItems = nrAudit?.details?.items;
    if (Array.isArray(nrItems)) {
      out.request_count = nrItems.length;
    }

    // diagnostics
    const diagAudit = audits['diagnostics'];
    const diagItem = diagAudit?.details?.items?.[0];
    if (diagItem && typeof diagItem === 'object') {
      const diag: PsiDiagnostics = {};
      if (typeof diagItem.numElements === 'number') diag.dom_size = diagItem.numElements;
      if (typeof diagItem.rtt === 'number') diag.network_rtt = Math.round(diagItem.rtt);
      if (typeof diagItem.maxServerLatency === 'number') diag.network_server_latency = Math.round(diagItem.maxServerLatency);
      if (typeof diagItem.numTasks === 'number') diag.total_tasks = diagItem.numTasks;
      if (typeof diagItem.mainDocumentTransferSize === 'number') diag.main_document_transfer_size = diagItem.mainDocumentTransferSize;
      if (Object.keys(diag).length > 0) out.diagnostics = diag;
    }
  } catch {
    // swallow — diagnostics extraction is best-effort
  }
  return out;
}

/**
 * Call Google PageSpeed Insights API for a single strategy
 */
async function callPSISingle(url: string, strategy: 'desktop' | 'mobile', config?: ResolvedConfig): Promise<any> {
  const resolved = config ?? (await import('../config')).resolveConfig();
  const apiKey = resolved.psiKey;
  if (!apiKey) {
    throw new AuthError('PSI API key not set. Run `sgnl init` or set SGNL_PSI_KEY env var.');
  }

  const apiUrl = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';

  const params = {
    url,
    key: apiKey,
    strategy,
    category: ['performance', 'accessibility', 'best-practices', 'seo'],
  };

  try {
    const response = await axios.get(apiUrl, {
      params,
      timeout: 30000,
    });

    return response.data;
  } catch (err) {
    const errObj = err as any;

    // Check for timeout errors first (regardless of response)
    if (errObj?.code === 'ECONNABORTED' || errObj?.message?.includes('timeout')) {
      throw new TimeoutError(`PSI request timeout: ${errObj.message}`);
    }

    // Check for HTTP status errors
    const isAxiosError = err && typeof err === 'object' && 'response' in err;
    if (isAxiosError) {
      const status = errObj.response?.status;
      const message = errObj.response?.data?.error?.message || errObj.message;

      if (status === 429) {
        throw new RateLimitError(`PSI rate limit exceeded: ${message}`);
      }
      if (status === 403) {
        throw new AuthError(`PSI authentication failed: ${message}`);
      }
      if (status === 404) {
        throw new NotFoundError(`PSI URL not found: ${url}`);
      }
    }
    throw err;
  }
}

/**
 * Call Google PageSpeed Insights API for a single strategy.
 * @param url - URL to analyze
 * @param strategy - 'desktop' | 'mobile'
 * @returns Promise<PSIResult>
 */
export async function callPSI(url: string, strategy: 'desktop' | 'mobile', config?: ResolvedConfig): Promise<PSIResult> {
  try {
    // Validate URL
    try {
      new URL(url);
    } catch {
      throw new NotFoundError(`Invalid URL: ${url}`);
    }

    // Call PSI API with retry on rate limits and timeouts
    const response = await withRetry(() => callPSISingle(url, strategy, config), {
      maxAttempts: 3,
      retryOn: (e) => e instanceof RateLimitError || e instanceof TimeoutError,
    });

    // Extract field data from PSI loadingExperience (unreliable fallback).
    // Callers should prefer the standalone CrUX API (crux.ts) when possible.
    const fieldData = extractFieldDataFromLighthouse(response);

    // Extract lab data (Lighthouse)
    const labData = extractLabData(response);

    // Extract opportunities
    const opportunities = extractOpportunities(response);

    // Extract resource summary
    const resource_summary = extractResourceSummary(response);

    // Extract the four category scores (performance + accessibility + best-practices + SEO)
    const category_scores = extractCategoryScores(response);

    // Extract additional Lighthouse audit details
    const auditDetails = extractAuditDetails(response);

    return {
      url,
      strategy,
      field_data: fieldData,
      lab_data: labData,
      opportunities,
      ...(resource_summary ? { resource_summary } : {}),
      ...(category_scores ? { category_scores } : {}),
      ...auditDetails,
      _raw: response,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);

    // Re-throw custom errors
    if (
      err instanceof RateLimitError ||
      err instanceof AuthError ||
      err instanceof NotFoundError ||
      err instanceof TimeoutError
    ) {
      throw err;
    }

    // Return graceful result with error
    return {
      url,
      strategy,
      field_data: null,
      lab_data: {
        performance_score: 0,
        speed_index_s: 0,
        tti_s: 0,
        tbt_ms: 0,
        cls: 0,
      },
      opportunities: [],
      error: errorMsg,
    };
  }
}

/**
 * Call PSI for both desktop and mobile strategies in parallel
 */
export async function callPSIParallel(url: string, config?: ResolvedConfig): Promise<[PSIResult, PSIResult]> {
  const results = await Promise.all([callPSI(url, 'desktop', config), callPSI(url, 'mobile', config)]);
  return results as [PSIResult, PSIResult];
}
