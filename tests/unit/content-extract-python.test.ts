/**
 * Integration test for python/content_extract.py.
 * Spawns the real script against fixture markdown and validates the
 * language-neutral stats + outline + inventories.
 */

import { runPythonScriptSafe } from '../../src/analysis/python';

async function runExtract(markdown: string, meta: Record<string, any>): Promise<Record<string, any>> {
  const result = await runPythonScriptSafe('content_extract.py', markdown, 30000, JSON.stringify(meta));
  expect(result.success).toBe(true);
  return result.data as Record<string, any>;
}

describe('content_extract.py — language-neutral stats', () => {
  const baseMeta = {
    url: 'https://example.com/post',
    title: 'SEO Guide',
    meta_description: 'A guide to SEO',
    raw_html_word_count: 500,
  };

  const markdown = [
    '# SEO Guide',
    '',
    'Never underestimate SEO in 2024. This guide explains how search engine optimization works.',
    '',
    '## What is SEO?',
    '',
    'SEO is the practice of optimizing pages. It helps them rank. About 68% of sessions start from a search engine.',
    '',
    '### A sub topic',
    '',
    'More content here with a few sentences. Another sentence. And a third.',
    '',
    '## Common mistakes',
    '',
    '- Keyword stuffing',
    '- Duplicate content',
    '- Thin content',
    '',
    '![Chart of growth](/chart.png)',
    '',
    '![](/no-alt.png)',
    '',
    '[Internal link](https://example.com/other) and [external link](https://other.com/page).',
    '',
    'Visit https://raw.example.com/naked for more.',
    '',
    '## Conclusion',
    '',
    'In conclusion, SEO is a long game. Quality wins in 2025 and beyond.',
    '',
    'In conclusion, SEO is a long game. Quality wins in 2025 and beyond.',
    '',
  ].join('\n');

  let data: Record<string, any>;

  beforeAll(async () => {
    data = await runExtract(markdown, baseMeta);
  });

  it('detects language and carries metadata fields', () => {
    expect(data.metadata.detected_language).toBe('en');
    expect(data.metadata.title).toBe('SEO Guide');
    expect(data.metadata.meta_description).toBe('A guide to SEO');
    expect(data.metadata.h1).toBe('SEO Guide');
  });

  it('computes volume stats (words, sentences, paragraphs)', () => {
    expect(data.stats.volume.word_count).toBeGreaterThan(40);
    expect(data.stats.volume.sentence_count).toBeGreaterThanOrEqual(5);
    expect(data.stats.volume.paragraph_count).toBeGreaterThanOrEqual(5);
    expect(data.stats.volume.char_count).toBeGreaterThan(100);
  });

  it('computes reading_time_minutes and lexical diversity', () => {
    expect(typeof data.stats.derived.reading_time_minutes).toBe('number');
    expect(data.stats.derived.reading_time_minutes).toBeGreaterThan(0);
    expect(data.stats.derived.lexical_diversity).toBeGreaterThan(0);
    expect(data.stats.derived.lexical_diversity).toBeLessThanOrEqual(1);
    expect(['low', 'medium', 'high']).toContain(data.stats.derived.lexical_diversity_label);
  });

  it('computes content_to_chrome_ratio when raw_html_word_count is supplied', () => {
    expect(typeof data.stats.derived.content_to_chrome_ratio).toBe('number');
    expect(data.stats.derived.content_to_chrome_ratio).toBeGreaterThan(0);
  });

  it('emits paragraph and sentence length distributions', () => {
    const pl = data.stats.distribution.paragraph_length;
    const sl = data.stats.distribution.sentence_length;
    expect(pl).toEqual(expect.objectContaining({ min: expect.any(Number), max: expect.any(Number), p50: expect.any(Number), p90: expect.any(Number) }));
    expect(sl).toEqual(expect.objectContaining({ min: expect.any(Number), max: expect.any(Number), p50: expect.any(Number), p90: expect.any(Number) }));
    expect(pl.max).toBeGreaterThanOrEqual(pl.min);
    expect(sl.max).toBeGreaterThanOrEqual(sl.min);
  });

  it('builds heading outline as a nested tree', () => {
    expect(Array.isArray(data.outline)).toBe(true);
    expect(data.outline.length).toBe(1);
    expect(data.outline[0].level).toBe(1);
    expect(data.outline[0].text).toBe('SEO Guide');
    // Three H2 children under the H1 (What is SEO, Common mistakes, Conclusion).
    const h2s = data.outline[0].children.filter((c: any) => c.level === 2);
    expect(h2s.length).toBe(3);
    // First H2 has an H3 child ("A sub topic").
    expect(h2s[0].children.length).toBeGreaterThanOrEqual(1);
    expect(h2s[0].children[0].level).toBe(3);
  });

  it('validates heading hierarchy and reports counts', () => {
    expect(data.stats.structure.h1_count).toBe(1);
    expect(data.stats.structure.h2_count).toBe(3);
    expect(data.stats.structure.h3_count).toBe(1);
    expect(data.stats.structure.heading_hierarchy_valid).toBe(true);
    expect(data.stats.structure.skipped_levels).toEqual([]);
  });

  it('detects skipped heading levels', async () => {
    const md = '# Top\n\n## Middle\n\n#### Skipped\n\n';
    const d = await runExtract(md, { url: 'https://e.com', title: '', meta_description: '' });
    expect(d.stats.structure.heading_hierarchy_valid).toBe(false);
    expect(d.stats.structure.skipped_levels).toContain('H2→H4');
  });

  it('splits link inventory into internal/external based on base URL', () => {
    expect(data.stats.links.total).toBeGreaterThanOrEqual(2);
    expect(data.stats.links.internal).toBeGreaterThanOrEqual(1);
    expect(data.stats.links.external).toBeGreaterThanOrEqual(1);
    expect(data.stats.links.naked_urls).toBeGreaterThanOrEqual(1);

    const inv = data.link_inventory as Array<{ url: string; internal: boolean }>;
    const internalHit = inv.find(l => l.internal && l.url.includes('example.com'));
    expect(internalHit).toBeDefined();
    const externalHit = inv.find(l => !l.internal);
    expect(externalHit).toBeDefined();
  });

  it('builds image inventory with alt text and counts alt coverage', () => {
    expect(data.stats.media.image_count).toBe(2);
    expect(data.stats.media.images_with_alt).toBe(1);
    expect(data.stats.media.images_missing_alt).toBe(1);
    expect(data.stats.media.alt_coverage).toBe(0.5);
    expect(data.image_inventory.length).toBe(2);
    const withAlt = (data.image_inventory as Array<{ alt: string }>).find(i => i.alt.length > 0);
    expect(withAlt).toBeDefined();
  });

  it('detects duplicate paragraphs', () => {
    expect(data.stats.duplication.duplicate_paragraphs).toBeGreaterThanOrEqual(1);
  });

  it('extracts year mentions and percentage count', () => {
    expect(data.stats.patterns.year_mentions).toEqual(expect.arrayContaining([2024, 2025]));
    expect(data.stats.patterns.percentage_count).toBeGreaterThanOrEqual(1);
  });

  it('includes the body passthrough', () => {
    expect(typeof data.body).toBe('string');
    expect(data.body).toContain('# SEO Guide');
  });
});

describe('content_extract.py — CJK smoke test', () => {
  it('handles Japanese text with character-based word count and 。 sentence split', async () => {
    const md = [
      '# 検索エンジン最適化',
      '',
      '検索エンジン最適化はウェブサイトの検索結果を向上させる手法です。多くの企業が実施しています。2024年にはさらに重要になりました。',
      '',
      '## 基本',
      '',
      '内部リンクを整理する。コンテンツを充実させる。',
      '',
    ].join('\n');

    const d = await runExtract(md, { url: 'https://ja.example.com', title: '検索エンジン最適化', meta_description: '', lang: 'ja' });

    expect(d.metadata.detected_language).toBe('ja');
    expect(d.stats.volume.word_count).toBeGreaterThan(0);
    expect(d.stats.volume.sentence_count).toBeGreaterThanOrEqual(3);
    expect(typeof d.stats.derived.reading_time_minutes).toBe('number');
    expect(d.metadata.h1).toBe('検索エンジン最適化');
  });
});
