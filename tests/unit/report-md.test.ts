import {
  buildReportMd,
  dash,
  fmtInt,
  fmtMs,
  fmtS,
  fmtKB,
  fmtPct,
  fmtFloat,
  icon,
  boolYN,
  escCell,
  cwvRating,
  statusToIcon,
  table,
} from '../../src/analysis/report-md';
import { AnalysisReport } from '../../src/analysis/merger';

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const fullReport: AnalysisReport = {
  url: 'https://example.com/blog/post',
  timestamp: '2026-03-22T14:30:00.000Z',
  http_status: 200,
  crawlable: true,
  https: true,
  performance: {
    core_web_vitals: { lcp_ms: 1200, fcp_ms: 900, cls: 0.08, inp_ms: 150, fid_ms: 50 },
    speed_metrics: { ttfb_ms: 120, speed_index_s: 1.8, tti_s: 2.1, tbt_ms: 95, performance_score: 92 },
    cdn: 'CloudFlare',
    compression: 'gzip',
    resource_summary: {
      total_bytes: 524288,
      script_bytes: 204800,
      stylesheet_bytes: 51200,
      image_bytes: 204800,
      font_bytes: 40960,
      other_bytes: 22528,
    },
  },
  seo: {
    technical: {
      title: 'Example Blog Post',
      description: 'A detailed description of the blog post content',
      canonical: 'https://example.com/blog/post',
      schema_count: 2,
      open_graph: true,
      twitter_card: true,
      indexable: true,
    },
    content: { word_count: 1240, h1_count: 1, headings_valid: true, images_total: 12, images_alt_missing: 2 },
    links: { internal_total: 28, external_total: 5, generic_anchor_text: 3 },
  },
  structure: { dom_elements: 387, div_ratio: 0.35, semantic_score: 6, heading_hierarchy_valid: true },
  issues: {
    critical: ['Site is not served over HTTPS: insecure connection detected'],
    warning: ['Slow TTFB: 650ms (threshold: 600ms)', '2 images missing alt text'],
    info: ['No canonical tag: consider adding one'],
  },
  robots: {
    fetched: true,
    disallow_rules: ['/admin/', '/private/'],
    crawl_delay: null,
    sitemaps: ['https://example.com/sitemap.xml'],
    has_wildcard_disallow: false,
    issues: [],
  },
  caching: {
    cache_control: 'public, max-age=3600',
    has_cache_control: true,
    has_etag: true,
    has_last_modified: false,
    max_age_seconds: 3600,
    is_cacheable: true,
    issues: [],
  },
  resource_hints: {
    preload: [
      { href: '/font.woff2', as: 'font' },
      { href: '/hero.webp', as: 'image' },
    ],
    prefetch: [],
    dns_prefetch: [],
    preconnect: ['https://cdn.example.com'],
    preload_count: 2,
    dns_prefetch_count: 0,
    preconnect_count: 1,
  },
  schema_validation: {
    blocks_found: 1,
    types: ['Article'],
    rich_results_eligible: ['Article'],
    recommendations: [{ priority: 'medium', type: 'Article', message: "'Add datePublished for better visibility'" }],
  },
  redirect_analysis: {
    chain_length: 2,
    chain: ['http://example.com/blog/post', 'https://example.com/blog/post'],
    has_http_to_https: true,
    has_www_redirect: false,
    issues: [],
  },
  third_party_scripts: {
    count: 5,
    domains: ['cdn.example.com', 'analytics.example.com'],
    categories: { analytics: ['analytics.example.com'], cdn: ['cdn.example.com'] },
    tag_manager_detected: true,
  },
  content_analysis: {
    depth_label: 'comprehensive',
    eeat_label: 'moderate',
    freshness_status: 'current',
    thin_content_risk: 'none',
    anchor_quality_score: 'good',
    snippet_eligible: true,
    issues: ['Short meta description', 'Short meta description', 'Missing alt on hero image'],
  },
  analysis_detail: {
    xray: {
      dom: { total_elements: 387, unique_tags: 45, depth_max: 12, depth_avg: 6 },
      structure: { div_ratio: 0.35, semantic_score: 6, empty_elements: 15, duplicate_ids: 0, inline_event_handlers: 2, iframes: { count: 1 } },
      inline_styles: { count: 8 },
      content_ratios: { html_size_kb: 45.3, html_text_ratio: 0.32 },
      scripts: { total: 14, inline: 3, external: 11, defer_count: 8, async_count: 2, third_party: { count: 5, domains: ['cdn.example.com', 'analytics.example.com'] } },
      accessibility: { images_missing_alt: 2, inputs_without_label: 0, buttons_links_no_text: 1, html_missing_lang: false, aria_attribute_count: 12 },
      links: { target_blank_missing_rel: 3 },
      images: { missing_dimensions: 4 },
      forms: { form_count: 2, input_count: 6, button_count: 3, inputs_without_labels: 1, forms_missing_action: 0 },
      head: { charset_present: true, viewport_present: true, favicon_present: true, preload_count: 2 },
    },
    technical_seo: {
      meta: {
        title: { content: 'Example Blog Post', length: 18, status: 'pass' },
        description: { content: 'A detailed description of the blog post content', length: 48, status: 'pass' },
        robots: { content: 'index, follow', status: 'pass' },
        charset: { present: true },
        viewport: { present: true },
      },
      canonical: { href: 'https://example.com/blog/post', self_referencing: true, status: 'pass' },
      open_graph: { title: true, description: true, image: true, url: true, published_time: '2026-03-20T10:00:00Z', modified_time: null, twitter_card: { present: true, card_type: 'summary_large_image' } },
      security_headers: { count: 4, grade: 'moderate', present: ['X-Frame-Options', 'X-Content-Type-Options', 'Strict-Transport-Security', 'Content-Security-Policy'], missing: ['Permissions-Policy', 'Referrer-Policy'], details: { 'X-Frame-Options': 'DENY', 'Strict-Transport-Security': 'max-age=31536000' } },
      hreflang: { count: 0, languages: [] },
      pagination_amp: { is_paginated: false, is_amp: false },
      url_structure: { length: 35, path: '/blog/post', has_uppercase: false, has_special_chars: false, has_double_slashes: false },
    },
    onpage: {
      content: { word_count: 1240, paragraph_count: 18, avg_paragraph_length: 68.9 },
      headings: {
        h1_count: 1, h1_content: 'Welcome to Our Blog', h2_count: 4, h3_count: 7, h4_count: 2, h5_count: 0, h6_count: 0,
        total_headings: 14, empty_headings: 0,
        hierarchy_valid: true,
        violations: ['Skipped heading level: H2 to H4'],
        tree: [
          { level: 1, text: 'Welcome to Our Blog', children: [
            { level: 2, text: 'Introduction', children: [
              { level: 3, text: 'Background', children: [] },
            ] },
            { level: 2, text: 'Main Content', children: [] },
          ] },
        ],
      },
      links: { internal_total: 28, external_total: 5, external_broken: 0, internal_generic_anchor: 3 },
      images: { total: 12, missing_alt: 2, empty_alt_decorative: 1, too_short: 1, too_long: 0, poor_quality_alt: 0, lazy_loading: 8, modern_format: 9, explicit_dimensions: 10, density_per_1000_words: 9.7 },
    },
    content_analysis: {
      content_depth: { word_count: 1240, paragraph_count: 18 },
      eeat_signals: { first_person_count: 5, statistics_count: 3 },
      content_freshness: { most_recent_year: 2026 },
      thin_content: { duplicate_sentences_found: 0, boilerplate_present: false },
      anchor_text_quality: { descriptive_ratio: 0.85 },
      featured_snippet: { definition_paragraph_present: true, list_snippet_eligible: false, qa_pattern_count: 2, table_snippet_eligible: false },
      readability: { reading_level: 'college', flesch_reading_ease: 52.3, gunning_fog_index: 14.2, avg_words_per_sentence: 18.5, long_sentences_count: 4 },
      content_relevance: { title_in_h1: true, title_in_intro: true, heading_alignment_score: 0.78, keyword_stuffing_detected: false },
      top_keywords: [
        { word: 'blog', count: 15 },
        { word: 'content', count: 12 },
        { word: 'example', count: 8 },
      ],
      cta: { cta_present: true, cta_patterns_found: ['sign up', 'learn more'] },
      author_bio: { author_bio_present: true },
      detected_language: 'en',
      passive_voice: { passive_voice_count: 8, passive_voice_ratio: 0.12 },
      transition_words: { transition_word_count: 15, transition_word_ratio: 0.23, transition_label: 'good' },
      meta_description: { meta_description_length: 48, meta_description_status: 'pass' },
      link_density: { links_per_1000_words: 22.6, total_internal_links: 28, issues: [] },
      image_alt_text: { images_total: 12, images_missing_alt: 2, alt_coverage_ratio: 0.83 },
      heading_hierarchy: { hierarchy_valid: true, violations: [] },
      toc: { toc_present: true, toc_entry_count: 5, toc_recommended: false },
      top_phrases: {
        bigrams: [{ phrase: 'blog post', count: 6, percentage: 0.5 }, { phrase: 'content marketing', count: 4, percentage: 0.3 }],
        trigrams: [{ phrase: 'search engine optimization', count: 3, percentage: 0.2 }],
      },
    },
  },
};

const minimalReport: AnalysisReport = {
  url: 'https://minimal.example.com',
  timestamp: '2026-01-01T00:00:00.000Z',
  http_status: 404,
  crawlable: false,
  https: false,
  performance: {
    core_web_vitals: {},
    speed_metrics: { ttfb_ms: 0 },
  },
  seo: {
    technical: { schema_count: 0, open_graph: false, twitter_card: false, indexable: false },
    content: { word_count: 0, h1_count: 0, headings_valid: false, images_total: 0, images_alt_missing: 0 },
    links: { internal_total: 0, external_total: 0, generic_anchor_text: 0 },
  },
  structure: { dom_elements: 0, div_ratio: 0, semantic_score: 0, heading_hierarchy_valid: false },
  issues: { critical: [], warning: [], info: [] },
};

// ─────────────────────────────────────────────────────────────────────────────
// Formatting utility tests
// ─────────────────────────────────────────────────────────────────────────────

describe('formatting utilities', () => {
  test('dash', () => {
    expect(dash(null)).toBe('\u2014');
    expect(dash(undefined)).toBe('\u2014');
    expect(dash('')).toBe('\u2014');
    expect(dash('hello')).toBe('hello');
    expect(dash(0)).toBe('0');
  });

  test('fmtInt', () => {
    expect(fmtInt(1234)).toBe('1,234');
    expect(fmtInt(0)).toBe('0');
    expect(fmtInt(undefined)).toBe('\u2014');
  });

  test('fmtMs', () => {
    expect(fmtMs(1234)).toBe('1,234 ms');
    expect(fmtMs(undefined)).toBe('\u2014');
  });

  test('fmtS', () => {
    expect(fmtS(1.83)).toBe('1.8 s');
    expect(fmtS(undefined)).toBe('\u2014');
  });

  test('fmtKB', () => {
    expect(fmtKB(1024)).toBe('1.0 KB');
    expect(fmtKB(2560)).toBe('2.5 KB');
    expect(fmtKB(undefined)).toBe('\u2014');
  });

  test('fmtPct', () => {
    expect(fmtPct(0.723)).toBe('72%');
    expect(fmtPct(undefined)).toBe('\u2014');
  });

  test('fmtFloat', () => {
    expect(fmtFloat(0.153, 2)).toBe('0.15');
    expect(fmtFloat(3.456)).toBe('3.5');
    expect(fmtFloat(undefined)).toBe('\u2014');
  });

  test('icon', () => {
    expect(icon(true)).toBe('\u2713');
    expect(icon(false)).toBe('\u2717');
    expect(icon(undefined)).toBe('\u2014');
  });

  test('boolYN', () => {
    expect(boolYN(true)).toBe('yes');
    expect(boolYN(false)).toBe('no');
    expect(boolYN(undefined)).toBe('\u2014');
  });

  test('escCell', () => {
    expect(escCell('a|b')).toBe('a\\|b');
    expect(escCell('no pipes')).toBe('no pipes');
  });

  test('statusToIcon', () => {
    expect(statusToIcon('pass')).toBe('\u2713');
    expect(statusToIcon('warn')).toBe('\u26A0');
    expect(statusToIcon('fail')).toBe('\u2717');
    expect(statusToIcon(undefined)).toBe('\u2014');
  });
});

describe('cwvRating', () => {
  test('good LCP', () => {
    const r = cwvRating('lcp', 2000);
    expect(r.icon).toBe('\u2713');
    expect(r.label).toBe('good');
  });

  test('needs improvement LCP', () => {
    const r = cwvRating('lcp', 3000);
    expect(r.icon).toBe('\u26A0');
    expect(r.label).toBe('needs improvement');
  });

  test('poor LCP', () => {
    const r = cwvRating('lcp', 5000);
    expect(r.icon).toBe('\u2717');
    expect(r.label).toBe('poor');
  });

  test('good CLS', () => {
    const r = cwvRating('cls', 0.05);
    expect(r.label).toBe('good');
  });

  test('poor CLS', () => {
    const r = cwvRating('cls', 0.3);
    expect(r.label).toBe('poor');
  });

  test('undefined value', () => {
    const r = cwvRating('lcp', undefined);
    expect(r.icon).toBe('\u2014');
  });
});

describe('table', () => {
  test('builds markdown table', () => {
    const result = table(['A', 'B'], [['1', '2'], ['3', '4']]);
    expect(result).toContain('| A | B |');
    expect(result).toContain('| 1 | 2 |');
    expect(result).toContain('| 3 | 4 |');
  });

  test('empty rows returns empty string', () => {
    expect(table(['A'], [])).toBe('');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Full report tests
// ─────────────────────────────────────────────────────────────────────────────

describe('buildReportMd', () => {
  const output = buildReportMd(fullReport);

  test('starts with YAML frontmatter', () => {
    expect(output).toMatch(/^---\n/);
    expect(output).toContain('url: https://example.com/blog/post');
    expect(output).toContain('http_status: 200');
    expect(output).toContain('https: true');
    expect(output).toContain('cdn: cloudflare');
    expect(output).toContain('1 critical');
  });

  test('title with hostname', () => {
    expect(output).toContain('# SGNL Report \u00B7 example.com');
  });

  test('Performance section with CWV', () => {
    expect(output).toContain('## Performance');
    expect(output).toContain('### Core Web Vitals');
    expect(output).toContain('LCP');
    expect(output).toContain('1,200 ms');
    expect(output).toContain('\u2713 good');
    expect(output).toContain('### Speed');
    expect(output).toContain('92 / 100');
  });

  test('Compression in Speed table', () => {
    expect(output).toContain('gzip');
  });

  test('Resources section', () => {
    expect(output).toContain('### Resources');
    expect(output).toContain('512.0 KB'); // 524288 / 1024
  });

  test('Third-party scripts section', () => {
    expect(output).toContain('### Third-Party Scripts');
    expect(output).toContain('cdn.example.com');
    expect(output).toContain('Tag manager');
    expect(output).toContain('yes'); // tag_manager_detected
    expect(output).toContain('analytics');
  });

  test('SEO Technical section', () => {
    expect(output).toContain('## SEO \u00B7 Technical');
    expect(output).toContain('### Meta');
    expect(output).toContain('Example Blog Post');
    expect(output).toContain('\u2713 pass');
    expect(output).toContain('(self-referencing)');
  });

  test('Open Graph section', () => {
    expect(output).toContain('### Open Graph & Social');
    expect(output).toContain('og:title');
    expect(output).toContain('2026-03-20');
    expect(output).toContain('summary_large_image');
  });

  test('Schema.org section', () => {
    expect(output).toContain('### Schema.org (JSON-LD)');
    expect(output).toContain('Article');
    expect(output).toContain('Add datePublished');
  });

  test('Security Headers section', () => {
    expect(output).toContain('### Security Headers');
    expect(output).toContain('X-Frame-Options');
    expect(output).toContain('DENY');
    expect(output).toContain('Permissions-Policy');
    expect(output).toContain('\u2717 missing');
  });

  test('Crawlability section with robots details', () => {
    expect(output).toContain('### Crawlability');
    expect(output).toContain('\u2713 fetched');
    expect(output).toContain('sitemap.xml');
    expect(output).toContain('`/admin/`');
    expect(output).toContain('`/private/`');
  });

  test('Redirect Analysis section', () => {
    expect(output).toContain('### Redirect Analysis');
    expect(output).toContain('Chain length');
    expect(output).toContain('HTTP \u2192 HTTPS');
    expect(output).toContain('yes'); // has_http_to_https
  });

  test('Redirect Analysis annotates hops with labels', () => {
    // Chain: http://example.com/blog/post -> https://example.com/blog/post (HTTP→HTTPS hop)
    expect(output).toContain('| From |');
    expect(output).toContain('HTTP\u2192HTTPS');
  });

  test('Speed section includes HTTP Status and CDN rows', () => {
    expect(output).toContain('HTTP Status');
    expect(output).toContain('| 200 |');
    expect(output).toContain('CDN');
    expect(output).toContain('CloudFlare');
  });

  test('Caching section with cacheable field', () => {
    expect(output).toContain('### Caching');
    expect(output).toContain('3600 s');
    expect(output).toContain('public, max-age=3600');
    expect(output).toContain('Cacheable');
  });

  test('URL Structure section', () => {
    expect(output).toContain('### URL Structure');
    expect(output).toContain('/blog/post');
    expect(output).toContain('no uppercase');
  });

  test('SEO On-Page section with heading details', () => {
    expect(output).toContain('## SEO \u00B7 On-Page');
    expect(output).toContain('1,240');
    expect(output).toContain('Welcome to Our Blog');
    expect(output).toContain('\u2713 valid');
    expect(output).toContain('Total headings');
    expect(output).toContain('14');
    expect(output).toContain('Skipped heading level');
  });

  test('Links subsection', () => {
    expect(output).toContain('### Links');
    expect(output).toContain('target=_blank missing rel');
  });

  test('Images subsection with extra fields', () => {
    expect(output).toContain('### Images');
    expect(output).toContain('75%'); // 9/12
    expect(output).toContain('9.7 / 1,000 words');
    expect(output).toContain('Empty alt (decorative)');
    expect(output).toContain('Alt too long');
    expect(output).toContain('Poor quality alt');
  });

  test('Content Analysis section with all signals', () => {
    expect(output).toContain('## Content Analysis');
    expect(output).toContain('comprehensive');
    expect(output).toContain('moderate');
    expect(output).toContain('85% descriptive ratio');
    expect(output).toContain('definition block');
    expect(output).toContain('Q&A (2 pair(s))');
    expect(output).toContain('sign up, learn more');
    expect(output).toContain('author bio present');
    // New signals
    expect(output).toContain('Language');
    expect(output).toContain('en');
    expect(output).toContain('TOC');
    expect(output).toContain('5 entries');
    expect(output).toContain('Link density');
    expect(output).toContain('22.6');
    expect(output).toContain('Meta description');
    expect(output).toContain('48 chars');
    expect(output).toContain('Alt coverage');
    expect(output).toContain('83%');
  });

  test('Readability subsection with passive voice and transitions', () => {
    expect(output).toContain('### Readability');
    expect(output).toContain('college');
    expect(output).toContain('52.3');
    expect(output).toContain('Passive voice');
    expect(output).toContain('12%'); // passive_voice_ratio
    expect(output).toContain('Transition words');
    expect(output).toContain('23%'); // transition_word_ratio
    expect(output).toContain('good'); // transition_label
  });

  test('Relevance subsection', () => {
    expect(output).toContain('### Relevance');
    expect(output).toContain('0.8'); // heading alignment rounded
  });

  test('Top Keywords', () => {
    expect(output).toContain('### Top Keywords');
    expect(output).toContain('blog');
    expect(output).toContain('15');
  });

  test('Top Phrases (bigrams + trigrams)', () => {
    expect(output).toContain('### Top Phrases');
    expect(output).toContain('blog post');
    expect(output).toContain('content marketing');
    expect(output).toContain('search engine optimization');
    expect(output).toContain('Bigrams');
    expect(output).toContain('Trigrams');
  });

  test('DOM & Structure section with favicon', () => {
    expect(output).toContain('## DOM & Structure');
    expect(output).toContain('387');
    expect(output).toContain('45');  // unique tags
    expect(output).toContain('6 / 7');
    expect(output).toContain('45.3 KB');
    expect(output).toContain('32.0%');
    expect(output).toContain('Favicon');
  });

  test('Forms subsection', () => {
    expect(output).toContain('### Forms');
    expect(output).toContain('Inputs without labels');
  });

  test('Scripts subsection', () => {
    expect(output).toContain('### Scripts');
    expect(output).toContain('14');
    expect(output).toContain('3 inline');
    expect(output).toContain('11 external');
  });

  test('Resource Hints subsection', () => {
    expect(output).toContain('### Resource Hints');
    expect(output).toContain('1 font');
    expect(output).toContain('1 image');
  });

  test('Accessibility section', () => {
    expect(output).toContain('## Accessibility');
    expect(output).toContain('present'); // lang attribute
    expect(output).toContain('\u26A0');  // buttons_links_no_text > 0
  });

  test('Heading Tree with box drawing', () => {
    expect(output).toContain('## Heading Tree');
    expect(output).toContain('H1: Welcome to Our Blog');
    expect(output).toContain('\u251C\u2500\u2500 H2: Introduction'); // ├──
    expect(output).toContain('\u2514\u2500\u2500 H3: Background');   // └──
    expect(output).toContain('\u2514\u2500\u2500 H2: Main Content'); // └──
  });

  test('Issues section', () => {
    expect(output).toContain('## Issues');
    expect(output).toContain('### Warnings (2)');
    expect(output).toContain('Slow TTFB');
    expect(output).toContain('### Info (1)');
    expect(output).toContain('No canonical tag');
  });

  test('Content Issues are deduplicated', () => {
    expect(output).toContain('### Content Issues (2)'); // 3 items → 2 after dedup
    expect(output).toContain('2\u00D7 Short meta description');
    expect(output).toContain('Missing alt on hero image');
  });

  test('Schema Recommendations', () => {
    expect(output).toContain('### Schema Recommendations (1)');
    expect(output).toContain('Add datePublished');
  });

  test('sections separated by ---', () => {
    expect(output).toContain('\n\n---\n\n');
  });

  test('no analysis_detail note absent', () => {
    expect(output).not.toContain('Detailed analysis data unavailable');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Minimal report (missing data gracefully handled)
// ─────────────────────────────────────────────────────────────────────────────

describe('buildReportMd — minimal report', () => {
  const output = buildReportMd(minimalReport);

  test('produces valid frontmatter', () => {
    expect(output).toMatch(/^---\n/);
    expect(output).toContain('http_status: 404');
    expect(output).toContain('0 critical');
  });

  test('hostname extracted', () => {
    expect(output).toContain('minimal.example.com');
  });

  test('CWV shows em-dashes for missing data', () => {
    expect(output).toContain('\u2014'); // em-dash
  });

  test('note about missing analysis_detail', () => {
    expect(output).toContain('Detailed analysis data unavailable');
  });

  test('empty issues show None', () => {
    expect(output).toContain('### Warnings (0)');
    expect(output).toContain('None.');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Determinism
// ─────────────────────────────────────────────────────────────────────────────

describe('determinism', () => {
  test('same input produces identical output', () => {
    const a = buildReportMd(fullReport);
    const b = buildReportMd(fullReport);
    expect(a).toBe(b);
  });
});
