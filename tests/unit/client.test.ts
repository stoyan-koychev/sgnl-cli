/**
 * Smoke tests for resolveConfig.
 * Does NOT hit the network or Python. Only tests config resolution.
 */

import { resolveConfig } from '../../src/config';

describe('resolveConfig', () => {
  const originalEnv = process.env.SGNL_PSI_KEY;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.SGNL_PSI_KEY;
    } else {
      process.env.SGNL_PSI_KEY = originalEnv;
    }
  });

  it('override.psiKey takes precedence over env var', () => {
    process.env.SGNL_PSI_KEY = 'env-key';
    const result = resolveConfig({ psiKey: 'override-key' });
    // override wins regardless of env
    expect(result.psiKey).toBe('override-key');
  });

  it('override.psiKey takes precedence over file config', () => {
    // Even if a file exists, the override should win
    const result = resolveConfig({ psiKey: 'injected-key' });
    expect(result.psiKey).toBe('injected-key');
  });

  it('reads psiKey from env when override not provided', () => {
    process.env.SGNL_PSI_KEY = 'env-only-key';
    // env takes precedence over file
    const result = resolveConfig();
    expect(result.psiKey).toBe('env-only-key');
  });

  it('passes through gsc tokens from override', () => {
    const tokens = { access_token: 'tok', refresh_token: 'rtok' };
    const result = resolveConfig({ gsc: { tokens } });
    expect(result.gsc?.tokens).toEqual(tokens);
  });

  it('gsc.tokens is undefined when no override is provided', () => {
    const result = resolveConfig();
    // tokens only come from injection — never from file
    expect(result.gsc?.tokens).toBeUndefined();
  });
});
