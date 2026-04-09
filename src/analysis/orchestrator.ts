/**
 * SGNL Orchestrator — Phase 8
 * High-level pipeline: fetch → PSI → Python → score → merge → AnalysisReport
 */

import { renderFetch } from './fetch';
import { callPSI, PSIResult, FieldData } from './psi';
import { fetchCrUXData } from './crux';
import { fetchGSCData, GSCData } from './gsc';
import { runPythonScriptSafe } from './python';
import { DOMAnalysis, TechnicalSEO, OnPageSEO, ContentAnalysis } from './scoring';
import { mergeAnalysis, AnalysisReport, PythonAnalysis } from './merger';
import { saveRunReport } from './run-reporter';
import type { ResolvedConfig } from '../config';

// ---------------------------------------------------------------------------
// Progress callback types
// ---------------------------------------------------------------------------

export type StepId = 'validate' | 'fetch' | 'psi' | 'split' | 'technical_seo' | 'html_xray' | 'on_page' | 'content' | 'performance' | 'score';

export interface StepUpdate {
  id: StepId;
  status: 'pending' | 'running' | 'done' | 'error';
  result?: Record<string, unknown>;
  error?: string;
  startedAt?: number;
  duration_ms?: number;
}

export type ProgressCallback = (update: StepUpdate) => void;

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface BuildReportOptions {
  /** Skip the Python layer entirely (default: false → run Python) */
  skipPython?: boolean;
  /** Skip PageSpeed Insights entirely (default: false → run PSI) */
  skipPSI?: boolean;
  /** Device to emulate: 'mobile' (default) or 'desktop' */
  device?: 'mobile' | 'desktop';
  /** Optional callback for step-by-step progress updates */
  onProgress?: ProgressCallback;
  /** Save .md report files to runs/ directory (default: false — only report.json is saved) */
  save?: boolean;
  /** Timeout per analysis step in ms (default: 30000). Applies to fetch, PSI, and Python steps. */
  timeout?: number;
  /** Custom HTTP headers to send with requests to the target URL. */
  headers?: Record<string, string>;
  /** Programmatic config injection (overrides env + file). Used by SgnlClient. */
  config?: ResolvedConfig;
  /** Options for split.py content extraction. */
  splitOptions?: { onlyMainContent?: boolean; includeTags?: string[]; excludeTags?: string[] };
}

// ---------------------------------------------------------------------------
// Python output → TypeScript interface mappers
// ---------------------------------------------------------------------------

/**
 * Map xray.py JSON output to DOMAnalysis interface.
 * Preserves the original 7 fields exactly and additively populates the
 * expanded optional fields defined on DOMAnalysis.
 */
export function mapXrayToDOMAnalysis(data: Record<string, any>): DOMAnalysis | undefined {
  try {
    const dom = data?.dom;
    const structure = data?.structure;
    if (!dom && !structure) return undefined;

    const result: DOMAnalysis = {
      element_count: dom?.total_elements ?? 0,
      div_ratio: structure?.div_ratio ?? 0,
      semantic_score: structure?.semantic_score ?? 0,
      heading_hierarchy_valid: structure?.heading_hierarchy_valid ?? false,
      duplicate_ids: structure?.duplicate_ids ?? 0,
      inline_event_handlers: structure?.inline_event_handlers ?? 0,
      avg_element_depth: dom?.depth_avg ?? 0,
    };

    // Expanded DOM fields
    if (dom?.depth_max !== undefined) result.depth_max = dom.depth_max;
    if (dom?.unique_tags !== undefined) result.unique_tags = dom.unique_tags;
    if (Array.isArray(dom?.deepest_path)) result.deepest_path = dom.deepest_path;
    if (data?.element_map && typeof data.element_map === 'object') {
      result.element_map = data.element_map as Record<string, number>;
    }

    // Heading counts from structure
    if (structure && (structure.h1_count !== undefined || structure.h2_count !== undefined || structure.h3_count !== undefined)) {
      result.heading_counts = {
        h1: structure.h1_count ?? 0,
        h2: structure.h2_count ?? 0,
        h3: structure.h3_count ?? 0,
      };
    }
    if (structure?.empty_elements !== undefined) result.empty_elements = structure.empty_elements;
    if (Array.isArray(structure?.deprecated_tags)) result.deprecated_tags = structure.deprecated_tags;
    if (structure?.iframes) {
      result.iframes = {
        count: structure.iframes.count ?? 0,
        domains: Array.isArray(structure.iframes.domains) ? structure.iframes.domains : [],
      };
    }

    const head = data?.head;
    if (head) {
      result.head_signals = {
        charset_present: head.charset_present ?? false,
        viewport_present: head.viewport_present ?? false,
        favicon_present: head.favicon_present ?? false,
        preload_count: head.preload_count ?? 0,
      };
    }

    const cr = data?.content_ratios;
    if (cr) {
      result.content_ratios = {
        html_size_kb: cr.html_size_kb ?? 0,
        word_count_approx: cr.word_count_approx ?? 0,
        html_text_ratio: cr.html_text_ratio ?? 0,
      };
    }

    const a11y = data?.accessibility;
    if (a11y) {
      result.accessibility = {
        images_missing_alt: a11y.images_missing_alt ?? 0,
        inputs_without_label: a11y.inputs_without_label ?? 0,
        buttons_links_no_text: a11y.buttons_links_no_text ?? 0,
        html_missing_lang: a11y.html_missing_lang ?? false,
        aria_attribute_count: a11y.aria_attribute_count ?? 0,
      };
    }

    const links = data?.links;
    if (links) {
      result.links_summary = {
        total: links.total ?? 0,
        internal: links.internal ?? 0,
        external: links.external ?? 0,
        target_blank_missing_rel: links.target_blank_missing_rel ?? 0,
      };
    }

    const images = data?.images;
    if (images) {
      result.images_summary = {
        total: images.total ?? 0,
        missing_alt: images.missing_alt ?? 0,
        missing_dimensions: images.missing_dimensions ?? 0,
        lazy_loaded: images.lazy_loaded ?? 0,
      };
    }

    const forms = data?.forms;
    if (forms) {
      result.forms_summary = {
        form_count: forms.form_count ?? 0,
        input_count: forms.input_count ?? 0,
        button_count: forms.button_count ?? 0,
        inputs_without_labels: forms.inputs_without_labels ?? 0,
        forms_missing_action: forms.forms_missing_action ?? 0,
      };
    }

    const scripts = data?.scripts;
    if (scripts) {
      const tp = scripts.third_party ?? {};
      result.scripts_summary = {
        total: scripts.total ?? 0,
        inline: scripts.inline ?? 0,
        external: scripts.external ?? 0,
        defer_count: scripts.defer_count ?? 0,
        async_count: scripts.async_count ?? 0,
        third_party_count: tp.count ?? 0,
        third_party_domains: Array.isArray(tp.domains) ? tp.domains : [],
        tag_manager_detected: tp.tag_manager_detected ?? false,
      };
    }

    if (data?.inline_styles?.count !== undefined) {
      result.inline_styles_count = data.inline_styles.count;
    }

    // Phase 4 additions (webflow-tier signals)
    if (dom?.depth_avg !== undefined) result.depth_avg = dom.depth_avg;
    if (data?.tabindex_audit && typeof data.tabindex_audit === 'object') {
      result.tabindex_audit = {
        positive_tabindex_count: data.tabindex_audit.positive_tabindex_count ?? 0,
      };
    }
    if (data?.largest_image_candidate !== undefined) {
      const lic = data.largest_image_candidate;
      if (lic && typeof lic === 'object') {
        result.largest_image_candidate = {
          src: lic.src ?? '',
          width: lic.width ?? 0,
          height: lic.height ?? 0,
        };
      } else {
        result.largest_image_candidate = null;
      }
    }
    if (data?.text_density_by_region && typeof data.text_density_by_region === 'object') {
      const td = data.text_density_by_region;
      result.text_density_by_region = {
        main: td.main ?? 0,
        aside: td.aside ?? 0,
        footer: td.footer ?? 0,
        header: td.header ?? 0,
      };
    }
    if (Array.isArray(data?.duplicate_headings)) {
      result.duplicate_headings = data.duplicate_headings.map((s: unknown) => String(s));
    }

    return result;
  } catch {
    return undefined;
  }
}

/**
 * Map technical_seo.py JSON output to TechnicalSEO interface.
 * Preserves the original 7 fields exactly and additively populates the
 * expanded optional fields defined on TechnicalSEO.
 */
export function mapTechSeoToTechnicalSEO(data: Record<string, any>): TechnicalSEO | undefined {
  try {
    if (!data) return undefined;
    const og = data?.open_graph ?? {};
    // Exclude nested twitter_card from the OG presence check
    const ogPresent = ['title', 'description', 'image', 'url'].some(k => Boolean(og[k]));

    const result: TechnicalSEO = {
      title_present: data?.meta?.title?.present ?? false,
      description_present: data?.meta?.description?.present ?? false,
      canonical_present: data?.canonical?.present ?? false,
      open_graph_present: ogPresent,
      is_indexable: !(data?.indexability?.blocked ?? false),
      twitter_card_present: data?.open_graph?.twitter_card?.present ?? false,
      security_headers_count: data?.security_headers?.count,
    };

    // Meta title / description / robots
    const metaTitle = data?.meta?.title;
    if (metaTitle) {
      result.title = {
        content: metaTitle.content,
        length: metaTitle.length,
        status: metaTitle.status,
      };
    }
    const metaDesc = data?.meta?.description;
    if (metaDesc) {
      result.description = {
        content: metaDesc.content,
        length: metaDesc.length,
        status: metaDesc.status,
      };
    }
    const metaRobots = data?.meta?.robots;
    if (metaRobots) {
      result.robots = {
        index: metaRobots.index ?? true,
        follow: metaRobots.follow ?? true,
        content: metaRobots.content,
        status: metaRobots.status,
      };
    }
    if (data?.meta?.charset?.present !== undefined) {
      result.charset_present = data.meta.charset.present;
    }
    if (data?.meta?.viewport?.present !== undefined) {
      result.viewport_present = data.meta.viewport.present;
    }

    const canonical = data?.canonical;
    if (canonical) {
      result.canonical = {
        href: canonical.href ?? null,
        self_referencing: canonical.self_referencing ?? null,
        status: canonical.status,
      };
    }

    if (og && Object.keys(og).length > 0) {
      result.open_graph = {
        title: Boolean(og.title),
        description: Boolean(og.description),
        image: Boolean(og.image),
        url: Boolean(og.url),
        published_time: og.published_time ?? null,
        modified_time: og.modified_time ?? null,
        updated_time: og.updated_time ?? null,
      };
    }

    const idx = data?.indexability;
    if (idx) {
      result.indexability = {
        blocked: idx.blocked ?? false,
        signals: Array.isArray(idx.signals) ? idx.signals : [],
        conflicts: Array.isArray(idx.conflicts) ? idx.conflicts : [],
      };
    }

    const links = data?.links;
    if (links) {
      result.links_summary = {
        internal_total: links.internal_total ?? 0,
        internal_generic_anchor: links.internal_generic_anchor ?? 0,
        external_total: links.external_total ?? 0,
        external_broken: links.external_broken ?? 0,
      };
    }

    const sec = data?.security_headers;
    if (sec) {
      result.security_headers = {
        present: Array.isArray(sec.present) ? sec.present : [],
        missing: Array.isArray(sec.missing) ? sec.missing : [],
        count: sec.count ?? 0,
        grade: sec.grade,
        details: sec.details,
      };
    }

    const hreflang = data?.hreflang;
    if (hreflang) {
      // Python may return languages as array of strings or array of {lang, href}
      const rawLangs = Array.isArray(hreflang.languages) ? hreflang.languages : [];
      const langs: string[] = rawLangs.map((l: any) =>
        typeof l === 'string' ? l : (l?.lang ?? String(l)),
      );
      result.hreflang = {
        present: hreflang.present ?? false,
        count: hreflang.count ?? 0,
        languages: langs,
        has_x_default: hreflang.has_x_default ?? false,
        issues: Array.isArray(hreflang.issues) ? hreflang.issues : [],
      };
    }

    const pa = data?.pagination_amp;
    if (pa) {
      result.pagination_amp = {
        has_prev: pa.has_prev ?? false,
        has_next: pa.has_next ?? false,
        prev_href: pa.prev_href ?? null,
        next_href: pa.next_href ?? null,
        is_paginated: pa.is_paginated ?? false,
        amp_link_present: pa.amp_link_present ?? false,
        amp_html: typeof pa.amp_html === 'string' ? pa.amp_html : (pa.amp_html ? String(pa.amp_html) : null),
        is_amp: pa.is_amp ?? false,
      };
    }

    const caching = data?.caching;
    if (caching) {
      result.caching = {
        cache_control: caching.cache_control ?? null,
        has_cache_control: caching.has_cache_control ?? false,
        has_etag: caching.has_etag ?? false,
        has_last_modified: caching.has_last_modified ?? false,
        max_age_seconds: caching.max_age_seconds ?? null,
        is_cacheable: caching.is_cacheable ?? false,
        issues: Array.isArray(caching.issues) ? caching.issues : [],
      };
    }

    const rh = data?.resource_hints;
    if (rh) {
      // preload may be array of strings or array of {href, as}; normalize to strings
      const preloadRaw = Array.isArray(rh.preload) ? rh.preload : [];
      const preload: string[] = preloadRaw.map((p: any) =>
        typeof p === 'string' ? p : (p?.href ?? String(p)),
      );
      result.resource_hints = {
        preload,
        prefetch: Array.isArray(rh.prefetch) ? rh.prefetch : [],
        dns_prefetch: Array.isArray(rh.dns_prefetch) ? rh.dns_prefetch : [],
        preconnect: Array.isArray(rh.preconnect) ? rh.preconnect : [],
        counts: {
          preload: rh.preload_count ?? preload.length,
          dns_prefetch: rh.dns_prefetch_count ?? (Array.isArray(rh.dns_prefetch) ? rh.dns_prefetch.length : 0),
          preconnect: rh.preconnect_count ?? (Array.isArray(rh.preconnect) ? rh.preconnect.length : 0),
        },
      };
    }

    const us = data?.url_structure;
    if (us) {
      result.url_structure = {
        length: us.length ?? 0,
        path: us.path ?? '',
        has_trailing_slash: us.has_trailing_slash ?? false,
        has_uppercase: us.has_uppercase ?? false,
        has_special_chars: us.has_special_chars ?? false,
        has_double_slashes: us.has_double_slashes ?? false,
        keyword_segments: us.keyword_segments ?? 0,
        total_segments: us.total_segments ?? 0,
        issues: Array.isArray(us.issues) ? us.issues : [],
      };
    }

    return result;
  } catch {
    return undefined;
  }
}

/**
 * Map onpage.py JSON output to OnPageSEO interface.
 * Preserves the original 7 fields exactly and additively populates
 * heading tree/violations, content, links, and images detail.
 */
export function mapOnpageToOnPageSEO(data: Record<string, any>): OnPageSEO | undefined {
  try {
    if (!data) return undefined;

    const result: OnPageSEO = {
      h1_count: data?.headings?.h1_count ?? 0,
      content_word_count: data?.content?.word_count ?? 0,
      image_alt_missing: data?.images?.missing_alt ?? 0,
      internal_links: data?.links?.internal_total ?? 0,
      heading_hierarchy_valid: data?.headings?.hierarchy_valid ?? false,
    };

    const h = data?.headings;
    if (h) {
      result.heading_counts = {
        h1: h.h1_count ?? 0,
        h2: h.h2_count ?? 0,
        h3: h.h3_count ?? 0,
        h4: h.h4_count ?? 0,
        h5: h.h5_count ?? 0,
        h6: h.h6_count ?? 0,
      };
      // h1_content in Python is a single string; normalize to string[]
      if (h.h1_content !== undefined) {
        if (Array.isArray(h.h1_content)) {
          result.h1_content = h.h1_content.map((s: any) => String(s));
        } else if (h.h1_content) {
          result.h1_content = [String(h.h1_content)];
        } else {
          result.h1_content = [];
        }
      }
      if (h.empty_headings !== undefined) result.empty_headings = h.empty_headings;
      if (h.total_headings !== undefined) result.total_headings = h.total_headings;
      if (Array.isArray(h.violations)) {
        result.heading_violations = h.violations.map((v: any) => ({
          from_level: v?.from_level ?? 0,
          to_level: v?.to_level ?? 0,
          heading: v?.heading,
          issue_type: v?.issue_type ?? '',
        }));
      }
      if (Array.isArray(h.tree)) {
        result.heading_tree = h.tree;
      }
      if (Array.isArray(h.issues)) result.heading_issues = h.issues;
      if (h.table_of_contents_detected !== undefined) {
        result.table_of_contents_detected = Boolean(h.table_of_contents_detected);
      }
    }

    const c = data?.content;
    if (c) {
      result.content = {
        word_count: c.word_count ?? 0,
        paragraph_count: c.paragraph_count ?? 0,
        avg_paragraph_length: c.avg_paragraph_length ?? 0,
      };
    }

    const l = data?.links;
    if (l) {
      result.links_detail = {
        internal_total: l.internal_total ?? 0,
        internal_generic_anchor: l.internal_generic_anchor ?? 0,
        external_total: l.external_total ?? 0,
        external_broken: l.external_broken ?? 0,
      };
    }

    const img = data?.images;
    if (img) {
      result.images_detail = {
        total: img.total ?? 0,
        missing_alt: img.missing_alt ?? 0,
        empty_alt_decorative: img.empty_alt_decorative ?? 0,
        too_short: img.too_short ?? 0,
        too_long: img.too_long ?? 0,
        poor_quality_alt: img.poor_quality_alt ?? 0,
        lazy_loading: img.lazy_loading ?? 0,
        modern_format: img.modern_format ?? 0,
        explicit_dimensions: img.explicit_dimensions ?? 0,
        density_per_1000_words: img.density_per_1000_words ?? 0,
      };
    }

    return result;
  } catch {
    return undefined;
  }
}

/**
 * Map content_analysis.py JSON output to ContentAnalysis interface.
 *
 * Strategy: spread everything from Python first (so new fields flow through
 * automatically), then selectively re-apply defensive coercions and summary
 * promotions that merger.ts / report builders depend on. This keeps the
 * mapper resilient to additive Python changes while still ensuring the
 * backward-compatible top-level summary fields (depth_label, eeat_label, ...)
 * and string-coerced scores stay exactly as merger.ts expects.
 *
 * Fields needing defensive handling (not raw passthrough):
 *  - `issues`: must default to [] (downstream code assumes array).
 *  - summary promotions: `depth_label`, `eeat_label`, `freshness_status`,
 *    `thin_content_risk`, `anchor_quality_score` (stringified),
 *    `snippet_eligible` (boolean-coerced).
 *  - `meta_description_info`: Python emits this as `meta_description`;
 *    we alias it onto the TypeScript field name.
 */
export function mapContentAnalysis(data: Record<string, any>): ContentAnalysis | undefined {
  try {
    if (!data || typeof data !== 'object') return undefined;

    // Start from a full spread so new Python fields flow through.
    // Then narrow/coerce the specific subset downstream consumers rely on.
    const result: ContentAnalysis = {
      ...(data as Record<string, any>),
      issues: Array.isArray(data.issues) ? data.issues : [],
    } as ContentAnalysis;

    // Top-level summary fields used by merger.ts for report.content_analysis
    if (data.content_depth?.depth_label !== undefined) {
      result.depth_label = data.content_depth.depth_label;
    }
    if (data.eeat_signals?.eeat_label !== undefined) {
      result.eeat_label = data.eeat_signals.eeat_label;
    }
    if (data.content_freshness?.freshness_status !== undefined) {
      result.freshness_status = data.content_freshness.freshness_status;
    }
    if (data.thin_content?.thin_content_risk !== undefined) {
      result.thin_content_risk = data.thin_content.thin_content_risk;
    }
    if (data.anchor_text_quality?.anchor_quality_score !== undefined) {
      result.anchor_quality_score = String(data.anchor_text_quality.anchor_quality_score);
    }
    if (data.featured_snippet?.snippet_eligible !== undefined) {
      result.snippet_eligible = Boolean(data.featured_snippet.snippet_eligible);
    }

    // Detail sections — copied defensively
    if (typeof data.detected_language === 'string') result.detected_language = data.detected_language;
    if (data.content_depth && typeof data.content_depth === 'object') {
      const cd = data.content_depth;
      result.content_depth = {
        word_count: cd.word_count ?? 0,
        paragraph_count: cd.paragraph_count ?? 0,
        avg_paragraph_length: cd.avg_paragraph_length ?? 0,
        depth_label: cd.depth_label ?? 'unknown',
        issues: Array.isArray(cd.issues) ? cd.issues : [],
      };
    }
    if (data.content_relevance) {
      const cr = data.content_relevance;
      result.content_relevance = {
        title_in_h1: cr.title_in_h1 ?? false,
        title_in_intro: cr.title_in_intro ?? false,
        title_in_intro_word_position: cr.title_in_intro_word_position ?? null,
        heading_alignment_score: cr.heading_alignment_score ?? 0,
        keyword_stuffing_detected: cr.keyword_stuffing_detected ?? false,
      };
    }
    if (data.eeat_signals) {
      const e = data.eeat_signals;
      result.eeat_signals = {
        first_person_count: e.first_person_count ?? 0,
        first_person_present: e.first_person_present ?? false,
        statistics_count: e.statistics_count ?? 0,
        citation_patterns: e.citation_patterns ?? 0,
        author_mention_detected: e.author_mention_detected ?? false,
        eeat_label: e.eeat_label ?? 'unknown',
        eeat_signals_count: e.eeat_signals_count ?? 0,
        eeat_signals_present: (e.eeat_signals_present && typeof e.eeat_signals_present === 'object') ? e.eeat_signals_present : {},
        dates_found: Array.isArray(e.dates_found) ? e.dates_found : [],
        most_recent_date: e.most_recent_date ?? null,
        time_sensitive_without_date: e.time_sensitive_without_date ?? false,
      };
    }
    if (data.content_freshness) {
      const f = data.content_freshness;
      result.content_freshness = {
        years_mentioned: Array.isArray(f.years_mentioned) ? f.years_mentioned : [],
        most_recent_year: f.most_recent_year ?? null,
        current_year: f.current_year ?? new Date().getFullYear(),
        freshness_status: f.freshness_status ?? 'undated',
        time_sensitive_phrases_found: Array.isArray(f.time_sensitive_phrases_found) ? f.time_sensitive_phrases_found : [],
        time_sensitive_without_date: f.time_sensitive_without_date ?? false,
      };
    }
    if (data.featured_snippet) {
      const fs = data.featured_snippet;
      result.featured_snippet = {
        definition_paragraph_present: fs.definition_paragraph_present ?? false,
        list_snippet_eligible: fs.list_snippet_eligible ?? false,
        lists_under_headings: Array.isArray(fs.lists_under_headings) ? fs.lists_under_headings : [],
        qa_pairs_found: Array.isArray(fs.qa_pairs_found) ? fs.qa_pairs_found : [],
        qa_pattern_count: fs.qa_pattern_count ?? 0,
        faq_schema_recommended: fs.faq_schema_recommended ?? false,
        tables_with_headers: fs.tables_with_headers ?? 0,
        table_snippet_eligible: fs.table_snippet_eligible ?? false,
        snippet_types_eligible: Array.isArray(fs.snippet_types_eligible) ? fs.snippet_types_eligible : [],
        snippet_eligible: fs.snippet_eligible ?? false,
      };
    }
    if (data.thin_content) {
      const tc = data.thin_content;
      result.thin_content = {
        boilerplate_detected: Array.isArray(tc.boilerplate_detected) ? tc.boilerplate_detected : [],
        boilerplate_present: tc.boilerplate_present ?? false,
        duplicate_sentences_found: tc.duplicate_sentences_found ?? 0,
        high_repetition: tc.high_repetition ?? false,
        heading_count: tc.heading_count ?? 0,
        heading_to_content_ratio: tc.heading_to_content_ratio ?? 0,
        skeleton_page_detected: tc.skeleton_page_detected ?? false,
        thin_content_signals: (tc.thin_content_signals && typeof tc.thin_content_signals === 'object') ? tc.thin_content_signals : {},
        thin_content_risk: tc.thin_content_risk ?? 'none',
      };
    }
    if (data.anchor_text_quality) {
      const a = data.anchor_text_quality;
      result.anchor_text_quality = {
        total_internal_links: a.total_internal_links ?? 0,
        descriptive_count: a.descriptive_count ?? 0,
        partial_count: a.partial_count ?? 0,
        generic_count: a.generic_count ?? 0,
        naked_url_count: a.naked_url_count ?? 0,
        empty_count: a.empty_count ?? 0,
        descriptive_ratio: a.descriptive_ratio ?? 0,
        anchor_quality_score: String(a.anchor_quality_score ?? 'unknown'),
      };
    }
    if (data.readability) {
      const r = data.readability;
      result.readability = {
        avg_words_per_sentence: r.avg_words_per_sentence ?? 0,
        long_sentences_count: r.long_sentences_count ?? 0,
        short_sentences_count: r.short_sentences_count ?? 0,
        flesch_reading_ease: r.flesch_reading_ease ?? 0,
        gunning_fog_index: r.gunning_fog_index ?? 0,
        reading_level: r.reading_level ?? 'unknown',
        sentence_count: r.sentence_count ?? 0,
      };
    }
    if (data.passive_voice) {
      result.passive_voice = {
        passive_voice_count: data.passive_voice.passive_voice_count ?? 0,
        passive_voice_ratio: data.passive_voice.passive_voice_ratio ?? 0,
      };
    }
    if (data.transition_words) {
      const t = data.transition_words;
      result.transition_words = {
        transition_word_count: t.transition_word_count ?? 0,
        transition_word_ratio: t.transition_word_ratio ?? 0,
        transition_label: t.transition_label ?? 'unknown',
      };
    }
    // Python emits `meta_description` (not `meta_description_info`); accept either
    const mdInfo = data.meta_description_info ?? data.meta_description;
    if (mdInfo && typeof mdInfo === 'object') {
      result.meta_description_info = {
        meta_description_length: mdInfo.meta_description_length ?? 0,
        meta_description_status: mdInfo.meta_description_status ?? 'unknown',
      };
    }
    if (data.link_density) {
      const ld = data.link_density;
      result.link_density = {
        links_per_1000_words: ld.links_per_1000_words ?? 0,
        total_internal_links: ld.total_internal_links ?? 0,
        issues: Array.isArray(ld.issues) ? ld.issues : [],
      };
    }
    if (data.image_alt_text) {
      const ia = data.image_alt_text;
      result.image_alt_text = {
        images_total: ia.images_total ?? 0,
        images_missing_alt: ia.images_missing_alt ?? 0,
        alt_coverage_ratio: ia.alt_coverage_ratio ?? 0,
      };
    }
    if (data.heading_hierarchy) {
      result.heading_hierarchy = {
        hierarchy_valid: data.heading_hierarchy.hierarchy_valid ?? false,
        violations: Array.isArray(data.heading_hierarchy.violations) ? data.heading_hierarchy.violations : [],
      };
    }
    if (data.toc) {
      result.toc = {
        toc_present: data.toc.toc_present ?? false,
        toc_entry_count: data.toc.toc_entry_count ?? 0,
        toc_recommended: data.toc.toc_recommended ?? false,
      };
    }
    if (data.cta) {
      result.cta = {
        cta_present: data.cta.cta_present ?? false,
        cta_patterns_found: Array.isArray(data.cta.cta_patterns_found) ? data.cta.cta_patterns_found : [],
        cta_count: data.cta.cta_count ?? 0,
      };
    }
    if (data.author_bio) {
      result.author_bio = {
        author_bio_present: data.author_bio.author_bio_present ?? false,
        detected_pattern: data.author_bio.detected_pattern,
      };
    }
    if (Array.isArray(data.top_keywords)) {
      result.top_keywords = data.top_keywords as Array<{ word: string; count: number; percentage: number }>;
    }
    if (data.top_phrases) {
      result.top_phrases = {
        bigrams: Array.isArray(data.top_phrases.bigrams) ? data.top_phrases.bigrams : [],
        trigrams: Array.isArray(data.top_phrases.trigrams) ? data.top_phrases.trigrams : [],
      };
    }

    return result;
  } catch {
    return undefined;
  }
}

/**
 * Check if the error indicates Python is not installed.
 */
function isPythonNotInstalled(error: string): boolean {
  return (
    error.toLowerCase().includes('python is not installed') ||
    error.toLowerCase().includes('enoent') ||
    error.toLowerCase().includes('not found in path')
  );
}

// ---------------------------------------------------------------------------
// Python result validation helpers
// ---------------------------------------------------------------------------

/**
 * Assert that split.py output has the expected structure.
 * Returns the data if valid, or logs and returns undefined if not.
 */
function validateSplitResult(data: unknown): { markdown?: string; skeleton?: string } | undefined {
  if (data === null || typeof data !== 'object') {
    return undefined;
  }
  const d = data as Record<string, unknown>;
  if (typeof d.markdown !== 'string' && d.markdown !== undefined) {
    return undefined;
  }
  if (typeof d.skeleton !== 'string' && d.skeleton !== undefined) {
    return undefined;
  }
  return { markdown: d.markdown as string | undefined, skeleton: d.skeleton as string | undefined };
}

/**
 * Assert that xray.py output has the expected structure.
 * Returns the raw data if valid, or undefined if not.
 */
function validateXrayResult(data: unknown): Record<string, any> | undefined {
  if (data === null || typeof data !== 'object') {
    return undefined;
  }
  const d = data as Record<string, unknown>;
  // Must have at least dom or structure
  if (!d.dom && !d.structure) {
    return undefined;
  }
  return d as Record<string, any>;
}

/**
 * Assert that technical_seo.py output has the expected structure.
 * Returns the raw data if valid, or undefined if not.
 */
function validateTechSeoResult(data: unknown): Record<string, any> | undefined {
  if (data === null || typeof data !== 'object') {
    return undefined;
  }
  const d = data as Record<string, unknown>;
  // Must have at least meta or canonical
  if (!d.meta && !d.canonical) {
    return undefined;
  }
  return d as Record<string, any>;
}

/**
 * Assert that onpage.py output has the expected structure.
 * Returns the raw data if valid, or undefined if not.
 */
function validateOnpageResult(data: unknown): Record<string, any> | undefined {
  if (data === null || typeof data !== 'object') {
    return undefined;
  }
  const d = data as Record<string, unknown>;
  // Must have at least content or headings
  if (!d.content && !d.headings) {
    return undefined;
  }
  return d as Record<string, any>;
}

// ---------------------------------------------------------------------------
// Python pipeline runner
// ---------------------------------------------------------------------------

interface PythonPipelineResult {
  analysis: PythonAnalysis;
  raw: {
    split?: { markdown?: string; skeleton?: string };
    xray?: Record<string, any>;
    techSeo?: Record<string, any>;
    onpage?: Record<string, any>;
    contentAnalysis?: Record<string, any>;
    robotsCheck?: Record<string, any>;
    schemaValidation?: Record<string, any>;
  };
}

/**
 * Run all Python analysis scripts.
 * Stage 1: split.py + technical_seo.py + robots_check.py in parallel
 * Stage 2: xray.py + onpage.py in parallel (need split output)
 */
async function runPythonPipeline(
  html: string,
  headers: Record<string, string>,
  emit?: (id: StepId, status: StepUpdate['status'], extra?: Partial<StepUpdate>) => void,
  url?: string,
  timeout = 30000,
  config?: ResolvedConfig,
  customRequestHeaders?: Record<string, string>,
  splitOptions?: { onlyMainContent?: boolean; includeTags?: string[]; excludeTags?: string[] },
): Promise<PythonPipelineResult> {
  const result: PythonAnalysis = {};
  const raw: PythonPipelineResult['raw'] = {};
  const pythonPath = config?.pythonPath;

  // ── Stage 1: split + technical_seo + robots_check in parallel ────────────
  const tSplit = Date.now(), tTech = Date.now();
  emit?.('split', 'running', { startedAt: tSplit });
  emit?.('technical_seo', 'running', { startedAt: tTech });
  const [splitSettled, techSeoSettled, robotsCheckSettled, schemaSettled] = await Promise.allSettled([
    runPythonScriptSafe('split.py', html, timeout, url, pythonPath,
      splitOptions ? [url ?? '', JSON.stringify(splitOptions)] : undefined),
    runPythonScriptSafe('technical_seo.py', JSON.stringify({ html, headers, url }), timeout, undefined, pythonPath),
    url
      ? runPythonScriptSafe('robots_check.py', JSON.stringify({ url, meta_robots_blocked: false, timeout_ms: timeout, headers: customRequestHeaders ?? {} }), timeout, undefined, pythonPath)
      : Promise.resolve({ success: false as const, error: 'No URL provided' }),
    runPythonScriptSafe('schema_validator.py', JSON.stringify({ html }), timeout, undefined, pythonPath),
  ]);
  emit?.('split', splitSettled.status === 'fulfilled' && splitSettled.value.success ? 'done' : 'error',
    { duration_ms: Date.now() - tSplit });
  emit?.('technical_seo', techSeoSettled.status === 'fulfilled' && techSeoSettled.value.success ? 'done' : 'error',
    { duration_ms: Date.now() - tTech });

  // Check if Python is not installed (bail out early, no point continuing)
  if (splitSettled.status === 'fulfilled' && !splitSettled.value.success) {
    if (isPythonNotInstalled(splitSettled.value.error ?? '')) {
      // Python not installed — return empty analysis (degraded mode)
      return { analysis: result, raw };
    }
  }

  // Extract split output
  const rawSplitData =
    splitSettled.status === 'fulfilled' && splitSettled.value.success
      ? splitSettled.value.data
      : undefined;
  const splitData = rawSplitData !== undefined
    ? (validateSplitResult(rawSplitData) ?? { markdown: '', skeleton: '' })
    : { markdown: '', skeleton: '' };

  if (splitData.markdown) result.markdown = splitData.markdown;
  if (splitData.skeleton) result.skeleton = splitData.skeleton;
  raw.split = { markdown: splitData.markdown, skeleton: splitData.skeleton };

  // Extract technical SEO output
  if (techSeoSettled.status === 'fulfilled' && techSeoSettled.value.success) {
    const validated = validateTechSeoResult(techSeoSettled.value.data);
    const mapped = validated ? mapTechSeoToTechnicalSEO(validated) : undefined;
    if (mapped) result.technical_seo = mapped;
    if (validated) raw.techSeo = validated;
  }

  // Extract robots check output
  if (robotsCheckSettled.status === 'fulfilled' && robotsCheckSettled.value.success) {
    const data = robotsCheckSettled.value.data;
    if (data && typeof data === 'object') {
      raw.robotsCheck = data as Record<string, any>;
    }
  }

  // Extract schema validation output
  if (schemaSettled.status === 'fulfilled' && schemaSettled.value.success) {
    const data = schemaSettled.value.data;
    if (data && typeof data === 'object') {
      raw.schemaValidation = data as Record<string, any>;
    }
  }

  // ── Stage 2: xray + onpage in parallel ───────────────────────────────────
  const skeleton = splitData.skeleton ?? '';
  const markdown = splitData.markdown ?? '';

  const tXray = Date.now(), tOnpage = Date.now();
  emit?.('html_xray', 'running', { startedAt: tXray });
  emit?.('on_page', 'running', { startedAt: tOnpage });
  const [xraySettled, onpageSettled] = await Promise.allSettled([
    skeleton
      ? runPythonScriptSafe('xray.py', JSON.stringify({ skeleton, html, url }), timeout, undefined, pythonPath)
      : Promise.resolve({ success: false as const, error: 'No skeleton available' }),
    (markdown || html)
      ? runPythonScriptSafe('onpage.py', JSON.stringify({ markdown, html }), timeout, undefined, pythonPath)
      : Promise.resolve({ success: false as const, error: 'No content available' }),
  ]);
  emit?.('html_xray', xraySettled.status === 'fulfilled' && xraySettled.value.success ? 'done' : 'error',
    { duration_ms: Date.now() - tXray });
  emit?.('on_page', onpageSettled.status === 'fulfilled' && onpageSettled.value.success ? 'done' : 'error',
    { duration_ms: Date.now() - tOnpage });

  // Extract DOM analysis from xray
  if (xraySettled.status === 'fulfilled' && xraySettled.value.success) {
    const validated = validateXrayResult(xraySettled.value.data);
    const mapped = validated ? mapXrayToDOMAnalysis(validated) : undefined;
    if (mapped) result.dom = mapped;
    if (validated) raw.xray = validated;
  }

  // Extract on-page SEO from onpage
  if (onpageSettled.status === 'fulfilled' && onpageSettled.value.success) {
    const validated = validateOnpageResult(onpageSettled.value.data);
    const mapped = validated ? mapOnpageToOnPageSEO(validated) : undefined;
    if (mapped) result.onpage_seo = mapped;
    if (validated) raw.onpage = validated;
  }

  // ── Stage 3: content_analysis (needs markdown + meta from techSeo) ──────────
  const meta = {
    title: raw.techSeo?.meta?.title?.content ?? '',
    meta_description: raw.techSeo?.meta?.description?.content ?? '',
    published_time: raw.techSeo?.open_graph?.published_time ?? raw.techSeo?.schema?.date_published ?? null,
    modified_time: raw.techSeo?.open_graph?.modified_time ?? raw.techSeo?.open_graph?.updated_time ?? raw.techSeo?.schema?.date_modified ?? null,
  };

  const tContent = Date.now();
  emit?.('content', 'running', { startedAt: tContent });
  const [contentAnalysisSettled] = await Promise.allSettled([
    markdown
      ? runPythonScriptSafe('content_analysis.py', markdown, timeout, JSON.stringify(meta), pythonPath)
      : Promise.resolve({ success: false as const, error: 'No markdown available' }),
  ]);
  emit?.('content', contentAnalysisSettled.status === 'fulfilled' && contentAnalysisSettled.value?.success ? 'done' : 'error',
    { duration_ms: Date.now() - tContent });

  if (contentAnalysisSettled.status === 'fulfilled' && contentAnalysisSettled.value?.success) {
    const data = contentAnalysisSettled.value.data;
    if (data && typeof data === 'object') {
      const mapped = mapContentAnalysis(data as Record<string, any>);
      if (mapped) result.content_analysis = mapped;
      raw.contentAnalysis = data as Record<string, any>;
    }
  }

  return { analysis: result, raw };
}

// ---------------------------------------------------------------------------
// Streaming orchestrator (async generator)
// ---------------------------------------------------------------------------

/**
 * Internal type to extend AnalysisReport with streaming metadata
 */
interface AnalysisReportWithMetadata extends AnalysisReport {
  _partial?: boolean;
  _complete?: boolean;
}

/**
 * Async generator that yields partial and complete reports.
 * Phase 1: Fetch + Python (fast, ~2-3s) → yield partial report
 * Phase 2: Wait for Google APIs (slower, 5-10s more) → yield final report
 *
 * @param url - Fully qualified URL to analyze
 * @param options - Optional pipeline configuration
 * @yields AnalysisReport - Partial report first, then complete report
 */
export async function* buildReportStream(url: string, options: BuildReportOptions = {}): AsyncGenerator<AnalysisReportWithMetadata> {
  const { skipPython = false, skipPSI = false, device = 'mobile', timeout = 30000 } = options;
  // Only use a resolved config object when the caller explicitly injected one.
  // When absent, each sub-function performs its own resolveConfig() / env-read,
  // which preserves the existing CLI behaviour and keeps existing tests green.
  const resolved = options.config ?? undefined;

  const emit = (id: StepId, status: StepUpdate['status'], extra?: Partial<StepUpdate>) =>
    options.onProgress?.({ id, status, ...extra });

  // ── 0. Validate (URL already valid at this point) ─────────────────────────
  const tValidate = Date.now();
  emit('validate', 'running', { startedAt: tValidate });
  emit('validate', 'done', { duration_ms: Date.now() - tValidate });

  // ── 1. HTTP Fetch ──────────────────────────────────────────────────────────
  const tFetch = Date.now();
  emit('fetch', 'running', { startedAt: tFetch });
  const fetchResult = await renderFetch(url, { device, timeout, headers: options.headers, screenshot: options.save });
  emit('fetch', 'done', { duration_ms: Date.now() - tFetch });

  // ── PHASE 1: Start Python + Google APIs in parallel (non-blocking) ────────
  const pythonPromise = (async () => {
    let python: PythonAnalysis = {};
    let rawPython: Record<string, any> = {};

    if (!skipPython) {
      try {
        const pipelineResult = await runPythonPipeline(
          fetchResult.html ?? '',
          (fetchResult.headers as Record<string, string>) ?? {},
          emit,
          url,
          timeout,
          resolved ?? undefined,
          options.headers,
          options.splitOptions,
        );
        python = pipelineResult.analysis;
        rawPython = pipelineResult.raw;
      } catch {
        // Python pipeline failed unexpectedly — continue in degraded mode
      }
    }

    return { python, rawPython };
  })();

  // ── GSC data (non-blocking, auto-detects own site) ───────────────────────
  const gscPromise = (async (): Promise<GSCData | null> => {
    try {
      return resolved ? await fetchGSCData(url, resolved) : await fetchGSCData(url);
    } catch {
      return null;
    }
  })();

  // ── Google APIs (PSI + CrUX) in parallel, non-blocking ───────────────────
  const googleApiPromise = (async () => {
    const psiResults: PSIResult[] = [];
    let rawPsiDesktop: any = null;
    let rawPsiMobile: any = null;
    let cruxFieldData: FieldData | null = null;
    let cruxScope: 'url' | 'origin' | undefined;
    let cruxCollectionPeriod: { firstDate?: string; lastDate?: string } | undefined;

    if (!skipPSI) {
      const tPsi = Date.now();
      const psiStrategy = device === 'desktop' ? 'desktop' : 'mobile';
      const cruxFormFactor = psiStrategy === 'desktop' ? 'DESKTOP' : 'PHONE';
      emit('psi', 'running', { startedAt: tPsi });
      const [psiSettled, cruxSettled] = await Promise.allSettled([
        resolved ? callPSI(url, psiStrategy, resolved) : callPSI(url, psiStrategy),
        resolved
          ? fetchCrUXData(url, resolved, { formFactor: cruxFormFactor })
          : fetchCrUXData(url, undefined, { formFactor: cruxFormFactor }),
      ]);

      if (psiSettled.status === 'fulfilled') {
        psiResults.push(psiSettled.value);
        if (psiStrategy === 'desktop') {
          rawPsiDesktop = psiSettled.value._raw ?? null;
        } else {
          rawPsiMobile = psiSettled.value._raw ?? null;
        }
      }
      if (cruxSettled.status === 'fulfilled' && cruxSettled.value?.data) {
        cruxFieldData = cruxSettled.value.data;
        cruxScope = cruxSettled.value.scope;
        cruxCollectionPeriod = cruxSettled.value.collectionPeriod;
      }
      emit('psi', 'done', { duration_ms: Date.now() - tPsi });
    } else {
      emit('psi', 'done', {});
    }

    return { psiResults, rawPsiDesktop, rawPsiMobile, cruxFieldData, cruxScope, cruxCollectionPeriod };
  })();

  // ── PHASE 2a: Python completes first (fast path) ─────────────────────────
  const { python, rawPython } = await pythonPromise;

  // ── Create partial report (Python only, no Google metrics) ───────────────
  const partialFieldData = null; // No CrUX/PSI data yet
  const partialPsiResults: PSIResult[] = [];

  const tPerf = Date.now();
  emit('performance', 'running', { startedAt: tPerf });
  emit('performance', 'done', { duration_ms: Date.now() - tPerf });

  // ── Create and yield partial report ───────────────────────────────────────
  const tScore = Date.now();
  emit('score', 'running', { startedAt: tScore });
  const partialReport = mergeAnalysis(url, fetchResult, partialPsiResults, python, partialFieldData, rawPython);
  (partialReport as AnalysisReportWithMetadata)._partial = true;
  (partialReport as AnalysisReportWithMetadata)._complete = false;
  emit('score', 'done', { duration_ms: Date.now() - tScore });

  if (process.env.SGNL_DEBUG) {
    (partialReport as any)._raw = {
      fetch: fetchResult,
      psi: null,
      python,
    };
  }

  yield partialReport as AnalysisReportWithMetadata;

  // ── PHASE 2b: Wait for Google APIs + GSC to complete ────────────────────
  const [googleApiResult, gscData] = await Promise.all([googleApiPromise, gscPromise]);
  const { psiResults, rawPsiDesktop, rawPsiMobile, cruxFieldData, cruxScope, cruxCollectionPeriod } = googleApiResult;

  // ── Create complete report (with Google metrics) ─────────────────────────
  // Prefer CrUX field data (direct API), fall back to PSI's loadingExperience
  const tPerfFinal = Date.now();
  emit('performance', 'running', { startedAt: tPerfFinal });
  emit('performance', 'done', { duration_ms: Date.now() - tPerfFinal });

  // ── Create and yield final report ─────────────────────────────────────────
  const tScoreFinal = Date.now();
  emit('score', 'running', { startedAt: tScoreFinal });
  const finalReport = mergeAnalysis(
    url,
    fetchResult,
    psiResults,
    python,
    cruxFieldData,
    rawPython,
    gscData,
    { scope: cruxScope, collectionPeriod: cruxCollectionPeriod },
  );
  (finalReport as AnalysisReportWithMetadata)._partial = false;
  (finalReport as AnalysisReportWithMetadata)._complete = true;
  emit('score', 'done', { duration_ms: Date.now() - tScoreFinal });

  if (process.env.SGNL_DEBUG) {
    (finalReport as any)._raw = {
      fetch: fetchResult,
      psi: psiResults[0],
      python,
    };
  }

  // ── Write run files (always report.json; .md files only with save flag) ────
  await saveRunReport({
    url,
    statusCode: fetchResult.status,
    ttfb_ms: fetchResult.ttfb_ms,
    compression: fetchResult.compression,
    cdnDetected: fetchResult.cdnDetected,
    redirect_chain: fetchResult.redirect_chain,
    headers: (fetchResult.headers as Record<string, string>) ?? {},
    html: fetchResult.html ?? '',
    screenshot: fetchResult.screenshot,
    rawSplit: rawPython.split,
    rawXray: rawPython.xray,
    rawTechSeo: rawPython.techSeo,
    rawOnpage: rawPython.onpage,
    rawContentAnalysis: rawPython.contentAnalysis,
    rawRobotsCheck: rawPython.robotsCheck,
    rawSchemaValidation: rawPython.schemaValidation,
    rawPsi: { desktop: rawPsiDesktop, mobile: rawPsiMobile },
    report: finalReport,
  }, options.save ?? false, resolved ?? undefined);

  yield finalReport as AnalysisReportWithMetadata;
}

// ---------------------------------------------------------------------------
// Main orchestrator (backward compatible synchronous version)
// ---------------------------------------------------------------------------

/**
 * Run the full SGNL analysis pipeline for a URL.
 * PSI and Python errors are handled gracefully (degraded mode).
 *
 * @param url - Fully qualified URL to analyze
 * @param options - Optional pipeline configuration
 * @returns Promise<AnalysisReport>
 */
export async function buildReport(url: string, options: BuildReportOptions = {}): Promise<AnalysisReport> {
  // Use the async generator but only return the final report
  let finalReport: AnalysisReport | null = null;
  for await (const report of buildReportStream(url, options)) {
    finalReport = report;
  }
  return finalReport || ({} as AnalysisReport);
}
