/**
 * URL Validation & Security Module
 * 
 * Validates and sanitizes URLs before analysis.
 * Blocks private IPs, dangerous schemes, and malformed URLs.
 */

import { SgnlError } from '../errors';

/**
 * Custom error for validation failures
 */
export class ValidationError extends SgnlError {
  constructor(
    public reason: string,
    message: string,
  ) {
    super(message, `VALIDATION_${reason}`);
    this.name = 'ValidationError';
  }
}

/**
 * Validation result type
 */
export interface ValidationResult {
  valid: boolean;
  url?: string;
  reason?: string;
}

/**
 * Validates a URL for safe analysis
 * 
 * Checks:
 * - Non-http/https schemes (blocks file://, javascript://, ftp://, data://, etc.)
 * - Private IP ranges (127.x, 10.x, 192.168.x, 172.16-31.x, 0.0.0.0, ::1)
 * - URL length (max 2048 chars)
 * - Malformed URLs (invalid format, null bytes, control chars)
 * 
 * @throws ValidationError if URL is invalid
 * @returns Normalized URL with https:// added if missing
 */
export function validateUrl(url: string, maxLength: number = 2048): string {
  // Check for null bytes and control characters
  if (/[\x00-\x1F\x7F]/.test(url)) {
    throw new ValidationError(
      'MALFORMED_URL',
      'URL contains control characters',
    );
  }

  // Check length
  if (url.length > maxLength) {
    throw new ValidationError(
      'URL_TOO_LONG',
      `URL exceeds ${maxLength} characters`,
    );
  }

  // Ensure protocol
  let normalizedUrl = url;
  if (!url.match(/^https?:\/\//)) {
    normalizedUrl = `https://${url}`;
  }

  // Parse URL
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(normalizedUrl);
  } catch {
    throw new ValidationError(
      'INVALID_URL',
      'URL is malformed and cannot be parsed',
    );
  }

  // Check protocol
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new ValidationError(
      'BLOCKED_SCHEME',
      `Scheme '${parsedUrl.protocol}' is not allowed`,
    );
  }

  // Check for private IPs
  const hostname = parsedUrl.hostname || '';

  // IPv4 checks
  if (hostname === 'localhost' || hostname === '0.0.0.0') {
    throw new ValidationError(
      'PRIVATE_IP_BLOCKED',
      `Hostname '${hostname}' is blocked`,
    );
  }

  // IPv4 address check
  const ipv4Match = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ipv4Match) {
    const [_, oct1, oct2, oct3, oct4] = ipv4Match.map(Number);

    // 127.x.x.x (loopback)
    if (oct1 === 127) {
      throw new ValidationError(
        'PRIVATE_IP_BLOCKED',
        'Loopback IP (127.x.x.x) is blocked',
      );
    }

    // 10.x.x.x
    if (oct1 === 10) {
      throw new ValidationError(
        'PRIVATE_IP_BLOCKED',
        'Private IP (10.x.x.x) is blocked',
      );
    }

    // 192.168.x.x
    if (oct1 === 192 && oct2 === 168) {
      throw new ValidationError(
        'PRIVATE_IP_BLOCKED',
        'Private IP (192.168.x.x) is blocked',
      );
    }

    // 172.16.x.x to 172.31.x.x
    if (oct1 === 172 && oct2 >= 16 && oct2 <= 31) {
      throw new ValidationError(
        'PRIVATE_IP_BLOCKED',
        'Private IP (172.16-31.x.x) is blocked',
      );
    }

    // 169.254.x.x (link-local)
    if (oct1 === 169 && oct2 === 254) {
      throw new ValidationError(
        'PRIVATE_IP_BLOCKED',
        'Link-local IP (169.254.x.x) is blocked',
      );
    }
  }

  // IPv6 checks
  if (hostname === '::1' || hostname === '::') {
    throw new ValidationError(
      'PRIVATE_IP_BLOCKED',
      `IPv6 loopback '${hostname}' is blocked`,
    );
  }

  if (hostname.startsWith('fe80:') || hostname.startsWith('fc00:') || hostname.startsWith('fd00:')) {
    throw new ValidationError(
      'PRIVATE_IP_BLOCKED',
      'Private IPv6 range is blocked',
    );
  }

  return normalizedUrl;
}
