/**
 * Tests for additive structural detail preservation in mergeAnalysis:
 * - robots_check.py detail (allow_rules, status_code, sitemap_analysis, ...)
 * - schema_validator.py block-level detail
 * - content_analysis detail fields merged into report.content_analysis
 */

import { mergeAnalysis, PythonAnalysis } from '../../src/analysis/merger';
import { FetchResult } from '../../src/analysis/fetch';
import type { ContentAnalysis } from '../../src/analysis/scoring';

function mockFetch(overrides: Partial<FetchResult> = {}): FetchResult {
  return {
    status: 200,
    html: '<html><head><title>T</title></head><body><h1>H</h1></body></html>',
    headers: {},
    ttfb_ms: 100,
    redirect_chain: [],
    error: null,
    ...overrides,
  };
}

describe('mergeAnalysis — robots_check detail preservation', () => {
  it('preserves existing fields AND adds status_code, allow_rules, path_disallowed, conflict_with_meta, sitemap_analysis', () => {
    const rawPythonData = {
      robotsCheck: {
        fetched: true,
        status_code: 200,
        path_disallowed: false,
        disallow_rules: ['/admin'],
        allow_rules: ['/public'],
        crawl_delay: null,
        sitemaps: ['https://example.com/sitemap.xml'],
        has_wildcard_disallow: false,
        conflict_with_meta: false,
        issues: [],
        sitemap_analysis: {
          url: 'https://example.com/sitemap.xml',
          url_count: 42,
          has_lastmod: true,
          is_index: false,
          error: null,
        },
      },
    };

    const report = mergeAnalysis('https://example.com', mockFetch(), [], {}, undefined, rawPythonData);

    expect(report.robots).toBeDefined();
    // Existing 6 fields preserved
    expect(report.robots?.fetched).toBe(true);
    expect(report.robots?.disallow_rules).toEqual(['/admin']);
    expect(report.robots?.crawl_delay).toBeNull();
    expect(report.robots?.sitemaps).toEqual(['https://example.com/sitemap.xml']);
    expect(report.robots?.has_wildcard_disallow).toBe(false);
    expect(report.robots?.issues).toEqual([]);
    // New additive fields
    expect(report.robots?.status_code).toBe(200);
    expect(report.robots?.path_disallowed).toBe(false);
    expect(report.robots?.allow_rules).toEqual(['/public']);
    expect(report.robots?.conflict_with_meta).toBe(false);
    expect(report.robots?.sitemap_analysis?.url_count).toBe(42);
    expect(report.robots?.sitemap_analysis?.is_index).toBe(false);
  });

  it('plumbs the expanded phase-4 fields (per-agent verdict, AI bot summary, validation flags, sitemap_analyses) onto report.robots', () => {
    const rawPythonData = {
      robotsCheck: {
        fetched: true,
        status_code: 200,
        path_disallowed: false,
        disallow_rules: ['/admin'],
        allow_rules: [],
        crawl_delay: null,
        sitemaps: ['https://example.com/sitemap.xml'],
        has_wildcard_disallow: false,
        conflict_with_meta: false,
        issues: [],
        final_url: 'https://example.com/robots.txt',
        content_type: 'text/plain',
        content_length: 1024,
        elapsed_ms: 87,
        redirect_chain: [],
        per_agent_rules: {
          '*': { disallow: ['/admin'], allow: [], crawl_delay: null },
          googlebot: { disallow: ['/'], allow: [], crawl_delay: null },
        },
        per_agent_verdict: {
          '*': 'allowed',
          googlebot: 'disallowed',
          bingbot: 'allowed',
          gptbot: 'allowed',
          ccbot: 'allowed',
          'anthropic-ai': 'allowed',
          'google-extended': 'allowed',
          perplexitybot: 'allowed',
          bytespider: 'allowed',
        },
        ai_bot_summary: { blocked_count: 0, blocked_agents: [], total_checked: 6 },
        sitemap_analyses: [
          { url: 'https://example.com/sitemap.xml', url_count: 10, has_lastmod: true, is_index: false, error: null },
        ],
        sitemap_analysis: { url: 'https://example.com/sitemap.xml', url_count: 10, has_lastmod: true, is_index: false, error: null },
        syntax_warnings: ['line 5: missing colon'],
        size_exceeds_google_limit: false,
        content_type_is_text_plain: true,
        cross_origin_redirect: false,
      },
    };

    const report = mergeAnalysis('https://example.com', mockFetch(), [], {}, undefined, rawPythonData);

    expect(report.robots).toBeDefined();
    expect(report.robots?.final_url).toBe('https://example.com/robots.txt');
    expect(report.robots?.content_type).toBe('text/plain');
    expect(report.robots?.content_length).toBe(1024);
    expect(report.robots?.elapsed_ms).toBe(87);
    expect(report.robots?.per_agent_verdict?.googlebot).toBe('disallowed');
    expect(report.robots?.per_agent_verdict?.['*']).toBe('allowed');
    expect(report.robots?.ai_bot_summary?.total_checked).toBe(6);
    expect(report.robots?.sitemap_analyses).toHaveLength(1);
    expect(report.robots?.syntax_warnings).toContain('line 5: missing colon');
    expect(report.robots?.size_exceeds_google_limit).toBe(false);
    expect(report.robots?.content_type_is_text_plain).toBe(true);
    expect(report.robots?.cross_origin_redirect).toBe(false);
    // Backward-compat alias still populated
    expect(report.robots?.sitemap_analysis?.url_count).toBe(10);
  });
});

describe('mergeAnalysis — schema_validator block detail preservation', () => {
  it('preserves summary AND adds per-block validation detail', () => {
    const rawPythonData = {
      schemaValidation: {
        blocks_found: 2,
        blocks: [
          {
            type: 'Article',
            raw_json: { '@type': 'Article', headline: 'x' },
            validation: {
              required: { fields: ['headline'], present: ['headline'], missing: [] },
              recommended: { fields: ['author', 'datePublished'], present: ['author'], missing: ['datePublished'] },
              format_errors: [
                { field: 'datePublished', value: null, expected: 'ISO 8601', message: 'missing' },
              ],
              warnings: [],
            },
            rich_results: { eligible: false, types: ['Article'], missing_for_eligibility: ['datePublished'] },
          },
          { type: 'Organization', raw_json: {}, validation: {}, rich_results: { eligible: true, types: [], missing_for_eligibility: [] } },
        ],
        recommendations: [{ priority: 'high', type: 'Article', message: 'Add datePublished' }],
        summary: {
          total_blocks: 2,
          valid_blocks: 1,
          types_found: ['Article', 'Organization'],
          rich_results_eligible: ['Organization'],
          rich_results_ineligible: ['Article'],
        },
      },
    };

    const report = mergeAnalysis('https://example.com', mockFetch(), [], {}, undefined, rawPythonData);

    expect(report.schema_validation).toBeDefined();
    // Existing 4 summary fields
    expect(report.schema_validation?.blocks_found).toBe(2);
    expect(report.schema_validation?.types).toEqual(['Article', 'Organization']);
    expect(report.schema_validation?.rich_results_eligible).toEqual(['Organization']);
    expect(report.schema_validation?.recommendations).toHaveLength(1);
    // New additive fields
    expect(report.schema_validation?.total_blocks).toBe(2);
    expect(report.schema_validation?.valid_blocks).toBe(1);
    expect(report.schema_validation?.rich_results_ineligible).toEqual(['Article']);
    expect(report.schema_validation?.blocks).toHaveLength(2);
    expect(report.schema_validation?.blocks?.[0].type).toBe('Article');
    expect(report.schema_validation?.blocks?.[0].validation?.format_errors?.[0].field).toBe('datePublished');
    expect(report.schema_validation?.blocks?.[0].rich_results?.missing_for_eligibility).toEqual(['datePublished']);
  });

  it('plumbs new schema fields (duplicate_types, overall_score, per-block score) via spread', () => {
    const rawPythonData = {
      schemaValidation: {
        blocks_found: 2,
        overall_score: 72,
        blocks: [
          {
            type: 'Organization',
            raw_json: { '@type': 'Organization', name: 'Acme' },
            validation: {
              required: { fields: ['name', 'url'], present: ['name'], missing: ['url'] },
              recommended: { fields: [], present: [], missing: [] },
              format_errors: [],
              warnings: [],
            },
            rich_results: { eligible: false, types: [], missing_for_eligibility: [] },
            score: 80,
          },
          {
            type: 'Organization',
            raw_json: { '@type': 'Organization', name: 'Acme Two' },
            validation: {
              required: { fields: ['name', 'url'], present: ['name', 'url'], missing: [] },
              recommended: { fields: [], present: [], missing: [] },
              format_errors: [],
              warnings: [],
            },
            rich_results: { eligible: false, types: [], missing_for_eligibility: [] },
            score: 65,
          },
        ],
        recommendations: [],
        summary: {
          total_blocks: 2,
          valid_blocks: 2,
          types_found: ['Organization'],
          rich_results_eligible: [],
          rich_results_ineligible: [],
          duplicate_types: ['Organization'],
        },
      },
    };

    const report = mergeAnalysis('https://example.com', mockFetch(), [], {}, undefined, rawPythonData);

    expect(report.schema_validation?.duplicate_types).toEqual(['Organization']);
    expect(report.schema_validation?.overall_score).toBe(72);
    expect(report.schema_validation?.blocks?.[0].score).toBe(80);
    expect(report.schema_validation?.blocks?.[1].score).toBe(65);
  });
});

describe('mergeAnalysis — content_analysis detail merge', () => {
  it('keeps backward-compatible summary fields AND merges detail sections', () => {
    const ca: ContentAnalysis = {
      issues: ['warn-1'],
      depth_label: 'comprehensive',
      eeat_label: 'strong',
      freshness_status: 'fresh',
      thin_content_risk: 'low',
      anchor_quality_score: 'good',
      snippet_eligible: true,
      content_depth: {
        word_count: 2000, paragraph_count: 30, avg_paragraph_length: 66,
        depth_label: 'comprehensive', issues: [],
      },
      readability: {
        avg_words_per_sentence: 17, long_sentences_count: 3, short_sentences_count: 4,
        flesch_reading_ease: 70, gunning_fog_index: 9, reading_level: 'standard', sentence_count: 100,
      },
    };
    const python: PythonAnalysis = { content_analysis: ca };

    const report = mergeAnalysis('https://example.com', mockFetch(), [], python);

    // Existing backward-compatible summary shape
    expect(report.content_analysis?.depth_label).toBe('comprehensive');
    expect(report.content_analysis?.eeat_label).toBe('strong');
    expect(report.content_analysis?.freshness_status).toBe('fresh');
    expect(report.content_analysis?.thin_content_risk).toBe('low');
    expect(report.content_analysis?.anchor_quality_score).toBe('good');
    expect(report.content_analysis?.snippet_eligible).toBe(true);
    expect(report.content_analysis?.issues).toEqual(['warn-1']);

    // Detail fields merged in
    expect(report.content_analysis?.content_depth?.word_count).toBe(2000);
    expect(report.content_analysis?.readability?.reading_level).toBe('standard');
  });

  it('carries phase-1/phase-2 content fields (passive_voice, image_alt_text, heading_hierarchy, first_paragraph, reading_time, lexical_diversity, distributions, duplicate_paragraphs) through the spread', () => {
    const ca: ContentAnalysis = {
      issues: [],
      content_depth: {
        word_count: 1200,
        paragraph_count: 18,
        avg_paragraph_length: 66,
        depth_label: 'comprehensive',
        reading_time_minutes: 6.0,
        lexical_diversity: 0.42,
        lexical_diversity_label: 'medium',
        paragraph_length_distribution: { min: 12, max: 180, p50: 60, p90: 140 },
        issues: [],
      },
      readability: {
        avg_words_per_sentence: 16,
        long_sentences_count: 2,
        short_sentences_count: 3,
        flesch_reading_ease: 62,
        gunning_fog_index: 10,
        reading_level: 'standard',
        sentence_count: 90,
        sentence_length_distribution: { min: 3, max: 48, p50: 16, p90: 30 },
      },
      passive_voice: { passive_voice_count: 9, passive_voice_ratio: 0.0075 },
      image_alt_text: {
        images_total: 10,
        images_missing_alt: 1,
        alt_coverage_ratio: 0.9,
        images_empty_alt: 0,
        images_decorative: 2,
        images_informative: 7,
      },
      heading_hierarchy: {
        hierarchy_valid: false,
        violations: [{ from: 2, to: 4, heading: 'Deep dive' }],
        h1_count: 1,
        skipped_levels: 1,
        orphan_headings: 0,
      },
      first_paragraph: {
        word_count: 48,
        contains_title_keyword: true,
        has_hook: true,
      },
      thin_content: {
        boilerplate_detected: [],
        boilerplate_present: false,
        duplicate_sentences_found: 0,
        duplicate_paragraphs_found: 2,
        high_repetition: false,
        heading_count: 6,
        heading_to_content_ratio: 0.33,
        skeleton_page_detected: false,
        thin_content_signals: {},
        thin_content_risk: 'low',
      },
    };
    const python: PythonAnalysis = { content_analysis: ca };

    const report = mergeAnalysis('https://example.com', mockFetch(), [], python);
    const got = report.content_analysis as any;

    expect(got.content_depth.reading_time_minutes).toBe(6.0);
    expect(got.content_depth.lexical_diversity).toBe(0.42);
    expect(got.content_depth.lexical_diversity_label).toBe('medium');
    expect(got.content_depth.paragraph_length_distribution).toEqual({ min: 12, max: 180, p50: 60, p90: 140 });
    expect(got.readability.sentence_length_distribution).toEqual({ min: 3, max: 48, p50: 16, p90: 30 });
    expect(got.passive_voice.passive_voice_count).toBe(9);
    expect(got.image_alt_text.images_decorative).toBe(2);
    expect(got.heading_hierarchy.hierarchy_valid).toBe(false);
    expect(got.heading_hierarchy.h1_count).toBe(1);
    expect(got.first_paragraph.has_hook).toBe(true);
    expect(got.first_paragraph.contains_title_keyword).toBe(true);
    expect(got.thin_content.duplicate_paragraphs_found).toBe(2);
  });
});

describe('mergeAnalysis — performance detail preservation (Phase 4)', () => {
  it('plumbs expanded PSI fields (category_scores, lcp_element, render_blocking, third_party, bootup, diagnostics) onto report.performance', () => {
    const psi = {
      url: 'https://example.com',
      strategy: 'mobile' as const,
      field_data: {
        lcp: { value: 2100, unit: 'ms', status: 'good' as const, target: 2500, distribution: [
          { min: 0, max: 2500, proportion: 0.8 },
          { min: 2500, max: 4000, proportion: 0.15 },
          { min: 4000, max: Infinity, proportion: 0.05 },
        ] },
        cls: { value: 0.05, unit: 'score', status: 'good' as const, target: 0.1 },
        inp: { value: 150, unit: 'ms', status: 'good' as const, target: 200 },
        fcp: { value: 1200, unit: 'ms', status: 'good' as const, target: 1800 },
        fid: { value: 20, unit: 'ms', status: 'good' as const, target: 100 },
      },
      lab_data: {
        performance_score: 85,
        speed_index_s: 2.3,
        tti_s: 3.1,
        tbt_ms: 140,
        cls: 0.05,
      },
      opportunities: [],
      category_scores: { performance: 85, accessibility: 90, best_practices: 88, seo: 100 },
      resource_summary: {
        total_bytes: 500000, script_bytes: 200000, stylesheet_bytes: 50000,
        image_bytes: 150000, font_bytes: 40000, other_bytes: 60000,
        total_requests: 42, script_requests: 15, stylesheet_requests: 3,
        image_requests: 18, font_requests: 2, other_requests: 4,
      },
      lcp_element: { selector: 'h1.hero', nodeLabel: 'Welcome' },
      cls_elements: [{ selector: '.ad', score: 0.08 }],
      render_blocking: [{ url: 'https://cdn/a.css', wastedMs: 300 }],
      third_party: [{ entity: 'Google Analytics', blockingTime: 120, transferSize: 45000 }],
      bootup: { total_ms: 1800, items: [{ url: 'https://cdn/app.js', scripting: 900, scriptParseCompile: 150 }] },
      server_response_time_ms: 380,
      request_count: 50,
      diagnostics: { dom_size: 1200, network_rtt: 42, total_tasks: 800 },
    };

    const report = mergeAnalysis(
      'https://example.com',
      mockFetch(),
      [psi],
      {},
      psi.field_data,
      undefined,
      undefined,
      { scope: 'url', collectionPeriod: { firstDate: '2026-03-01', lastDate: '2026-03-28' } },
    );

    expect(report.performance.category_scores?.accessibility).toBe(90);
    expect(report.performance.lcp_element?.selector).toBe('h1.hero');
    expect(report.performance.cls_elements?.[0].score).toBe(0.08);
    expect(report.performance.render_blocking?.[0].url).toBe('https://cdn/a.css');
    expect(report.performance.third_party?.[0].entity).toBe('Google Analytics');
    expect(report.performance.bootup?.total_ms).toBe(1800);
    expect(report.performance.server_response_time_ms).toBe(380);
    expect(report.performance.request_count).toBe(50);
    expect(report.performance.diagnostics?.dom_size).toBe(1200);
    expect(report.performance.field_data_scope).toBe('url');
    expect(report.performance.field_data_collection_period?.firstDate).toBe('2026-03-01');
    expect(report.performance.resource_summary?.script_requests).toBe(15);
    expect(report.performance.core_web_vitals.cwv_passing).toBe(true);
    // LCP histogram distribution flows through
    expect(report.performance.field_data_distributions?.lcp?.[0].proportion).toBe(0.8);
  });
});
