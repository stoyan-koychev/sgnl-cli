import { FetchResult } from './fetch';
import { FieldData, LabData } from './psi';

/**
 * DOM structure analysis from Python layer
 */
export interface DOMAnalysis {
  element_count: number;
  div_ratio: number;
  semantic_score: number; // 0-7 (factual count of semantic elements)
  heading_hierarchy_valid: boolean;
  duplicate_ids?: number; // count of duplicate IDs (0 = good)
  inline_event_handlers?: number; // count of inline handlers (0 = good)
  avg_element_depth?: number; // average depth of elements

  // --- Expanded xray.py fields (all optional, additive) ---
  depth_max?: number;
  unique_tags?: number;
  deepest_path?: string[];
  element_map?: Record<string, number>;
  heading_counts?: { h1: number; h2: number; h3: number };
  empty_elements?: number;
  deprecated_tags?: string[];
  iframes?: { count: number; domains: string[] };
  head_signals?: {
    charset_present: boolean;
    viewport_present: boolean;
    favicon_present: boolean;
    preload_count: number;
  };
  content_ratios?: {
    html_size_kb: number;
    word_count_approx: number;
    html_text_ratio: number;
  };
  accessibility?: {
    images_missing_alt: number;
    inputs_without_label: number;
    buttons_links_no_text: number;
    html_missing_lang: boolean;
    aria_attribute_count: number;
  };
  links_summary?: {
    total: number;
    internal: number;
    external: number;
    target_blank_missing_rel: number;
  };
  images_summary?: {
    total: number;
    missing_alt: number;
    missing_dimensions: number;
    lazy_loaded: number;
  };
  forms_summary?: {
    form_count: number;
    input_count: number;
    button_count: number;
    inputs_without_labels: number;
    forms_missing_action: number;
  };
  scripts_summary?: {
    total: number;
    inline: number;
    external: number;
    defer_count: number;
    async_count: number;
    third_party_count: number;
    third_party_domains: string[];
    tag_manager_detected: boolean;
  };
  inline_styles_count?: number;

  // --- Phase 4 (webflow-tier) additions ---
  depth_avg?: number;
  tabindex_audit?: { positive_tabindex_count: number };
  largest_image_candidate?: { src: string; width: number; height: number } | null;
  text_density_by_region?: { main: number; aside: number; footer: number; header: number };
  duplicate_headings?: string[];
}

/**
 * Technical SEO analysis from Python layer
 */
export interface TechnicalSEO {
  title_present: boolean;
  description_present: boolean;
  canonical_present: boolean;
  schema_blocks: number;
  open_graph_present?: boolean;
  is_indexable?: boolean;
  twitter_card_present?: boolean;
  security_headers_count?: number;

  // --- Expanded technical_seo.py fields (all optional, additive) ---
  title?: { content?: string; length?: number; status?: string };
  description?: { content?: string; length?: number; status?: string };
  robots?: { index: boolean; follow: boolean; content?: string; status?: string };
  charset_present?: boolean;
  viewport_present?: boolean;
  canonical?: { href?: string | null; self_referencing?: boolean | null; status?: string };
  open_graph?: {
    title: boolean;
    description: boolean;
    image: boolean;
    url: boolean;
    published_time?: string | null;
    modified_time?: string | null;
    updated_time?: string | null;
  };
  indexability?: { blocked: boolean; signals: string[]; conflicts: string[] };
  links_summary?: {
    internal_total: number;
    internal_generic_anchor: number;
    external_total: number;
    external_broken: number;
  };
  security_headers?: {
    present: string[];
    missing: string[];
    count: number;
    grade?: string;
    details?: Record<string, unknown>;
  };
  hreflang?: {
    present: boolean;
    count: number;
    languages: string[];
    has_x_default: boolean;
    issues: string[];
  };
  pagination_amp?: {
    has_prev: boolean;
    has_next: boolean;
    prev_href?: string | null;
    next_href?: string | null;
    is_paginated: boolean;
    amp_link_present: boolean;
    amp_html?: string | null;
    is_amp: boolean;
  };
  caching?: {
    cache_control?: string | null;
    has_cache_control: boolean;
    has_etag: boolean;
    has_last_modified: boolean;
    max_age_seconds?: number | null;
    is_cacheable: boolean;
    issues: string[];
  };
  resource_hints?: {
    preload: string[];
    prefetch: string[];
    dns_prefetch: string[];
    preconnect: string[];
    counts: Record<string, number>;
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
    issues: string[];
  };
}

/**
 * Content analysis from Python layer (Section 5)
 */
export interface ContentAnalysis {
  // Existing fields — MUST keep exact shape for backward compatibility.
  issues: string[];

  // Summary fields that merger.ts writes to report.content_analysis.
  // These live on the mapped object too so merger can read them directly.
  depth_label?: string;
  eeat_label?: string;
  freshness_status?: string;
  thin_content_risk?: string;
  anchor_quality_score?: string; // Python returns this as a label string ("excellent" | "good" | ...)
  snippet_eligible?: boolean;

  // --- New detail fields from content_analysis.py (all optional, additive) ---
  detected_language?: string;
  content_depth?: {
    word_count: number;
    paragraph_count: number;
    avg_paragraph_length: number;
    depth_label: string;
    reading_time_minutes?: number;
    lexical_diversity?: number;
    lexical_diversity_label?: string;
    paragraph_length_distribution?: { min: number; max: number; p50: number; p90: number };
    issues: string[];
  };
  content_relevance?: {
    title_in_h1: boolean;
    title_in_intro: boolean;
    title_in_intro_word_position?: number | null;
    heading_alignment_score: number;
    keyword_stuffing_detected: boolean;
  };
  eeat_signals?: {
    first_person_count: number;
    first_person_present: boolean;
    statistics_count: number;
    citation_patterns: number;
    author_mention_detected: boolean;
    eeat_label: string;
    eeat_signals_count: number;
    eeat_signals_present: Record<string, boolean>;
    dates_found: unknown[];
    most_recent_date?: string | number | null;
    time_sensitive_without_date: boolean;
  };
  content_freshness?: {
    years_mentioned: number[];
    most_recent_year?: number | null;
    current_year: number;
    freshness_status: string;
    time_sensitive_phrases_found: string[];
    time_sensitive_without_date: boolean;
  };
  featured_snippet?: {
    definition_paragraph_present: boolean;
    list_snippet_eligible: boolean;
    lists_under_headings: unknown[];
    qa_pairs_found: unknown[];
    qa_pattern_count: number;
    faq_schema_recommended: boolean;
    tables_with_headers: number;
    table_snippet_eligible: boolean;
    snippet_types_eligible: string[];
    snippet_eligible: boolean;
  };
  thin_content?: {
    boilerplate_detected: string[];
    boilerplate_present: boolean;
    duplicate_sentences_found: number;
    duplicate_paragraphs_found?: number;
    high_repetition: boolean;
    heading_count: number;
    heading_to_content_ratio: number;
    skeleton_page_detected: boolean;
    thin_content_signals: Record<string, boolean>;
    thin_content_risk: string;
  };
  anchor_text_quality?: {
    total_internal_links: number;
    descriptive_count: number;
    partial_count: number;
    generic_count: number;
    naked_url_count: number;
    empty_count: number;
    descriptive_ratio: number;
    anchor_quality_score: string;
  };
  readability?: {
    avg_words_per_sentence: number;
    long_sentences_count: number;
    short_sentences_count: number;
    flesch_reading_ease: number;
    gunning_fog_index: number;
    reading_level: string;
    sentence_count: number;
    sentence_length_distribution?: { min: number; max: number; p50: number; p90: number };
  };
  passive_voice?: {
    passive_voice_count: number;
    passive_voice_ratio: number;
    examples?: string[];
  };
  first_paragraph?: {
    word_count: number;
    contains_title_keyword: boolean;
    has_hook: boolean;
  };
  transition_words?: {
    transition_word_count: number;
    transition_word_ratio: number;
    transition_label: string;
  };
  meta_description_info?: {
    meta_description_length: number;
    meta_description_status: string;
  };
  link_density?: {
    links_per_1000_words: number;
    total_internal_links: number;
    issues: string[];
  };
  image_alt_text?: {
    images_total: number;
    images_missing_alt: number;
    alt_coverage_ratio: number;
    images_empty_alt?: number;
    images_decorative?: number;
    images_informative?: number;
  };
  heading_hierarchy?: {
    hierarchy_valid: boolean;
    violations: Array<Record<string, unknown>> | string[];
    h1_count?: number;
    skipped_levels?: number;
    orphan_headings?: number;
  };
  toc?: { toc_present: boolean; toc_entry_count: number; toc_recommended: boolean };
  cta?: { cta_present: boolean; cta_patterns_found: string[]; cta_count: number };
  author_bio?: { author_bio_present: boolean; detected_pattern?: string };
  top_keywords?: Array<{ word: string; count: number; percentage: number }>;
  top_phrases?: {
    bigrams: unknown[];
    trigrams: unknown[];
  };
}

/**
 * On-page SEO analysis from Python layer
 */
export interface OnPageSEO {
  h1_count: number;
  content_word_count: number;
  image_alt_missing: number;
  internal_links: number;
  heading_hierarchy_valid?: boolean;
  has_robots?: boolean;

  // --- Expanded onpage.py fields (all optional, additive) ---
  heading_counts?: { h1: number; h2: number; h3: number; h4: number; h5: number; h6: number };
  h1_content?: string[];
  empty_headings?: number;
  total_headings?: number;
  heading_violations?: Array<{
    from_level: number;
    to_level: number;
    heading?: string;
    issue_type: string;
  }>;
  heading_tree?: Array<{
    level: number;
    text: string;
    children: unknown[];
  }>;
  heading_issues?: string[];
  table_of_contents_detected?: boolean;
  content?: {
    word_count: number;
    paragraph_count: number;
    avg_paragraph_length: number;
  };
  links_detail?: {
    internal_total: number;
    internal_generic_anchor: number;
    external_total: number;
    external_broken: number;
  };
  images_detail?: {
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
}

/**
 * Sitemap analysis block (one entry per Sitemap: directive).
 */
export interface SitemapAnalysis {
  url?: string;
  url_count?: number;
  has_lastmod?: boolean;
  is_index?: boolean;
  error?: string | null;
  children_fetched?: number;
  total_urls_across_children?: number;
  discovered_via_fallback?: boolean;
}

/**
 * Multi-agent verdict: per-user-agent allowed/disallowed for the analyzed URL.
 */
export type AgentVerdict = 'allowed' | 'disallowed';

/**
 * AI-bot blocking summary — counts explicit blocks per AI crawler.
 */
export interface AIBotSummary {
  blocked_count: number;
  blocked_agents: string[];
  total_checked: number;
}

/**
 * Robots.txt analysis from robots_check.py
 */
export interface RobotsInfo {
  fetched?: boolean;
  status_code?: number;
  path_disallowed?: boolean;
  reason?: string;
  disallow_rules?: string[];
  allow_rules?: string[];
  crawl_delay?: number | null;
  sitemaps?: string[];
  has_wildcard_disallow?: boolean;
  conflict_with_meta?: boolean;
  issues?: string[];
  sitemap_analysis?: SitemapAnalysis;

  // --- Expanded robots_check.py fields (all optional, additive) ---
  final_url?: string | null;
  content_type?: string | null;
  content_length?: number | null;
  elapsed_ms?: number;
  redirect_chain?: string[];
  per_agent_rules?: Record<string, { disallow: string[]; allow: string[]; crawl_delay: number | null }>;
  per_agent_verdict?: Record<string, AgentVerdict>;
  ai_bot_summary?: AIBotSummary;
  sitemap_analyses?: SitemapAnalysis[];
  syntax_warnings?: string[];
  size_exceeds_google_limit?: boolean;
  content_type_is_text_plain?: boolean;
  cross_origin_redirect?: boolean;
}

/**
 * Schema.org validation block-level detail from schema_validator.py
 */
export interface SchemaValidationBlock {
  type?: string;
  raw_json?: unknown;
  score?: number;
  validation?: {
    required?: { fields: string[]; present: string[]; missing: string[] };
    recommended?: { fields: string[]; present: string[]; missing: string[] };
    format_errors?: Array<{
      field: string;
      value?: unknown;
      expected?: string;
      message: string;
    }>;
    warnings?: Array<{ field: string; message: string }>;
  };
  rich_results?: {
    eligible: boolean;
    types: string[];
    missing_for_eligibility: string[];
  };
}

/**
 * Schema validation summary + block detail from schema_validator.py
 */
export interface SchemaValidationInfo {
  blocks_found?: number;
  total_blocks?: number;
  valid_blocks?: number;
  types?: string[];
  rich_results_eligible?: string[];
  rich_results_ineligible?: string[];
  duplicate_types?: string[];
  overall_score?: number;
  recommendations?: Array<{ priority?: string; type?: string; message: string }>;
  blocks?: SchemaValidationBlock[];
}

/**
 * Aggregated analysis data from all phases
 */
export interface AnalysisData {
  fetch?: FetchResult | null;
  field_data?: FieldData | null;
  lab_data?: LabData | null;
  dom?: DOMAnalysis | null;
  technical_seo?: TechnicalSEO | null;
  onpage_seo?: OnPageSEO | null;
  content_analysis?: ContentAnalysis | null;
  error?: string;
}
