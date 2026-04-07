/**
 * SGNL Phase 8 — UI Tests
 * Tests for ReportRenderer Ink component
 */

import React from 'react';
import { render } from 'ink-testing-library';
import { ReportRenderer, StatusBadge } from '../../src/ui/report';
import { AnalysisReport } from '../../src/analysis/merger';

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const mockReport: AnalysisReport = {
  url: 'https://example.com',
  timestamp: '2026-03-14T11:17:30.000Z',
  http_status: 200,
  crawlable: true,
  https: true,
  performance: {
    core_web_vitals: {
      lcp_ms: 1200,
      cls: 0.15,
      inp_ms: 180,
      fid_ms: 250,
    },
    speed_metrics: {
      ttfb_ms: 120,
      speed_index_s: 1.8,
      tti_s: 2.1,
    },
    cdn: 'CloudFlare',
  },
  seo: {
    technical: {
      title: 'Example Page',
      description: 'An example page description',
      canonical: 'https://example.com',
      schema_count: 2,
      open_graph: true,
      twitter_card: true,
      indexable: true,
    },
    content: {
      word_count: 1240,
      h1_count: 1,
      headings_valid: true,
      images_total: 12,
      images_alt_missing: 2,
    },
    links: {
      internal_total: 28,
      external_total: 5,
      generic_anchor_text: 0,
    },
  },
  structure: {
    dom_elements: 387,
    div_ratio: 0.35,
    semantic_score: 6,
    heading_hierarchy_valid: true,
  },
  issues: {
    critical: ['Missing H1 tag — Add one main heading per page'],
    warning: [
      'CLS score is 0.15 — Target < 0.1 for good UX',
      '2 images missing alt text — Improves SEO and accessibility',
      'No Open Graph description — Improves social sharing',
    ],
    info: [
      'Multiple H1 tags (found 2) — Use only 1 main heading',
      'Word count low (245 words) — Consider 300+ for better SEO',
    ],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Helper: get all rendered text
// ─────────────────────────────────────────────────────────────────────────────

function getText(lastFrame: string | undefined): string {
  return lastFrame ?? '';
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('ReportRenderer', () => {
  test('Component renders without crashing', () => {
    const { lastFrame } = render(<ReportRenderer report={mockReport} />);
    expect(lastFrame()).toBeTruthy();
    expect(lastFrame()!.length).toBeGreaterThan(0);
  });

  test('Issues banner displayed correctly', () => {
    const { lastFrame } = render(<ReportRenderer report={mockReport} />);
    const output = getText(lastFrame());
    expect(output).toContain('ISSUES');
  });

  test('Performance section contains all CWV metrics', () => {
    const { lastFrame } = render(<ReportRenderer report={mockReport} />);
    const output = getText(lastFrame());
    expect(output).toContain('PERFORMANCE');
    expect(output).toContain('LCP');
    expect(output).toContain('CLS');
    expect(output).toContain('INP');
    expect(output).toContain('FID');
    expect(output).toContain('Core Web Vitals');
  });

  test('SEO section has technical + content + links', () => {
    const { lastFrame } = render(<ReportRenderer report={mockReport} />);
    const output = getText(lastFrame());
    expect(output).toContain('SEO');
    expect(output).toContain('Technical');
    expect(output).toContain('Content');
    expect(output).toContain('Links');
    // Technical checks
    expect(output).toContain('Title present');
    expect(output).toContain('Description present');
    // Content checks
    expect(output).toContain('Word count');
    // Links checks
    expect(output).toContain('Internal');
    expect(output).toContain('External');
  });

  test('Structure section shows DOM metrics', () => {
    const { lastFrame } = render(<ReportRenderer report={mockReport} />);
    const output = getText(lastFrame());
    expect(output).toContain('STRUCTURE');
    expect(output).toContain('Elements');
    expect(output).toContain('387');
    expect(output).toContain('Div ratio');
    expect(output).toContain('Semantic score');
  });

  test('Issues categorized (critical/warning/info)', () => {
    const { lastFrame } = render(<ReportRenderer report={mockReport} />);
    const output = getText(lastFrame());
    expect(output).toContain('ISSUES');
    expect(output).toContain('CRITICAL');
    expect(output).toContain('Missing H1 tag');
    expect(output).toContain('WARNINGS');
    expect(output).toContain('CLS score');
    expect(output).toContain('INFO');
    expect(output).toContain('Word count low');
  });

  test('Status bar shows HTTP + HTTPS + crawlable', () => {
    const { lastFrame } = render(<ReportRenderer report={mockReport} />);
    const output = getText(lastFrame());
    expect(output).toContain('HTTP 200');
    expect(output).toContain('HTTPS');
    expect(output).toContain('CRAWLABLE');
  });

  test('Status bar shows CDN when present', () => {
    const { lastFrame } = render(<ReportRenderer report={mockReport} />);
    const output = getText(lastFrame());
    expect(output).toContain('CloudFlare');
  });

  test('Missing data handled gracefully', () => {
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
        technical: {
          schema_count: 0,
          open_graph: false,
          twitter_card: false,
          indexable: false,
        },
        content: {
          word_count: 0,
          h1_count: 0,
          headings_valid: false,
          images_total: 0,
          images_alt_missing: 0,
        },
        links: {
          internal_total: 0,
          external_total: 0,
          generic_anchor_text: 0,
        },
      },
      structure: {
        dom_elements: 0,
        div_ratio: 0,
        semantic_score: 0,
        heading_hierarchy_valid: false,
      },
      issues: {
        critical: [],
        warning: [],
        info: [],
      },
    };

    // Should render without throwing
    expect(() => {
      render(<ReportRenderer report={minimalReport} />);
    }).not.toThrow();

    const { lastFrame } = render(<ReportRenderer report={minimalReport} />);
    const output = getText(lastFrame());
    expect(output).toContain('https://minimal.example.com');
  });

  test('Header displays URL and timestamp', () => {
    const { lastFrame } = render(<ReportRenderer report={mockReport} />);
    const output = getText(lastFrame());
    expect(output).toContain('SGNL Analysis Report');
    expect(output).toContain('https://example.com');
    expect(output).toContain('2026-03-14T11:17:30.000Z');
  });

  test('Footer is present', () => {
    const { lastFrame } = render(<ReportRenderer report={mockReport} />);
    const output = getText(lastFrame());
    expect(output).toContain('Generated by SGNL');
    expect(output).toContain('https://github.com/stoyan-koychev/sgnl-cli');
  });
});

describe('StatusBadge', () => {
  test('renders pass badge', () => {
    const { lastFrame } = render(<StatusBadge text="HTTPS" status="pass" />);
    expect(lastFrame()).toContain('✓');
    expect(lastFrame()).toContain('HTTPS');
  });

  test('renders warn badge', () => {
    const { lastFrame } = render(<StatusBadge text="CLS" status="warn" />);
    expect(lastFrame()).toContain('⚠');
    expect(lastFrame()).toContain('CLS');
  });

  test('renders fail badge', () => {
    const { lastFrame } = render(<StatusBadge text="Error" status="fail" />);
    expect(lastFrame()).toContain('✗');
    expect(lastFrame()).toContain('Error');
  });
});
