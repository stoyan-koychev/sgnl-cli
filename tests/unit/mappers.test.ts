/**
 * Unit tests for the Python-output → TypeScript interface mappers added
 * by the structural data-loss cleanup. Verifies that expanded optional
 * fields on DOMAnalysis, TechnicalSEO, OnPageSEO, and ContentAnalysis
 * are populated from representative raw Python outputs.
 */

import {
  mapXrayToDOMAnalysis,
  mapTechSeoToTechnicalSEO,
  mapOnpageToOnPageSEO,
  mapContentAnalysis,
} from '../../src/analysis/orchestrator';

// ─────────────────────────────────────────────────────────────────────────────
// mapXrayToDOMAnalysis
// ─────────────────────────────────────────────────────────────────────────────

describe('mapXrayToDOMAnalysis', () => {
  const xrayFixture: Record<string, any> = {
    dom: {
      total_elements: 480,
      unique_tags: 42,
      depth_max: 18,
      depth_avg: 8.3,
      deepest_path: ['html', 'body', 'main', 'article', 'section'],
    },
    element_map: { div: 120, p: 40, a: 30 },
    structure: {
      div_ratio: 0.41,
      semantic_score: 6,
      h1_count: 1,
      h2_count: 4,
      h3_count: 7,
      heading_hierarchy_valid: true,
      empty_elements: 12,
      duplicate_ids: 2,
      deprecated_tags: ['center'],
      inline_event_handlers: 3,
      iframes: { count: 1, domains: ['youtube.com'] },
    },
    head: {
      charset_present: true,
      viewport_present: true,
      favicon_present: false,
      preload_count: 4,
    },
    content_ratios: {
      html_size_kb: 95.2,
      word_count_approx: 1500,
      html_text_ratio: 0.22,
    },
    accessibility: {
      images_missing_alt: 2,
      inputs_without_label: 1,
      buttons_links_no_text: 0,
      html_missing_lang: false,
      aria_attribute_count: 14,
    },
    links: { total: 50, internal: 40, external: 10, target_blank_missing_rel: 3 },
    images: { total: 20, missing_alt: 2, missing_dimensions: 5, lazy_loaded: 12 },
    forms: { form_count: 1, input_count: 4, button_count: 2, inputs_without_labels: 1, forms_missing_action: 0 },
    scripts: {
      total: 25,
      inline: 4,
      external: 21,
      defer_count: 10,
      async_count: 6,
      third_party: {
        count: 8,
        domains: ['google-analytics.com', 'gtm.js'],
        categories: { analytics: ['google-analytics.com'] },
        tag_manager_detected: true,
      },
    },
    inline_styles: { count: 55 },
  };

  it('preserves the original 7 fields exactly', () => {
    const result = mapXrayToDOMAnalysis(xrayFixture);
    expect(result).toBeDefined();
    expect(result!.element_count).toBe(480);
    expect(result!.div_ratio).toBe(0.41);
    expect(result!.semantic_score).toBe(6);
    expect(result!.heading_hierarchy_valid).toBe(true);
    expect(result!.duplicate_ids).toBe(2);
    expect(result!.inline_event_handlers).toBe(3);
    expect(result!.avg_element_depth).toBe(8.3);
  });

  it('populates expanded DOM fields', () => {
    const r = mapXrayToDOMAnalysis(xrayFixture)!;
    expect(r.depth_max).toBe(18);
    expect(r.unique_tags).toBe(42);
    expect(r.deepest_path).toEqual(['html', 'body', 'main', 'article', 'section']);
    expect(r.element_map).toEqual({ div: 120, p: 40, a: 30 });
    expect(r.heading_counts).toEqual({ h1: 1, h2: 4, h3: 7 });
    expect(r.empty_elements).toBe(12);
    expect(r.deprecated_tags).toEqual(['center']);
    expect(r.iframes).toEqual({ count: 1, domains: ['youtube.com'] });
  });

  it('populates head, content_ratios, and accessibility', () => {
    const r = mapXrayToDOMAnalysis(xrayFixture)!;
    expect(r.head_signals?.viewport_present).toBe(true);
    expect(r.head_signals?.preload_count).toBe(4);
    expect(r.content_ratios?.html_size_kb).toBe(95.2);
    expect(r.accessibility?.aria_attribute_count).toBe(14);
  });

  it('populates links, images, forms, scripts, inline_styles summaries', () => {
    const r = mapXrayToDOMAnalysis(xrayFixture)!;
    expect(r.links_summary?.target_blank_missing_rel).toBe(3);
    expect(r.images_summary?.missing_dimensions).toBe(5);
    expect(r.forms_summary?.inputs_without_labels).toBe(1);
    expect(r.scripts_summary?.third_party_count).toBe(8);
    expect(r.scripts_summary?.tag_manager_detected).toBe(true);
    expect(r.scripts_summary?.third_party_domains).toContain('google-analytics.com');
    expect(r.inline_styles_count).toBe(55);
  });

  it('returns undefined on missing dom/structure', () => {
    expect(mapXrayToDOMAnalysis({})).toBeUndefined();
  });

  it('returns a minimal result when only dom is present', () => {
    const r = mapXrayToDOMAnalysis({ dom: { total_elements: 10 } })!;
    expect(r.element_count).toBe(10);
    expect(r.head_signals).toBeUndefined();
    expect(r.scripts_summary).toBeUndefined();
  });

  it('maps Phase 4 webflow-tier fields (tabindex, LCP guess, regions, duplicates)', () => {
    const fixture: Record<string, any> = {
      ...xrayFixture,
      tabindex_audit: { positive_tabindex_count: 2 },
      largest_image_candidate: { src: 'hero.jpg', width: 800, height: 400 },
      text_density_by_region: { main: 500, aside: 20, footer: 50, header: 30 },
      duplicate_headings: ['Overview', 'Details'],
    };
    const r = mapXrayToDOMAnalysis(fixture)!;
    expect(r.depth_avg).toBe(8.3);
    expect(r.tabindex_audit?.positive_tabindex_count).toBe(2);
    expect(r.largest_image_candidate).toEqual({ src: 'hero.jpg', width: 800, height: 400 });
    expect(r.text_density_by_region?.main).toBe(500);
    expect(r.text_density_by_region?.footer).toBe(50);
    expect(r.duplicate_headings).toEqual(['Overview', 'Details']);
  });

  it('handles null largest_image_candidate', () => {
    const r = mapXrayToDOMAnalysis({ ...xrayFixture, largest_image_candidate: null })!;
    expect(r.largest_image_candidate).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// mapTechSeoToTechnicalSEO
// ─────────────────────────────────────────────────────────────────────────────

describe('mapTechSeoToTechnicalSEO', () => {
  const techFixture: Record<string, any> = {
    meta: {
      title: { present: true, content: 'My Page', length: 7, status: 'good' },
      description: { present: true, content: 'A description', length: 13, status: 'short' },
      robots: { index: true, follow: true, content: 'index, follow', status: 'ok' },
      charset: { present: true },
      viewport: { present: true },
    },
    canonical: { present: true, href: 'https://example.com/', self_referencing: true, status: 'ok' },
    open_graph: {
      title: true,
      description: true,
      image: true,
      url: true,
      published_time: '2024-01-01',
      modified_time: null,
      updated_time: null,
      twitter_card: { present: true, card_type: 'summary', title: true, image: true, description: true },
    },
    indexability: { blocked: false, signals: [], conflicts: [] },
    links: { internal_total: 20, internal_generic_anchor: 3, external_total: 5, external_broken: 0 },
    security_headers: {
      present: ['x-frame-options'],
      missing: ['content-security-policy'],
      count: 1,
      grade: 'C',
      details: { 'x-frame-options': 'DENY' },
    },
    hreflang: {
      present: true,
      count: 3,
      languages: [{ lang: 'en', href: 'https://example.com/en' }, { lang: 'es', href: 'https://example.com/es' }, 'fr'],
      has_x_default: true,
      issues: [],
    },
    pagination_amp: {
      has_prev: false,
      has_next: true,
      prev_href: null,
      next_href: 'https://example.com/page/2',
      is_paginated: true,
      amp_link_present: false,
      amp_html: false,
      is_amp: false,
    },
    caching: {
      cache_control: 'max-age=3600',
      has_cache_control: true,
      has_etag: false,
      has_last_modified: true,
      max_age_seconds: 3600,
      is_cacheable: true,
      issues: [],
    },
    resource_hints: {
      preload: [{ href: '/main.css', as: 'style' }],
      prefetch: [],
      dns_prefetch: ['//cdn.example.com'],
      preconnect: [],
      preload_count: 1,
      dns_prefetch_count: 1,
      preconnect_count: 0,
    },
    url_structure: {
      length: 23,
      path: '/blog/my-post',
      has_trailing_slash: false,
      has_uppercase: false,
      has_special_chars: false,
      has_double_slashes: false,
      keyword_segments: 2,
      total_segments: 2,
      issues: [],
    },
  };

  it('preserves the original 7 fields exactly', () => {
    const r = mapTechSeoToTechnicalSEO(techFixture)!;
    expect(r.title_present).toBe(true);
    expect(r.description_present).toBe(true);
    expect(r.canonical_present).toBe(true);
    expect(r.schema_blocks).toBe(0); // populated later from schema_validator
    expect(r.open_graph_present).toBe(true);
    expect(r.is_indexable).toBe(true);
    expect(r.twitter_card_present).toBe(true);
  });

  it('populates expanded title/description/robots/canonical', () => {
    const r = mapTechSeoToTechnicalSEO(techFixture)!;
    expect(r.title?.content).toBe('My Page');
    expect(r.description?.length).toBe(13);
    expect(r.robots?.content).toBe('index, follow');
    expect(r.canonical?.href).toBe('https://example.com/');
    expect(r.canonical?.self_referencing).toBe(true);
    expect(r.charset_present).toBe(true);
    expect(r.viewport_present).toBe(true);
  });

  it('populates hreflang, pagination_amp, caching, resource_hints, url_structure', () => {
    const r = mapTechSeoToTechnicalSEO(techFixture)!;
    expect(r.hreflang?.languages).toEqual(['en', 'es', 'fr']);
    expect(r.hreflang?.has_x_default).toBe(true);
    expect(r.pagination_amp?.is_paginated).toBe(true);
    expect(r.caching?.max_age_seconds).toBe(3600);
    expect(r.resource_hints?.preload).toEqual(['/main.css']);
    expect(r.resource_hints?.counts.dns_prefetch).toBe(1);
    expect(r.url_structure?.path).toBe('/blog/my-post');
  });

  it('populates security_headers and links_summary', () => {
    const r = mapTechSeoToTechnicalSEO(techFixture)!;
    expect(r.security_headers?.count).toBe(1);
    expect(r.security_headers?.grade).toBe('C');
    expect(r.links_summary?.internal_generic_anchor).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// mapOnpageToOnPageSEO
// ─────────────────────────────────────────────────────────────────────────────

describe('mapOnpageToOnPageSEO', () => {
  const onpageFixture: Record<string, any> = {
    content: { word_count: 1200, paragraph_count: 22, avg_paragraph_length: 54 },
    headings: {
      h1_count: 1,
      h1_content: 'Main Title',
      h2_count: 5,
      h3_count: 8,
      h4_count: 2,
      h5_count: 0,
      h6_count: 0,
      hierarchy_valid: false,
      empty_headings: 1,
      total_headings: 16,
      violations: [
        { from_level: 1, to_level: 3, heading: 'Skipped section', issue_type: 'skipped_level' },
      ],
      issues: ['heading-skip'],
      tree: [
        { level: 1, text: 'Main Title', children: [
          { level: 2, text: 'Intro', children: [] },
        ] },
      ],
    },
    links: { internal_total: 22, internal_generic_anchor: 2, external_total: 8, external_broken: 1 },
    images: {
      total: 12, missing_alt: 2, empty_alt_decorative: 1, too_short: 0, too_long: 0,
      poor_quality_alt: 1, lazy_loading: 8, modern_format: 6, explicit_dimensions: 10,
      density_per_1000_words: 10,
    },
    crawlability: {
      status_code: 200, redirect_count: 0, robots_blocked: false, sitemap_found: true,
      https_enforced: true, mixed_content: false,
    },
  };

  it('preserves the original 7 fields exactly', () => {
    const r = mapOnpageToOnPageSEO(onpageFixture)!;
    expect(r.h1_count).toBe(1);
    expect(r.content_word_count).toBe(1200);
    expect(r.image_alt_missing).toBe(2);
    expect(r.internal_links).toBe(22);
    expect(r.https_enforced).toBe(true);
    expect(r.heading_hierarchy_valid).toBe(false);
    expect(r.has_sitemap).toBe(true);
  });

  it('populates heading counts, tree, and violations', () => {
    const r = mapOnpageToOnPageSEO(onpageFixture)!;
    expect(r.heading_counts).toEqual({ h1: 1, h2: 5, h3: 8, h4: 2, h5: 0, h6: 0 });
    expect(r.h1_content).toEqual(['Main Title']);
    expect(r.empty_headings).toBe(1);
    expect(r.total_headings).toBe(16);
    expect(r.heading_violations).toHaveLength(1);
    expect(r.heading_violations?.[0].issue_type).toBe('skipped_level');
    expect(r.heading_tree).toHaveLength(1);
    expect(r.heading_issues).toEqual(['heading-skip']);
  });

  it('populates content, links_detail, images_detail, crawlability', () => {
    const r = mapOnpageToOnPageSEO(onpageFixture)!;
    expect(r.content?.paragraph_count).toBe(22);
    expect(r.links_detail?.external_broken).toBe(1);
    expect(r.images_detail?.modern_format).toBe(6);
    expect(r.images_detail?.density_per_1000_words).toBe(10);
    expect(r.crawlability?.status_code).toBe(200);
  });

  it('maps table_of_contents_detected flag from headings', () => {
    const withToc = {
      ...onpageFixture,
      headings: { ...onpageFixture.headings, table_of_contents_detected: true },
    };
    const withoutToc = {
      ...onpageFixture,
      headings: { ...onpageFixture.headings, table_of_contents_detected: false },
    };
    expect(mapOnpageToOnPageSEO(withToc)!.table_of_contents_detected).toBe(true);
    expect(mapOnpageToOnPageSEO(withoutToc)!.table_of_contents_detected).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// mapContentAnalysis
// ─────────────────────────────────────────────────────────────────────────────

describe('mapContentAnalysis', () => {
  const caFixture: Record<string, any> = {
    section: 'content',
    detected_language: 'en',
    content_depth: {
      word_count: 1500, paragraph_count: 20, avg_paragraph_length: 75,
      depth_label: 'comprehensive', issues: [],
    },
    content_relevance: {
      title_in_h1: true, title_in_intro: true, title_in_intro_word_position: 4,
      heading_alignment_score: 0.85, keyword_stuffing_detected: false,
    },
    eeat_signals: {
      first_person_count: 3, first_person_present: true, statistics_count: 5,
      citation_patterns: 2, author_mention_detected: true, eeat_label: 'strong',
      eeat_signals_count: 4, eeat_signals_present: { author: true, citations: true },
      dates_found: ['2024-01-01'], most_recent_date: '2024-01-01',
      time_sensitive_without_date: false,
    },
    content_freshness: {
      years_mentioned: [2023, 2024], most_recent_year: 2024, current_year: 2026,
      freshness_status: 'stale', time_sensitive_phrases_found: ['recently'],
      time_sensitive_without_date: false,
    },
    featured_snippet: {
      definition_paragraph_present: true, list_snippet_eligible: true,
      lists_under_headings: [], qa_pairs_found: [{ question: 'Q?', answer_preview: 'A' }],
      qa_pattern_count: 1, faq_schema_recommended: true, tables_with_headers: 2,
      table_snippet_eligible: true, snippet_types_eligible: ['definition', 'list'],
      snippet_eligible: true,
    },
    thin_content: {
      boilerplate_detected: [], boilerplate_present: false, duplicate_sentences_found: 0,
      high_repetition: false, heading_count: 10, heading_to_content_ratio: 0.01,
      skeleton_page_detected: false, thin_content_signals: {}, thin_content_risk: 'low',
    },
    anchor_text_quality: {
      total_internal_links: 20, descriptive_count: 15, partial_count: 3, generic_count: 2,
      naked_url_count: 0, empty_count: 0, descriptive_ratio: 0.75, anchor_quality_score: 'good',
    },
    readability: {
      avg_words_per_sentence: 18, long_sentences_count: 2, short_sentences_count: 5,
      flesch_reading_ease: 65, gunning_fog_index: 10, reading_level: 'standard', sentence_count: 80,
    },
    passive_voice: { passive_voice_count: 4, passive_voice_ratio: 0.05 },
    transition_words: { transition_word_count: 20, transition_word_ratio: 0.02, transition_label: 'good' },
    meta_description: { meta_description_length: 150, meta_description_status: 'optimal' },
    link_density: { links_per_1000_words: 15, total_internal_links: 20, issues: [] },
    image_alt_text: { images_total: 12, images_missing_alt: 2, alt_coverage_ratio: 0.83 },
    heading_hierarchy: { hierarchy_valid: true, violations: [] },
    toc: { toc_present: false, toc_entry_count: 0, toc_recommended: true },
    cta: { cta_present: true, cta_patterns_found: ['Contact us'], cta_count: 2 },
    author_bio: { author_bio_present: true, detected_pattern: 'byline' },
    top_keywords: [{ word: 'seo', count: 25, percentage: 0.02 }],
    top_phrases: {
      bigrams: [{ phrase: 'search engine', count: 10, percentage: 0.01 }],
      trigrams: [{ phrase: 'search engine optimization', count: 5, percentage: 0.005 }],
    },
    issues: ['some-warning'],
  };

  it('populates the summary fields read by merger.ts', () => {
    const r = mapContentAnalysis(caFixture)!;
    expect(r.depth_label).toBe('comprehensive');
    expect(r.eeat_label).toBe('strong');
    expect(r.freshness_status).toBe('stale');
    expect(r.thin_content_risk).toBe('low');
    expect(r.anchor_quality_score).toBe('good');
    expect(r.snippet_eligible).toBe(true);
    expect(r.issues).toEqual(['some-warning']);
  });

  it('populates detail sections', () => {
    const r = mapContentAnalysis(caFixture)!;
    expect(r.detected_language).toBe('en');
    expect(r.content_depth?.word_count).toBe(1500);
    expect(r.content_relevance?.heading_alignment_score).toBe(0.85);
    expect(r.eeat_signals?.statistics_count).toBe(5);
    expect(r.content_freshness?.years_mentioned).toEqual([2023, 2024]);
    expect(r.featured_snippet?.faq_schema_recommended).toBe(true);
    expect(r.thin_content?.skeleton_page_detected).toBe(false);
    expect(r.anchor_text_quality?.descriptive_ratio).toBe(0.75);
    expect(r.readability?.flesch_reading_ease).toBe(65);
    expect(r.passive_voice?.passive_voice_ratio).toBe(0.05);
    expect(r.transition_words?.transition_label).toBe('good');
    expect(r.meta_description_info?.meta_description_length).toBe(150);
    expect(r.link_density?.links_per_1000_words).toBe(15);
    expect(r.image_alt_text?.alt_coverage_ratio).toBe(0.83);
    expect(r.heading_hierarchy?.hierarchy_valid).toBe(true);
    expect(r.toc?.toc_recommended).toBe(true);
    expect(r.cta?.cta_count).toBe(2);
    expect(r.author_bio?.author_bio_present).toBe(true);
    expect(r.top_keywords?.[0].word).toBe('seo');
    expect(r.top_phrases?.bigrams).toHaveLength(1);
  });

  it('returns undefined for non-object input', () => {
    expect(mapContentAnalysis(null as any)).toBeUndefined();
  });

  it('returns a minimal object when data is sparse', () => {
    const r = mapContentAnalysis({ issues: [] })!;
    expect(r.issues).toEqual([]);
    expect(r.content_depth).toBeUndefined();
    expect(r.depth_label).toBeUndefined();
  });
});
