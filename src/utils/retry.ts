/**
 * Generic retry utility with exponential backoff.
 */

export interface RetryOptions {
  /** Maximum number of attempts (default: 3) */
  maxAttempts?: number;
  /** Base delay in ms, doubled each retry (default: 500) */
  baseDelayMs?: number;
  /** Predicate to decide whether a given error is retryable (default: always retry) */
  retryOn?: (err: Error) => boolean;
}

/**
 * Execute `fn` with automatic retries on failure.
 *
 * @example
 * const data = await withRetry(() => callPSI(url, 'mobile'), {
 *   maxAttempts: 3,
 *   retryOn: (e) => e instanceof RateLimitError,
 * });
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const { maxAttempts = 3, baseDelayMs = 500, retryOn = () => true } = options;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isLast = attempt === maxAttempts;
      const isRetryable = err instanceof Error && retryOn(err);

      if (isLast || !isRetryable) throw err;

      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  // Unreachable — the loop always returns or throws
  throw new Error('withRetry: unreachable');
}
