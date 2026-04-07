import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { NetworkError } from '../errors';

/**
 * Options for configuring safeFetch behavior
 */
export interface FetchOptions {
  timeout?: number; // milliseconds, default 10000
  maxResponseSize?: number; // bytes, default 10 * 1024 * 1024 (10MB)
  maxRedirects?: number; // default 5
  headers?: Record<string, string>;
  device?: 'mobile' | 'desktop'; // default 'mobile'
}

/**
 * Result of a safe fetch operation
 */
export interface FetchResult {
  status: number;
  html: string;
  headers: Record<string, string>;
  ttfb_ms: number;
  redirect_chain: string[];
  cdnDetected?: string;
  compression?: string;
  error?: string | null;
}

/**
 * Detect CDN from response headers
 */
function detectCDN(headers: Record<string, string>): string | undefined {
  const headerStr = JSON.stringify(headers).toLowerCase();
  const headerKeys = Object.keys(headers).map((k) => k.toLowerCase()).join(',');

  // Check in specific order (most specific first)
  if (headerStr.includes('cf-ray') || headerStr.includes('cf-cache-status')) {
    return 'cloudflare';
  }
  if (headerStr.includes('x-amz-cloudfront-id') || headerStr.includes('cloudfront')) {
    return 'cloudfront';
  }
  if (headerStr.includes('akamai') || headerStr.includes('ak-akamai')) {
    return 'akamai';
  }
  if (headerKeys.includes('x-amz') || headerStr.includes('x-aws')) {
    return 'aws';
  }
  if (headerStr.includes('fastly')) {
    return 'fastly';
  }

  return undefined;
}

/**
 * Detect compression from response headers
 */
function detectCompression(headers: Record<string, string>): string | undefined {
  const contentEncoding = (headers['content-encoding'] || headers['Content-Encoding'] || '').toLowerCase();

  if (contentEncoding.includes('br') || contentEncoding.includes('brotli')) {
    return 'brotli';
  }
  if (contentEncoding.includes('gzip')) {
    return 'gzip';
  }
  if (contentEncoding.includes('deflate')) {
    return 'deflate';
  }

  return undefined;
}

/**
 * Normalize headers to lowercase keys
 */
function normalizeHeaders(headers: any): Record<string, string> {
  const normalized: Record<string, string> = {};
  if (!headers) return normalized;
  Object.entries(headers).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      normalized[key.toLowerCase()] = String(value);
    }
  });
  return normalized;
}

/**
 * Safe HTTP fetch with comprehensive error handling, timeout, size limits, and metrics
 * @param url - URL to fetch
 * @param options - Fetch options (timeout, maxResponseSize, maxRedirects, headers)
 * @returns Promise<FetchResult>
 */
export async function safeFetch(url: string, options?: FetchOptions): Promise<FetchResult> {
  const timeout = options?.timeout ?? 10000;
  const maxResponseSize = options?.maxResponseSize ?? 10 * 1024 * 1024; // 10MB
  const maxRedirects = options?.maxRedirects ?? 5;
  const customHeaders = options?.headers ?? {};

  const redirectChain: string[] = [];
  let ttfbMs = 0;
  let contentSize = 0;
  let startTime = Date.now();

  try {
    // Create axios instance with custom config
    const client: AxiosInstance = axios.create({
      timeout,
      maxRedirects: 0, // We'll handle redirects manually to track chain
      validateStatus: () => true, // Don't throw on any status code
      headers: {
        'User-Agent': (options?.device === 'desktop')
          ? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
          : 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
        ...customHeaders,
      },
    });

    let currentUrl = url;
    let redirectCount = 0;
    let response: AxiosResponse | null = null;

    // Handle redirects manually with chain tracking
    while (redirectCount <= maxRedirects) {
      startTime = Date.now();
      response = await client.get(currentUrl);
      ttfbMs = Date.now() - startTime;

      if (!response) {
        break;
      }

      // Track the URL in redirect chain (only if not the first request)
      if (redirectCount > 0) {
        redirectChain.push(currentUrl);
      }

      // Check for redirect status codes
      const statusCode = response.status;
      if ([301, 302, 303, 307, 308].includes(statusCode)) {
        const locationHeader = (response.headers as any)['location'];
        if (!locationHeader) {
          // Redirect without location header — return what we got
          break;
        }

        redirectCount++;
        if (redirectCount > maxRedirects) {
          return {
            status: statusCode,
            html: '',
            headers: normalizeHeaders((response.headers as any)),
            ttfb_ms: ttfbMs,
            redirect_chain: redirectChain,
            error: `Exceeded maximum redirects (${maxRedirects})`,
          };
        }

        // Resolve relative URLs
        try {
          currentUrl = new URL(locationHeader, currentUrl).toString();
        } catch {
          currentUrl = locationHeader;
        }
        continue;
      }

      // Not a redirect, break loop
      break;
    }

    if (!response) {
      return {
        status: 0,
        html: '',
        headers: {},
        ttfb_ms: 0,
        redirect_chain: redirectChain,
        error: 'No response received',
      };
    }

    // Check response size
    const responseBody = response.data || '';
    contentSize = typeof responseBody === 'string' ? responseBody.length : JSON.stringify(responseBody).length;

    if (contentSize > maxResponseSize) {
      return {
        status: response.status,
        html: '',
        headers: normalizeHeaders(response.headers),
        ttfb_ms: ttfbMs,
        redirect_chain: redirectChain,
        error: `Response size (${contentSize} bytes) exceeds maximum (${maxResponseSize} bytes)`,
      };
    }

    // Normalize headers
    const normalizedHeaders = normalizeHeaders((response.headers as any));

    // Detect CDN and compression
    const cdnDetected = detectCDN(normalizedHeaders);
    const compression = detectCompression(normalizedHeaders);

    return {
      status: response.status,
      html: typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody),
      headers: normalizedHeaders,
      ttfb_ms: ttfbMs,
      redirect_chain: redirectChain,
      ...(cdnDetected && { cdnDetected }),
      ...(compression && { compression }),
      error: null,
    };
  } catch (err) {
    const errObj = err as any;
    // Throw typed NetworkError for connection-level failures
    if (errObj?.code === 'ECONNREFUSED' || errObj?.code === 'ENOTFOUND' || errObj?.code === 'ETIMEDOUT' || errObj?.code === 'ECONNRESET') {
      throw new NetworkError(url, errObj.message);
    }
    const errorMessage = err instanceof Error ? err.message : String(err);
    return {
      status: 0,
      html: '',
      headers: {},
      ttfb_ms: ttfbMs,
      redirect_chain: redirectChain,
      error: errorMessage,
    };
  }
}
