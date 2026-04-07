/**
 * Shared utilities for SGNL CLI commands
 */

import type { ResolvedConfig } from '../config';

export function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Parse -H / --header CLI flags into a Record.
 * Accepts "Name: Value" or "Name:Value" format.
 */
export function parseHeaderFlags(flags: string[] | undefined): Record<string, string> {
  if (!flags || flags.length === 0) return {};
  const result: Record<string, string> = {};
  for (const raw of flags) {
    const idx = raw.indexOf(':');
    if (idx < 1) {
      console.error(`Warning: Ignoring malformed header "${raw}" — expected "Name: Value"`);
      continue;
    }
    const name = raw.slice(0, idx).trim();
    const value = raw.slice(idx + 1).trim();
    result[name] = value;
  }
  return result;
}

/**
 * Merge headers from config (global + per-domain) and CLI flags.
 * Precedence: device UA < config global < config domain < CLI flags.
 */
export function buildFetchHeaders(
  url: string,
  config: ResolvedConfig | undefined,
  cliHeaders: Record<string, string>,
): Record<string, string> {
  const domain = (() => { try { return new URL(url).hostname; } catch { return ''; } })();
  return {
    ...(config?.headers ?? {}),
    ...(domain && config?.domainHeaders?.[domain] ? config.domainHeaders[domain] : {}),
    ...cliHeaders,
  };
}
