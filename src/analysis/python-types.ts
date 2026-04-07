/**
 * TypeScript interfaces for Python script JSON outputs.
 * Each interface matches the exact output shape of its corresponding Python script.
 */

// ─────────────────────────────────────────────────────────────────────────────
// split.py
// ─────────────────────────────────────────────────────────────────────────────

export interface SplitOutput {
  markdown: string;
  skeleton: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// xray.py
// ─────────────────────────────────────────────────────────────────────────────

export interface XrayOutput {
  dom: {
    total_elements: number;
    unique_tags: number;
    depth_max: number;
    depth_avg: number;
    deepest_path?: string[];
  };
  element_map: Record<string, number>;
  structure: {
    div_ratio: number;
    semantic_score: number;
    h1_count: number;
    h2_count: number;
    h3_count: number;
    heading_hierarchy_valid: boolean;
    empty_elements: number;
    duplicate_ids: number;
    deprecated_tags: string[];
    inline_event_handlers: number;
    iframes: {
      count: number;
      domains: string[];
    };
  };
  head: {
    charset_present: boolean;
    viewport_present: boolean;
    favicon_present: boolean;
    preload_count: number;
  };
  content_ratios: {
    html_size_kb: number;
    word_count_approx: number;
    html_text_ratio: number;
  };
  accessibility: {
    images_missing_alt: number;
    inputs_without_label: number;
    buttons_links_no_text: number;
    html_missing_lang: boolean;
    aria_attribute_count: number;
  };
  seo: {
    meta_description_present: boolean;
    og_tags: string[];
    canonical_present: boolean;
    title_non_empty: boolean;
  };
  links: {
    total: number;
    internal: number;
    external: number;
    target_blank_missing_rel: number;
  };
  images: {
    total: number;
    missing_alt: number;
    missing_dimensions: number;
    lazy_loaded: number;
  };
  forms: {
    form_count: number;
    input_count: number;
    button_count: number;
    inputs_without_labels: number;
    forms_missing_action: number;
  };
  scripts: {
    total: number;
    inline: number;
    external: number;
    defer_count: number;
    async_count: number;
    third_party: {
      count: number;
      domains: string[];
      categories: Record<string, string[]>;
      tag_manager_detected: boolean;
    };
  };
  inline_styles: {
    count: number;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// technical_seo.py
// ─────────────────────────────────────────────────────────────────────────────

export interface TechnicalSeoOutput {
  meta: {
    title: { present: boolean; content: string; length: number; status: string };
    description: { present: boolean; content: string; length: number; status: string };
    robots: { index: boolean; follow: boolean; content: string; status: string };
    charset: { present: boolean };
    viewport: { present: boolean };
  };
  canonical: {
    present: boolean;
    href: string | null;
    self_referencing: boolean | null;
    status: string;
  };
  open_graph: {
    title: boolean;
    description: boolean;
    image: boolean;
    url: boolean;
    published_time: string | null;
    modified_time: string | null;
    updated_time: string | null;
    twitter_card: {
      present: boolean;
      card_type: string | null;
      title: boolean;
      image: boolean;
      description: boolean;
    };
  };
  indexability: {
    blocked: boolean;
    signals: string[];
    conflicts: string[];
  };
  links: {
    internal_total: number;
    internal_generic_anchor: number;
    external_total: number;
    external_broken: number;
  };
  security_headers: {
    present: string[];
    missing: string[];
    count: number;
    grade: string;
    details: Record<string, string>;
  };
  hreflang: {
    present: boolean;
    count: number;
    languages: Array<{ lang: string; href: string }>;
    has_x_default: boolean;
    issues?: string[];
  };
  pagination_amp: {
    has_prev: boolean;
    has_next: boolean;
    prev_href: string | null;
    next_href: string | null;
    is_paginated: boolean;
    amp_link_present: boolean;
    amp_html: boolean;
    is_amp: boolean;
  };
  caching: {
    cache_control: string | null;
    has_cache_control: boolean;
    has_etag: boolean;
    has_last_modified: boolean;
    max_age_seconds: number | null;
    is_cacheable: boolean;
    issues: string[];
  };
  resource_hints: {
    preload: Array<{ href: string; as: string }>;
    prefetch: string[];
    dns_prefetch: string[];
    preconnect: string[];
    preload_count: number;
    dns_prefetch_count: number;
    preconnect_count: number;
  };
  url_structure?: {
    length: number;
    path: string;
    has_trailing_slash: boolean;
    has_uppercase: boolean;
    has_special_chars: boolean;
    has_double_slashes: boolean;
    keyword_segments: number;
    total_segments: number;
    issues?: string[];
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// onpage.py
// ─────────────────────────────────────────────────────────────────────────────

export interface HeadingViolation {
  from_level: number;
  to_level: number;
  heading: string;
  issue_type: string;
}

export interface HeadingTreeNode {
  level: number;
  text: string;
  children: HeadingTreeNode[];
}

export interface OnpageOutput {
  content: {
    word_count: number;
    paragraph_count: number;
    avg_paragraph_length: number;
  };
  headings: {
    h1_count: number;
    h1_content: string;
    h2_count: number;
    h3_count: number;
    h4_count: number;
    h5_count: number;
    h6_count: number;
    hierarchy_valid: boolean;
    empty_headings: number;
    total_headings: number;
    violations: HeadingViolation[];
    issues: string[];
    tree: HeadingTreeNode[];
  };
  links: {
    internal_total: number;
    internal_generic_anchor: number;
    external_total: number;
    external_broken: number;
  };
  images: {
    total: number;
    missing_alt: number;
    empty_alt_decorative: number;
    too_short: number;
    too_long: number;
    poor_quality_alt: number;
    lazy_loading: number;
    modern_format: number;
    explicit_dimensions: number;
    density_per_1000_words: number;
  };
  crawlability: {
    status_code: number;
    redirect_count: number;
    robots_blocked: boolean;
    sitemap_found: boolean;
    https_enforced: boolean;
    mixed_content: boolean;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// content_analysis.py
// ─────────────────────────────────────────────────────────────────────────────

export interface ContentAnalysisOutput {
  section: string;
  detected_language: string;
  content_depth: {
    word_count: number;
    paragraph_count: number;
    avg_paragraph_length: number;
    depth_label: string;
    issues: string[];
  };
  content_relevance: {
    title_in_h1: boolean;
    title_in_intro: boolean;
    title_in_intro_word_position: number;
    heading_alignment_score: number;
    keyword_stuffing_detected: boolean;
  };
  eeat_signals: {
    first_person_count: number;
    first_person_present: boolean;
    statistics_count: number;
    citation_patterns: number;
    author_mention_detected: boolean;
    eeat_label: string;
    eeat_signals_count: number;
    eeat_signals_present: Record<string, boolean>;
    dates_found: number[];
    most_recent_date: number;
    time_sensitive_without_date: boolean;
  };
  content_freshness: {
    years_mentioned: number[];
    most_recent_year: number;
    current_year: number;
    freshness_status: string;
    time_sensitive_phrases_found: string[];
    time_sensitive_without_date: boolean;
  };
  featured_snippet: {
    definition_paragraph_present: boolean;
    list_snippet_eligible: boolean;
    lists_under_headings: unknown[];
    qa_pairs_found: Array<{ question: string; answer_preview: string; answer_length: number }>;
    qa_pattern_count: number;
    faq_schema_recommended: boolean;
    tables_with_headers: number;
    table_snippet_eligible: boolean;
    snippet_types_eligible: string[];
    snippet_eligible: boolean;
  };
  thin_content: {
    boilerplate_detected: string[];
    boilerplate_present: boolean;
    duplicate_sentences_found: number;
    high_repetition: boolean;
    heading_count: number;
    heading_to_content_ratio: number;
    skeleton_page_detected: boolean;
    thin_content_signals: Record<string, boolean>;
    thin_content_risk: string;
  };
  anchor_text_quality: {
    total_internal_links: number;
    descriptive_count: number;
    partial_count: number;
    generic_count: number;
    naked_url_count: number;
    empty_count: number;
    descriptive_ratio: number;
    anchor_quality_score: string;
  };
  readability: {
    avg_words_per_sentence: number;
    long_sentences_count: number;
    short_sentences_count: number;
    flesch_reading_ease: number;
    gunning_fog_index: number;
    reading_level: string;
    sentence_count: number;
  };
  passive_voice: {
    passive_voice_count: number;
    passive_voice_ratio: number;
  };
  transition_words: {
    transition_word_count: number;
    transition_word_ratio: number;
    transition_label: string;
  };
  meta_description: {
    meta_description_length: number;
    meta_description_status: string;
  };
  link_density: {
    links_per_1000_words: number;
    total_internal_links: number;
    issues: string[];
  };
  image_alt_text: {
    images_total: number;
    images_missing_alt: number;
    alt_coverage_ratio: number;
  };
  heading_hierarchy: {
    hierarchy_valid: boolean;
    violations: string[];
  };
  toc: {
    toc_present: boolean;
    toc_entry_count: number;
    toc_recommended: boolean;
  };
  cta: {
    cta_present: boolean;
    cta_patterns_found: string[];
    cta_count: number;
  };
  author_bio: {
    author_bio_present: boolean;
    detected_pattern?: string;
  };
  top_keywords: Array<{ word: string; count: number; percentage: number }>;
  top_phrases: {
    bigrams: Array<{ phrase: string; count: number; percentage: number }>;
    trigrams: Array<{ phrase: string; count: number; percentage: number }>;
  };
  issues: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// robots_check.py
// ─────────────────────────────────────────────────────────────────────────────

export interface RobotsCheckOutput {
  fetched: boolean;
  status_code: number;
  path_disallowed: boolean;
  crawl_delay: number | null;
  sitemaps: string[];
  disallow_rules: string[];
  allow_rules: string[];
  has_wildcard_disallow: boolean;
  conflict_with_meta: boolean;
  issues: string[];
  sitemap_analysis?: {
    url: string;
    url_count: number;
    has_lastmod: boolean;
    is_index: boolean;
    error: string | null;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// schema_validator.py
// ─────────────────────────────────────────────────────────────────────────────

export interface SchemaBlock {
  raw_json: Record<string, unknown>;
  type: string;
  validation: {
    required: { fields: string[]; present: string[]; missing: string[] };
    recommended: { fields: string[]; present: string[]; missing: string[] };
    format_errors: Array<{ field: string; value: string; expected: string; message: string }>;
    warnings: Array<{ field: string; message: string }>;
  };
  rich_results: {
    eligible: boolean;
    types: string[];
    missing_for_eligibility: string[];
  };
}

export interface SchemaValidatorOutput {
  blocks_found: number;
  blocks: SchemaBlock[];
  recommendations: Array<{ priority: string; type: string; message: string }>;
  summary: {
    total_blocks: number;
    valid_blocks: number;
    types_found: string[];
    rich_results_eligible: string[];
    rich_results_ineligible: string[];
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Aggregate typed raw data (replaces Record<string, any> in orchestrator/merger)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Aggregate typed raw Python data.
 * Fields use Record<string, any> at the boundary since Python scripts
 * may return partial data (e.g., on error or when a section is skipped).
 * Use the typed interfaces above for documentation and when casting
 * validated data within specific consumers.
 */
export interface RawPythonData {
  xray?: Record<string, any>;
  techSeo?: Record<string, any>;
  onpage?: Record<string, any>;
  contentAnalysis?: Record<string, any>;
  schemaValidation?: Record<string, any>;
  robotsCheck?: Record<string, any>;
}
