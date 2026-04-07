import { SgnlError, NetworkError, formatErrorForUser } from '../../src/errors';

describe('SgnlError hierarchy', () => {
  it('SgnlError should extend Error', () => {
    const err = new SgnlError('test', 'TEST_CODE', 'User message');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(SgnlError);
    expect(err.message).toBe('test');
    expect(err.code).toBe('TEST_CODE');
    expect(err.userMessage).toBe('User message');
    expect(err.name).toBe('SgnlError');
  });

  it('NetworkError should extend SgnlError', () => {
    const err = new NetworkError('https://example.com', 'ECONNREFUSED');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(SgnlError);
    expect(err).toBeInstanceOf(NetworkError);
    expect(err.code).toBe('NETWORK_ERROR');
    expect(err.userMessage).toContain('example.com');
    expect(err.name).toBe('NetworkError');
  });

  it('NetworkError without cause should still have a user message', () => {
    const err = new NetworkError('https://test.dev');
    expect(err.userMessage).toContain('test.dev');
    expect(err.message).toContain('Network error reaching https://test.dev');
  });
});

describe('formatErrorForUser', () => {
  it('should return userMessage for SgnlError in text mode', () => {
    const err = new SgnlError('internal detail', 'CODE', 'Friendly message');
    expect(formatErrorForUser(err)).toBe('Friendly message');
  });

  it('should fall back to message when no userMessage', () => {
    const err = new SgnlError('only message', 'CODE');
    expect(formatErrorForUser(err)).toBe('only message');
  });

  it('should return message for plain Error', () => {
    const err = new Error('plain error');
    expect(formatErrorForUser(err)).toBe('plain error');
  });

  it('should stringify non-Error values', () => {
    expect(formatErrorForUser('string error')).toBe('string error');
    expect(formatErrorForUser(42)).toBe('42');
  });

  it('should return JSON for SgnlError in json output mode', () => {
    const err = new SgnlError('detail', 'MY_CODE', 'Friendly');
    const result = formatErrorForUser(err, 'json');
    const parsed = JSON.parse(result);
    expect(parsed.error).toBe('detail');
    expect(parsed.code).toBe('MY_CODE');
  });

  it('should return JSON for plain Error in json output mode', () => {
    const err = new Error('plain');
    const result = formatErrorForUser(err, 'json');
    const parsed = JSON.parse(result);
    expect(parsed.error).toBe('plain');
    expect(parsed.code).toBe('UNKNOWN_ERROR');
  });
});
