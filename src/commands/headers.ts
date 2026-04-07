/**
 * SGNL CLI — headers command
 * Manage persistent custom HTTP headers for requests.
 */

import { Command } from 'commander';
import { loadConfig, saveConfig } from '../config';

const SENSITIVE_NAMES = new Set(['cookie', 'authorization', 'x-api-key', 'x-auth-token']);

function maskValue(name: string, value: string): string {
  if (SENSITIVE_NAMES.has(name.toLowerCase()) && value.length > 8) {
    return value.slice(0, 8) + '…';
  }
  return value;
}

export function registerHeadersCommand(program: Command): void {
  const headers = program
    .command('headers')
    .description('Manage custom HTTP headers for requests');

  // ── set ──────────────────────────────────────────────────────────────────
  headers
    .command('set <name> <value>')
    .description('Set a header (global or per-domain)')
    .option('--domain <hostname>', 'Apply header only to this domain')
    .action((name: string, value: string, opts: { domain?: string }) => {
      const config = loadConfig();
      if (opts.domain) {
        if (!config.domainHeaders) config.domainHeaders = {};
        if (!config.domainHeaders[opts.domain]) config.domainHeaders[opts.domain] = {};
        config.domainHeaders[opts.domain][name] = value;
        console.log(`Set ${name} for ${opts.domain}`);
      } else {
        if (!config.headers) config.headers = {};
        config.headers[name] = value;
        console.log(`Set global header ${name}`);
      }
      saveConfig(config);
    });

  // ── list ─────────────────────────────────────────────────────────────────
  headers
    .command('list')
    .description('List stored headers')
    .option('--domain <hostname>', 'Show only headers for this domain')
    .action((opts: { domain?: string }) => {
      const config = loadConfig();

      if (opts.domain) {
        const dh = (config.domainHeaders?.[opts.domain] ?? {}) as Record<string, string>;
        if (Object.keys(dh).length === 0) {
          console.log(`No headers stored for ${opts.domain}`);
          return;
        }
        console.log(`\nHeaders for ${opts.domain}:`);
        for (const [k, v] of Object.entries(dh)) {
          console.log(`  ${k}: ${maskValue(k, String(v))}`);
        }
      } else {
        const globalH = (config.headers ?? {}) as Record<string, string>;
        const domainH = (config.domainHeaders ?? {}) as Record<string, Record<string, string>>;
        const hasGlobal = Object.keys(globalH).length > 0;
        const hasDomain = Object.keys(domainH).length > 0;

        if (!hasGlobal && !hasDomain) {
          console.log('No headers stored. Use `sgnl headers set <name> <value>` to add one.');
          return;
        }

        if (hasGlobal) {
          console.log('\nGlobal headers:');
          for (const [k, v] of Object.entries(globalH)) {
            console.log(`  ${k}: ${maskValue(k, String(v))}`);
          }
        }

        if (hasDomain) {
          for (const [domain, hdrs] of Object.entries(domainH)) {
            if (Object.keys(hdrs).length === 0) continue;
            console.log(`\n${domain}:`);
            for (const [k, v] of Object.entries(hdrs)) {
              console.log(`  ${k}: ${maskValue(k, String(v))}`);
            }
          }
        }
      }
      console.log('');
    });

  // ── remove ───────────────────────────────────────────────────────────────
  headers
    .command('remove <name>')
    .description('Remove a header')
    .option('--domain <hostname>', 'Remove from this domain only')
    .action((name: string, opts: { domain?: string }) => {
      const config = loadConfig();
      if (opts.domain) {
        if (config.domainHeaders?.[opts.domain]) {
          delete config.domainHeaders[opts.domain][name];
          if (Object.keys(config.domainHeaders[opts.domain]).length === 0) {
            delete config.domainHeaders[opts.domain];
          }
          console.log(`Removed ${name} from ${opts.domain}`);
        } else {
          console.log(`No headers found for ${opts.domain}`);
          return;
        }
      } else {
        if (config.headers?.[name]) {
          delete config.headers[name];
          console.log(`Removed global header ${name}`);
        } else {
          console.log(`Global header ${name} not found`);
          return;
        }
      }
      saveConfig(config);
    });

  // ── clear ────────────────────────────────────────────────────────────────
  headers
    .command('clear')
    .description('Remove all stored headers')
    .action(() => {
      const config = loadConfig();
      delete config.headers;
      delete config.domainHeaders;
      saveConfig(config);
      console.log('All stored headers cleared.');
    });
}
