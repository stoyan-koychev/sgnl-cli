/**
 * SGNL CLI — explorer command group
 *
 * sgnl explorer crawl <url>     — Crawl and generate visualization
 * sgnl explorer inspect <url>   — Show node details
 * sgnl explorer links <url>     — Show in/out links for a page
 * sgnl explorer list-issues     — List pages with issues
 * sgnl explorer top-pages       — Top pages by PageRank
 * sgnl explorer clusters        — List content clusters
 * sgnl explorer cluster <seg>   — Pages in a cluster
 * sgnl explorer depth-map       — Pages by crawl depth
 * sgnl explorer external        — Top external domains
 * sgnl explorer unranked        — Pages not ranking in GSC
 */

import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import { Command } from 'commander';
import { Explorer } from '../explorer/crawler';
import { runGraphAnalysis, PythonNotInstalledError } from '../analysis/python';
import { loadConfig, resolveConfig } from '../config';
import { getAccessToken } from '../auth/google-oauth';
import { fetchAllRankedPages, resolveGSCProperty } from '../analysis/gsc';
import { findLatestRun, loadRun, resolveDomain } from '../explorer/query';
import type { LoadedRun } from '../explorer/query';
import { isValidUrl, parseHeaderFlags, buildFetchHeaders } from './helpers';
import { formatErrorForUser } from '../errors';

// ── Shared: resolve run from --run-dir or --domain ─────────────────────────

function resolveRun(opts: { runDir?: string; domain?: string }): LoadedRun {
  let runPath: string | null = null;

  if (opts.runDir) {
    runPath = findLatestRun('', opts.runDir);
  } else if (opts.domain) {
    const domain = resolveDomain(opts.domain);
    runPath = findLatestRun(domain);
  } else {
    // Try to find any latest run
    const { runsPath } = loadConfig();
    const base = runsPath ?? path.join(process.cwd(), 'runs');
    if (fs.existsSync(base)) {
      const domains = fs.readdirSync(base).filter(d =>
        fs.statSync(path.join(base, d)).isDirectory()
      );
      // Pick the domain with the most recent run
      let latest: { path: string; time: number } | null = null;
      for (const d of domains) {
        const dPath = path.join(base, d);
        const runs = fs.readdirSync(dPath)
          .filter(r => fs.statSync(path.join(dPath, r)).isDirectory())
          .sort().reverse();
        for (const r of runs) {
          const candidate = path.join(dPath, r);
          if (fs.existsSync(path.join(candidate, 'compact.json'))) {
            const stat = fs.statSync(path.join(candidate, 'compact.json'));
            if (!latest || stat.mtimeMs > latest.time) {
              latest = { path: candidate, time: stat.mtimeMs };
            }
            break;
          }
        }
      }
      runPath = latest?.path ?? null;
    }
  }

  if (!runPath) {
    console.error('Error: No explorer run found. Run `sgnl explorer crawl <url>` first.');
    if (opts.domain) console.error(`  Searched for domain: ${opts.domain}`);
    process.exit(1);
  }

  return loadRun(runPath);
}

const QUERY_OPTS = (cmd: Command) => cmd
  .option('--run-dir <path>', 'Path to a specific run directory')
  .option('--domain <domain>', 'Domain to find the latest run for')
  .option('--json', 'Output as JSON', false);

// ── Register ────────────────────────────────────────────────────────────────

export function registerExplorerCommand(program: Command): void {
  const explorer = program
    .command('explorer')
    .description('Crawl a site, visualize structure, and query data');

  // ── sgnl explorer crawl <url> ──────────────────────────────────────────

  explorer
    .command('crawl <url>')
    .description('Crawl a site and generate an interactive link map visualization')
    .option('--max-pages <number>', 'Maximum pages to crawl (auto from sitemap, or 300)')
    .option('--delay <ms>', 'Delay between requests in ms', '500')
    .option('--depth <number>', 'Maximum crawl depth', '10')
    .option('--quiet', 'Suppress progress output', false)
    .option('--sitemap-url <url>', 'Sitemap URL to use directly (skips robots.txt discovery)')
    .option('--page-stats', 'Run Python content analysis per page (slower)', false)
    .option('--crawl-sitemap', 'Seed crawl queue from sitemap — crawls all sitemap pages (requires sitemap to be reachable)', false)
    .option('--exclude-el <selectors>', 'Comma-separated CSS tag selectors to exclude links from (e.g. "header>nav,footer>nav")')
    .option('--googlebot', 'Simulate Googlebot: use mobile UA + respect robots.txt Disallow/Crawl-delay', false)
    .option('-H, --header <header...>', 'Custom HTTP header(s) in "Name: Value" format')
    .action(crawlAction);

  // ── sgnl explorer inspect <url> ────────────────────────────────────────

  QUERY_OPTS(explorer.command('inspect <url>'))
    .description('Show all data for a specific page node')
    .action((url: string, opts: any) => {
      const run = resolveRun(opts);
      const node = run.nodeByUrl.get(url) || run.nodeByUrl.get(url.replace(/\/$/, '')) || run.nodeByUrl.get(url + '/');
      if (!node) {
        console.error(`Node not found: ${url}`);
        const similar = run.nodes.filter(n => n.url.includes(url.replace(/https?:\/\/[^/]+/, ''))).slice(0, 5);
        if (similar.length) {
          console.error('Did you mean:');
          similar.forEach(n => console.error(`  ${n.url}`));
        }
        process.exit(1);
      }
      if (opts.json) {
        console.log(JSON.stringify(node, null, 2));
      } else {
        const seg = [...(new Map<string, number>(run.compact.segMap || []).entries())]
          .find(([, v]) => v === node.communityId)?.[0];
        console.log(`URL:          ${node.url}`);
        console.log(`Title:        ${node.label}`);
        console.log(`Status:       ${node.status}`);
        console.log(`Type:         ${node.type}`);
        console.log(`Inlinks:      ${node.inlinks}`);
        console.log(`Outlinks:     ${node.outlinks}`);
        console.log(`External:     ${node.outExternal}`);
        console.log(`Crawl Depth:  ${node.crawlDepth}`);
        console.log(`Link Depth:   ${node.linkDepth}`);
        console.log(`PageRank:     ${node.pageRank.toFixed(4)}`);
        console.log(`Indexable:    ${node.indexable ? 'Yes' : 'No'}`);
        console.log(`In Sitemap:   ${node.inSitemap ? 'Yes' : 'No'}`);
        console.log(`Dead End:     ${node.isDeadEnd ? 'Yes' : 'No'}`);
        if (node.h1) console.log(`H1:           ${node.h1}`);
        if (node.canonical) console.log(`Canonical:    ${node.canonical}`);
        if (node.metaRobots) console.log(`Robots:       ${node.metaRobots}`);
        if (node.gscPosition !== null) console.log(`GSC Position: ${node.gscPosition.toFixed(1)}`);
        if (seg) console.log(`Cluster:      /${seg} (#${node.communityId})`);
      }
    });

  // ── sgnl explorer links <url> ──────────────────────────────────────────

  QUERY_OPTS(explorer.command('links <url>'))
    .description('Show inbound and outbound links for a page')
    .action((url: string, opts: any) => {
      const run = resolveRun(opts);
      const outgoing = run.edges.filter(e => e.source === url);
      const incoming = run.edges.filter(e => e.target === url);

      if (opts.json) {
        console.log(JSON.stringify({ outgoing, incoming }, null, 2));
      } else {
        console.log(`\nOutgoing (${outgoing.length}):`);
        for (const e of outgoing) {
          console.log(`  → ${e.target}${e.follow ? '' : ' (nofollow)'}`);
        }
        console.log(`\nIncoming (${incoming.length}):`);
        for (const e of incoming) {
          console.log(`  ← ${e.source}${e.follow ? '' : ' (nofollow)'}`);
        }
      }
    });

  // ── sgnl explorer list-issues ──────────────────────────────────────────

  QUERY_OPTS(explorer.command('list-issues'))
    .description('List pages with issues (orphans, dead-ends, errors, etc.)')
    .option('--type <type>', 'Filter: orphans, dead-ends, deep, errors, no-sitemap, external')
    .action((opts: any) => {
      const run = resolveRun(opts);
      const URLS = run.compact.urls;
      const meta = run.compact.meta;

      const sections: { title: string; key: string; ids: number[] }[] = [
        { title: 'Orphan Pages', key: 'orphans', ids: meta.orphans || [] },
        { title: 'Dead Ends', key: 'dead-ends', ids: meta.deadEnds || [] },
        { title: 'Deep Pages (>3 clicks)', key: 'deep', ids: meta.deepPages || [] },
        { title: '4xx Errors', key: 'errors', ids: meta.errors4xx || [] },
        { title: '5xx Errors', key: 'errors', ids: meta.errors5xx || [] },
        { title: 'Not in Sitemap', key: 'no-sitemap', ids: meta.notInSitemap || [] },
        { title: 'Too Many External Links', key: 'external', ids: meta.tooManyExternal || [] },
      ];

      const filtered = opts.type
        ? sections.filter(s => s.key === opts.type)
        : sections;

      if (opts.json) {
        const result: Record<string, string[]> = {};
        for (const s of filtered) {
          result[s.title] = s.ids.map(i => URLS[i]);
        }
        console.log(JSON.stringify(result, null, 2));
      } else {
        for (const s of filtered) {
          if (s.ids.length === 0) continue;
          console.log(`\n${s.title} (${s.ids.length}):`);
          for (const idx of s.ids) {
            console.log(`  ${URLS[idx]}`);
          }
        }
      }
    });

  // ── sgnl explorer top-pages ────────────────────────────────────────────

  QUERY_OPTS(explorer.command('top-pages'))
    .description('Top pages by PageRank (internal authority)')
    .option('-l, --limit <number>', 'Number of pages to show', '10')
    .action((opts: any) => {
      const run = resolveRun(opts);
      const limit = parseInt(opts.limit, 10) || 10;
      const sorted = run.nodes
        .filter(n => n.type !== 'external')
        .sort((a, b) => b.pageRank - a.pageRank)
        .slice(0, limit);

      if (opts.json) {
        console.log(JSON.stringify(sorted.map(n => ({
          url: n.url, pageRank: n.pageRank, inlinks: n.inlinks, outlinks: n.outlinks,
        })), null, 2));
      } else {
        console.log(`\n#   PageRank  Inlinks  URL`);
        console.log('─'.repeat(70));
        sorted.forEach((n, i) => {
          console.log(`${String(i + 1).padStart(3)}   ${n.pageRank.toFixed(4).padStart(8)}  ${String(n.inlinks).padStart(7)}  ${n.url}`);
        });
      }
    });

  // ── sgnl explorer clusters ─────────────────────────────────────────────

  QUERY_OPTS(explorer.command('clusters'))
    .description('List content clusters with page counts')
    .action((opts: any) => {
      const run = resolveRun(opts);
      const segMap = new Map<string, number>(run.compact.segMap || []);
      const counts = new Map<number, number>();
      for (const n of run.nodes) {
        if (n.type === 'external') continue;
        counts.set(n.communityId, (counts.get(n.communityId) || 0) + 1);
      }
      const entries = [...counts.entries()]
        .filter(([, c]) => c >= 2)
        .sort((a, b) => b[1] - a[1]);

      if (opts.json) {
        console.log(JSON.stringify(entries.map(([cid, count]) => {
          const seg = [...segMap.entries()].find(([, v]) => v === cid)?.[0] ?? `#${cid}`;
          return { segment: `/${seg}`, communityId: cid, pages: count };
        }), null, 2));
      } else {
        console.log(`\n#   Segment              Pages`);
        console.log('─'.repeat(45));
        entries.forEach(([cid, count], i) => {
          const seg = [...segMap.entries()].find(([, v]) => v === cid)?.[0] ?? `#${cid}`;
          console.log(`${String(i + 1).padStart(3)}   /${seg.padEnd(20)} ${String(count).padStart(5)}`);
        });
      }
    });

  // ── sgnl explorer cluster <segment> ────────────────────────────────────

  QUERY_OPTS(explorer.command('cluster <segment>'))
    .description('List pages in a specific cluster')
    .action((segment: string, opts: any) => {
      const run = resolveRun(opts);
      const segMap = new Map<string, number>(run.compact.segMap || []);
      const cleanSeg = segment.replace(/^\//, '');
      const cid = segMap.get(cleanSeg);

      if (cid === undefined) {
        console.error(`Cluster not found: ${segment}`);
        console.error('Available clusters:');
        for (const [s] of segMap) console.error(`  /${s}`);
        process.exit(1);
      }

      const pages = run.nodes
        .filter(n => n.communityId === cid && n.type !== 'external')
        .sort((a, b) => b.pageRank - a.pageRank);

      if (opts.json) {
        console.log(JSON.stringify(pages.map(n => ({
          url: n.url, pageRank: n.pageRank, inlinks: n.inlinks, outlinks: n.outlinks,
        })), null, 2));
      } else {
        console.log(`\nCluster: /${cleanSeg} (${pages.length} pages)`);
        for (const n of pages) {
          console.log(`  ${n.url}   PR:${n.pageRank.toFixed(4)}  In:${n.inlinks}  Out:${n.outlinks}`);
        }
      }
    });

  // ── sgnl explorer depth-map ────────────────────────────────────────────

  QUERY_OPTS(explorer.command('depth-map'))
    .description('Pages grouped by crawl depth')
    .action((opts: any) => {
      const run = resolveRun(opts);
      const byDepth = new Map<number, string[]>();
      for (const n of run.nodes) {
        if (n.type === 'external') continue;
        const arr = byDepth.get(n.crawlDepth) || [];
        arr.push(n.url);
        byDepth.set(n.crawlDepth, arr);
      }

      if (opts.json) {
        const result: Record<string, string[]> = {};
        for (const [d, urls] of [...byDepth.entries()].sort((a, b) => a[0] - b[0])) {
          result[`depth_${d}`] = urls;
        }
        console.log(JSON.stringify(result, null, 2));
      } else {
        for (const [d, urls] of [...byDepth.entries()].sort((a, b) => a[0] - b[0])) {
          console.log(`\nDepth ${d} (${urls.length} pages):`);
          for (const u of urls.slice(0, 30)) console.log(`  ${u}`);
          if (urls.length > 30) console.log(`  ... and ${urls.length - 30} more`);
        }
      }
    });

  // ── sgnl explorer external ─────────────────────────────────────────────

  QUERY_OPTS(explorer.command('external'))
    .description('Top external domains and pages linking to them')
    .option('-l, --limit <number>', 'Number of domains to show', '10')
    .action((opts: any) => {
      const run = resolveRun(opts);
      const limit = parseInt(opts.limit, 10) || 10;

      // Build domain → source pages map from edges to external nodes
      const extEdges = run.edges.filter(e => {
        const tgt = run.nodeByUrl.get(e.target);
        return tgt && tgt.type === 'external';
      });

      const domainMap = new Map<string, Set<string>>();
      for (const e of extEdges) {
        try {
          const domain = new URL(e.target.replace('ext:', '')).hostname;
          if (!domainMap.has(domain)) domainMap.set(domain, new Set());
          domainMap.get(domain)!.add(e.source);
        } catch { /* skip malformed */ }
      }

      const sorted = [...domainMap.entries()]
        .map(([domain, sources]) => ({ domain, links: sources.size, sources: [...sources] }))
        .sort((a, b) => b.links - a.links)
        .slice(0, limit);

      if (opts.json) {
        console.log(JSON.stringify(sorted, null, 2));
      } else {
        console.log(`\n#   Domain                     Links  Pages linking out`);
        console.log('─'.repeat(70));
        sorted.forEach((d, i) => {
          const pages = d.sources.slice(0, 3).map(u => {
            try { return new URL(u).pathname; } catch { return u; }
          }).join(', ');
          const more = d.sources.length > 3 ? ` +${d.sources.length - 3}` : '';
          console.log(`${String(i + 1).padStart(3)}   ${d.domain.padEnd(28)} ${String(d.links).padStart(5)}  ${pages}${more}`);
        });
      }
    });

  // ── sgnl explorer unranked ─────────────────────────────────────────────

  QUERY_OPTS(explorer.command('unranked'))
    .description('Pages not ranking in GSC (requires GSC data)')
    .action((opts: any) => {
      const run = resolveRun(opts);
      const hasGSC = run.nodes.some(n => n.gscPosition !== null);

      if (!hasGSC) {
        console.error('No GSC data found in this run. Authenticate with `sgnl gsc login` and re-crawl.');
        process.exit(1);
      }

      const unranked = run.nodes
        .filter(n => n.type !== 'external' && n.gscPosition === null)
        .sort((a, b) => b.inlinks - a.inlinks);

      const rankedOrphans = run.nodes
        .filter(n => n.gscPosition !== null && n.inlinks === 0);

      const rankedDeep = run.nodes
        .filter(n => n.gscPosition !== null && n.crawlDepth > 3);

      if (opts.json) {
        console.log(JSON.stringify({
          unranked: unranked.map(n => ({ url: n.url, inlinks: n.inlinks, crawlDepth: n.crawlDepth })),
          rankedButOrphaned: rankedOrphans.map(n => ({ url: n.url, position: n.gscPosition })),
          rankedButDeep: rankedDeep.map(n => ({ url: n.url, position: n.gscPosition, crawlDepth: n.crawlDepth })),
        }, null, 2));
      } else {
        console.log(`\nNot Ranked (${unranked.length} pages):`);
        for (const n of unranked.slice(0, 30)) {
          console.log(`  ${n.url}    Inlinks:${n.inlinks}  Depth:${n.crawlDepth}`);
        }
        if (unranked.length > 30) console.log(`  ... and ${unranked.length - 30} more`);

        if (rankedOrphans.length > 0) {
          console.log(`\nRanked but Orphaned — add internal links! (${rankedOrphans.length}):`);
          for (const n of rankedOrphans.slice(0, 15)) {
            console.log(`  ${n.url}    Pos:${n.gscPosition!.toFixed(1)}`);
          }
        }

        if (rankedDeep.length > 0) {
          console.log(`\nRanked but Deep (>3 clicks) — flatten! (${rankedDeep.length}):`);
          for (const n of rankedDeep.slice(0, 15)) {
            console.log(`  ${n.url}    Pos:${n.gscPosition!.toFixed(1)}  Depth:${n.crawlDepth}`);
          }
        }
      }
    });
}

// ── Crawl action (extracted from original) ──────────────────────────────────

async function crawlAction(rawUrl: string, options: {
  maxPages?: string; delay?: string; depth: string; output: string;
  quiet: boolean; sitemapUrl?: string; pageStats: boolean;
  crawlSitemap: boolean; excludeEl?: string; googlebot: boolean;
  header?: string[];
}) {
  let url = rawUrl;
  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url}`;
  }

  if (!isValidUrl(url)) {
    console.error(`Error: Invalid URL "${rawUrl}". Must be a valid http/https URL.`);
    process.exit(2);
  }

  const maxPages = options.maxPages ? Math.max(1, parseInt(options.maxPages, 10) || 300) : undefined;
  const delayExplicit = options.delay !== undefined;
  const delay    = Math.max(0, parseInt(options.delay ?? '500', 10) || 500);
  const maxDepth = Math.max(1, parseInt(options.depth, 10) || 10);
  const excludeSelectors = options.excludeEl
    ? options.excludeEl.split(',').map((s: string) => s.trim()).filter(Boolean)
    : [];

  if (!options.quiet) {
    console.log(`\nLink Explorer — ${url}`);
    console.log(`Settings: max-pages=${maxPages ?? 'auto (sitemap size)'}, delay=${delay}ms, depth=${maxDepth}\n`);
    if (excludeSelectors.length) {
      console.log(`  Excluding links from: ${excludeSelectors.join(', ')}`);
    }
  }

  try {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const timestamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}`;
    const hostname  = new URL(url).hostname.replace(/\./g, '_');
    const resolvedConfig = resolveConfig();
    const { runsPath } = resolvedConfig;
    const base         = runsPath ?? path.join(process.cwd(), 'runs');
    const runDir       = path.join(base, hostname, timestamp);
    fs.mkdirSync(runDir, { recursive: true });
    const crawlFile    = path.join(runDir, 'crawl.jsonl');
    const metadataFile = path.join(runDir, 'metadata.json');
    const compactFile  = path.join(runDir, 'compact.json');

    const headers = buildFetchHeaders(url, resolvedConfig, parseHeaderFlags(options.header));

    // Phase 1: Crawl → crawl.jsonl

    const explorer = new Explorer(url, {
      maxPages, delay, maxDepth, sitemapUrl: options.sitemapUrl,
      storeHtml: false, crawlSitemap: options.crawlSitemap,
      excludeSelectors, outputFile: crawlFile,
      googlebot: options.googlebot,
      delayExplicit,
      headers,
    });

    if (!options.quiet) {
      process.stderr.write(options.sitemapUrl
        ? `  Using provided sitemap: ${options.sitemapUrl}\n`
        : '  Fetching robots.txt and sitemap…\n');
      if (options.crawlSitemap) {
        process.stderr.write('  Sitemap-driven crawl: all sitemap URLs will be queued.\n');
      }
    }

    const onProgress = options.quiet
      ? undefined
      : (count: number, currentUrl: string, total: number) => {
          const short = currentUrl.length > 60 ? currentUrl.slice(0, 60) + '…' : currentUrl;
          process.stderr.write(`\r  [${count}/${total}] ${short.padEnd(63)}`);
        };

    const result = await explorer.crawl(onProgress, options.quiet ? undefined : (sitemapSize) => {
      if (sitemapSize === 0) {
        process.stderr.write('  Warning: sitemap returned 0 URLs — max-pages falling back to 300.\n');
        process.stderr.write('  (Check that the sitemap URL is correct and accessible.)\n');
      } else {
        process.stderr.write(`  Found ${sitemapSize.toLocaleString()} URLs in sitemap.\n`);
      }
    });

    if (!options.quiet) process.stderr.write('\n');

    if (options.pageStats) {
      process.stderr.write('\n  Warning: --page-stats is skipped in streaming mode.\n');
    }

    // Build uncrawled reasons
    const crawledUrls = result.crawledUrls;
    const uncrawledUrls = [...result.sitemapUrls].filter(u => !crawledUrls.has(u));
    const uncrawledReasons: Record<string, string> = {};

    for (const u of uncrawledUrls) {
      if (result.robotsBlocked.has(u)) {
        uncrawledReasons[u] = 'robots';
      } else if (result.queueRemainder.has(u)) {
        uncrawledReasons[u] = 'cap';
      } else {
        uncrawledReasons[u] = 'unseeded';
      }
    }

    // HEAD-check 'cap' and 'unseeded' URLs
    const toHeadCheck = uncrawledUrls.filter(u =>
      uncrawledReasons[u] === 'cap' || uncrawledReasons[u] === 'unseeded'
    ).slice(0, 50);

    if (toHeadCheck.length > 0) {
      if (!options.quiet) process.stderr.write(`\n  Checking ${toHeadCheck.length} uncrawled URL(s)…\n`);
      await Promise.all(toHeadCheck.map(async (headUrl: string) => {
        try {
          const r = await axios.head(headUrl, {
            timeout: 5000,
            maxRedirects: 0,
            validateStatus: () => true,
            headers: { 'User-Agent': 'SGNL-LinkExplorer/1.0 (compatible; site-auditor)', ...headers },
          });
          if (r.status >= 500) uncrawledReasons[headUrl] = '5xx';
          else if (r.status >= 400) uncrawledReasons[headUrl] = '4xx';
          else if (r.status >= 300) {
            const loc: string = (r.headers['location'] as string) || '';
            uncrawledReasons[headUrl] = crawledUrls.has(loc) ? 'redirect_crawled' : 'redirect';
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`\u26a0 Warning: HEAD check failed for ${headUrl}: ${msg}`);
          uncrawledReasons[headUrl] = 'timeout';
        }
      }));
    }

    // Write metadata.json
    fs.writeFileSync(metadataFile, JSON.stringify({
      baseUrl: url,
      crawledAt: new Date().toISOString(),
      sitemapUrls: [...result.sitemapUrls],
      errors: Object.fromEntries(result.errors),
      uncrawledReasons,
    }));

    // Phase 2: Python graph analysis → compact.json
    if (!options.quiet) process.stderr.write('\n  Analyzing with Python…\n');
    try {
      await runGraphAnalysis(crawlFile, metadataFile, compactFile);
    } catch (err) {
      if (err instanceof PythonNotInstalledError) {
        console.error('Error: Python 3 required. Install and run: pip install -r python/requirements.txt');
        console.error(`Crawl data saved to: ${crawlFile}`);
        process.exit(1);
      }
      throw err;
    }

    // Phase 2.5: Enrich with GSC ranking data (if authenticated)
    const compactData = JSON.parse(fs.readFileSync(compactFile, 'utf-8'));
    if (resolvedConfig.gsc?.clientId && resolvedConfig.gsc?.clientSecret && resolvedConfig.gsc?.properties?.length) {
      try {
        const token = await getAccessToken(resolvedConfig.gsc.clientId, resolvedConfig.gsc.clientSecret);
        if (token) {
          const property = resolveGSCProperty(url, resolvedConfig.gsc.properties);
          if (property) {
            if (!options.quiet) process.stderr.write('  Fetching GSC ranking data…\n');
            const ranked = await fetchAllRankedPages(property, token, { limit: 25000 });
            const posMap = new Map<string, number>();
            for (const r of ranked) posMap.set(r.page, r.position);
            const URLS: string[] = compactData.urls;
            compactData.nodes.gscPosition = compactData.nodes.idx.map(
              (urlIdx: number) => posMap.get(URLS[urlIdx]) ?? null
            );
            if (!options.quiet) {
              const rankedCount = compactData.nodes.gscPosition.filter((p: number | null) => p !== null).length;
              process.stderr.write(`  GSC: ${rankedCount}/${compactData.nodes.idx.length} nodes have ranking data\n`);
            }
          }
        }
      } catch {
        // GSC fetch failed — continue without it
      }
    }

    // Summary
    const pageCount  = result.streamedPages ?? result.pages.size;
    const errorCount = result.errors.size;
    console.log('\n  Summary');
    console.log(`  Pages crawled : ${pageCount}`);
    console.log(`  Errors        : ${errorCount}`);
    console.log(`  Sitemap URLs  : ${result.sitemapUrls.size}`);
    console.log(`\n  Data saved to: ${path.join(runDir, 'compact.json')}\n`);

    process.exit(0);
  } catch (err: unknown) {
    console.error(formatErrorForUser(err));
    process.exit(1);
  }
}
