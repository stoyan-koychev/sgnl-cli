import { safeFetch, FetchResult } from '../../src/analysis/fetch';
import axios from 'axios';

// Mock axios
jest.mock('axios');

describe('safeFetch', () => {
  const mockedAxios = axios as jest.Mocked<typeof axios>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ============================================
  // HAPPY PATH: 200 Response
  // ============================================
  describe('happy path: 200 response', () => {
    it('should fetch a URL and return 200 status with HTML content', async () => {
      const mockResponse = {
        status: 200,
        data: '<html><body>Hello World</body></html>',
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'content-length': '37',
        },
      };

      mockedAxios.create.mockReturnValue({
        get: jest.fn().mockResolvedValue(mockResponse),
      } as any);

      const result = await safeFetch('https://example.com');

      expect(result.status).toBe(200);
      expect(result.html).toBe('<html><body>Hello World</body></html>');
      expect(result.error).toBeNull();
      expect(result.ttfb_ms).toBeGreaterThanOrEqual(0);
      expect(result.redirect_chain).toEqual([]);
    });

    it('should capture response headers', async () => {
      const mockResponse = {
        status: 200,
        data: 'test content',
        headers: {
          'content-type': 'text/html',
          'cache-control': 'max-age=3600',
          'server': 'nginx',
        },
      };

      mockedAxios.create.mockReturnValue({
        get: jest.fn().mockResolvedValue(mockResponse),
      } as any);

      const result = await safeFetch('https://example.com');

      expect(result.headers['content-type']).toBe('text/html');
      expect(result.headers['cache-control']).toBe('max-age=3600');
      expect(result.headers['server']).toBe('nginx');
    });
  });

  // ============================================
  // REDIRECT CHAINS
  // ============================================
  describe('redirect chains', () => {
    it('should handle 1 redirect (301)', async () => {
      const mockResponses = [
        {
          status: 301,
          data: '',
          headers: { location: 'https://example.com/new-url' },
        },
        {
          status: 200,
          data: '<html>Final</html>',
          headers: { 'content-type': 'text/html' },
        },
      ];

      let callCount = 0;
      mockedAxios.create.mockReturnValue({
        get: jest.fn().mockImplementation(() => {
          return Promise.resolve(mockResponses[callCount++]);
        }),
      } as any);

      const result = await safeFetch('https://example.com');

      expect(result.status).toBe(200);
      expect(result.html).toBe('<html>Final</html>');
      expect(result.redirect_chain.length).toBe(1);
      expect(result.redirect_chain[0]).toBe('https://example.com/new-url');
    });

    it('should handle 5 redirects (chain limit)', async () => {
      const mockResponses = [
        { status: 301, data: '', headers: { location: 'https://example.com/1' } },
        { status: 301, data: '', headers: { location: 'https://example.com/2' } },
        { status: 301, data: '', headers: { location: 'https://example.com/3' } },
        { status: 301, data: '', headers: { location: 'https://example.com/4' } },
        { status: 301, data: '', headers: { location: 'https://example.com/5' } },
        { status: 200, data: '<html>Final</html>', headers: { 'content-type': 'text/html' } },
      ];

      let callCount = 0;
      mockedAxios.create.mockReturnValue({
        get: jest.fn().mockImplementation(() => {
          return Promise.resolve(mockResponses[callCount++]);
        }),
      } as any);

      const result = await safeFetch('https://example.com', { maxRedirects: 5 });

      expect(result.status).toBe(200);
      expect(result.redirect_chain.length).toBe(5);
    });

    it('should abort if redirect chain exceeds limit (>5)', async () => {
      const mockResponses = [
        { status: 301, data: '', headers: { location: 'https://example.com/1' } },
        { status: 301, data: '', headers: { location: 'https://example.com/2' } },
        { status: 301, data: '', headers: { location: 'https://example.com/3' } },
        { status: 301, data: '', headers: { location: 'https://example.com/4' } },
        { status: 301, data: '', headers: { location: 'https://example.com/5' } },
        { status: 301, data: '', headers: { location: 'https://example.com/6' } }, // This will trigger the limit
      ];

      let callCount = 0;
      mockedAxios.create.mockReturnValue({
        get: jest.fn().mockImplementation(() => {
          return Promise.resolve(mockResponses[callCount++]);
        }),
      } as any);

      const result = await safeFetch('https://example.com', { maxRedirects: 5 });

      expect(result.status).toBe(301);
      expect(result.error).toContain('Exceeded maximum redirects');
      expect(result.redirect_chain.length).toBe(5);
    });

    it('should handle 302 redirects', async () => {
      const mockResponses = [
        { status: 302, data: '', headers: { location: 'https://example.com/temp' } },
        { status: 200, data: '<html>OK</html>', headers: { 'content-type': 'text/html' } },
      ];

      let callCount = 0;
      mockedAxios.create.mockReturnValue({
        get: jest.fn().mockImplementation(() => {
          return Promise.resolve(mockResponses[callCount++]);
        }),
      } as any);

      const result = await safeFetch('https://example.com');

      expect(result.status).toBe(200);
      expect(result.html).toBe('<html>OK</html>');
    });

    it('should handle 307 and 308 redirects', async () => {
      const mockResponses = [
        { status: 307, data: '', headers: { location: 'https://example.com/next' } },
        { status: 308, data: '', headers: { location: 'https://example.com/final' } },
        { status: 200, data: '<html>Success</html>', headers: {} },
      ];

      let callCount = 0;
      mockedAxios.create.mockReturnValue({
        get: jest.fn().mockImplementation(() => {
          return Promise.resolve(mockResponses[callCount++]);
        }),
      } as any);

      const result = await safeFetch('https://example.com');

      expect(result.status).toBe(200);
      expect(result.redirect_chain.length).toBe(2);
    });
  });

  // ============================================
  // RESPONSE SIZE LIMITS
  // ============================================
  describe('response size limits', () => {
    it('should accept response <10MB', async () => {
      const largeContent = 'x'.repeat(5 * 1024 * 1024); // 5MB
      const mockResponse = {
        status: 200,
        data: largeContent,
        headers: { 'content-type': 'text/plain' },
      };

      mockedAxios.create.mockReturnValue({
        get: jest.fn().mockResolvedValue(mockResponse),
      } as any);

      const result = await safeFetch('https://example.com');

      expect(result.status).toBe(200);
      expect(result.error).toBeNull();
    });

    it('should reject response >10MB', async () => {
      const tooLargeContent = 'x'.repeat(11 * 1024 * 1024); // 11MB
      const mockResponse = {
        status: 200,
        data: tooLargeContent,
        headers: { 'content-type': 'text/plain' },
      };

      mockedAxios.create.mockReturnValue({
        get: jest.fn().mockResolvedValue(mockResponse),
      } as any);

      const result = await safeFetch('https://example.com');

      expect(result.status).toBe(200);
      expect(result.error).toContain('exceeds maximum');
      expect(result.html).toBe('');
    });

    it('should respect custom maxResponseSize', async () => {
      const content = 'x'.repeat(2 * 1024 * 1024); // 2MB
      const mockResponse = {
        status: 200,
        data: content,
        headers: {},
      };

      mockedAxios.create.mockReturnValue({
        get: jest.fn().mockResolvedValue(mockResponse),
      } as any);

      const result = await safeFetch('https://example.com', {
        maxResponseSize: 1 * 1024 * 1024, // 1MB limit
      });

      expect(result.error).toContain('exceeds maximum');
    });
  });

  // ============================================
  // TIMEOUT HANDLING
  // ============================================
  describe('timeout handling', () => {
    it('should handle timeout errors', async () => {
      const timeoutError = new Error('timeout of 5000ms exceeded');
      mockedAxios.create.mockReturnValue({
        get: jest.fn().mockRejectedValue(timeoutError),
      } as any);

      const result = await safeFetch('https://example.com', { timeout: 5000 });

      expect(result.status).toBe(0);
      expect(result.error).toContain('timeout');
    });

    it('should use custom timeout value', async () => {
      const mockResponse = {
        status: 200,
        data: 'content',
        headers: {},
      };

      const mockClient = {
        get: jest.fn().mockResolvedValue(mockResponse),
      };

      mockedAxios.create.mockReturnValue(mockClient as any);

      await safeFetch('https://example.com', { timeout: 5000 });

      expect(mockedAxios.create).toHaveBeenCalledWith(
        expect.objectContaining({
          timeout: 5000,
        })
      );
    });

    it('should use default timeout of 10000ms', async () => {
      const mockResponse = {
        status: 200,
        data: 'content',
        headers: {},
      };

      mockedAxios.create.mockReturnValue({
        get: jest.fn().mockResolvedValue(mockResponse),
      } as any);

      await safeFetch('https://example.com');

      expect(mockedAxios.create).toHaveBeenCalledWith(
        expect.objectContaining({
          timeout: 10000,
        })
      );
    });
  });

  // ============================================
  // HTTP STATUS CODES (NO THROW)
  // ============================================
  describe('HTTP status codes (no throw)', () => {
    it('should return 4xx status without throwing', async () => {
      const mockResponse = {
        status: 404,
        data: '<html>Not Found</html>',
        headers: { 'content-type': 'text/html' },
      };

      mockedAxios.create.mockReturnValue({
        get: jest.fn().mockResolvedValue(mockResponse),
      } as any);

      const result = await safeFetch('https://example.com/notfound');

      expect(result.status).toBe(404);
      expect(result.html).toBe('<html>Not Found</html>');
      expect(result.error).toBeNull();
    });

    it('should return 5xx status without throwing', async () => {
      const mockResponse = {
        status: 500,
        data: '<html>Internal Server Error</html>',
        headers: {},
      };

      mockedAxios.create.mockReturnValue({
        get: jest.fn().mockResolvedValue(mockResponse),
      } as any);

      const result = await safeFetch('https://example.com');

      expect(result.status).toBe(500);
      expect(result.html).toBe('<html>Internal Server Error</html>');
      expect(result.error).toBeNull();
    });

    it('should return 403 Forbidden', async () => {
      const mockResponse = {
        status: 403,
        data: 'Forbidden',
        headers: {},
      };

      mockedAxios.create.mockReturnValue({
        get: jest.fn().mockResolvedValue(mockResponse),
      } as any);

      const result = await safeFetch('https://example.com/forbidden');

      expect(result.status).toBe(403);
      expect(result.error).toBeNull();
    });

    it('should return 502 Bad Gateway', async () => {
      const mockResponse = {
        status: 502,
        data: 'Bad Gateway',
        headers: {},
      };

      mockedAxios.create.mockReturnValue({
        get: jest.fn().mockResolvedValue(mockResponse),
      } as any);

      const result = await safeFetch('https://example.com');

      expect(result.status).toBe(502);
      expect(result.error).toBeNull();
    });
  });

  // ============================================
  // TTFB MEASUREMENT
  // ============================================
  describe('TTFB (time-to-first-byte) measurement', () => {
    it('should measure TTFB accurately', async () => {
      const mockResponse = {
        status: 200,
        data: 'content',
        headers: {},
      };

      mockedAxios.create.mockReturnValue({
        get: jest.fn().mockImplementation(() => {
          // Simulate 100ms delay
          return new Promise((resolve) => {
            setTimeout(() => resolve(mockResponse), 100);
          });
        }),
      } as any);

      const result = await safeFetch('https://example.com');

      // TTFB should be roughly 100ms (with some tolerance)
      expect(result.ttfb_ms).toBeGreaterThanOrEqual(90);
      expect(result.ttfb_ms).toBeLessThan(500); // Allow some overhead
    });

    it('should have zero TTFB on error', async () => {
      mockedAxios.create.mockReturnValue({
        get: jest.fn().mockRejectedValue(new Error('Network error')),
      } as any);

      const result = await safeFetch('https://example.com');

      expect(result.ttfb_ms).toBeGreaterThanOrEqual(0);
    });
  });

  // ============================================
  // CDN DETECTION
  // ============================================
  describe('CDN detection', () => {
    it('should detect Cloudflare CDN', async () => {
      const mockResponse = {
        status: 200,
        data: 'content',
        headers: {
          'cf-ray': '12345-LAX',
          'cf-cache-status': 'HIT',
        },
      };

      mockedAxios.create.mockReturnValue({
        get: jest.fn().mockResolvedValue(mockResponse),
      } as any);

      const result = await safeFetch('https://example.com');

      expect(result.cdnDetected).toBe('cloudflare');
    });

    it('should detect Akamai CDN', async () => {
      const mockResponse = {
        status: 200,
        data: 'content',
        headers: {
          'x-ak-akamai-gip': '123.45.67.89',
        },
      };

      mockedAxios.create.mockReturnValue({
        get: jest.fn().mockResolvedValue(mockResponse),
      } as any);

      const result = await safeFetch('https://example.com');

      expect(result.cdnDetected).toBe('akamai');
    });

    it('should detect AWS CDN', async () => {
      const mockResponse = {
        status: 200,
        data: 'content',
        headers: {
          'x-amz-cf-id': 'abc123',
          'x-amz-cf-pop': 'LAX50-C1',
        },
      };

      mockedAxios.create.mockReturnValue({
        get: jest.fn().mockResolvedValue(mockResponse),
      } as any);

      const result = await safeFetch('https://example.com');

      expect(result.cdnDetected).toBe('aws');
    });

    it('should detect Fastly CDN', async () => {
      const mockResponse = {
        status: 200,
        data: 'content',
        headers: {
          'x-served-by': 'cache-fastly',
          'x-cache': 'HIT',
        },
      };

      mockedAxios.create.mockReturnValue({
        get: jest.fn().mockResolvedValue(mockResponse),
      } as any);

      const result = await safeFetch('https://example.com');

      expect(result.cdnDetected).toBe('fastly');
    });

    it('should detect CloudFront CDN', async () => {
      const mockResponse = {
        status: 200,
        data: 'content',
        headers: {
          'x-amz-cloudfront-id': 'xyz789',
        },
      };

      mockedAxios.create.mockReturnValue({
        get: jest.fn().mockResolvedValue(mockResponse),
      } as any);

      const result = await safeFetch('https://example.com');

      expect(result.cdnDetected).toBe('cloudfront');
    });

    it('should not detect CDN if headers missing', async () => {
      const mockResponse = {
        status: 200,
        data: 'content',
        headers: {
          'content-type': 'text/html',
          'server': 'Apache',
        },
      };

      mockedAxios.create.mockReturnValue({
        get: jest.fn().mockResolvedValue(mockResponse),
      } as any);

      const result = await safeFetch('https://example.com');

      expect(result.cdnDetected).toBeUndefined();
    });
  });

  // ============================================
  // COMPRESSION DETECTION
  // ============================================
  describe('compression detection', () => {
    it('should detect Brotli compression', async () => {
      const mockResponse = {
        status: 200,
        data: 'compressed content',
        headers: {
          'content-encoding': 'br',
        },
      };

      mockedAxios.create.mockReturnValue({
        get: jest.fn().mockResolvedValue(mockResponse),
      } as any);

      const result = await safeFetch('https://example.com');

      expect(result.compression).toBe('brotli');
    });

    it('should detect Gzip compression', async () => {
      const mockResponse = {
        status: 200,
        data: 'gzipped content',
        headers: {
          'content-encoding': 'gzip',
        },
      };

      mockedAxios.create.mockReturnValue({
        get: jest.fn().mockResolvedValue(mockResponse),
      } as any);

      const result = await safeFetch('https://example.com');

      expect(result.compression).toBe('gzip');
    });

    it('should detect Deflate compression', async () => {
      const mockResponse = {
        status: 200,
        data: 'deflated content',
        headers: {
          'content-encoding': 'deflate',
        },
      };

      mockedAxios.create.mockReturnValue({
        get: jest.fn().mockResolvedValue(mockResponse),
      } as any);

      const result = await safeFetch('https://example.com');

      expect(result.compression).toBe('deflate');
    });

    it('should not detect compression if no header', async () => {
      const mockResponse = {
        status: 200,
        data: 'uncompressed content',
        headers: {
          'content-type': 'text/html',
        },
      };

      mockedAxios.create.mockReturnValue({
        get: jest.fn().mockResolvedValue(mockResponse),
      } as any);

      const result = await safeFetch('https://example.com');

      expect(result.compression).toBeUndefined();
    });

    it('should handle case-insensitive headers', async () => {
      const mockResponse = {
        status: 200,
        data: 'content',
        headers: {
          'Content-Encoding': 'GZIP',
        },
      };

      mockedAxios.create.mockReturnValue({
        get: jest.fn().mockResolvedValue(mockResponse),
      } as any);

      const result = await safeFetch('https://example.com');

      expect(result.compression).toBe('gzip');
    });
  });

  // ============================================
  // EDGE CASES & ERROR HANDLING
  // ============================================
  describe('edge cases and error handling', () => {
    it('should handle network errors gracefully', async () => {
      const networkError = new Error('ECONNREFUSED: Connection refused');
      mockedAxios.create.mockReturnValue({
        get: jest.fn().mockRejectedValue(networkError),
      } as any);

      const result = await safeFetch('https://invalid.local');

      expect(result.status).toBe(0);
      expect(result.error).toBe('ECONNREFUSED: Connection refused');
      expect(result.html).toBe('');
    });

    it('should handle redirect without location header', async () => {
      const mockResponse = {
        status: 301,
        data: '',
        headers: {}, // No location header
      };

      mockedAxios.create.mockReturnValue({
        get: jest.fn().mockResolvedValue(mockResponse),
      } as any);

      const result = await safeFetch('https://example.com');

      expect(result.status).toBe(301);
      expect(result.redirect_chain).toEqual([]);
    });

    it('should handle JSON response data', async () => {
      const mockResponse = {
        status: 200,
        data: { key: 'value', nested: { foo: 'bar' } },
        headers: { 'content-type': 'application/json' },
      };

      mockedAxios.create.mockReturnValue({
        get: jest.fn().mockResolvedValue(mockResponse),
      } as any);

      const result = await safeFetch('https://api.example.com/data');

      expect(result.status).toBe(200);
      expect(result.html).toContain('key');
      expect(result.html).toContain('value');
    });

    it('should normalize header keys to lowercase', async () => {
      const mockResponse = {
        status: 200,
        data: 'content',
        headers: {
          'Content-Type': 'text/html',
          'Cache-Control': 'max-age=3600',
          'X-Custom-Header': 'custom-value',
        },
      };

      mockedAxios.create.mockReturnValue({
        get: jest.fn().mockResolvedValue(mockResponse),
      } as any);

      const result = await safeFetch('https://example.com');

      expect(result.headers['content-type']).toBe('text/html');
      expect(result.headers['cache-control']).toBe('max-age=3600');
      expect(result.headers['x-custom-header']).toBe('custom-value');
    });

    it('should pass custom headers to axios', async () => {
      const mockResponse = {
        status: 200,
        data: 'content',
        headers: {},
      };

      const mockClient = {
        get: jest.fn().mockResolvedValue(mockResponse),
      };

      mockedAxios.create.mockReturnValue(mockClient as any);

      await safeFetch('https://example.com', {
        headers: {
          Authorization: 'Bearer token123',
          'X-Custom': 'value',
        },
      });

      expect(mockedAxios.create).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer token123',
            'X-Custom': 'value',
          }),
        })
      );
    });
  });

  // ============================================
  // COMPLETE SCENARIOS
  // ============================================
  describe('complete scenarios', () => {
    it('should handle full fetch with all features', async () => {
      const mockResponse = {
        status: 200,
        data: '<html><body>Full test</body></html>',
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'content-encoding': 'gzip',
          'cf-ray': '12345-LAX',
          'cache-control': 'max-age=3600',
          'server': 'cloudflare',
        },
      };

      mockedAxios.create.mockReturnValue({
        get: jest.fn().mockResolvedValue(mockResponse),
      } as any);

      const result = await safeFetch('https://example.com', {
        timeout: 10000,
        maxResponseSize: 10 * 1024 * 1024,
      });

      expect(result.status).toBe(200);
      expect(result.html).toBe('<html><body>Full test</body></html>');
      expect(result.headers['content-type']).toBe('text/html; charset=utf-8');
      expect(result.compression).toBe('gzip');
      expect(result.cdnDetected).toBe('cloudflare');
      expect(result.error).toBeNull();
      expect(result.ttfb_ms).toBeGreaterThanOrEqual(0);
    });
  });
});
