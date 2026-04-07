/**
 * SGNL CLI — robots command
 */

import * as fs from 'fs';
import * as path from 'path';
import { Command } from 'commander';
import { runPythonScriptSafe } from '../analysis/python';
import { createRunDir, RunReportData, buildRobotsCheckMd } from '../analysis/run-reporter';
import { annotateRedirectChain } from '../analysis/redirects';
import { isValidUrl, parseHeaderFlags, buildFetchHeaders } from './helpers';
import { resolveConfig } from '../config';
import { formatErrorForUser } from '../errors';
import { logger } from '../utils/logger';

type RequestMeta = {
  robots_url?: string;
  final_url?: string | null;
  status_code?: number;
  content_type?: string | null;
  content_length?: number | null;
  elapsed_ms?: number;
  redirect_chain?: string[];
};

function extractRequestMeta(data: Record<string, any>, url: string): RequestMeta {
  // Prefer the nested `request` block, fall back to top-level fields.
  const r = data.request ?? {};
  const origin = (() => {
    try { return new URL(url).origin; } catch { return ''; }
  })();
  return {
    robots_url: r.robots_url ?? data.robots_url ?? (origin ? `${origin}/robots.txt` : undefined),
    final_url: r.final_url ?? data.final_url ?? null,
    status_code: r.status_code ?? data.status_code,
    content_type: r.content_type ?? data.content_type ?? null,
    content_length: r.content_length ?? data.content_length ?? null,
    elapsed_ms: r.elapsed_ms ?? data.elapsed_ms,
    redirect_chain: Array.isArray(r.redirect_chain) ? r.redirect_chain
      : Array.isArray(data.redirect_chain) ? data.redirect_chain : [],
  };
}

function printRobotsTerminal(data: Record<string, any>, url: string): void {
  console.log(`\nRobots.txt — ${url}\n`);

  const req = extractRequestMeta(data, url);

  // --- Request section --------------------------------------------------
  if (req.robots_url || req.status_code != null) {
    console.log('  Request');
    if (req.robots_url) console.log(`    URL: ${req.robots_url}`);
    if (req.final_url && req.final_url !== req.robots_url) {
      console.log(`    Final URL: ${req.final_url}`);
    }
    if (req.status_code != null) console.log(`    Status: ${req.status_code}`);
    if (req.content_type) console.log(`    Content-Type: ${req.content_type}`);
    if (req.content_length != null) console.log(`    Size: ${req.content_length} bytes`);
    if (req.elapsed_ms != null) console.log(`    Elapsed: ${req.elapsed_ms} ms`);
    console.log('');
  }

  // --- Redirects section ------------------------------------------------
  const chain = req.redirect_chain ?? [];
  if (chain.length > 0 && req.robots_url) {
    const hops = annotateRedirectChain(req.robots_url, chain);
    console.log(`  Redirects (${hops.length} hop${hops.length === 1 ? '' : 's'})`);
    for (const h of hops) {
      const labelStr = h.labels.length > 0 ? `     [${h.labels.join(', ')}]` : '';
      console.log(`    ${h.index}. ${h.from} → ${h.to}${labelStr}`);
    }
    console.log('');
  }

  if (!data.fetched) {
    console.log(`  Status: Could not fetch robots.txt${data.error ? ` (${data.error})` : ''}\n`);
    return;
  }

  console.log(`  Path Disallowed: ${data.path_disallowed ? 'YES' : 'no'}${data.reason ? ` (${data.reason})` : ''}`);
  console.log(`  Crawl Delay: ${data.crawl_delay != null ? `${data.crawl_delay}s` : 'none'}`);

  // Site-wide block (relabelled from has_wildcard_disallow)
  const disallowRules: string[] = data.disallow_rules ?? [];
  const blocksEntireSite = data.has_wildcard_disallow === true && disallowRules.includes('/');
  if (blocksEntireSite) {
    console.log('  Blocks entire site: YES (Disallow: /)');
  } else if (data.has_wildcard_disallow) {
    console.log('  Wildcard rule present: yes');
  }

  if (data.conflict_with_meta) console.log('  Conflict: robots.txt vs meta robots tag');

  // Explicit "no rules for *" signal
  const perAgent = (data.per_agent_rules ?? {}) as Record<string, any>;
  const starBlock = perAgent['*'];
  if (data.fetched && (!starBlock || (!starBlock.disallow?.length && !starBlock.allow?.length))) {
    console.log('  No rules for User-agent: *');
  }

  // --- Sitemaps ---------------------------------------------------------
  const sitemaps: string[] = data.sitemaps ?? [];
  if (sitemaps.length > 0) {
    console.log(`\n  Sitemaps (${sitemaps.length}):`);
    for (const s of sitemaps) console.log(`    - ${s}`);
  } else {
    console.log('\n  Sitemaps: none found');
  }

  // --- Sitemap analyses (all, not just first) ---------------------------
  const analyses: any[] = Array.isArray(data.sitemap_analyses) ? data.sitemap_analyses
    : data.sitemap_analysis ? [data.sitemap_analysis] : [];
  if (analyses.length > 0) {
    console.log(`\n  Sitemap Analysis:`);
    for (const sa of analyses) {
      console.log(`    ${sa.url ?? '(no url)'}`);
      console.log(`      URLs: ${sa.url_count ?? 0}  |  Lastmod: ${sa.has_lastmod ? 'yes' : 'no'}  |  Is index: ${sa.is_index ? 'yes' : 'no'}${sa.discovered_via_fallback ? '  |  discovered via fallback' : ''}`);
      if (sa.is_index && sa.children_fetched != null) {
        console.log(`      Children fetched: ${sa.children_fetched}  |  URLs across children: ${sa.total_urls_across_children ?? 0}`);
      }
      if (sa.error) console.log(`      Error: ${sa.error}`);
    }
  }

  // --- Multi-agent verdict table ---------------------------------------
  const verdicts = (data.per_agent_verdict ?? {}) as Record<string, string>;
  if (Object.keys(verdicts).length > 0) {
    console.log('\n  Multi-agent Verdict');
    for (const [agent, v] of Object.entries(verdicts)) {
      const mark = v === 'disallowed' ? '✗' : '✓';
      console.log(`    ${mark} ${agent.padEnd(18)} ${v}`);
    }
  }

  // --- AI Bots ---------------------------------------------------------
  const ai = data.ai_bot_summary;
  if (ai && typeof ai === 'object') {
    console.log(`\n  AI Bots: ${ai.blocked_count}/${ai.total_checked} explicitly blocked`);
    if (Array.isArray(ai.blocked_agents) && ai.blocked_agents.length > 0) {
      console.log(`    Blocked: ${ai.blocked_agents.join(', ')}`);
    }
  }

  // --- Disallow rules --------------------------------------------------
  if (disallowRules.length > 0) {
    console.log(`\n  Disallow Rules (${disallowRules.length})`);
    for (const r of disallowRules.slice(0, 10)) console.log(`    ${r}`);
    if (disallowRules.length > 10) console.log(`    ... and ${disallowRules.length - 10} more`);
  }

  // --- Allow rules (previously dropped) --------------------------------
  const allowRules: string[] = data.allow_rules ?? [];
  if (allowRules.length > 0) {
    console.log(`\n  Allow Rules (${allowRules.length})`);
    for (const r of allowRules.slice(0, 10)) console.log(`    ${r}`);
    if (allowRules.length > 10) console.log(`    ... and ${allowRules.length - 10} more`);
  }

  // --- Validation warnings ---------------------------------------------
  const syntaxWarnings: string[] = data.syntax_warnings ?? [];
  const sizeExceeds = data.size_exceeds_google_limit === true;
  const ctNotPlain = data.content_type && data.content_type_is_text_plain === false;
  const crossOrigin = data.cross_origin_redirect === true;
  if (syntaxWarnings.length > 0 || sizeExceeds || ctNotPlain || crossOrigin) {
    console.log('\n  Validation');
    if (sizeExceeds) console.log(`    ! robots.txt exceeds Google's 500 KiB limit (${data.content_length} bytes)`);
    if (ctNotPlain) console.log(`    ! Content-Type is "${data.content_type}" (expected text/plain)`);
    if (crossOrigin) console.log('    ! robots.txt redirected cross-origin');
    for (const w of syntaxWarnings.slice(0, 10)) console.log(`    - ${w}`);
    if (syntaxWarnings.length > 10) console.log(`    ... and ${syntaxWarnings.length - 10} more`);
  }

  // --- Issues ----------------------------------------------------------
  const issues: string[] = data.issues ?? [];
  if (issues.length > 0) {
    console.log(`\n  Issues (${issues.length}):`);
    for (const i of issues) console.log(`    - ${i}`);
  }

  console.log('');
}

export function registerRobotsCommand(program: Command): void {
  program
    .command('robots <url>')
    .description('Analyze robots.txt: rules, sitemaps, multi-agent verdicts, AI bot blocking, validation')
    .option('--output <format>', 'Output format: terminal or json', 'terminal')
    .option('--save', 'Save robots_check.md and robots.json to runs/', false)
    .option('--timeout <ms>', 'Timeout per analysis step in ms', '30000')
    .option('--meta-blocked', 'Mark the page as blocked by meta robots (enables conflict check)', false)
    .option('-H, --header <header...>', 'Custom HTTP header(s) in "Name: Value" format')
    .action(async (
      url: string,
      options: { output: string; save: boolean; timeout: string; metaBlocked: boolean; header?: string[] },
    ) => {
      if (!isValidUrl(url)) {
        console.error(`Error: Invalid URL "${url}". Must start with http:// or https://`);
        process.exit(2);
      }

      try {
        logger.info(`Checking robots.txt for ${url}...`);
        const timeoutMs = parseInt(options.timeout, 10);
        const config = resolveConfig();
        const headers = buildFetchHeaders(url, config, parseHeaderFlags(options.header));
        const result = await runPythonScriptSafe('robots_check.py', JSON.stringify({
          url,
          meta_robots_blocked: options.metaBlocked === true,
          timeout_ms: timeoutMs,
          headers,
        }), timeoutMs);

        if (!result.success || !result.data) {
          console.error(`Error: Robots check failed${result.error ? `: ${result.error}` : ''}`);
          process.exit(1);
        }

        const data = result.data as Record<string, any>;
        const request = extractRequestMeta(data, url);

        if (options.save) {
          try {
            const runDir = createRunDir(url, 'robots');
            const reportData: RunReportData = { url, statusCode: 200, headers: {}, html: '', rawRobotsCheck: data };
            fs.writeFileSync(path.join(runDir, 'robots_check.md'), buildRobotsCheckMd(reportData));
            const envelope = { request, robots: data };
            fs.writeFileSync(path.join(runDir, 'robots.json'), JSON.stringify(envelope, null, 2));
            logger.info(`Saved to: ${runDir}`);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.warn(`Failed to save robots report: ${msg}`);
          }
        }

        if (options.output === 'json') {
          const envelope = { request, robots: data };
          process.stdout.write(JSON.stringify(envelope, null, 2) + '\n', () => process.exit(0));
        } else {
          printRobotsTerminal(data, url);
          process.exit(0);
        }
      } catch (err: unknown) {
        console.error(formatErrorForUser(err, options.output));
        process.exit(1);
      }
    });
}
