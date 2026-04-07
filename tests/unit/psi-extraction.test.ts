/**
 * Tests for the Phase 1 + Phase 2 expansions of src/analysis/psi.ts:
 * - Lighthouse category scores (performance / accessibility / best-practices / seo)
 * - Opportunity `savings_bytes` alongside `savings_ms`
 * - Resource summary request counts (in addition to bytes)
 * - LCP element, CLS elements, render-blocking resources, third-party summary,
 *   bootup time, server response time, network request count, diagnostics
 */

import axios from 'axios';
import { callPSI } from '../../src/analysis/psi';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.SGNL_PSI_KEY = 'test-api-key';
});

afterEach(() => {
  delete process.env.SGNL_PSI_KEY;
});

function makeRichPsiResponse() {
  return {
    lighthouseResult: {
      categories: {
        performance: { score: 0.72 },
        accessibility: { score: 0.91 },
        'best-practices': { score: 0.83 },
        seo: { score: 1.0 },
      },
      audits: {
        'speed-index': { numericValue: 2200, title: 'Speed Index' },
        interactive: { numericValue: 4100, title: 'TTI' },
        'total-blocking-time': { numericValue: 180, title: 'TBT' },
        'cumulative-layout-shift': { numericValue: 0.08, title: 'CLS' },

        'render-blocking-resources': {
          title: 'Eliminate render-blocking resources',
          numericValue: 1200,
          details: {
            type: 'opportunity',
            overallSavingsBytes: 84000,
            items: [
              { url: 'https://cdn.example.com/a.css', wastedMs: 500 },
              { url: 'https://cdn.example.com/b.js', wastedMs: 320 },
            ],
          },
        },
        'unused-javascript': {
          title: 'Reduce unused JavaScript',
          numericValue: 800,
          details: {
            type: 'opportunity',
            overallSavingsBytes: 120000,
            items: [],
          },
        },

        'resource-summary': {
          details: {
            items: [
              { resourceType: 'total',      transferSize: 2_000_000, requestCount: 80 },
              { resourceType: 'script',     transferSize:   800_000, requestCount: 25 },
              { resourceType: 'stylesheet', transferSize:   200_000, requestCount:  8 },
              { resourceType: 'image',      transferSize:   600_000, requestCount: 30 },
              { resourceType: 'font',       transferSize:   100_000, requestCount:  4 },
              { resourceType: 'document',   transferSize:    50_000, requestCount:  1 },
              { resourceType: 'media',      transferSize:   250_000, requestCount: 12 },
            ],
          },
        },

        'largest-contentful-paint-element': {
          details: {
            items: [
              {
                items: [
                  {
                    node: {
                      selector: 'main > h1',
                      snippet: '<h1 class="hero">Hello</h1>',
                      nodeLabel: 'Hello',
                    },
                  },
                ],
              },
            ],
          },
        },

        'layout-shift-elements': {
          details: {
            items: [
              { node: { selector: 'div.ad' }, score: 0.12 },
              { node: { selector: 'img.hero' }, score: 0.04 },
            ],
          },
        },

        'third-party-summary': {
          details: {
            items: [
              { entity: 'Google Analytics', blockingTime: 150, transferSize: 50000 },
              { entity: 'Facebook', blockingTime: 80, transferSize: 40000 },
            ],
          },
        },

        'bootup-time': {
          numericValue: 2400,
          details: {
            items: [
              { url: 'https://cdn.example.com/app.js', scripting: 1100, scriptParseCompile: 200 },
              { url: 'https://cdn.example.com/vendor.js', scripting: 800, scriptParseCompile: 180 },
            ],
          },
        },

        'server-response-time': { numericValue: 420 },
        'network-requests': {
          details: { items: new Array(72).fill({ url: 'x' }) },
        },
        'diagnostics': {
          details: {
            items: [
              {
                numElements: 1450,
                rtt: 45,
                maxServerLatency: 230,
                numTasks: 920,
                mainDocumentTransferSize: 52000,
              },
            ],
          },
        },
      },
    },
  };
}

describe('PSI extraction — expanded signals (Phase 1 + 2.6)', () => {
  it('extracts the four Lighthouse category scores', async () => {
    (mockedAxios.get as jest.Mock).mockResolvedValue({ data: makeRichPsiResponse() });
    const result = await callPSI('https://example.com', 'mobile');

    expect(result.category_scores).toEqual({
      performance: 72,
      accessibility: 91,
      best_practices: 83,
      seo: 100,
    });
  });

  it('populates savings_bytes on opportunities when overallSavingsBytes is present', async () => {
    (mockedAxios.get as jest.Mock).mockResolvedValue({ data: makeRichPsiResponse() });
    const result = await callPSI('https://example.com', 'mobile');

    const rb = result.opportunities.find(o => o.id === 'render-blocking-resources');
    const uj = result.opportunities.find(o => o.id === 'unused-javascript');
    expect(rb?.savings_bytes).toBe(84000);
    expect(uj?.savings_bytes).toBe(120000);
  });

  it('populates request counts in resource_summary alongside bytes', async () => {
    (mockedAxios.get as jest.Mock).mockResolvedValue({ data: makeRichPsiResponse() });
    const result = await callPSI('https://example.com', 'mobile');

    expect(result.resource_summary).toBeDefined();
    const rs = result.resource_summary!;
    expect(rs.script_bytes).toBe(800000);
    expect(rs.script_requests).toBe(25);
    expect(rs.image_requests).toBe(30);
    expect(rs.font_requests).toBe(4);
    expect(rs.stylesheet_requests).toBe(8);
    // `other` folds document + media
    expect(rs.other_requests).toBe(13);
  });

  it('extracts LCP element selector and label', async () => {
    (mockedAxios.get as jest.Mock).mockResolvedValue({ data: makeRichPsiResponse() });
    const result = await callPSI('https://example.com', 'mobile');

    expect(result.lcp_element).toBeDefined();
    expect(result.lcp_element?.selector).toBe('main > h1');
    expect(result.lcp_element?.nodeLabel).toBe('Hello');
  });

  it('extracts top layout-shift elements with selector and score', async () => {
    (mockedAxios.get as jest.Mock).mockResolvedValue({ data: makeRichPsiResponse() });
    const result = await callPSI('https://example.com', 'mobile');

    expect(result.cls_elements?.length).toBeGreaterThanOrEqual(2);
    expect(result.cls_elements?.[0].selector).toBe('div.ad');
    expect(result.cls_elements?.[0].score).toBe(0.12);
  });

  it('extracts render-blocking resources detail', async () => {
    (mockedAxios.get as jest.Mock).mockResolvedValue({ data: makeRichPsiResponse() });
    const result = await callPSI('https://example.com', 'mobile');

    expect(result.render_blocking?.length).toBeGreaterThanOrEqual(2);
    expect(result.render_blocking?.[0].url).toBe('https://cdn.example.com/a.css');
    expect(result.render_blocking?.[0].wastedMs).toBe(500);
  });

  it('extracts third-party summary entries', async () => {
    (mockedAxios.get as jest.Mock).mockResolvedValue({ data: makeRichPsiResponse() });
    const result = await callPSI('https://example.com', 'mobile');

    expect(result.third_party?.length).toBeGreaterThanOrEqual(2);
    expect(result.third_party?.[0].entity).toBe('Google Analytics');
    expect(result.third_party?.[0].blockingTime).toBe(150);
  });

  it('extracts bootup-time total and items', async () => {
    (mockedAxios.get as jest.Mock).mockResolvedValue({ data: makeRichPsiResponse() });
    const result = await callPSI('https://example.com', 'mobile');

    expect(result.bootup?.total_ms).toBe(2400);
    expect(result.bootup?.items.length).toBe(2);
    expect(result.bootup?.items[0].scripting).toBe(1100);
  });

  it('extracts server response time, request count, and diagnostics', async () => {
    (mockedAxios.get as jest.Mock).mockResolvedValue({ data: makeRichPsiResponse() });
    const result = await callPSI('https://example.com', 'mobile');

    expect(result.server_response_time_ms).toBe(420);
    expect(result.request_count).toBe(72);
    expect(result.diagnostics?.dom_size).toBe(1450);
    expect(result.diagnostics?.network_rtt).toBe(45);
    expect(result.diagnostics?.total_tasks).toBe(920);
    expect(result.diagnostics?.main_document_transfer_size).toBe(52000);
  });
});
