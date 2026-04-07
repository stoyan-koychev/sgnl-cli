import { withRetry } from '../../src/utils/retry';

describe('withRetry', () => {
  it('should return the result on first success', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    const result = await withRetry(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should retry on failure and succeed', async () => {
    const fn = jest.fn()
      .mockRejectedValueOnce(new Error('fail1'))
      .mockResolvedValue('ok');
    const result = await withRetry(fn, { maxAttempts: 3, baseDelayMs: 1 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should throw after exhausting all attempts', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('always fails'));
    await expect(withRetry(fn, { maxAttempts: 3, baseDelayMs: 1 })).rejects.toThrow('always fails');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('should respect retryOn predicate — do not retry non-matching errors', async () => {
    class RetryableError extends Error {}
    const fn = jest.fn().mockRejectedValue(new Error('not retryable'));
    await expect(
      withRetry(fn, { maxAttempts: 3, baseDelayMs: 1, retryOn: (e) => e instanceof RetryableError }),
    ).rejects.toThrow('not retryable');
    expect(fn).toHaveBeenCalledTimes(1); // no retry
  });

  it('should retry when retryOn predicate matches', async () => {
    class RetryableError extends Error {}
    const fn = jest.fn()
      .mockRejectedValueOnce(new RetryableError('retry me'))
      .mockResolvedValue('ok');
    const result = await withRetry(fn, {
      maxAttempts: 3,
      baseDelayMs: 1,
      retryOn: (e) => e instanceof RetryableError,
    });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should use exponential backoff delays', async () => {
    const fn = jest.fn()
      .mockRejectedValueOnce(new Error('1'))
      .mockRejectedValueOnce(new Error('2'))
      .mockResolvedValue('ok');

    const start = Date.now();
    await withRetry(fn, { maxAttempts: 3, baseDelayMs: 50 });
    const elapsed = Date.now() - start;

    // 1st retry: 50ms, 2nd retry: 100ms → total ~150ms minimum
    expect(elapsed).toBeGreaterThanOrEqual(100);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('should work with maxAttempts = 1 (no retries)', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('fail'));
    await expect(withRetry(fn, { maxAttempts: 1 })).rejects.toThrow('fail');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
