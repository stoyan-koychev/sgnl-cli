/**
 * Correctness tests for python/schema_validator.py.
 *
 * These spawn the real Python script with fixture HTML and assert on the
 * JSON output. The script is pure, fast, and deterministic — no network.
 */

import { spawnSync } from 'child_process';
import * as path from 'path';

const SCRIPT = path.resolve(__dirname, '../../python/schema_validator.py');

function runValidator(html: string): any {
  const proc = spawnSync('python3', [SCRIPT], {
    input: JSON.stringify({ html }),
    encoding: 'utf-8',
    timeout: 15000,
  });
  if (proc.status !== 0) {
    throw new Error(`schema_validator.py exited ${proc.status}: ${proc.stderr}`);
  }
  return JSON.parse(proc.stdout);
}

function htmlWith(json: unknown): string {
  return `<html><head><script type="application/ld+json">${JSON.stringify(json)}</script></head><body></body></html>`;
}

function htmlWithMany(list: unknown[]): string {
  const scripts = list
    .map((j) => `<script type="application/ld+json">${JSON.stringify(j)}</script>`)
    .join('');
  return `<html><head>${scripts}</head><body></body></html>`;
}

describe('schema_validator.py — @context validation', () => {
  it('accepts https://schema.org with no @context error/warning', () => {
    const r = runValidator(
      htmlWith({ '@context': 'https://schema.org', '@type': 'Person', name: 'Alice' }),
    );
    const block = r.blocks[0];
    const ctxErrors = block.validation.format_errors.filter((e: any) => e.field === '@context');
    const ctxWarnings = block.validation.warnings.filter((w: any) => w.field === '@context');
    expect(ctxErrors).toHaveLength(0);
    expect(ctxWarnings).toHaveLength(0);
  });

  it('flags http://schema.org as warning (not error)', () => {
    const r = runValidator(
      htmlWith({ '@context': 'http://schema.org', '@type': 'Person', name: 'Bob' }),
    );
    const block = r.blocks[0];
    const ctxErrors = block.validation.format_errors.filter((e: any) => e.field === '@context');
    const ctxWarnings = block.validation.warnings.filter((w: any) => w.field === '@context');
    expect(ctxErrors).toHaveLength(0);
    expect(ctxWarnings.length).toBeGreaterThan(0);
    expect(ctxWarnings[0].message).toMatch(/http:\/\/schema\.org/);
  });

  it('flags missing @context as format error', () => {
    const r = runValidator(htmlWith({ '@type': 'Person', name: 'Carol' }));
    const block = r.blocks[0];
    const ctxErrors = block.validation.format_errors.filter((e: any) => e.field === '@context');
    expect(ctxErrors.length).toBeGreaterThan(0);
  });

  it('accepts @context as array including https://schema.org', () => {
    const r = runValidator(
      htmlWith({
        '@context': ['https://schema.org', { custom: 'http://example.com' }],
        '@type': 'Person',
        name: 'Dan',
      }),
    );
    const block = r.blocks[0];
    const ctxErrors = block.validation.format_errors.filter((e: any) => e.field === '@context');
    expect(ctxErrors).toHaveLength(0);
  });
});

describe('schema_validator.py — currency format', () => {
  it('accepts valid ISO 4217 code', () => {
    const r = runValidator(
      htmlWith({
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: 'Shoe',
        image: 'https://example.com/s.jpg',
        offers: { '@type': 'Offer', price: '19.99', priceCurrency: 'USD' },
      }),
    );
    const warnings = r.blocks[0].validation.warnings;
    expect(warnings.some((w: any) => /priceCurrency/.test(w.message))).toBe(false);
  });

  it('flags lowercase currency code', () => {
    const r = runValidator(
      htmlWith({
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: 'Shoe',
        image: 'https://example.com/s.jpg',
        offers: { '@type': 'Offer', price: '19.99', priceCurrency: 'usd' },
      }),
    );
    const warnings = r.blocks[0].validation.warnings;
    expect(warnings.some((w: any) => /priceCurrency/.test(w.message))).toBe(true);
  });

  it('flags non-3-letter currency code', () => {
    const r = runValidator(
      htmlWith({
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: 'Shoe',
        image: 'https://example.com/s.jpg',
        offers: { '@type': 'Offer', price: '19.99', priceCurrency: 'DOLLARS' },
      }),
    );
    const warnings = r.blocks[0].validation.warnings;
    expect(warnings.some((w: any) => /priceCurrency/.test(w.message))).toBe(true);
  });
});

describe('schema_validator.py — aggregateRating sanity', () => {
  it('accepts ratingValue within default bounds', () => {
    const r = runValidator(
      htmlWith({
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: 'Widget',
        image: 'https://example.com/w.jpg',
        offers: { '@type': 'Offer', price: '10', priceCurrency: 'USD' },
        aggregateRating: { '@type': 'AggregateRating', ratingValue: '4.5', reviewCount: 120 },
      }),
    );
    const warnings = r.blocks[0].validation.warnings;
    expect(warnings.some((w: any) => /aggregateRating/.test(w.message))).toBe(false);
  });

  it('flags ratingValue outside bounds', () => {
    const r = runValidator(
      htmlWith({
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: 'Widget',
        image: 'https://example.com/w.jpg',
        offers: { '@type': 'Offer', price: '10', priceCurrency: 'USD' },
        aggregateRating: { '@type': 'AggregateRating', ratingValue: '7', reviewCount: 10 },
      }),
    );
    const warnings = r.blocks[0].validation.warnings;
    expect(warnings.some((w: any) => /outside/.test(w.message))).toBe(true);
  });

  it('flags aggregateRating missing reviewCount/ratingCount', () => {
    const r = runValidator(
      htmlWith({
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: 'Widget',
        image: 'https://example.com/w.jpg',
        offers: { '@type': 'Offer', price: '10', priceCurrency: 'USD' },
        aggregateRating: { '@type': 'AggregateRating', ratingValue: '4' },
      }),
    );
    const warnings = r.blocks[0].validation.warnings;
    expect(warnings.some((w: any) => /reviewCount/.test(w.message))).toBe(true);
  });
});

describe('schema_validator.py — duplicate type detection', () => {
  it('flags duplicate Organization blocks without @id', () => {
    const r = runValidator(
      htmlWithMany([
        { '@context': 'https://schema.org', '@type': 'Organization', name: 'Org One', url: 'https://a.com' },
        { '@context': 'https://schema.org', '@type': 'Organization', name: 'Org Two', url: 'https://b.com' },
      ]),
    );
    expect(r.summary.duplicate_types).toContain('Organization');
  });

  it('does not flag duplicate types with distinct @id', () => {
    const r = runValidator(
      htmlWithMany([
        { '@context': 'https://schema.org', '@type': 'Organization', '@id': 'https://a.com/#org', name: 'A', url: 'https://a.com' },
        { '@context': 'https://schema.org', '@type': 'Organization', '@id': 'https://b.com/#org', name: 'B', url: 'https://b.com' },
      ]),
    );
    expect(r.summary.duplicate_types).not.toContain('Organization');
  });
});

describe('schema_validator.py — WebSite + SearchAction', () => {
  it('recommends SearchAction when WebSite is present without potentialAction', () => {
    const r = runValidator(
      htmlWith({ '@context': 'https://schema.org', '@type': 'WebSite', name: 'Site', url: 'https://example.com' }),
    );
    const rec = r.recommendations.find((x: any) => /SearchAction/.test(x.message));
    expect(rec).toBeDefined();
    expect(rec.priority).toBe('low');
  });

  it('does not recommend SearchAction when already present', () => {
    const r = runValidator(
      htmlWith({
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: 'Site',
        url: 'https://example.com',
        potentialAction: {
          '@type': 'SearchAction',
          target: 'https://example.com/?q={search_term_string}',
          'query-input': 'required name=search_term_string',
        },
      }),
    );
    const rec = r.recommendations.find((x: any) => /SearchAction/.test(x.message));
    expect(rec).toBeUndefined();
  });
});

describe('schema_validator.py — nested author/publisher completeness', () => {
  it('flags Organization publisher missing logo', () => {
    const r = runValidator(
      htmlWith({
        '@context': 'https://schema.org',
        '@type': 'Article',
        headline: 'Post',
        image: 'https://example.com/i.jpg',
        datePublished: '2026-01-01',
        author: { '@type': 'Person', name: 'Alice' },
        publisher: { '@type': 'Organization', name: 'Acme' },
      }),
    );
    const warnings = r.blocks[0].validation.warnings;
    expect(warnings.some((w: any) => /publisher/.test(w.message) && /logo/.test(w.message))).toBe(true);
  });

  it('flags Person author missing name', () => {
    const r = runValidator(
      htmlWith({
        '@context': 'https://schema.org',
        '@type': 'Article',
        headline: 'Post',
        image: 'https://example.com/i.jpg',
        datePublished: '2026-01-01',
        author: { '@type': 'Person', url: 'https://example.com/alice' },
        publisher: { '@type': 'Organization', name: 'Acme', logo: 'https://example.com/l.png' },
      }),
    );
    const warnings = r.blocks[0].validation.warnings;
    expect(warnings.some((w: any) => /author/.test(w.message) && /name/.test(w.message))).toBe(true);
  });
});

describe('schema_validator.py — inLanguage recommendation', () => {
  it('recommends inLanguage for Article without it', () => {
    const r = runValidator(
      htmlWith({
        '@context': 'https://schema.org',
        '@type': 'Article',
        headline: 'Post',
        image: 'https://example.com/i.jpg',
        datePublished: '2026-01-01',
        author: { '@type': 'Person', name: 'Alice' },
        publisher: { '@type': 'Organization', name: 'Acme', logo: 'https://example.com/l.png' },
      }),
    );
    const rec = r.recommendations.find((x: any) => /inLanguage/.test(x.message));
    expect(rec).toBeDefined();
  });
});

describe('schema_validator.py — image shape hint', () => {
  it('recommends ImageObject when image is a bare string', () => {
    const r = runValidator(
      htmlWith({
        '@context': 'https://schema.org',
        '@type': 'Article',
        headline: 'Post',
        image: 'https://example.com/i.jpg',
        datePublished: '2026-01-01',
        author: { '@type': 'Person', name: 'Alice' },
        publisher: { '@type': 'Organization', name: 'Acme', logo: 'https://example.com/l.png' },
      }),
    );
    const rec = r.recommendations.find((x: any) => /ImageObject/.test(x.message));
    expect(rec).toBeDefined();
  });

  it('does not recommend ImageObject when already used with dims', () => {
    const r = runValidator(
      htmlWith({
        '@context': 'https://schema.org',
        '@type': 'Article',
        headline: 'Post',
        image: { '@type': 'ImageObject', url: 'https://example.com/i.jpg', width: 1200, height: 630 },
        datePublished: '2026-01-01',
        author: { '@type': 'Person', name: 'Alice' },
        publisher: { '@type': 'Organization', name: 'Acme', logo: 'https://example.com/l.png' },
        inLanguage: 'en-US',
      }),
    );
    const rec = r.recommendations.find((x: any) => /ImageObject/.test(x.message));
    expect(rec).toBeUndefined();
  });
});

describe('schema_validator.py — block score', () => {
  it('emits per-block score and overall_score', () => {
    const r = runValidator(
      htmlWith({
        '@context': 'https://schema.org',
        '@type': 'Person',
        name: 'Alice',
      }),
    );
    expect(r.blocks[0].score).toBeDefined();
    expect(typeof r.blocks[0].score).toBe('number');
    expect(r.overall_score).toBeDefined();
  });

  it('penalises missing required fields', () => {
    const complete = runValidator(
      htmlWith({
        '@context': 'https://schema.org',
        '@type': 'Organization',
        name: 'Acme',
        url: 'https://acme.com',
      }),
    );
    const partial = runValidator(
      htmlWith({
        '@context': 'https://schema.org',
        '@type': 'Organization',
        name: 'Acme',
      }),
    );
    expect(complete.blocks[0].score).toBeGreaterThan(partial.blocks[0].score);
  });
});
