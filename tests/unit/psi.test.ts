import {
  callPSI,
  callPSIParallel,
  RateLimitError,
  AuthError,
  NotFoundError,
  TimeoutError,
  PSIResult,
  Opportunity,
  LabData,
  FieldData,
} from '../../src/analysis/psi';
import axios from 'axios';

// Mock axios
jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;

/**
 * Mock PSI response with both field and lab data
 */
function createMockPSIResponse() {
  return {
    loadingExperience: {
      metrics: {
        LARGEST_CONTENTFUL_PAINT_MS: {
          percentile: 2000,
          distributions: [],
          category: 'FAST',
        },
        CUMULATIVE_LAYOUT_SHIFT_SCORE: {
          percentile: 5,
          distributions: [],
          category: 'FAST',
        },
        INTERACTION_TO_NEXT_PAINT: {
          percentile: 100,
          distributions: [],
          category: 'FAST',
        },
        FIRST_CONTENTFUL_PAINT_MS: {
          percentile: 1500,
          distributions: [],
          category: 'FAST',
        },
        FIRST_INPUT_DELAY_MS: {
          percentile: 50,
          distributions: [],
          category: 'FAST',
        },
      },
    },
    lighthouseResult: {
      categories: {
        performance: {
          score: 0.95,
        },
      },
      audits: {
        'speed-index': {
          numericValue: 2500,
          title: 'Speed Index',
        },
        interactive: {
          numericValue: 3500,
          title: 'Time to Interactive',
        },
        'total-blocking-time': {
          numericValue: 150,
          title: 'Total Blocking Time',
        },
        'cumulative-layout-shift': {
          numericValue: 0.05,
          title: 'Cumulative Layout Shift',
        },
        'render-blocking-resources': {
          title: 'Eliminate render-blocking resources',
          numericValue: 2000,
          details: {
            type: 'opportunity',
          },
        },
        'unminified-javascript': {
          title: 'Minify JavaScript',
          numericValue: 500,
          details: {
            type: 'opportunity',
          },
        },
        'unused-javascript': {
          title: 'Remove unused JavaScript',
          numericValue: 1500,
          details: {
            type: 'opportunity',
          },
        },
        'unused-css': {
          title: 'Remove unused CSS',
          numericValue: 300,
          details: {
            type: 'opportunity',
          },
        },
        'modern-image-formats': {
          title: 'Serve images in modern formats',
          numericValue: 800,
          details: {
            type: 'opportunity',
          },
        },
      },
    },
  };
}

describe('PSI (PageSpeed Insights) Integration', () => {
  beforeEach(() => {
    process.env.SGNL_PSI_KEY = 'test-api-key-mock';
    jest.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.SGNL_PSI_KEY;
  });

  // ============================================
  // HAPPY PATH: Valid API Response
  // ============================================
  describe('happy path: valid API response', () => {
    it('should parse valid PSI response for desktop strategy', async () => {
      const mockResponse = createMockPSIResponse();

      (mockedAxios.get as jest.Mock).mockResolvedValue({
        data: mockResponse,
      });

      const result = await callPSI('https://example.com', 'desktop');

      expect(result.url).toBe('https://example.com');
      expect(result.strategy).toBe('desktop');
      expect(result.field_data).not.toBeNull();
      expect(result.lab_data.performance_score).toBe(95);
      expect(result.opportunities.length).toBeGreaterThan(0);
      expect(result.error).toBeUndefined();
    });

    it('should parse valid PSI response for mobile strategy', async () => {
      const mockResponse = createMockPSIResponse();

      (mockedAxios.get as jest.Mock).mockResolvedValue({
        data: mockResponse,
      });

      const result = await callPSI('https://example.com', 'mobile');

      expect(result.url).toBe('https://example.com');
      expect(result.strategy).toBe('mobile');
      expect(result.field_data).not.toBeNull();
      expect(result.lab_data).toBeDefined();
    });

    it('should extract field data (CrUX) from response', async () => {
      const mockResponse = createMockPSIResponse();

      (mockedAxios.get as jest.Mock).mockResolvedValue({
        data: mockResponse,
      });

      const result = await callPSI('https://example.com', 'desktop');

      expect(result.field_data).not.toBeNull();
      if (result.field_data) {
        expect(result.field_data.lcp).toBeDefined();
        expect(result.field_data.cls).toBeDefined();
        expect(result.field_data.inp).toBeDefined();
        expect(result.field_data.fcp).toBeDefined();
        expect(result.field_data.fid).toBeDefined();

        // Check values
        expect(result.field_data.lcp.value).toBe(2000);
        expect(result.field_data.lcp.status).toBe('good');
        expect(result.field_data.lcp.unit).toBe('ms');
        expect(result.field_data.lcp.target).toBe(2500);
      }
    });

    it('should extract lab data (Lighthouse) from response', async () => {
      const mockResponse = createMockPSIResponse();

      (mockedAxios.get as jest.Mock).mockResolvedValue({
        data: mockResponse,
      });

      const result = await callPSI('https://example.com', 'desktop');

      expect(result.lab_data).toBeDefined();
      expect(result.lab_data.performance_score).toBe(95);
      expect(result.lab_data.speed_index_s).toBe(2.5);
      expect(result.lab_data.tti_s).toBe(3.5);
      expect(result.lab_data.tbt_ms).toBe(150);
      expect(result.lab_data.cls).toBe(0.05);
    });

    it('should extract opportunities and sort by savings_ms descending', async () => {
      const mockResponse = createMockPSIResponse();

      (mockedAxios.get as jest.Mock).mockResolvedValue({
        data: mockResponse,
      });

      const result = await callPSI('https://example.com', 'desktop');

      expect(result.opportunities.length).toBeGreaterThan(0);
      
      // Verify sorted by savings_ms descending
      for (let i = 0; i < result.opportunities.length - 1; i++) {
        expect(result.opportunities[i].savings_ms).toBeGreaterThanOrEqual(
          result.opportunities[i + 1].savings_ms
        );
      }

      // Verify structure
      const opp = result.opportunities[0];
      expect(opp.id).toBeDefined();
      expect(typeof opp.priority).toBe('number');
      expect(typeof opp.savings_ms).toBe('number');
      expect(['pass', 'warn', 'fail']).toContain(opp.status);
      expect(opp.fix).toBeDefined();
    });

    it('should identify key audit opportunities', async () => {
      const mockResponse = createMockPSIResponse();

      (mockedAxios.get as jest.Mock).mockResolvedValue({
        data: mockResponse,
      });

      const result = await callPSI('https://example.com', 'desktop');

      const oppIds = result.opportunities.map((o) => o.id);
      expect(oppIds).toContain('render-blocking-resources');
      expect(oppIds).toContain('unused-javascript');
      expect(oppIds).toContain('modern-image-formats');
    });
  });

  // ============================================
  // FIELD DATA EXTRACTION
  // ============================================
  describe('field data extraction', () => {
    it('should handle missing field data gracefully', async () => {
      const mockResponse = {
        lighthouseResult: createMockPSIResponse().lighthouseResult,
        // No loadingExperience
      };

      (mockedAxios.get as jest.Mock).mockResolvedValue({
        data: mockResponse,
      });

      const result = await callPSI('https://example.com', 'desktop');

      expect(result.field_data).toBeNull();
      expect(result.lab_data).toBeDefined();
    });

    it('should determine metric status as good', async () => {
      const mockResponse = createMockPSIResponse();
      if (mockResponse.loadingExperience.metrics.LARGEST_CONTENTFUL_PAINT_MS) {
        mockResponse.loadingExperience.metrics.LARGEST_CONTENTFUL_PAINT_MS.percentile = 90;
      }

      (mockedAxios.get as jest.Mock).mockResolvedValue({
        data: mockResponse,
      });

      const result = await callPSI('https://example.com', 'desktop');

      if (result.field_data) {
        expect(result.field_data.lcp.status).toBe('good');
      }
    });

    it('should determine metric status as warn', async () => {
      const mockResponse = createMockPSIResponse();
      if (mockResponse.loadingExperience.metrics.LARGEST_CONTENTFUL_PAINT_MS) {
        mockResponse.loadingExperience.metrics.LARGEST_CONTENTFUL_PAINT_MS.percentile = 3000;
      }

      (mockedAxios.get as jest.Mock).mockResolvedValue({
        data: mockResponse,
      });

      const result = await callPSI('https://example.com', 'desktop');

      if (result.field_data) {
        expect(result.field_data.lcp.status).toBe('warn');
      }
    });

    it('should determine metric status as fail', async () => {
      const mockResponse = createMockPSIResponse();
      if (mockResponse.loadingExperience.metrics.LARGEST_CONTENTFUL_PAINT_MS) {
        mockResponse.loadingExperience.metrics.LARGEST_CONTENTFUL_PAINT_MS.percentile = 5000;
      }

      (mockedAxios.get as jest.Mock).mockResolvedValue({
        data: mockResponse,
      });

      const result = await callPSI('https://example.com', 'desktop');

      if (result.field_data) {
        expect(result.field_data.lcp.status).toBe('fail');
      }
    });
  });

  // ============================================
  // LAB DATA EXTRACTION
  // ============================================
  describe('lab data extraction', () => {
    it('should handle missing lab data gracefully', async () => {
      const mockResponse = {
        loadingExperience: createMockPSIResponse().loadingExperience,
        // No lighthouseResult
      };

      (mockedAxios.get as jest.Mock).mockResolvedValue({
        data: mockResponse,
      });

      const result = await callPSI('https://example.com', 'desktop');

      expect(result.lab_data.performance_score).toBe(0);
      expect(result.lab_data.speed_index_s).toBe(0);
      expect(result.lab_data.tti_s).toBe(0);
      expect(result.lab_data.tbt_ms).toBe(0);
      expect(result.lab_data.cls).toBe(0);
    });

    it('should convert ms to seconds for speed metrics', async () => {
      const mockResponse = createMockPSIResponse();
      mockResponse.lighthouseResult.audits['speed-index'].numericValue = 5000;
      mockResponse.lighthouseResult.audits.interactive.numericValue = 7500;

      (mockedAxios.get as jest.Mock).mockResolvedValue({
        data: mockResponse,
      });

      const result = await callPSI('https://example.com', 'desktop');

      expect(result.lab_data.speed_index_s).toBe(5);
      expect(result.lab_data.tti_s).toBe(7.5);
    });

    it('should parse performance score correctly', async () => {
      const mockResponse = createMockPSIResponse();
      mockResponse.lighthouseResult.categories.performance.score = 0.87;

      (mockedAxios.get as jest.Mock).mockResolvedValue({
        data: mockResponse,
      });

      const result = await callPSI('https://example.com', 'desktop');

      expect(result.lab_data.performance_score).toBe(87);
    });
  });

  // ============================================
  // OPPORTUNITY PARSING & SORTING
  // ============================================
  describe('opportunity parsing and sorting', () => {
    it('should sort opportunities by savings_ms descending', async () => {
      const mockResponse = createMockPSIResponse();

      (mockedAxios.get as jest.Mock).mockResolvedValue({
        data: mockResponse,
      });

      const result = await callPSI('https://example.com', 'desktop');

      const sorted = result.opportunities;
      for (let i = 0; i < sorted.length - 1; i++) {
        expect(sorted[i].savings_ms).toBeGreaterThanOrEqual(sorted[i + 1].savings_ms);
      }
    });

    it('should assign correct opportunity priority', async () => {
      const mockResponse = createMockPSIResponse();

      (mockedAxios.get as jest.Mock).mockResolvedValue({
        data: mockResponse,
      });

      const result = await callPSI('https://example.com', 'desktop');

      result.opportunities.forEach((opp) => {
        expect(opp.priority).toBe(opp.savings_ms);
      });
    });

    it('should set status based on savings threshold', async () => {
      const mockResponse = createMockPSIResponse();

      (mockedAxios.get as jest.Mock).mockResolvedValue({
        data: mockResponse,
      });

      const result = await callPSI('https://example.com', 'desktop');

      result.opportunities.forEach((opp) => {
        if (opp.savings_ms > 1000) {
          expect(opp.status).toBe('fail');
        } else if (opp.savings_ms > 100) {
          expect(opp.status).toBe('warn');
        } else {
          expect(opp.status).toBe('pass');
        }
      });
    });

    it('should handle empty opportunities list', async () => {
      const mockResponse = {
        lighthouseResult: {
          categories: { performance: { score: 0.95 } },
          audits: {}, // No opportunities
        },
      };

      (mockedAxios.get as jest.Mock).mockResolvedValue({
        data: mockResponse,
      });

      const result = await callPSI('https://example.com', 'desktop');

      expect(result.opportunities).toEqual([]);
    });
  });

  // ============================================
  // ERROR HANDLING
  // ============================================
  describe('error handling: rate limit (429)', () => {
    it('should throw RateLimitError on 429 response', async () => {
      (mockedAxios.get as jest.Mock).mockRejectedValue(
        Object.assign(new Error('Rate limit exceeded'), {
          response: {
            status: 429,
            data: {
              error: {
                message: 'Rate limit exceeded',
              },
            },
          },
        })
      );

      await expect(callPSI('https://example.com', 'desktop')).rejects.toThrow(RateLimitError);
    });

    it('should preserve error message from API', async () => {
      (mockedAxios.get as jest.Mock).mockRejectedValue(
        Object.assign(new Error('Rate limit exceeded'), {
          response: {
            status: 429,
            data: {
              error: {
                message: 'Quota exceeded for quota group',
              },
            },
          },
        })
      );

      try {
        await callPSI('https://example.com', 'desktop');
        fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(RateLimitError);
        expect((err as Error).message).toContain('Quota exceeded');
      }
    });
  });

  describe('error handling: auth error (403)', () => {
    it('should throw AuthError on 403 response', async () => {
      (mockedAxios.get as jest.Mock).mockRejectedValue(
        Object.assign(new Error('Forbidden'), {
          response: {
            status: 403,
            data: {
              error: {
                message: 'Invalid API key',
              },
            },
          },
        })
      );

      await expect(callPSI('https://example.com', 'desktop')).rejects.toThrow(AuthError);
    });

    it('should throw AuthError when SGNL_PSI_KEY not set', async () => {
      const originalKey = process.env.SGNL_PSI_KEY;
      delete process.env.SGNL_PSI_KEY;

      try {
        await expect(callPSI('https://example.com', 'desktop')).rejects.toThrow(AuthError);
      } finally {
        if (originalKey) process.env.SGNL_PSI_KEY = originalKey;
      }
    });
  });

  describe('error handling: not found (404)', () => {
    it('should throw NotFoundError on 404 response', async () => {
      (mockedAxios.get as jest.Mock).mockRejectedValue(
        Object.assign(new Error('Not found'), {
          response: {
            status: 404,
            data: {
              error: {
                message: 'URL not found',
              },
            },
          },
        })
      );

      await expect(callPSI('https://example.com/notfound', 'desktop')).rejects.toThrow(NotFoundError);
    });

    it('should throw NotFoundError for invalid URL', async () => {
      await expect(callPSI('not a valid url', 'desktop')).rejects.toThrow(NotFoundError);
    });
  });

  describe('error handling: timeout', () => {
    it('should throw TimeoutError on timeout', async () => {
      (mockedAxios.get as jest.Mock).mockRejectedValue(
        Object.assign(new Error('timeout of 30000ms exceeded'), {
          code: 'ECONNABORTED',
        })
      );

      await expect(callPSI('https://example.com', 'desktop')).rejects.toThrow(TimeoutError);
    });

    it('should throw TimeoutError on ECONNABORTED', async () => {
      (mockedAxios.get as jest.Mock).mockRejectedValue(
        Object.assign(new Error('Network timeout'), {
          code: 'ECONNABORTED',
        })
      );

      await expect(callPSI('https://example.com', 'desktop')).rejects.toThrow(TimeoutError);
    });
  });

  describe('error handling: graceful fallback', () => {
    it('should return graceful result on non-custom errors', async () => {
      (mockedAxios.get as jest.Mock).mockRejectedValue(new Error('Generic error'));

      const result = await callPSI('https://example.com', 'desktop');

      expect(result.url).toBe('https://example.com');
      expect(result.strategy).toBe('desktop');
      expect(result.field_data).toBeNull();
      expect(result.lab_data.performance_score).toBe(0);
      expect(result.opportunities).toEqual([]);
      expect(result.error).toContain('Generic error');
    });

    it('should not crash on malformed response', async () => {
      (mockedAxios.get as jest.Mock).mockResolvedValue({
        data: null,
      });

      const result = await callPSI('https://example.com', 'desktop');

      expect(result.field_data).toBeNull();
      expect(result.lab_data.performance_score).toBe(0);
      expect(result.opportunities).toEqual([]);
    });
  });

  // ============================================
  // MISSING METRICS (GRACEFUL FALLBACK)
  // ============================================
  describe('missing metrics: graceful fallback', () => {
    it('should handle missing field metrics', async () => {
      const mockResponse = {
        loadingExperience: {
          metrics: {
            // Only LCP
            LARGEST_CONTENTFUL_PAINT_MS: {
              percentile: 2000,
            },
            // Rest are missing
          },
        },
        lighthouseResult: createMockPSIResponse().lighthouseResult,
      };

      (mockedAxios.get as jest.Mock).mockResolvedValue({
        data: mockResponse,
      });

      const result = await callPSI('https://example.com', 'desktop');

      // Should still have structure with fallback values
      expect(result.field_data).not.toBeNull();
      if (result.field_data) {
        expect(result.field_data.lcp.value).toBe(2000);
        expect(result.field_data.cls).toBeDefined();
      }
    });

    it('should handle missing lab audits', async () => {
      const mockResponse = {
        loadingExperience: createMockPSIResponse().loadingExperience,
        lighthouseResult: {
          categories: { performance: { score: 0.95 } },
          audits: {
            // Only speed-index
            'speed-index': {
              numericValue: 2500,
              title: 'Speed Index',
            },
            // Rest are missing
          },
        },
      };

      (mockedAxios.get as jest.Mock).mockResolvedValue({
        data: mockResponse,
      });

      const result = await callPSI('https://example.com', 'desktop');

      expect(result.lab_data.speed_index_s).toBe(2.5);
      expect(result.lab_data.tti_s).toBe(0); // Missing, fallback to 0
      expect(result.lab_data.tbt_ms).toBe(0); // Missing, fallback to 0
    });
  });

  // ============================================
  // BOTH STRATEGIES (DESKTOP + MOBILE)
  // ============================================
  describe('both strategies (desktop + mobile)', () => {
    it('should support desktop strategy', async () => {
      const mockResponse = createMockPSIResponse();

      (mockedAxios.get as jest.Mock).mockResolvedValue({
        data: mockResponse,
      });

      const result = await callPSI('https://example.com', 'desktop');

      expect(result.strategy).toBe('desktop');
    });

    it('should support mobile strategy', async () => {
      const mockResponse = createMockPSIResponse();

      (mockedAxios.get as jest.Mock).mockResolvedValue({
        data: mockResponse,
      });

      const result = await callPSI('https://example.com', 'mobile');

      expect(result.strategy).toBe('mobile');
    });

    it('should call both strategies in parallel with callPSIParallel', async () => {
      const mockResponse = createMockPSIResponse();

      (mockedAxios.get as jest.Mock).mockResolvedValue({
        data: mockResponse,
      });

      const [desktop, mobile] = await callPSIParallel('https://example.com');

      expect(desktop.strategy).toBe('desktop');
      expect(mobile.strategy).toBe('mobile');
      expect(desktop.url).toBe('https://example.com');
      expect(mobile.url).toBe('https://example.com');

      // Should have called twice (once for each strategy)
      expect(mockedAxios.get).toHaveBeenCalledTimes(2);
    });
  });

  // ============================================
  // RETURN TYPE VALIDATION
  // ============================================
  describe('return type validation', () => {
    it('should return PSIResult with correct types', async () => {
      const mockResponse = createMockPSIResponse();

      (mockedAxios.get as jest.Mock).mockResolvedValue({
        data: mockResponse,
      });

      const result = await callPSI('https://example.com', 'desktop');

      // Type checks
      expect(typeof result.url).toBe('string');
      expect(['desktop', 'mobile']).toContain(result.strategy);
      expect(result.field_data === null || typeof result.field_data === 'object').toBe(true);
      expect(typeof result.lab_data === 'object').toBe(true);
      expect(Array.isArray(result.opportunities)).toBe(true);
    });

    it('should have correct MetricValue structure', async () => {
      const mockResponse = createMockPSIResponse();

      (mockedAxios.get as jest.Mock).mockResolvedValue({
        data: mockResponse,
      });

      const result = await callPSI('https://example.com', 'desktop');

      if (result.field_data && result.field_data.lcp) {
        const metric = result.field_data.lcp;
        expect(typeof metric.value).toBe('number');
        expect(typeof metric.unit).toBe('string');
        expect(['good', 'warn', 'fail']).toContain(metric.status);
        expect(typeof metric.target).toBe('number');
      }
    });

    it('should have correct Opportunity structure', async () => {
      const mockResponse = createMockPSIResponse();

      (mockedAxios.get as jest.Mock).mockResolvedValue({
        data: mockResponse,
      });

      const result = await callPSI('https://example.com', 'desktop');

      result.opportunities.forEach((opp) => {
        expect(typeof opp.id).toBe('string');
        expect(typeof opp.priority).toBe('number');
        expect(typeof opp.savings_ms).toBe('number');
        expect(['pass', 'warn', 'fail']).toContain(opp.status);
        expect(typeof opp.fix).toBe('string');
      });
    });

    it('should have correct LabData structure', async () => {
      const mockResponse = createMockPSIResponse();

      (mockedAxios.get as jest.Mock).mockResolvedValue({
        data: mockResponse,
      });

      const result = await callPSI('https://example.com', 'desktop');

      expect(typeof result.lab_data.performance_score).toBe('number');
      expect(typeof result.lab_data.speed_index_s).toBe('number');
      expect(typeof result.lab_data.tti_s).toBe('number');
      expect(typeof result.lab_data.tbt_ms).toBe('number');
      expect(typeof result.lab_data.cls).toBe('number');

      // Ranges
      expect(result.lab_data.performance_score).toBeGreaterThanOrEqual(0);
      expect(result.lab_data.performance_score).toBeLessThanOrEqual(100);
      expect(result.lab_data.speed_index_s).toBeGreaterThanOrEqual(0);
      expect(result.lab_data.tti_s).toBeGreaterThanOrEqual(0);
      expect(result.lab_data.tbt_ms).toBeGreaterThanOrEqual(0);
      expect(result.lab_data.cls).toBeGreaterThanOrEqual(0);
    });
  });

  // ============================================
  // COMPLETE SCENARIOS
  // ============================================
  describe('complete scenarios', () => {
    it('should handle full PSI analysis flow for desktop', async () => {
      const mockResponse = createMockPSIResponse();

      (mockedAxios.get as jest.Mock).mockResolvedValue({
        data: mockResponse,
      });

      const result = await callPSI('https://example.com', 'desktop');

      expect(result.url).toBe('https://example.com');
      expect(result.strategy).toBe('desktop');
      expect(result.field_data).not.toBeNull();
      expect(result.lab_data.performance_score).toBe(95);
      expect(result.opportunities.length).toBeGreaterThan(0);
      expect(result.opportunities[0].savings_ms).toBeGreaterThanOrEqual(
        result.opportunities[1].savings_ms
      );
      expect(result.error).toBeUndefined();
    });

    it('should handle full PSI analysis flow for mobile', async () => {
      const mockResponse = createMockPSIResponse();

      (mockedAxios.get as jest.Mock).mockResolvedValue({
        data: mockResponse,
      });

      const result = await callPSI('https://example.com', 'mobile');

      expect(result.url).toBe('https://example.com');
      expect(result.strategy).toBe('mobile');
      expect(result.field_data).not.toBeNull();
      expect(result.lab_data.performance_score).toBeGreaterThan(0);
      expect(Array.isArray(result.opportunities)).toBe(true);
    });

    it('should process multiple URLs sequentially', async () => {
      const mockResponse = createMockPSIResponse();

      (mockedAxios.get as jest.Mock).mockResolvedValue({
        data: mockResponse,
      });

      const result1 = await callPSI('https://example1.com', 'desktop');
      const result2 = await callPSI('https://example2.com', 'desktop');

      expect(result1.url).toBe('https://example1.com');
      expect(result2.url).toBe('https://example2.com');
      expect(mockedAxios.get).toHaveBeenCalledTimes(2);
    });
  });

  // ============================================
  // FIELD → LAB FALLBACK
  // ============================================
  describe('field → lab fallback', () => {
    it('should return null field_data but valid lab_data when field data missing', async () => {
      const mockResponse = {
        lighthouseResult: createMockPSIResponse().lighthouseResult,
      };

      (mockedAxios.get as jest.Mock).mockResolvedValue({
        data: mockResponse,
      });

      const result = await callPSI('https://example.com', 'desktop');

      expect(result.field_data).toBeNull();
      expect(result.lab_data.performance_score).toBeGreaterThan(0);
    });

    it('should return valid field_data but degraded lab_data when lab data missing', async () => {
      const mockResponse = {
        loadingExperience: createMockPSIResponse().loadingExperience,
      };

      (mockedAxios.get as jest.Mock).mockResolvedValue({
        data: mockResponse,
      });

      const result = await callPSI('https://example.com', 'desktop');

      expect(result.field_data).not.toBeNull();
      expect(result.lab_data.performance_score).toBe(0);
      expect(result.lab_data.speed_index_s).toBe(0);
    });
  });
});
