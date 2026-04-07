/**
 * Tests for the Core Web Vitals PASS / FAIL / insufficient-data verdict
 * computed by mergeAnalysis (Phase 2.5).
 *
 * Verdict rules (p75):
 *   PASS  => LCP ≤ 2500 AND CLS ≤ 0.1 AND INP ≤ 200
 *   FAIL  => any of the three above the threshold
 *   null  => LCP or INP missing (value === 0) — insufficient data
 */

import { mergeAnalysis, PythonAnalysis } from '../../src/analysis/merger';
import { FetchResult } from '../../src/analysis/fetch';
import type { FieldData, PSIResult, MetricValue } from '../../src/analysis/psi';

function mockFetch(): FetchResult {
  return {
    status: 200,
    html: '<html><head><title>T</title></head><body></body></html>',
    headers: {},
    ttfb_ms: 100,
    redirect_chain: [],
    error: null,
  };
}

function metric(value: number, unit: string, status: MetricValue['status']): MetricValue {
  return { value, unit, status, target: 0 };
}

function mockField(lcp: number, cls: number, inp: number): FieldData {
  return {
    lcp: metric(lcp, 'ms', lcp <= 2500 ? 'good' : 'fail'),
    cls: metric(cls, 'score', cls <= 0.1 ? 'good' : 'fail'),
    inp: metric(inp, 'ms', inp <= 200 ? 'good' : 'fail'),
    fcp: metric(1500, 'ms', 'good'),
    fid: metric(50, 'ms', 'good'),
  };
}

function mockPsi(field: FieldData | null): PSIResult {
  return {
    url: 'https://example.com',
    strategy: 'mobile',
    field_data: field,
    lab_data: {
      performance_score: 80,
      speed_index_s: 2.5,
      tti_s: 3.5,
      tbt_ms: 150,
      cls: 0.05,
    },
    opportunities: [],
  };
}

const emptyPython: PythonAnalysis = {};

describe('CWV verdict', () => {
  it('PASSES when LCP ≤ 2500, CLS ≤ 0.1, INP ≤ 200', () => {
    const report = mergeAnalysis(
      'https://example.com',
      mockFetch(),
      [mockPsi(mockField(2000, 0.05, 150))],
      emptyPython,
      mockField(2000, 0.05, 150),
    );
    expect(report.performance.core_web_vitals.cwv_passing).toBe(true);
  });

  it('FAILS when LCP > 2500', () => {
    const report = mergeAnalysis(
      'https://example.com',
      mockFetch(),
      [mockPsi(mockField(3200, 0.05, 150))],
      emptyPython,
      mockField(3200, 0.05, 150),
    );
    expect(report.performance.core_web_vitals.cwv_passing).toBe(false);
  });

  it('FAILS when CLS > 0.1', () => {
    const report = mergeAnalysis(
      'https://example.com',
      mockFetch(),
      [mockPsi(mockField(2000, 0.22, 150))],
      emptyPython,
      mockField(2000, 0.22, 150),
    );
    expect(report.performance.core_web_vitals.cwv_passing).toBe(false);
  });

  it('FAILS when INP > 200', () => {
    const report = mergeAnalysis(
      'https://example.com',
      mockFetch(),
      [mockPsi(mockField(2000, 0.05, 380))],
      emptyPython,
      mockField(2000, 0.05, 380),
    );
    expect(report.performance.core_web_vitals.cwv_passing).toBe(false);
  });

  it('returns null (insufficient data) when field data is missing entirely', () => {
    const report = mergeAnalysis(
      'https://example.com',
      mockFetch(),
      [mockPsi(null)],
      emptyPython,
      null,
    );
    expect(report.performance.core_web_vitals.cwv_passing).toBeNull();
  });

  it('returns null when LCP or INP is 0 (treated as missing)', () => {
    const report = mergeAnalysis(
      'https://example.com',
      mockFetch(),
      [mockPsi(mockField(0, 0.05, 150))],
      emptyPython,
      mockField(0, 0.05, 150),
    );
    expect(report.performance.core_web_vitals.cwv_passing).toBeNull();
  });

  it('PASSES at the exact 2500 / 0.1 / 200 boundary values', () => {
    const report = mergeAnalysis(
      'https://example.com',
      mockFetch(),
      [mockPsi(mockField(2500, 0.1, 200))],
      emptyPython,
      mockField(2500, 0.1, 200),
    );
    expect(report.performance.core_web_vitals.cwv_passing).toBe(true);
  });
});
