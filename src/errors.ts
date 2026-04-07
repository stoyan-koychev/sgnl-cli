/**
 * SGNL Unified Error Hierarchy
 *
 * All SGNL-specific errors extend SgnlError, enabling uniform
 * handling in command handlers via `instanceof SgnlError`.
 */

/**
 * Base error for all SGNL-specific failures.
 * Carries a machine-readable `code` and an optional user-facing message.
 */
export class SgnlError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly userMessage?: string,
  ) {
    super(message);
    this.name = 'SgnlError';
  }
}

/**
 * Network-level failure (ECONNREFUSED, ENOTFOUND, ETIMEDOUT, etc.)
 */
export class NetworkError extends SgnlError {
  constructor(url: string, cause?: string) {
    super(
      `Network error reaching ${url}${cause ? `: ${cause}` : ''}`,
      'NETWORK_ERROR',
      `Could not reach "${url}". Check the URL and your internet connection.`,
    );
    this.name = 'NetworkError';
  }
}

/**
 * Format an error for the user, using the userMessage when available.
 * When --output json is active, returns a structured JSON string instead.
 */
export function formatErrorForUser(err: unknown, outputFormat?: string): string {
  if (outputFormat === 'json') {
    const code = err instanceof SgnlError ? err.code : 'UNKNOWN_ERROR';
    const message = err instanceof Error ? err.message : String(err);
    return JSON.stringify({ error: message, code }, null, 2);
  }

  if (err instanceof SgnlError && err.userMessage) {
    return err.userMessage;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}
