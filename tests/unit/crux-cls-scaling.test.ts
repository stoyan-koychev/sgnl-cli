/**
 * CLS scaling lockdown tests (Phase 2.4).
 *
 * Verifies:
 *  - `parseCrUXMetric` (via fetchCrUXData) returns CLS as the RAW score — e.g.
 *    p75 = 0.05, NOT 5. The CrUX API returns the raw CLS score directly.
 *  - `extractFieldDataFromLighthouse` divides the PSI loadingExperience
 *    `CUMULATIVE_LAYOUT_SHIFT_SCORE.percentile` by 100 because the PSI endpoint
 *    returns score×100 (a historical quirk — e.g. `5` for CLS=0.05).
 *
 * These two code paths use the SAME upstream source (CrUX field data) but
 * different scaling conventions, so they are tested together to catch any
 * future regression where one path mirrors the other.
 */

import axios from 'axios';
import { fetchCrUXData } from '../../src/analysis/crux';
import { extractFieldDataFromLighthouse } from '../../src/analysis/psi';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.SGNL_PSI_KEY = 'test-api-key';
});

afterEach(() => {
  delete process.env.SGNL_PSI_KEY;
});

describe('CLS scaling — lockdown', () => {
  it('CrUX API returns CLS as raw score (0.05), NOT multiplied by 100', async () => {
    // CrUX API schema: percentiles.p75 is the raw score (0.05), not 5.
    mockedAxios.post.mockResolvedValue({
      data: {
        record: {
          metrics: {
            largest_contentful_paint: {
              histogram: [{ start: 0, end: 2500, density: 0.9 }],
              percentiles: { p75: 1500 },
            },
            cumulative_layout_shift: {
              histogram: [{ start: 0, end: 0.1, density: 0.9 }],
              percentiles: { p75: 0.05 },
            },
            first_input_delay: {
              histogram: [{ start: 0, end: 100, density: 0.95 }],
              percentiles: { p75: 10 },
            },
            interaction_to_next_paint: {
              histogram: [{ start: 0, end: 200, density: 0.95 }],
              percentiles: { p75: 120 },
            },
          },
          collectionPeriod: {
            firstDate: { year: 2026, month: 3, day: 1 },
            lastDate: { year: 2026, month: 3, day: 28 },
          },
        },
      },
      status: 200,
    });

    const result = await fetchCrUXData('https://example.com');

    expect(result.data).not.toBeNull();
    // The assertion that prevents the regression: CrUX CLS must be 0.05, not 5.
    expect(result.data!.cls.value).toBe(0.05);
    expect(result.data!.cls.value).toBeLessThan(1);
    expect(result.data!.cls.status).toBe('good');
  });

  it('PSI loadingExperience divides CLS by 100 (expects score×100 input)', () => {
    // PSI returns 5 meaning CLS=0.05. extractFieldDataFromLighthouse must divide.
    const response = {
      loadingExperience: {
        metrics: {
          LARGEST_CONTENTFUL_PAINT_MS: { percentile: 2000 },
          CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 5 },
          INTERACTION_TO_NEXT_PAINT: { percentile: 150 },
          FIRST_CONTENTFUL_PAINT_MS: { percentile: 1200 },
          FIRST_INPUT_DELAY_MS: { percentile: 40 },
        },
      },
    };

    const fieldData = extractFieldDataFromLighthouse(response);
    expect(fieldData).not.toBeNull();
    expect(fieldData!.cls.value).toBe(0.05);
    expect(fieldData!.cls.status).toBe('good');
  });

  it('PSI loadingExperience with CLS=25 maps to actual CLS=0.25 (boundary)', () => {
    const response = {
      loadingExperience: {
        metrics: {
          LARGEST_CONTENTFUL_PAINT_MS: { percentile: 2000 },
          CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 25 },
          INTERACTION_TO_NEXT_PAINT: { percentile: 150 },
        },
      },
    };

    const fieldData = extractFieldDataFromLighthouse(response);
    expect(fieldData!.cls.value).toBe(0.25);
    // Exactly 0.25 is the warn/fail boundary — warn category
    expect(fieldData!.cls.status).toBe('warn');
  });
});
