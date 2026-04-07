/**
 * Integration test for python/content_analysis.py new signals (Phase 1 + 2).
 * Spawns the real Python analyzer against fixture markdown and asserts the
 * existence of phase-1 passthrough fields (passive_voice, image_alt_text,
 * heading_hierarchy, transition_words, meta_description, detected_language,
 * eeat_signals_present, link_density.issues) and phase-2 new signals
 * (reading_time_minutes, lexical_diversity, paragraph_length_distribution,
 * sentence_length_distribution, first_paragraph, duplicate_paragraphs_found).
 */

import { runPythonScriptSafe } from '../../src/analysis/python';

describe('content_analysis.py — phase 1 + phase 2 signals', () => {
  const markdown = [
    '# The Ultimate SEO Guide',
    '',
    'Never underestimate SEO in 2026. This guide explains how search engine optimization is done right, and why the rules have changed.',
    '',
    '## What is SEO?',
    '',
    'SEO, or search engine optimization, refers to the process of improving your website so that it ranks higher in search engines. Pages are crawled by bots, and the most relevant results are returned to users.',
    '',
    '## Why it matters',
    '',
    'Organic traffic is free, sustained, and compounding. Statistics show that 68% of online experiences begin with a search engine. Thus, investing in SEO pays long-term dividends.',
    '',
    '## Common mistakes',
    '',
    '- Keyword stuffing',
    '- Duplicate content',
    '- Thin content',
    '- Broken links',
    '- Slow load times',
    '',
    '## Frequently Asked Questions',
    '',
    '### What is a title tag?',
    '',
    'A title tag is the HTML element that specifies a page title. It is shown in search results.',
    '',
    '### How long should content be?',
    '',
    'Most ranking pages are between 1,000 and 2,000 words. However, quality always beats quantity.',
    '',
    '![Chart showing organic traffic growth](/chart.png)',
    '',
    '![](/no-alt.png)',
    '',
    '## Conclusion',
    '',
    'In conclusion, SEO is a long game. Consistency and quality will always win. Organic traffic is free, sustained, and compounding.',
    '',
  ].join('\n');

  const meta = {
    title: 'The Ultimate SEO Guide',
    meta_description: 'A complete guide to search engine optimization in 2026. Learn how to rank higher, avoid common mistakes, and grow organic traffic sustainably.',
  };

  let data: Record<string, any>;

  beforeAll(async () => {
    const result = await runPythonScriptSafe(
      'content_analysis.py',
      markdown,
      30000,
      JSON.stringify(meta),
    );
    expect(result.success).toBe(true);
    data = result.data as Record<string, any>;
  });

  // --- Phase 1: previously-dropped fields are emitted ---

  it('emits detected_language at the top level', () => {
    expect(typeof data.detected_language).toBe('string');
    expect(data.detected_language.length).toBeGreaterThan(0);
  });

  it('emits passive_voice with count and ratio', () => {
    expect(data.passive_voice).toBeDefined();
    expect(typeof data.passive_voice.passive_voice_count).toBe('number');
    expect(typeof data.passive_voice.passive_voice_ratio).toBe('number');
  });

  it('emits image_alt_text with images_total / missing / coverage', () => {
    expect(data.image_alt_text).toBeDefined();
    expect(data.image_alt_text.images_total).toBeGreaterThanOrEqual(2);
    expect(data.image_alt_text.images_missing_alt).toBeGreaterThanOrEqual(1);
  });

  it('emits heading_hierarchy with hierarchy_valid and violations array', () => {
    expect(data.heading_hierarchy).toBeDefined();
    expect(typeof data.heading_hierarchy.hierarchy_valid).toBe('boolean');
    expect(Array.isArray(data.heading_hierarchy.violations)).toBe(true);
  });

  it('emits transition_words with count, ratio, label', () => {
    expect(data.transition_words).toBeDefined();
    expect(typeof data.transition_words.transition_word_count).toBe('number');
    expect(typeof data.transition_words.transition_word_ratio).toBe('number');
    expect(typeof data.transition_words.transition_label).toBe('string');
  });

  it('emits meta_description with length and status', () => {
    expect(data.meta_description).toBeDefined();
    expect(typeof data.meta_description.meta_description_status).toBe('string');
  });

  it('emits eeat_signals.eeat_signals_present as a per-signal dict', () => {
    expect(data.eeat_signals).toBeDefined();
    expect(data.eeat_signals.eeat_signals_present).toBeDefined();
    expect(typeof data.eeat_signals.eeat_signals_present).toBe('object');
    // Known signal keys
    expect(data.eeat_signals.eeat_signals_present).toHaveProperty('first_person');
    expect(data.eeat_signals.eeat_signals_present).toHaveProperty('statistics');
  });

  it('emits link_density.issues as an array', () => {
    expect(data.link_density).toBeDefined();
    expect(Array.isArray(data.link_density.issues)).toBe(true);
  });

  it('emits featured_snippet.qa_pairs_found and lists_under_headings', () => {
    expect(data.featured_snippet).toBeDefined();
    expect(Array.isArray(data.featured_snippet.qa_pairs_found)).toBe(true);
    expect(Array.isArray(data.featured_snippet.lists_under_headings)).toBe(true);
    // The fixture has two question-style headings → at least 2 QA pairs
    expect(data.featured_snippet.qa_pairs_found.length).toBeGreaterThanOrEqual(2);
  });

  // --- Phase 2: new signals ---

  it('emits reading_time_minutes on content_depth', () => {
    expect(data.content_depth.reading_time_minutes).toBeDefined();
    expect(typeof data.content_depth.reading_time_minutes).toBe('number');
    expect(data.content_depth.reading_time_minutes).toBeGreaterThan(0);
  });

  it('emits lexical_diversity + label on content_depth', () => {
    expect(typeof data.content_depth.lexical_diversity).toBe('number');
    expect(data.content_depth.lexical_diversity).toBeGreaterThan(0);
    expect(data.content_depth.lexical_diversity).toBeLessThanOrEqual(1);
    expect(['low', 'medium', 'high']).toContain(data.content_depth.lexical_diversity_label);
  });

  it('emits paragraph_length_distribution on content_depth', () => {
    const pld = data.content_depth.paragraph_length_distribution;
    expect(pld).toBeDefined();
    expect(pld).toEqual(
      expect.objectContaining({
        min: expect.any(Number),
        max: expect.any(Number),
        p50: expect.any(Number),
        p90: expect.any(Number),
      }),
    );
    expect(pld.max).toBeGreaterThanOrEqual(pld.min);
  });

  it('emits sentence_length_distribution on readability', () => {
    const sld = data.readability.sentence_length_distribution;
    expect(sld).toBeDefined();
    expect(sld).toEqual(
      expect.objectContaining({
        min: expect.any(Number),
        max: expect.any(Number),
        p50: expect.any(Number),
        p90: expect.any(Number),
      }),
    );
  });

  it('emits first_paragraph with word_count, contains_title_keyword, has_hook', () => {
    expect(data.first_paragraph).toBeDefined();
    expect(typeof data.first_paragraph.word_count).toBe('number');
    expect(typeof data.first_paragraph.contains_title_keyword).toBe('boolean');
    expect(typeof data.first_paragraph.has_hook).toBe('boolean');
    // The fixture's first paragraph contains "SEO" → matches title keyword.
    expect(data.first_paragraph.contains_title_keyword).toBe(true);
    // And starts with "Never assume..." → bold-claim hook pattern matches.
    expect(data.first_paragraph.has_hook).toBe(true);
  });

  it('emits duplicate_paragraphs_found on thin_content', () => {
    expect(typeof data.thin_content.duplicate_paragraphs_found).toBe('number');
  });

  it('preserves the existing duplicate_sentences_found signal separately', () => {
    expect(typeof data.thin_content.duplicate_sentences_found).toBe('number');
  });
});
