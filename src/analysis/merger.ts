import { FetchResult } from './fetch';
import {
  PSIResult,
  FieldData,
  CategoryScores,
  LcpElement,
  ClsElement,
  RenderBlockingResource,
  ThirdPartyEntry,
  BootupEntry,
  PsiDiagnostics,
} from './psi';
import type { CruxCollectionPeriod } from './crux';
import { DOMAnalysis, TechnicalSEO, OnPageSEO, ContentAnalysis, RobotsInfo, SchemaValidationInfo, SchemaValidationBlock } from './scoring';
import type { RawPythonData } from './python-types';
import type { GSCData } from './gsc';

// ---------------------------------------------------------------------------
// AnalysisDetail — full Python script outputs for JSON consumers
// ---------------------------------------------------------------------------
export interface AnalysisDetail {
  xray?: Record<string, any>;
  technical_seo?: Record<string, any>;
  onpage?: Record<string, any>;
  content_analysis?: Record<string, any>;
}

// ---------------------------------------------------------------------------
// PythonAnalysis — composite output from all 4 Python scripts
// ---------------------------------------------------------------------------
export interface PythonAnalysis {
  skeleton?: string;
  markdown?: string;
  dom?: DOMAnalysis;
  technical_seo?: TechnicalSEO;
  onpage_seo?: OnPageSEO;
  content_analysis?: ContentAnalysis;
}

// ---------------------------------------------------------------------------
// AnalysisReport — the final merged output
// ---------------------------------------------------------------------------
export interface AnalysisReport {
  // Meta
  url: string;
  timestamp: string; // ISO 8601
  http_status: number;
  crawlable: boolean;
  https: boolean;

  // Performance
  performance: {
    core_web_vitals: {
      lcp_ms?: number;
      fcp_ms?: number;
      cls?: number;
      inp_ms?: number;
      fid_ms?: number;
      // Phase 2.5 — Core Web Vitals verdict (null = insufficient data)
      cwv_passing?: boolean | null;
    };
    speed_metrics: {
      ttfb_ms: number;
      speed_index_s?: number;
      tti_s?: number;
      tbt_ms?: number;
      performance_score?: number;
    };
    cdn?: string;
    compression?: string;
    resource_summary?: {
      total_bytes: number;
      script_bytes: number;
      stylesheet_bytes: number;
      image_bytes: number;
      font_bytes: number;
      other_bytes: number;
      total_requests?: number;
      script_requests?: number;
      stylesheet_requests?: number;
      image_requests?: number;
      font_requests?: number;
      other_requests?: number;
    };
    // Phase 4 — expanded performance signals from `sgnl performance` audit
    category_scores?: CategoryScores;
    field_data_scope?: 'url' | 'origin';
    field_data_collection_period?: CruxCollectionPeriod;
    field_data_distributions?: {
      lcp?: Array<{ min: number; max: number; proportion: number }>;
      cls?: Array<{ min: number; max: number; proportion: number }>;
      inp?: Array<{ min: number; max: number; proportion: number }>;
      fcp?: Array<{ min: number; max: number; proportion: number }>;
      fid?: Array<{ min: number; max: number; proportion: number }>;
    };
    lcp_element?: LcpElement;
    cls_elements?: ClsElement[];
    render_blocking?: RenderBlockingResource[];
    third_party?: ThirdPartyEntry[];
    bootup?: { total_ms?: number; items: BootupEntry[] };
    server_response_time_ms?: number;
    request_count?: number;
    diagnostics?: PsiDiagnostics;
  };

  // SEO
  seo: {
    technical: {
      title?: string;
      description?: string;
      canonical?: string;
      schema_count: number;
      open_graph: boolean;
      twitter_card: boolean;
      indexable: boolean;
    } & Partial<Omit<TechnicalSEO, 'title' | 'description' | 'canonical' | 'open_graph'>>;
    content: {
      word_count: number;
      h1_count: number;
      headings_valid: boolean;
      images_total: number;
      images_alt_missing: number;
    } & Partial<OnPageSEO>;
    links: {
      internal_total: number;
      external_total: number;
      generic_anchor_text: number;
    };
  };

  // Structure
  structure: {
    dom_elements: number;
    div_ratio: number;
    semantic_score: number;
    heading_hierarchy_valid: boolean;
  } & Partial<DOMAnalysis>;

  // Issues/warnings
  issues: {
    critical: string[];
    warning: string[];
    info: string[];
  };

  // Redirect chain analysis
  redirect_analysis?: {
    chain_length: number;
    chain: string[];
    has_http_to_https: boolean;
    has_www_redirect: boolean;
    issues: string[];
  };

  // Robots.txt analysis (from robots_check.py)
  robots?: RobotsInfo;

  // Third-party scripts (from xray.py)
  third_party_scripts?: {
    count: number;
    domains: string[];
    categories: Record<string, string[]>;
    tag_manager_detected: boolean;
  };

  // Caching (from technical_seo.py)
  caching?: {
    cache_control: string | null;
    has_cache_control: boolean;
    has_etag: boolean;
    has_last_modified: boolean;
    max_age_seconds: number | null;
    is_cacheable: boolean;
    issues: string[];
  };

  // Resource hints (from technical_seo.py)
  resource_hints?: {
    preload: Array<{ href: string; as: string }>;
    prefetch: string[];
    dns_prefetch: string[];
    preconnect: string[];
    preload_count: number;
    dns_prefetch_count: number;
    preconnect_count: number;
  };

  // Schema.org validation (from schema_validator.py)
  schema_validation?: SchemaValidationInfo;

  // Full Python analysis detail (all fields from Python scripts)
  analysis_detail?: AnalysisDetail;

  // Google Search Console (only for verified properties)
  search_console?: {
    search_performance: {
      total_clicks: number;
      total_impressions: number;
      average_ctr: number;
      average_position: number;
      top_queries: Array<{
        query: string;
        clicks: number;
        impressions: number;
        ctr: number;
        position: number;
      }>;
    };
    index_status: {
      verdict: string;
      coverage_state: string;
      crawl_timestamp?: string;
      google_canonical?: string;
      is_page_indexed: boolean;
      rich_results?: string[];
    };
    sitemaps?: Array<{
      path: string;
      last_downloaded?: string;
      errors: number;
      warnings: number;
    }>;
  };

  // Content Analysis (Section 5) — summary fields are required for
  // backward compatibility; the ContentAnalysis mapper merges additional
  // typed detail fields (content_depth, eeat_signals, ...) on top.
  content_analysis?: ContentAnalysis & {
    depth_label: string;
    eeat_label: string;
    freshness_status: string;
    thin_content_risk: string;
    anchor_quality_score: string;
    snippet_eligible: boolean;
    issues: string[];
  };

  // Raw analysis data (optional, for debugging)
  _raw?: {
    fetch?: FetchResult;
    psi?: PSIResult;
    python?: PythonAnalysis;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Detect whether HTTPS is in use from fetch result.
 * Checks redirect chain or the final URL for https scheme.
 */
function detectHttps(url: string, fetch: FetchResult): boolean {
  // Check the original URL
  if (url.toLowerCase().startsWith('https://')) return true;

  // Check redirect chain
  if (fetch.redirect_chain && fetch.redirect_chain.length > 0) {
    const last = fetch.redirect_chain[fetch.redirect_chain.length - 1];
    if (last.toLowerCase().startsWith('https://')) return true;
    // If any hop in chain is https, the site redirects to https
    if (fetch.redirect_chain.some(u => u.toLowerCase().startsWith('https://'))) return true;
  }

  // Check response headers (x-forwarded-proto or similar)
  const proto = fetch.headers?.['x-forwarded-proto'] || fetch.headers?.['x-forwarded-protocol'] || '';
  if (proto.toLowerCase().includes('https')) return true;

  return false;
}

/**
 * Determine crawlability: page is crawlable if status < 400 and not explicitly blocked.
 */
function detectCrawlable(fetch: FetchResult, python: PythonAnalysis): boolean {
  if (fetch.status >= 400) return false;
  if (fetch.status === 0) return false;

  // Explicitly blocked by robots/meta robots
  const techSeo = python.technical_seo;
  if (techSeo?.is_indexable === false) return false;

  return true;
}

/**
 * Pick the most relevant PSI result. Prefer mobile, fall back to desktop.
 */
function pickPSI(psi: PSIResult[]): PSIResult | undefined {
  if (!psi || psi.length === 0) return undefined;
  return psi.find(p => p.strategy === 'mobile') ?? psi[0];
}

/**
/**
 * Extract a rough title from HTML (simple regex, not a full parser).
 */
function extractTitleFromHtml(html: string): string | undefined {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return match?.[1]?.trim() || undefined;
}

/**
 * Extract meta description from HTML.
 */
function extractDescriptionFromHtml(html: string): string | undefined {
  const match = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)
    ?? html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i);
  return match?.[1]?.trim() || undefined;
}

/**
 * Extract canonical URL from HTML.
 */
function extractCanonicalFromHtml(html: string): string | undefined {
  const match = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']*)["']/i)
    ?? html.match(/<link[^>]+href=["']([^"']*)["'][^>]+rel=["']canonical["']/i);
  return match?.[1]?.trim() || undefined;
}

/**
 * Count image tags in HTML.
 */
function countImages(html: string): number {
  const matches = html.match(/<img\b/gi);
  return matches ? matches.length : 0;
}

/**
 * Count images missing alt attribute (or with empty alt).
 */
function countMissingAlt(html: string): number {
  const imgTags = html.match(/<img\b[^>]*>/gi) ?? [];
  let missing = 0;
  for (const tag of imgTags) {
    if (!/\balt=["'][^"']+["']/i.test(tag)) missing++;
  }
  return missing;
}

/**
 * Count external links in HTML (href starting with http/https pointing to different domain).
 */
function countExternalLinks(html: string, baseUrl: string): number {
  let baseDomain = '';
  try { baseDomain = new URL(baseUrl).hostname; } catch { /* ignore */ }

  const hrefs = html.match(/href=["']([^"']+)["']/gi) ?? [];
  let external = 0;
  for (const href of hrefs) {
    const m = href.match(/href=["']([^"']+)["']/i);
    if (!m) continue;
    const val = m[1];
    if (val.startsWith('http://') || val.startsWith('https://')) {
      try {
        const domain = new URL(val).hostname;
        if (domain !== baseDomain) external++;
      } catch { /* ignore */ }
    }
  }
  return external;
}

/**
 * Generate issues list from the merged data.
 */
function generateIssues(
  fetch: FetchResult,
  psi: PSIResult | undefined,
  python: PythonAnalysis,
  https: boolean,
  contentAnalysis?: Record<string, any>,
  rawPythonData?: Record<string, any>,
): { critical: string[]; warning: string[]; info: string[] } {
  const critical: string[] = [];
  const warning: string[] = [];
  const info: string[] = [];

  const tech = python.technical_seo;
  const onpage = python.onpage_seo;
  const dom = python.dom;
  const xray = rawPythonData?.xray;
  const onpageRaw = rawPythonData?.onpage;
  const techSeoRaw = rawPythonData?.techSeo;

  // --- Critical ---
  if (fetch.status >= 400 && fetch.status < 600) {
    critical.push(`HTTP ${fetch.status}: Page returned an error status code`);
  }
  if (fetch.status === 0) {
    critical.push('Page is unreachable: connection failed or timed out');
  }
  if (tech?.is_indexable === false) {
    critical.push('Page is blocked from indexing (robots meta or X-Robots-Tag)');
  }
  if (tech && !tech.title_present) {
    critical.push('Missing <title> tag: required for SEO and search appearance');
  }
  if (!https) {
    critical.push('Site is not served over HTTPS: insecure connection detected');
  }

  // TTI > 10s (lab data)
  if (psi?.lab_data && psi.lab_data.tti_s > 10) {
    critical.push(`Very slow Time to Interactive: ${psi.lab_data.tti_s.toFixed(1)}s (threshold: 10s)`);
  }

  // --- Warning ---
  if (tech && !tech.description_present) {
    warning.push('Missing meta description: affects click-through rate in search results');
  }

  // CWV thresholds
  const chosen = psi;
  if (chosen?.field_data) {
    const fd = chosen.field_data;
    if (fd.lcp.value > 4000) {
      warning.push(`Poor LCP: ${fd.lcp.value}ms (threshold: 4000ms) — hurts Core Web Vitals`);
    }
    if (fd.cls.value > 0.25) {
      warning.push(`Poor CLS: ${fd.cls.value} (threshold: 0.25) — layout instability detected`);
    }
    if (fd.inp.value > 500) {
      warning.push(`Poor INP: ${fd.inp.value}ms (threshold: 500ms) — interaction responsiveness issue`);
    }
  } else if (chosen?.lab_data) {
    const ld = chosen.lab_data;
    if (ld.cls > 0.25) {
      warning.push(`Poor CLS (lab): ${ld.cls} (threshold: 0.25) — layout instability detected`);
    }
    if (ld.performance_score < 50) {
      warning.push(`Low Lighthouse performance score: ${ld.performance_score}/100`);
    }
  }

  // TBT > 300ms
  if (psi?.lab_data && psi.lab_data.tbt_ms > 300) {
    warning.push(`High Total Blocking Time: ${Math.round(psi.lab_data.tbt_ms)}ms (threshold: 300ms)`);
  }

  // TTFB > 600ms
  if (fetch.ttfb_ms > 600) {
    warning.push(`Slow TTFB: ${Math.round(fetch.ttfb_ms)}ms (threshold: 600ms)`);
  }

  if (onpage && onpage.h1_count === 0) {
    warning.push('Missing H1 tag: primary heading not found on page');
  }

  // Sitemap not found
  const robotsSitemaps = rawPythonData?.robotsCheck?.sitemaps ?? [];
  if (robotsSitemaps.length === 0) {
    warning.push('No sitemap detected: submit a sitemap to improve crawl efficiency');
  }

  // Images missing alt (with decorative clarification)
  if (onpage && onpage.image_alt_missing > 0) {
    const decorative = onpageRaw?.images?.empty_alt_decorative ?? 0;
    if (decorative > 0) {
      warning.push(`${onpage.image_alt_missing} image(s) missing alt attribute, ${decorative} additional with empty alt="" (decorative)`);
    } else {
      warning.push(`${onpage.image_alt_missing} image(s) missing alt text: accessibility and SEO issue`);
    }
  }

  // Accessibility: buttons/links without text
  const buttonsNoText = xray?.accessibility?.buttons_links_no_text ?? 0;
  if (buttonsNoText > 0) {
    warning.push(`${buttonsNoText} button(s)/link(s) with no accessible text: add aria-label or visible text`);
  }

  // Accessibility: inputs without label
  const inputsNoLabel = xray?.accessibility?.inputs_without_label ?? 0;
  if (inputsNoLabel > 0) {
    warning.push(`${inputsNoLabel} form input(s) without associated label: accessibility issue`);
  }

  // Render-blocking resources from PSI
  const renderBlocking = psi?.opportunities?.find((o: any) => o.id === 'render-blocking-resources');
  if (renderBlocking && renderBlocking.status !== 'pass') {
    warning.push(`Render-blocking resources detected: ~${renderBlocking.savings_ms}ms potential savings`);
  }

  // Link density
  const linkDensityIssues = onpageRaw?.links?.link_density_issues ?? [];
  if (Array.isArray(linkDensityIssues) && linkDensityIssues.includes('over_linked')) {
    warning.push('Page is over-linked: may dilute link equity');
  }

  // DOM accessibility issues
  if (dom) {
    if (dom.duplicate_ids && dom.duplicate_ids > 0) {
      warning.push(`${dom.duplicate_ids} duplicate ID(s) found: breaks accessibility and CSS specificity`);
    }
    if (dom.inline_event_handlers && dom.inline_event_handlers > 0) {
      warning.push(`${dom.inline_event_handlers} inline event handler(s) detected: harms maintainability and CSP`);
    }
  }

  // Heading hierarchy violations from enhanced onpage data
  const headingViolations = onpageRaw?.headings?.violations ?? [];
  for (const v of headingViolations) {
    if (v.issue_type === 'skipped_level') {
      const headingText = v.heading ? ` ('${String(v.heading).slice(0, 50)}')` : '';
      warning.push(`Heading level skip: H${v.from_level} → H${v.to_level}${headingText}`);
    }
  }
  const emptyHeadings = onpageRaw?.headings?.empty_headings ?? 0;
  if (emptyHeadings > 0) {
    warning.push(`${emptyHeadings} empty heading(s) found`);
  }

  // --- Info ---
  if (onpage && onpage.h1_count > 1) {
    warning.push(`${onpage.h1_count} H1 tags found: should be exactly 1`);
  }

  if (onpage && onpage.content_word_count < 300 && onpage.content_word_count > 0) {
    info.push(`Low word count: ${onpage.content_word_count} words — consider expanding content for better coverage`);
  }

  if (dom && dom.div_ratio > 0.7) {
    info.push(`High div ratio: ${(dom.div_ratio * 100).toFixed(0)}% of elements are <div> — use semantic HTML elements`);
  }

  if (!tech?.canonical_present) {
    info.push('No canonical tag: consider adding one to avoid duplicate content issues');
  }

  if ((rawPythonData?.schemaValidation?.blocks_found ?? 0) === 0) {
    info.push('No structured data (JSON-LD): adding schema markup can enhance search appearance');
  }

  // Missing Permissions-Policy header
  const secHeaders = techSeoRaw?.security_headers;
  if (secHeaders && !secHeaders.permissions_policy) {
    info.push('Missing Permissions-Policy security header');
  }

  // Images missing dimensions
  const missingDims = onpageRaw?.images?.explicit_dimensions !== undefined
    ? (onpageRaw.images.total ?? 0) - (onpageRaw.images.explicit_dimensions ?? 0)
    : xray?.images?.missing_dimensions ?? 0;
  if (missingDims > 0) {
    info.push(`${missingDims} image(s) missing width/height dimensions: may cause layout shifts`);
  }

  // Inline styles > 100
  const inlineStyleCount = xray?.inline_styles?.count ?? 0;
  if (inlineStyleCount > 100) {
    info.push(`${inlineStyleCount} inline styles detected: consider using CSS classes`);
  }

  // og:published_time missing on article-like content
  const publishedTime = techSeoRaw?.open_graph?.published_time;
  const wordCount = onpage?.content_word_count ?? 0;
  const schemaTypes = rawPythonData?.schemaValidation?.summary?.types_found ?? [];
  const isArticleLike = wordCount > 500 || schemaTypes.some((t: string) =>
    ['Article', 'BlogPosting', 'NewsArticle'].includes(t));
  if (!publishedTime && isArticleLike) {
    info.push('No article:published_time — search engines may not show publish date');
  }

  // Less than 50% images in modern format
  const totalImages = onpageRaw?.images?.total ?? 0;
  const modernCount = onpageRaw?.images?.modern_format ?? 0;
  if (totalImages > 0 && modernCount / totalImages < 0.5) {
    info.push(`Only ${Math.round((modernCount / totalImages) * 100)}% of images use modern formats (WebP/AVIF)`);
  }

  // Empty elements > 300
  const emptyElements = xray?.structure?.empty_elements ?? 0;
  if (emptyElements > 300) {
    info.push(`${emptyElements} empty elements detected: consider cleaning up unused markup`);
  }

  // --- Third-party scripts ---
  const thirdParty = xray?.scripts?.third_party;
  if (thirdParty) {
    if (thirdParty.tag_manager_detected && thirdParty.count > 15) {
      warning.push(`Tag manager + ${thirdParty.count} third-party scripts: audit for unused tags`);
    } else if (thirdParty.count > 10) {
      info.push(`${thirdParty.count} third-party scripts loaded — may impact performance`);
    }
  }

  // --- Caching ---
  const caching = techSeoRaw?.caching;
  if (caching && !caching.has_cache_control) {
    info.push('Missing Cache-Control header — page not explicitly cacheable');
  }

  // --- Resource hints ---
  const hints = techSeoRaw?.resource_hints;
  if (hints && hints.preconnect_count === 0 && thirdParty && thirdParty.count > 3) {
    info.push('No preconnect hints for third-party domains — add <link rel="preconnect"> for key origins');
  }

  // --- Redirect chain ---
  if (fetch.redirect_chain && fetch.redirect_chain.length > 2) {
    warning.push(`Long redirect chain (${fetch.redirect_chain.length} hops) — consolidate to a single redirect`);
  }

  // --- Content Analysis issues ---
  if (contentAnalysis) {
    const thinRisk = contentAnalysis.thin_content?.thin_content_risk;
    if (thinRisk === 'high') {
      critical.push('High thin content risk detected: boilerplate, repetition, or skeleton page');
    }
  }

  return { critical, warning, info };
}

// ---------------------------------------------------------------------------
// Main merge function
// ---------------------------------------------------------------------------

/**
 * Merge all analysis phases into a comprehensive AnalysisReport.
 *
 * @param url - The analyzed URL
 * @param fetch - HTTP fetch result from Phase 2
 * @param psi - PSI results (desktop + mobile) from Phase 3
 * @param python - Python analysis results from Phase 4
 * @param scores - Scored result from Phase 6
 * @returns AnalysisReport — the final merged report
 */
export function mergeAnalysis(
  url: string,
  fetch: FetchResult,
  psi: PSIResult[],
  python: PythonAnalysis,
  cruxFieldData?: FieldData | null,
  rawPythonData?: RawPythonData,
  gscData?: GSCData | null,
  cruxMeta?: { scope?: 'url' | 'origin'; collectionPeriod?: CruxCollectionPeriod },
): AnalysisReport {
  const timestamp = new Date().toISOString();

  // --- Meta ---
  const https = detectHttps(url, fetch);
  const crawlable = detectCrawlable(fetch, python);

  // --- Best PSI result for CWV extraction ---
  const bestPsi = pickPSI(psi);

  // --- Performance: Core Web Vitals ---
  // Priority: CrUX API field data > PSI loadingExperience field data > Lighthouse lab fallback
  const cwv: AnalysisReport['performance']['core_web_vitals'] = {};

  const activeFieldData = cruxFieldData ?? bestPsi?.field_data ?? null;

  if (activeFieldData) {
    const fd = activeFieldData;
    cwv.lcp_ms = fd.lcp.value;
    cwv.fcp_ms = fd.fcp.value;
    cwv.cls = fd.cls.value;
    cwv.inp_ms = fd.inp.value;
    cwv.fid_ms = fd.fid.value;

    // Phase 2.5 — CWV verdict at p75 (LCP ≤ 2500, CLS ≤ 0.1, INP ≤ 200)
    const lcpOk = fd.lcp.value > 0 && fd.lcp.value <= 2500;
    const clsOk = fd.cls.value <= 0.1; // CLS 0 is valid
    const inpOk = fd.inp.value > 0 && fd.inp.value <= 200;
    const haveAll = fd.lcp.value > 0 && fd.inp.value > 0;
    cwv.cwv_passing = haveAll ? (lcpOk && clsOk && inpOk) : null;
  } else if (bestPsi?.lab_data) {
    // Lab fallback: CLS only (no LCP/INP from lab directly in current schema)
    cwv.cls = bestPsi.lab_data.cls;
    cwv.cwv_passing = null;
  } else {
    cwv.cwv_passing = null;
  }

  // --- Performance: Speed Metrics ---
  const speed: AnalysisReport['performance']['speed_metrics'] = {
    ttfb_ms: fetch.ttfb_ms,
  };
  if (bestPsi?.lab_data) {
    speed.speed_index_s = bestPsi.lab_data.speed_index_s;
    speed.tti_s = bestPsi.lab_data.tti_s;
    speed.tbt_ms = bestPsi.lab_data.tbt_ms;
    speed.performance_score = bestPsi.lab_data.performance_score;
  }

  // --- SEO: Technical ---
  const tech = python.technical_seo;
  const html = fetch.html ?? '';

  // Strip conflicting fields (title/description/canonical/open_graph have
  // different typed shapes in TechnicalSEO vs. AnalysisReport) so the spread
  // is safe. The stripped detail still lives in analysis_detail.technical_seo.
  const {
    title: _tTitle,
    description: _tDesc,
    canonical: _tCanon,
    open_graph: _tOg,
    ...techRest
  } = tech ?? {};
  void _tTitle; void _tDesc; void _tCanon; void _tOg;
  const seoTechnical: AnalysisReport['seo']['technical'] = {
    ...techRest,
    schema_count: rawPythonData?.schemaValidation?.blocks_found ?? 0,
    open_graph: tech?.open_graph_present ?? false,
    twitter_card: tech?.twitter_card_present ?? false,
    indexable: tech?.is_indexable !== false, // default to true unless explicitly false
  };

  // Extract title/description/canonical from HTML if Python didn't surface them
  if (html) {
    seoTechnical.title = extractTitleFromHtml(html) || undefined;
    seoTechnical.description = extractDescriptionFromHtml(html) || undefined;
    seoTechnical.canonical = extractCanonicalFromHtml(html) || undefined;
  }

  // --- SEO: Content ---
  const onpage = python.onpage_seo;
  const dom = python.dom;

  const imagesTotalFromHtml = countImages(html);
  const imagesMissingAltFromHtml = countMissingAlt(html);

  const seoContent: AnalysisReport['seo']['content'] = {
    ...(onpage ?? {}),
    word_count: onpage?.content_word_count ?? 0,
    h1_count: onpage?.h1_count ?? 0,
    headings_valid: onpage?.heading_hierarchy_valid ?? dom?.heading_hierarchy_valid ?? false,
    images_total: imagesTotalFromHtml,
    images_alt_missing: onpage?.image_alt_missing ?? imagesMissingAltFromHtml,
  };

  // --- SEO: Links ---
  const externalCount = countExternalLinks(html, url);

  const seoLinks: AnalysisReport['seo']['links'] = {
    internal_total: onpage?.internal_links ?? 0,
    external_total: externalCount,
    generic_anchor_text: rawPythonData?.onpage?.links?.internal_generic_anchor
      ?? rawPythonData?.techSeo?.links?.internal_generic_anchor ?? 0,
  };

  // --- Structure ---
  const structure: AnalysisReport['structure'] = {
    ...(dom ?? {}),
    dom_elements: dom?.element_count ?? 0,
    div_ratio: dom?.div_ratio ?? 0,
    semantic_score: dom?.semantic_score ?? 0,
    heading_hierarchy_valid: dom?.heading_hierarchy_valid ?? false,
  };

  // --- Issues ---
  const issues = generateIssues(fetch, bestPsi, python, https, python.content_analysis, rawPythonData);

  // --- Build report ---
  const report: AnalysisReport = {
    url,
    timestamp,
    http_status: fetch.status,
    crawlable,
    https,
    performance: {
      core_web_vitals: cwv,
      speed_metrics: speed,
      ...(fetch.cdnDetected ? { cdn: fetch.cdnDetected } : {}),
      ...(fetch.compression ? { compression: fetch.compression } : {}),
      ...(bestPsi?.resource_summary ? { resource_summary: bestPsi.resource_summary } : {}),
      // Phase 4 — expanded performance signals
      ...(bestPsi?.category_scores ? { category_scores: bestPsi.category_scores } : {}),
      ...(cruxMeta?.scope ? { field_data_scope: cruxMeta.scope } : {}),
      ...(cruxMeta?.collectionPeriod ? { field_data_collection_period: cruxMeta.collectionPeriod } : {}),
      ...(activeFieldData
        ? {
          field_data_distributions: {
            lcp: activeFieldData.lcp?.distribution,
            cls: activeFieldData.cls?.distribution,
            inp: activeFieldData.inp?.distribution,
            fcp: activeFieldData.fcp?.distribution,
            fid: activeFieldData.fid?.distribution,
          },
        }
        : {}),
      ...(bestPsi?.lcp_element ? { lcp_element: bestPsi.lcp_element } : {}),
      ...(bestPsi?.cls_elements ? { cls_elements: bestPsi.cls_elements } : {}),
      ...(bestPsi?.render_blocking ? { render_blocking: bestPsi.render_blocking } : {}),
      ...(bestPsi?.third_party ? { third_party: bestPsi.third_party } : {}),
      ...(bestPsi?.bootup ? { bootup: bestPsi.bootup } : {}),
      ...(bestPsi?.server_response_time_ms != null ? { server_response_time_ms: bestPsi.server_response_time_ms } : {}),
      ...(bestPsi?.request_count != null ? { request_count: bestPsi.request_count } : {}),
      ...(bestPsi?.diagnostics ? { diagnostics: bestPsi.diagnostics } : {}),
    },
    seo: {
      technical: seoTechnical,
      content: seoContent,
      links: seoLinks,
    },
    structure,
    issues,
  };

  // --- Redirect analysis ---
  if (fetch.redirect_chain && fetch.redirect_chain.length > 0) {
    const chain = fetch.redirect_chain;
    const hasHttpToHttps = chain.some((u, i) => {
      const prev = i === 0 ? url : chain[i - 1];
      return prev.startsWith('http://') && u.startsWith('https://');
    }) || (url.startsWith('http://') && chain[0]?.startsWith('https://'));
    const hasWwwRedirect = chain.some((u, i) => {
      const prev = i === 0 ? url : chain[i - 1];
      try {
        const prevHost = new URL(prev).hostname;
        const currHost = new URL(u).hostname;
        return (prevHost.startsWith('www.') && !currHost.startsWith('www.'))
          || (!prevHost.startsWith('www.') && currHost.startsWith('www.'));
      } catch { return false; }
    });
    const redirectIssues: string[] = [];
    if (chain.length > 2) {
      redirectIssues.push(`Long redirect chain (${chain.length} hops) — consolidate to a single redirect`);
    }
    report.redirect_analysis = {
      chain_length: chain.length,
      chain,
      has_http_to_https: hasHttpToHttps,
      has_www_redirect: hasWwwRedirect,
      issues: redirectIssues,
    };
  }

  // --- Content Analysis section ---
  if (python.content_analysis) {
    const ca = python.content_analysis;
    // Spread all mapped detail fields, then overwrite summary fields to keep
    // the exact backward-compatible shape that consumers expect.
    report.content_analysis = {
      ...ca,
      depth_label: ca.content_depth?.depth_label ?? ca.depth_label ?? 'unknown',
      eeat_label: ca.eeat_signals?.eeat_label ?? ca.eeat_label ?? 'unknown',
      freshness_status: ca.content_freshness?.freshness_status ?? ca.freshness_status ?? 'undated',
      thin_content_risk: ca.thin_content?.thin_content_risk ?? ca.thin_content_risk ?? 'none',
      anchor_quality_score: ca.anchor_text_quality?.anchor_quality_score ?? ca.anchor_quality_score ?? 'unknown',
      snippet_eligible: ca.featured_snippet?.snippet_eligible ?? ca.snippet_eligible ?? false,
      issues: ca.issues ?? [],
    };
  }

  // --- Robots.txt ---
  if (rawPythonData?.robotsCheck && rawPythonData.robotsCheck.fetched !== undefined) {
    const rc = rawPythonData.robotsCheck;
    const robots: RobotsInfo = {
      fetched: rc.fetched ?? false,
      disallow_rules: rc.disallow_rules ?? [],
      crawl_delay: rc.crawl_delay ?? null,
      sitemaps: rc.sitemaps ?? [],
      has_wildcard_disallow: rc.has_wildcard_disallow ?? false,
      issues: rc.issues ?? [],
    };
    // Additive: preserve remaining fields from robots_check.py output
    if (rc.status_code !== undefined) robots.status_code = rc.status_code;
    if (rc.path_disallowed !== undefined) robots.path_disallowed = rc.path_disallowed;
    if (rc.reason !== undefined) robots.reason = rc.reason;
    if (Array.isArray(rc.allow_rules)) robots.allow_rules = rc.allow_rules;
    if (rc.conflict_with_meta !== undefined) robots.conflict_with_meta = rc.conflict_with_meta;
    if (rc.sitemap_analysis && typeof rc.sitemap_analysis === 'object') {
      robots.sitemap_analysis = {
        url: rc.sitemap_analysis.url,
        url_count: rc.sitemap_analysis.url_count,
        has_lastmod: rc.sitemap_analysis.has_lastmod,
        is_index: rc.sitemap_analysis.is_index,
        error: rc.sitemap_analysis.error ?? null,
        children_fetched: rc.sitemap_analysis.children_fetched,
        total_urls_across_children: rc.sitemap_analysis.total_urls_across_children,
        discovered_via_fallback: rc.sitemap_analysis.discovered_via_fallback,
      };
    }
    // Expanded robots_check.py signals (Phase 4 plumbing)
    if (rc.final_url !== undefined) robots.final_url = rc.final_url;
    if (rc.content_type !== undefined) robots.content_type = rc.content_type;
    if (rc.content_length !== undefined) robots.content_length = rc.content_length;
    if (rc.elapsed_ms !== undefined) robots.elapsed_ms = rc.elapsed_ms;
    if (Array.isArray(rc.redirect_chain)) robots.redirect_chain = rc.redirect_chain;
    if (rc.per_agent_rules && typeof rc.per_agent_rules === 'object') {
      robots.per_agent_rules = rc.per_agent_rules;
    }
    if (rc.per_agent_verdict && typeof rc.per_agent_verdict === 'object') {
      robots.per_agent_verdict = rc.per_agent_verdict;
    }
    if (rc.ai_bot_summary && typeof rc.ai_bot_summary === 'object') {
      robots.ai_bot_summary = rc.ai_bot_summary;
    }
    if (Array.isArray(rc.sitemap_analyses)) {
      robots.sitemap_analyses = rc.sitemap_analyses;
    }
    if (Array.isArray(rc.syntax_warnings)) robots.syntax_warnings = rc.syntax_warnings;
    if (rc.size_exceeds_google_limit !== undefined) {
      robots.size_exceeds_google_limit = rc.size_exceeds_google_limit;
    }
    if (rc.content_type_is_text_plain !== undefined) {
      robots.content_type_is_text_plain = rc.content_type_is_text_plain;
    }
    if (rc.cross_origin_redirect !== undefined) {
      robots.cross_origin_redirect = rc.cross_origin_redirect;
    }
    report.robots = robots;
  }

  // --- Third-party scripts ---
  const tp = rawPythonData?.xray?.scripts?.third_party;
  if (tp && tp.count > 0) {
    report.third_party_scripts = {
      count: tp.count,
      domains: tp.domains ?? [],
      categories: tp.categories ?? {},
      tag_manager_detected: tp.tag_manager_detected ?? false,
    };
  }

  // --- Caching ---
  if (rawPythonData?.techSeo?.caching) {
    report.caching = rawPythonData.techSeo.caching;
  }

  // --- Resource hints ---
  if (rawPythonData?.techSeo?.resource_hints) {
    report.resource_hints = rawPythonData.techSeo.resource_hints;
  }

  // --- Schema validation ---
  // Spread the raw Python output into SchemaValidationInfo so new fields flow
  // through automatically. Mirrors the performance/technical merger pattern.
  if (rawPythonData?.schemaValidation) {
    const sv = rawPythonData.schemaValidation as any;
    const info: SchemaValidationInfo = {
      blocks_found: sv.blocks_found ?? 0,
      types: sv.summary?.types_found ?? [],
      rich_results_eligible: sv.summary?.rich_results_eligible ?? [],
      recommendations: sv.recommendations ?? [],
      ...(sv.summary?.total_blocks !== undefined ? { total_blocks: sv.summary.total_blocks } : {}),
      ...(sv.summary?.valid_blocks !== undefined ? { valid_blocks: sv.summary.valid_blocks } : {}),
      ...(Array.isArray(sv.summary?.rich_results_ineligible)
        ? { rich_results_ineligible: sv.summary.rich_results_ineligible }
        : {}),
      ...(Array.isArray(sv.summary?.duplicate_types)
        ? { duplicate_types: sv.summary.duplicate_types }
        : {}),
      ...(sv.overall_score !== undefined ? { overall_score: sv.overall_score } : {}),
      ...(Array.isArray(sv.blocks)
        ? {
            blocks: (sv.blocks as any[]).map((b): SchemaValidationBlock => ({
              type: b?.type,
              raw_json: b?.raw_json,
              validation: b?.validation,
              rich_results: b?.rich_results,
              ...(b?.score !== undefined ? { score: b.score } : {}),
            })),
          }
        : {}),
    };
    report.schema_validation = info;
  }

  // --- Google Search Console ---
  if (gscData) {
    report.search_console = {
      search_performance: gscData.search_performance,
      index_status: gscData.index_status,
      ...(gscData.sitemaps ? { sitemaps: gscData.sitemaps } : {}),
    };

    // GSC-derived issues
    if (gscData.index_status.verdict === 'FAIL' || !gscData.index_status.is_page_indexed) {
      report.issues.critical.push(
        `Page not indexed by Google (${gscData.index_status.coverage_state})`
      );
    }

    // Canonical mismatch
    const declaredCanonical = report.seo?.technical?.canonical;
    const googleCanonical = gscData.index_status.google_canonical;
    if (declaredCanonical && googleCanonical && declaredCanonical !== googleCanonical) {
      report.issues.warning.push(
        `Google canonical (${googleCanonical}) differs from declared canonical (${declaredCanonical})`
      );
    }

    // Low CTR
    const topQuery = gscData.search_performance.top_queries[0];
    if (topQuery && topQuery.impressions > 100 && topQuery.ctr < 0.02) {
      report.issues.warning.push(
        `Low CTR (${(topQuery.ctr * 100).toFixed(1)}%) for top query "${topQuery.query}" — title/description may need optimization`
      );
    }
  }

  // --- Full Python analysis detail for JSON consumers ---
  if (rawPythonData) {
    report.analysis_detail = {};
    if (rawPythonData.xray) report.analysis_detail.xray = rawPythonData.xray;
    if (rawPythonData.techSeo) report.analysis_detail.technical_seo = rawPythonData.techSeo;
    if (rawPythonData.onpage) report.analysis_detail.onpage = rawPythonData.onpage;
    if (rawPythonData.contentAnalysis) report.analysis_detail.content_analysis = rawPythonData.contentAnalysis;
  }

  // --- Raw debug data (only when _DEBUG env is set) ---
  if (process.env._DEBUG) {
    report._raw = {
      fetch,
      psi: bestPsi,
      python,
    };
  }

  return report;
}

