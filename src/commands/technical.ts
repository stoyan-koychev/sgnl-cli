/**
 * SGNL CLI — technical command
 */

import * as fs from 'fs';
import * as path from 'path';
import { Command } from 'commander';
import { safeFetch } from '../analysis/fetch';
import { runPythonScriptSafe } from '../analysis/python';
import { createRunDir, RunReportData, buildTechSeoMd } from '../analysis/run-reporter';
import { annotateRedirectChain } from '../analysis/redirects';
import { isValidUrl, parseHeaderFlags, buildFetchHeaders } from './helpers';
import { resolveConfig } from '../config';
import { formatErrorForUser } from '../errors';
import { logger } from '../utils/logger';

function printTechnicalTerminal(
  data: Record<string, any>,
  url: string,
  fetchContext?: { status?: number; ttfb_ms?: number; compression?: string; cdnDetected?: string; redirect_chain?: string[] },
): void {
  console.log(`\nTechnical SEO — ${url}\n`);

  // Request (Phase 2c)
  if (fetchContext) {
    const reqLines: string[] = [];
    if (fetchContext.status != null) reqLines.push(`    Status: ${fetchContext.status}`);
    if (fetchContext.ttfb_ms != null) reqLines.push(`    TTFB: ${Math.round(fetchContext.ttfb_ms)} ms`);
    if (fetchContext.compression) reqLines.push(`    Compression: ${fetchContext.compression}`);
    if (fetchContext.cdnDetected) reqLines.push(`    CDN: ${fetchContext.cdnDetected}`);
    if (reqLines.length > 0) {
      console.log('  Request');
      for (const l of reqLines) console.log(l);
      console.log('');
    }

    // Redirects (Phase 2d)
    const chain = fetchContext.redirect_chain ?? [];
    if (chain.length > 0) {
      const hops = annotateRedirectChain(url, chain);
      console.log(`  Redirects (${hops.length} hop${hops.length === 1 ? '' : 's'})`);
      for (const h of hops) {
        const labelStr = h.labels.length > 0 ? `     [${h.labels.join(', ')}]` : '';
        console.log(`    ${h.index}. ${h.from} → ${h.to}${labelStr}`);
      }
      if (hops.length > 1) {
        console.log(`    ! long chain (${hops.length} hops) — consider consolidating`);
      }
      console.log('');
    }
  }

  // Meta tags
  const meta = data.meta ?? {};
  console.log('  Meta Tags');
  if (meta.title) console.log(`    Title: ${meta.title.content || '(none)'}  (${meta.title.length ?? 0} chars, ${meta.title.status ?? 'n/a'})`);
  if (meta.description) console.log(`    Description: ${(meta.description.content || '(none)').substring(0, 80)}${(meta.description.content?.length ?? 0) > 80 ? '...' : ''}  (${meta.description.length ?? 0} chars)`);
  if (meta.robots) console.log(`    Robots: ${meta.robots.content || 'index, follow'}`);
  console.log(`    Charset: ${meta.charset?.present ? 'yes' : 'no'}  |  Viewport: ${meta.viewport?.present ? 'yes' : 'no'}`);

  // Canonical
  const canonical = data.canonical ?? {};
  const selfRef = canonical.self_referencing === true
    ? ' (self-referencing)'
    : canonical.self_referencing === false
      ? ' (points elsewhere)'
      : '';
  console.log(`\n  Canonical: ${canonical.present ? (canonical.href || '(present, no href)') + selfRef : 'MISSING'}  (${canonical.status ?? 'n/a'})`);

  // Open Graph
  const og = data.open_graph ?? {};
  const ogPresent = ['title', 'description', 'image', 'url'].filter(k => og[k]);
  console.log(`\n  Open Graph: ${ogPresent.length}/4 tags present (${ogPresent.join(', ') || 'none'})`);
  // Phase 1h — article timestamps
  if (og.published_time) console.log(`    Published: ${og.published_time}`);
  if (og.modified_time) console.log(`    Modified: ${og.modified_time}`);
  if (og.updated_time) console.log(`    Updated: ${og.updated_time}`);

  // Twitter Card
  const tc = og.twitter_card ?? {};
  console.log(`  Twitter Card: ${tc.present ? `${tc.card_type || 'present'}` : 'not found'}`);

  // Indexability
  const idx = data.indexability ?? {};
  console.log(`\n  Indexability: ${idx.blocked ? 'BLOCKED' : 'indexable'}${idx.signals?.length ? ` (${idx.signals.join(', ')})` : ''}`);
  // Phase 1i — conflicts
  if (idx.conflicts?.length) console.log(`    Conflicts: ${idx.conflicts.join(', ')}`);

  // Security Headers (Phase 1c — expanded)
  const sec = data.security_headers ?? {};
  const total = (sec.count ?? 0) + (sec.missing?.length ?? 0);
  console.log(`\n  Security Headers: ${sec.grade ?? 'n/a'} (${sec.count ?? 0}/${total || 6})`);
  if (sec.present?.length) console.log(`    Present: ${sec.present.join(', ')}`);
  if (sec.missing?.length) console.log(`    Missing: ${sec.missing.join(', ')}`);
  const details = (sec.details ?? {}) as Record<string, string>;
  const hsts = details['HSTS'];
  const csp = details['CSP'];
  const xfo = details['X-Frame-Options'];
  const refPol = details['Referrer-Policy'];
  if (hsts) console.log(`    HSTS: ${hsts}`);
  if (csp) console.log(`    CSP: present`);
  if (xfo) console.log(`    X-Frame-Options: ${xfo}`);
  if (refPol) console.log(`    Referrer-Policy: ${refPol}`);

  // Links (Phase 1a)
  const lnk = data.links ?? {};
  if (lnk.internal_total != null || lnk.external_total != null) {
    console.log('\n  Links');
    console.log(`    Internal: ${lnk.internal_total ?? 0} total (${lnk.internal_generic_anchor ?? 0} generic-anchor)`);
    console.log(`    External: ${lnk.external_total ?? 0} total (${lnk.external_broken ?? 0} broken)`);
  }

  // Caching (Phase 1f — expanded)
  const caching = data.caching ?? {};
  if (caching.has_cache_control != null) {
    console.log(`\n  Caching: ${caching.is_cacheable ? 'cacheable' : 'not cacheable'}${caching.max_age_seconds != null ? ` (max-age: ${caching.max_age_seconds}s)` : ''}`);
    if (caching.cache_control) console.log(`    Cache-Control: ${caching.cache_control}`);
    console.log(`    ETag: ${caching.has_etag ? 'yes' : 'no'}  |  Last-Modified: ${caching.has_last_modified ? 'yes' : 'no'}`);
    const cachingIssues: string[] = caching.issues ?? [];
    if (cachingIssues.length > 0) {
      console.log(`    Issues: ${cachingIssues.join('; ')}`);
    } else {
      console.log('    Issues: (none)');
    }
  }

  // Resource Hints (Phase 1e — expanded)
  const rh = data.resource_hints ?? {};
  if (rh.preload_count || rh.dns_prefetch_count || rh.preconnect_count) {
    console.log(`\n  Resource Hints: preload=${rh.preload_count ?? 0}, dns-prefetch=${rh.dns_prefetch_count ?? 0}, preconnect=${rh.preconnect_count ?? 0}`);
    const preloads: Array<{ href: string; as: string }> = rh.preload ?? [];
    if (preloads.length > 0) {
      console.log('    Preloads:');
      for (const p of preloads.slice(0, 5)) console.log(`      - ${p.href}${p.as ? ` [as=${p.as}]` : ''}`);
    }
    const preconnects: string[] = rh.preconnect ?? [];
    if (preconnects.length > 0) {
      console.log('    Preconnect:');
      for (const d of preconnects.slice(0, 5)) console.log(`      - ${d}`);
    }
    const dnsPrefetch: string[] = rh.dns_prefetch ?? [];
    if (dnsPrefetch.length > 0) {
      console.log('    DNS-Prefetch:');
      for (const d of dnsPrefetch.slice(0, 5)) console.log(`      - ${d}`);
    }
  }

  // URL Structure (Phase 1g — expanded)
  const us = data.url_structure ?? {};
  if (us.length != null) {
    const urlIssues: string[] = us.issues ?? [];
    console.log(`\n  URL Structure: ${us.length} chars, ${us.keyword_segments ?? 0}/${us.total_segments ?? 0} keyword segments`);
    const flags: string[] = [];
    if (us.has_trailing_slash) flags.push('trailing slash');
    if (us.has_uppercase) flags.push('uppercase');
    if (us.has_special_chars) flags.push('special chars');
    if (us.has_double_slashes) flags.push('double slashes');
    if (flags.length > 0) console.log(`    Flags: ${flags.join(', ')}`);
    if (urlIssues.length) {
      for (const i of urlIssues) console.log(`    - ${i}`);
    }
  }

  // Hreflang (Phase 1d — expanded)
  const hreflang = data.hreflang ?? {};
  if (hreflang.present) {
    console.log(`\n  Hreflang: ${hreflang.count} language(s)${hreflang.has_x_default ? ' (x-default present)' : ' (missing x-default)'}`);
    const langs: Array<{ lang: string; href: string }> = hreflang.languages ?? [];
    for (const l of langs) {
      console.log(`    ${l.lang} → ${l.href}`);
    }
    if (hreflang.issues?.length) console.log(`    Issues: ${hreflang.issues.join(', ')}`);
  }

  // Pagination & AMP (Phase 1b)
  const pa = data.pagination_amp ?? {};
  if (pa.is_paginated || pa.is_amp) {
    console.log('\n  Pagination & AMP');
    if (pa.has_prev) console.log(`    rel=prev: ${pa.prev_href ?? '(present)'}`);
    if (pa.has_next) console.log(`    rel=next: ${pa.next_href ?? '(present)'}`);
    if (pa.is_amp) {
      if (pa.amp_link_present) console.log('    AMP: linked (<link rel=amphtml>)');
      else if (pa.amp_html) console.log('    AMP: amp attribute on <html>');
    }
  }

  console.log('');
}

export function registerTechnicalCommand(program: Command): void {
  program
    .command('technical <url>')
    .description('Analyze technical SEO: meta tags, canonical, OG, indexability, security, caching')
    .option('--output <format>', 'Output format: terminal or json', 'terminal')
    .option('--device <type>', 'Device to emulate: mobile or desktop', 'mobile')
    .option('--save', 'Save technical_seo.md to runs/ directory', false)
    .option('--timeout <ms>', 'Timeout per analysis step in ms', '30000')
    .option('-H, --header <header...>', 'Custom HTTP header(s) in "Name: Value" format')
    .action(async (url: string, options: { output: string; device: string; save: boolean; timeout: string; header?: string[] }) => {
      if (!isValidUrl(url)) {
        console.error(`Error: Invalid URL "${url}". Must start with http:// or https://`);
        process.exit(2);
      }

      try {
        logger.info(`Fetching ${url}...`);
        const config = resolveConfig();
        const headers = buildFetchHeaders(url, config, parseHeaderFlags(options.header));
        const fetchResult = await safeFetch(url, { device: options.device as 'mobile' | 'desktop', timeout: parseInt(options.timeout, 10), headers });

        if (!fetchResult.html) {
          console.error(`Error: No HTML received (HTTP ${fetchResult.status})`);
          process.exit(1);
        }

        logger.info('Analyzing technical SEO...');
        const result = await runPythonScriptSafe('technical_seo.py', JSON.stringify({
          html: fetchResult.html,
          headers: fetchResult.headers,
          url,
        }), parseInt(options.timeout, 10));

        if (!result.success || !result.data) {
          console.error(`Error: Technical SEO analysis failed${result.error ? `: ${result.error}` : ''}`);
          process.exit(1);
        }

        const fetchContext = {
          status: fetchResult.status,
          ttfb_ms: fetchResult.ttfb_ms,
          compression: fetchResult.compression,
          cdnDetected: fetchResult.cdnDetected,
          redirect_chain: fetchResult.redirect_chain,
        };

        if (options.save) {
          try {
            const runDir = createRunDir(url, 'technical');
            const reportData: RunReportData = {
              url,
              statusCode: fetchResult.status,
              ttfb_ms: fetchResult.ttfb_ms,
              compression: fetchResult.compression,
              cdnDetected: fetchResult.cdnDetected,
              redirect_chain: fetchResult.redirect_chain,
              headers: fetchResult.headers as Record<string, string>,
              html: fetchResult.html,
              rawTechSeo: result.data,
            };
            fs.writeFileSync(path.join(runDir, 'technical_seo.md'), buildTechSeoMd(reportData));
            logger.info(`Saved to: ${runDir}`);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.warn(`Failed to save technical report: ${msg}`);
          }
        }

        if (options.output === 'json') {
          // Wrap Python technical output with fetch context so consumers see status/ttfb/redirects.
          const wrapped = { request: fetchContext, technical: result.data };
          process.stdout.write(JSON.stringify(wrapped, null, 2) + '\n', () => process.exit(0));
        } else {
          printTechnicalTerminal(result.data, url, fetchContext);
          process.exit(0);
        }
      } catch (err: unknown) {
        console.error(formatErrorForUser(err, options.output));
        process.exit(1);
      }
    });
}
