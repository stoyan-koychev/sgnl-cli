/**
 * SGNL CLI — gsc command
 *
 * Google Search Console is a property-level tool, not a URL-only audit. These
 * subcommands are the focused-command (Path B) entry into the GSC API:
 *
 *   sgnl gsc login        — authenticate with Google OAuth2
 *   sgnl gsc logout       — remove stored tokens
 *   sgnl gsc status       — show auth state and verified properties
 *   sgnl gsc pages        — list ranked pages for a property
 *   sgnl gsc queries      — list ranked queries for a property
 *   sgnl gsc url <url>    — per-URL totals + top queries
 *   sgnl gsc inspect <url>— Google's index verdict for a URL
 *   sgnl gsc sitemaps     — submitted sitemaps + error/warning counts
 *
 * All data-fetching subcommands emit the standard `{ request, gsc }` envelope
 * when `--output json` is used, matching technical/structure/robots/performance/
 * schema/content.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { Command } from 'commander';
import { loadConfig, saveConfig } from '../config';
import {
  runOAuthFlow,
  removeTokens,
  loadTokens,
  getAccessToken,
  fetchGSCProperties,
} from '../auth/google-oauth';
import {
  fetchAllRankedPages,
  fetchAllRankedQueries,
  fetchSearchAnalytics,
  fetchURLInspection,
  fetchSitemaps,
  resolveGSCProperty,
  computeDateRange,
  computePreviousRange,
  GSCPageRow,
  GSCQuery,
  GSCSitemap,
  GSCIndexStatus,
  GSCSearchPerformance,
  GSCDateRange,
  GSCAnalyticsFilters,
} from '../analysis/gsc';
import { createRunDir } from '../analysis/run-reporter';
import { logger } from '../utils/logger';
import { formatErrorForUser } from '../errors';

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise(resolve => rl.question(question, resolve));
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RequestContext = {
  property: string;
  date_range: GSCDateRange;
  search_type: string;
  filters: GSCAnalyticsFilters;
  dimensions: string[];
  compare?: boolean;
  previous_range?: GSCDateRange;
  url?: string;
};

type GSCEnvelope<T> = {
  request: RequestContext;
  gsc: T;
};

type DataSubcommandOptions = {
  output?: string;
  json?: boolean;
  save?: boolean;
  verbose?: boolean;
  limit?: string;
  days?: string;
  startDate?: string;
  endDate?: string;
  searchType?: string;
  country?: string;
  device?: string;
  compare?: boolean;
};

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the `--output` / `--json` alias into a canonical format.
 * Supports `terminal` | `json` | `csv`. Legacy `--json` maps to `json`.
 */
function resolveOutputFormat(opts: DataSubcommandOptions): 'terminal' | 'json' | 'csv' {
  if (opts.json) return 'json';
  const raw = (opts.output ?? 'terminal').toLowerCase();
  if (raw === 'json' || raw === 'csv' || raw === 'terminal') return raw;
  return 'terminal';
}

/**
 * Turn flag inputs into a fully-resolved date range + filters + search type.
 */
function buildRequestContext(
  property: string,
  dimensions: string[],
  opts: DataSubcommandOptions,
  extras?: { url?: string },
): RequestContext {
  const days = opts.days ? parseInt(opts.days, 10) : undefined;
  const dateRange = computeDateRange({
    startDate: opts.startDate,
    endDate: opts.endDate,
    days: Number.isFinite(days) ? (days as number) : undefined,
  });

  const searchType = (opts.searchType ?? 'web').toLowerCase();

  const filters: GSCAnalyticsFilters = {};
  if (opts.country) filters.country = opts.country;
  if (opts.device) {
    const d = opts.device.toLowerCase();
    if (d === 'desktop' || d === 'mobile' || d === 'tablet') {
      filters.device = d;
    }
  }

  const ctx: RequestContext = {
    property,
    date_range: dateRange,
    search_type: searchType,
    filters,
    dimensions,
  };

  if (opts.compare) {
    ctx.compare = true;
    ctx.previous_range = computePreviousRange(dateRange);
  }

  if (extras?.url) ctx.url = extras.url;

  return ctx;
}

/**
 * Load config + resolve GSC property + obtain access token. Returns null and
 * writes an error to stderr if any precondition fails; callers should exit(1).
 */
async function prepareAuthAndProperty(
  siteOrUrl: string | undefined,
): Promise<{ property: string; accessToken: string } | null> {
  const config = loadConfig();
  if (!config.gsc?.clientId || !config.gsc?.clientSecret) {
    console.error('GSC not configured. Run `sgnl gsc login` first.');
    return null;
  }

  const accessToken = await getAccessToken(config.gsc.clientId, config.gsc.clientSecret);
  if (!accessToken) {
    console.error('Auth failed. Run `sgnl gsc login` to re-authenticate.');
    return null;
  }

  const properties = config.gsc.properties ?? [];
  let property: string | null = null;
  if (siteOrUrl) {
    property = resolveGSCProperty(siteOrUrl, properties);
    if (!property) {
      // Allow exact property match (e.g. `sc-domain:example.com`) as-is.
      if (properties.includes(siteOrUrl)) property = siteOrUrl;
    }
    if (!property) {
      console.error(`No GSC property found for "${siteOrUrl}". Available properties:`);
      properties.forEach(p => console.error(`  ${p}`));
      return null;
    }
  } else {
    property = properties[0] ?? null;
    if (!property) {
      console.error('No GSC properties found. Run `sgnl gsc login`.');
      return null;
    }
  }

  return { property, accessToken };
}

/**
 * Promise-flush stdout and return so the command can exit cleanly without
 * the truncation risk of calling process.exit() inside the write callback.
 */
async function flushStdout(payload: string): Promise<void> {
  process.stdout.write(payload, () => { /* flushed */ });
  await new Promise<void>((resolve) => setImmediate(resolve));
}

/**
 * Shared row renderer used by both `pages` and `queries`. Kills ~50 lines
 * of copy-paste between the two subcommands.
 */
function printGSCTable(
  rows: Array<{ clicks: number; impressions: number; ctr: number; position: number; label: string }>,
  opts: { label: 'Page' | 'Query' },
): void {
  if (rows.length === 0) {
    console.log(`  No ranked ${opts.label.toLowerCase()}s found.\n`);
    return;
  }
  const totalClicks = rows.reduce((s, r) => s + r.clicks, 0);
  const totalImpressions = rows.reduce((s, r) => s + r.impressions, 0);
  console.log(
    `  ${rows.length} ${opts.label.toLowerCase()}s | ` +
    `${totalClicks.toLocaleString()} clicks | ` +
    `${totalImpressions.toLocaleString()} impressions\n`,
  );
  console.log(
    '  ' +
    '#'.padStart(4) + '  ' +
    'Clicks'.padStart(7) + '  ' +
    'Impr'.padStart(8) + '  ' +
    'CTR'.padStart(6) + '  ' +
    'Pos'.padStart(5) + '  ' +
    opts.label,
  );
  console.log('  ' + '-'.repeat(90));
  rows.forEach((r, i) => {
    console.log(
      '  ' +
      String(i + 1).padStart(4) + '  ' +
      String(r.clicks).padStart(7) + '  ' +
      String(r.impressions).padStart(8) + '  ' +
      (r.ctr * 100).toFixed(1).padStart(5) + '%  ' +
      r.position.toFixed(1).padStart(5) + '  ' +
      r.label,
    );
  });
  console.log('');
}

function pagePath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

// CSV helpers -----------------------------------------------------------------

function csvEscape(v: unknown): string {
  const s = v == null ? '' : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function pagesToCsv(rows: GSCPageRow[]): string {
  const header = ['page', 'clicks', 'impressions', 'ctr', 'position'];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push([r.page, r.clicks, r.impressions, r.ctr, r.position].map(csvEscape).join(','));
  }
  return lines.join('\n') + '\n';
}

function queriesToCsv(rows: GSCQuery[]): string {
  const header = ['query', 'clicks', 'impressions', 'ctr', 'position'];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push([r.query, r.clicks, r.impressions, r.ctr, r.position].map(csvEscape).join(','));
  }
  return lines.join('\n') + '\n';
}

function sitemapsToCsv(rows: GSCSitemap[]): string {
  const header = ['path', 'type', 'last_submitted', 'last_downloaded', 'errors', 'warnings', 'is_pending'];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push([
      r.path, r.type ?? '', r.last_submitted ?? '', r.last_downloaded ?? '',
      r.errors, r.warnings, r.is_pending ?? '',
    ].map(csvEscape).join(','));
  }
  return lines.join('\n') + '\n';
}

// Markdown builders -----------------------------------------------------------

function mdPages(env: GSCEnvelope<{ pages: GSCPageRow[]; totals: any }>): string {
  const r = env.request;
  const lines: string[] = [];
  lines.push(`# GSC Ranked Pages — ${r.property}`);
  lines.push('');
  lines.push(`_${r.date_range.start_date} → ${r.date_range.end_date} (${r.date_range.days} days, ${r.search_type})_`);
  lines.push('');
  const t = env.gsc.totals ?? {};
  lines.push(`- Pages: **${env.gsc.pages.length}**`);
  lines.push(`- Total clicks: **${(t.clicks ?? 0).toLocaleString()}**`);
  lines.push(`- Total impressions: **${(t.impressions ?? 0).toLocaleString()}**`);
  lines.push('');
  lines.push('| # | Clicks | Impr | CTR | Pos | Page |');
  lines.push('|---|---|---|---|---|---|');
  env.gsc.pages.forEach((p, i) => {
    lines.push(`| ${i + 1} | ${p.clicks} | ${p.impressions} | ${(p.ctr * 100).toFixed(1)}% | ${p.position.toFixed(1)} | ${p.page} |`);
  });
  return lines.join('\n') + '\n';
}

function mdQueries(env: GSCEnvelope<{ queries: GSCQuery[]; totals: any }>): string {
  const r = env.request;
  const lines: string[] = [];
  lines.push(`# GSC Ranked Queries — ${r.property}`);
  lines.push('');
  lines.push(`_${r.date_range.start_date} → ${r.date_range.end_date} (${r.date_range.days} days, ${r.search_type})_`);
  lines.push('');
  const t = env.gsc.totals ?? {};
  lines.push(`- Queries: **${env.gsc.queries.length}**`);
  lines.push(`- Total clicks: **${(t.clicks ?? 0).toLocaleString()}**`);
  lines.push(`- Total impressions: **${(t.impressions ?? 0).toLocaleString()}**`);
  lines.push('');
  lines.push('| # | Clicks | Impr | CTR | Pos | Query |');
  lines.push('|---|---|---|---|---|---|');
  env.gsc.queries.forEach((q, i) => {
    lines.push(`| ${i + 1} | ${q.clicks} | ${q.impressions} | ${(q.ctr * 100).toFixed(1)}% | ${q.position.toFixed(1)} | ${q.query} |`);
  });
  return lines.join('\n') + '\n';
}

function mdUrl(env: GSCEnvelope<{ url: string; totals: any; top_queries: GSCQuery[] }>): string {
  const r = env.request;
  const lines: string[] = [];
  lines.push(`# GSC URL — ${env.gsc.url}`);
  lines.push('');
  lines.push(`_Property: ${r.property} · ${r.date_range.start_date} → ${r.date_range.end_date} (${r.date_range.days} days, ${r.search_type})_`);
  lines.push('');
  const t = env.gsc.totals ?? {};
  lines.push(`- Clicks: **${(t.clicks ?? 0).toLocaleString()}**`);
  lines.push(`- Impressions: **${(t.impressions ?? 0).toLocaleString()}**`);
  lines.push(`- CTR: **${((t.ctr ?? 0) * 100).toFixed(1)}%**`);
  lines.push(`- Avg position: **${(t.position ?? 0).toFixed(1)}**`);
  lines.push('');
  lines.push('## Top queries');
  lines.push('');
  lines.push('| # | Query | Clicks | Impr | CTR | Pos |');
  lines.push('|---|---|---|---|---|---|');
  env.gsc.top_queries.forEach((q, i) => {
    lines.push(`| ${i + 1} | ${q.query} | ${q.clicks} | ${q.impressions} | ${(q.ctr * 100).toFixed(1)}% | ${q.position.toFixed(1)} |`);
  });
  return lines.join('\n') + '\n';
}

function mdInspect(env: GSCEnvelope<{ url: string; inspection: GSCIndexStatus }>): string {
  const i = env.gsc.inspection;
  const lines: string[] = [];
  lines.push(`# GSC URL Inspection — ${env.gsc.url}`);
  lines.push('');
  lines.push(`- Verdict: **${i.verdict}**`);
  lines.push(`- Coverage: ${i.coverage_state}`);
  lines.push(`- Indexed: ${i.is_page_indexed ? 'yes' : 'no'}`);
  if (i.google_canonical) lines.push(`- Google canonical: ${i.google_canonical}`);
  if (i.user_canonical) lines.push(`- User canonical: ${i.user_canonical}`);
  if (i.crawl_timestamp) lines.push(`- Last crawl: ${i.crawl_timestamp}`);
  if (i.robots_txt_state) lines.push(`- Robots state: ${i.robots_txt_state}`);
  if (i.indexing_state) lines.push(`- Indexing state: ${i.indexing_state}`);
  if (i.page_fetch_state) lines.push(`- Page fetch state: ${i.page_fetch_state}`);
  if (i.rich_results && i.rich_results.length) lines.push(`- Rich results: ${i.rich_results.join(', ')}`);
  if (i.mobile_usability_verdict) lines.push(`- Mobile usability: ${i.mobile_usability_verdict}`);
  if (i.mobile_usability_issues && i.mobile_usability_issues.length) {
    lines.push(`- Mobile issues: ${i.mobile_usability_issues.join(', ')}`);
  }
  if (i.referring_urls && i.referring_urls.length) {
    lines.push('');
    lines.push('## Referring URLs');
    for (const u of i.referring_urls) lines.push(`- ${u}`);
  }
  return lines.join('\n') + '\n';
}

function mdSitemaps(env: GSCEnvelope<{ sitemaps: GSCSitemap[] }>): string {
  const lines: string[] = [];
  lines.push(`# GSC Sitemaps — ${env.request.property}`);
  lines.push('');
  lines.push('| Path | Type | Submitted | Downloaded | Errors | Warnings |');
  lines.push('|---|---|---|---|---|---|');
  for (const sm of env.gsc.sitemaps) {
    lines.push(`| ${sm.path} | ${sm.type ?? ''} | ${sm.last_submitted ?? ''} | ${sm.last_downloaded ?? ''} | ${sm.errors} | ${sm.warnings} |`);
  }
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Common data-command options (factored into a helper that returns a Command
// so every subcommand shares the identical flag contract).
// ---------------------------------------------------------------------------

function attachDataCommonOptions(cmd: Command): Command {
  return cmd
    .option('--output <format>', 'Output format: terminal | json | csv', 'terminal')
    .option('--json', '(alias for --output json)')
    .option('--save', 'Write dated artifacts to runs/', false)
    .option('--verbose', 'Include raw API response in JSON output', false);
}

function attachQueryRangeOptions(cmd: Command): Command {
  return cmd
    .option('--days <n>', 'Window size in days (default 28, max 16 months)')
    .option('--start-date <YYYY-MM-DD>', 'Explicit start date (overrides --days)')
    .option('--end-date <YYYY-MM-DD>', 'Explicit end date (pair with --start-date)')
    .option('--search-type <type>', 'web | image | video | news | discover', 'web')
    .option('--country <iso>', 'Filter by country (ISO-3, e.g. usa, deu)')
    .option('--device <type>', 'Filter by device (desktop | mobile | tablet)')
    .option('--compare', 'Compare against the previous equal-length window', false);
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function registerGSCCommand(program: Command): void {
  const gsc = program
    .command('gsc')
    .description('Google Search Console: authenticate and query property data');

  // ── sgnl gsc login ──────────────────────────────────────────────────────
  gsc
    .command('login')
    .description('Authenticate with Google Search Console via OAuth2')
    .action(async () => {
      const config = loadConfig();

      let clientId = config.gsc?.clientId;
      let clientSecret = config.gsc?.clientSecret;

      if (!clientId || !clientSecret) {
        console.log('\nGoogle Search Console requires OAuth2 credentials.');
        console.log('Create them at: https://console.cloud.google.com/apis/credentials');
        console.log('  1. Create an OAuth 2.0 Client ID (type: Desktop app)');
        console.log('  2. Enable the "Google Search Console API"\n');

        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

        clientId = (await ask(rl, '? OAuth Client ID: ')).trim();
        clientSecret = (await ask(rl, '? OAuth Client Secret: ')).trim();
        rl.close();

        if (!clientId || !clientSecret) {
          console.error('\nError: Client ID and Secret are required.');
          process.exit(1);
        }

        saveConfig({
          ...config,
          gsc: { ...config.gsc, clientId, clientSecret },
        });
      }

      try {
        await runOAuthFlow(clientId, clientSecret);
        console.log('\nAuthentication successful!');

        const token = await getAccessToken(clientId, clientSecret);
        if (token) {
          const properties = await fetchGSCProperties(token);
          saveConfig({
            ...loadConfig(),
            gsc: { ...loadConfig().gsc, properties },
          });
          console.log(`\nVerified properties (${properties.length}):`);
          for (const p of properties) {
            console.log(`  ${p}`);
          }
        }

        console.log('\nDone. GSC data will be included in sgnl analyze for verified properties.');
        process.exit(0);
      } catch (err: any) {
        console.error(`\nAuthentication failed: ${err.message}`);
        process.exit(1);
      }
    });

  // ── sgnl gsc logout ─────────────────────────────────────────────────────
  gsc
    .command('logout')
    .description('Remove stored Google Search Console tokens')
    .action(() => {
      const removed = removeTokens();
      const config = loadConfig();
      if (config.gsc?.properties) {
        saveConfig({ ...config, gsc: { ...config.gsc, properties: undefined } });
      }
      if (removed) {
        console.log('GSC tokens removed.');
      } else {
        console.log('No GSC tokens found.');
      }
      process.exit(0);
    });

  // ── sgnl gsc status ─────────────────────────────────────────────────────
  gsc
    .command('status')
    .description('Show GSC authentication state and verified properties')
    .action(async () => {
      const config = loadConfig();
      const tokens = loadTokens();

      if (!config.gsc?.clientId) {
        console.log('GSC: Not configured. Run `sgnl gsc login` to set up.');
        process.exit(0);
      }

      console.log('GSC Configuration:');
      console.log(`  Client ID: ${config.gsc.clientId.slice(0, 12)}...`);

      if (!tokens?.refresh_token) {
        console.log('  Auth: Not authenticated. Run `sgnl gsc login`.');
        process.exit(0);
      }

      const accessToken = await getAccessToken(
        config.gsc.clientId,
        config.gsc.clientSecret ?? '',
      );

      if (!accessToken) {
        console.log('  Auth: Token expired or invalid. Run `sgnl gsc login` to re-authenticate.');
        process.exit(0);
      }

      console.log('  Auth: Active');

      try {
        const properties = await fetchGSCProperties(accessToken);
        saveConfig({
          ...config,
          gsc: { ...config.gsc, properties },
        });
        console.log(`\n  Properties (${properties.length}):`);
        for (const p of properties) {
          console.log(`    ${p}`);
        }
      } catch (err: any) {
        console.log(`  Properties: Failed to fetch (${err.message})`);
      }

      process.exit(0);
    });

  // ── sgnl gsc pages [siteUrl] ─────────────────────────────────────────────
  attachQueryRangeOptions(
    attachDataCommonOptions(
      gsc
        .command('pages [siteUrl]')
        .description('List ranked pages for a GSC property')
        .option('-l, --limit <number>', 'Max pages to return', '50'),
    ),
  ).action(async (siteUrl: string | undefined, opts: DataSubcommandOptions) => {
    const output = resolveOutputFormat(opts);
    try {
      const auth = await prepareAuthAndProperty(siteUrl);
      if (!auth) process.exit(1);
      const { property, accessToken } = auth!;
      const request = buildRequestContext(property, ['page'], opts);
      const limit = parseInt(opts.limit ?? '50', 10) || 50;

      if (output === 'terminal') {
        logger.info(`Fetching ranked pages for ${property} (${request.date_range.start_date} → ${request.date_range.end_date})...`);
      }

      const pages = await fetchAllRankedPages(property, accessToken, {
        limit,
        searchType: request.search_type,
        dateRange: request.date_range,
        filters: request.filters,
      });

      let previousPages: GSCPageRow[] | undefined;
      if (request.compare && request.previous_range) {
        previousPages = await fetchAllRankedPages(property, accessToken, {
          limit,
          searchType: request.search_type,
          dateRange: request.previous_range,
          filters: request.filters,
        });
      }

      const totals = {
        clicks: pages.reduce((s, p) => s + p.clicks, 0),
        impressions: pages.reduce((s, p) => s + p.impressions, 0),
      };

      const payload: any = { pages, totals };
      if (previousPages) {
        const prevTotals = {
          clicks: previousPages.reduce((s, p) => s + p.clicks, 0),
          impressions: previousPages.reduce((s, p) => s + p.impressions, 0),
        };
        payload.previous = { pages: previousPages, totals: prevTotals };
        payload.delta = {
          clicks: totals.clicks - prevTotals.clicks,
          impressions: totals.impressions - prevTotals.impressions,
        };
      }

      const envelope: GSCEnvelope<typeof payload> = { request, gsc: payload };

      if (opts.save) {
        try {
          const runDir = createRunDir(`https://gsc/${encodeURIComponent(property)}`, 'gsc-pages');
          fs.writeFileSync(path.join(runDir, 'gsc.json'), JSON.stringify(envelope, null, 2));
          fs.writeFileSync(path.join(runDir, 'gsc.md'), mdPages(envelope));
          fs.writeFileSync(path.join(runDir, 'gsc.csv'), pagesToCsv(pages));
          logger.info(`Saved to: ${runDir}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.warn(`Failed to save gsc pages report: ${msg}`);
        }
      }

      if (output === 'json') {
        await flushStdout(JSON.stringify(envelope, null, 2) + '\n');
        return;
      }
      if (output === 'csv') {
        await flushStdout(pagesToCsv(pages));
        return;
      }

      // Terminal
      console.log(`\n${property}  ·  ${request.date_range.start_date} → ${request.date_range.end_date} (${request.date_range.days}d, ${request.search_type})`);
      if (request.filters.country) console.log(`  country=${request.filters.country}`);
      if (request.filters.device) console.log(`  device=${request.filters.device}`);
      console.log('');
      printGSCTable(
        pages.map(p => ({ ...p, label: pagePath(p.page) })),
        { label: 'Page' },
      );
      if (previousPages) {
        const prevTotals = {
          clicks: previousPages.reduce((s, p) => s + p.clicks, 0),
          impressions: previousPages.reduce((s, p) => s + p.impressions, 0),
        };
        console.log(`  vs previous ${request.previous_range!.start_date} → ${request.previous_range!.end_date}:`);
        console.log(`    Clicks:      ${prevTotals.clicks.toLocaleString()} → ${totals.clicks.toLocaleString()}  (Δ ${totals.clicks - prevTotals.clicks >= 0 ? '+' : ''}${totals.clicks - prevTotals.clicks})`);
        console.log(`    Impressions: ${prevTotals.impressions.toLocaleString()} → ${totals.impressions.toLocaleString()}  (Δ ${totals.impressions - prevTotals.impressions >= 0 ? '+' : ''}${totals.impressions - prevTotals.impressions})`);
        console.log('');
      }
      await flushStdout('');
    } catch (err: unknown) {
      console.error(formatErrorForUser(err, output));
      process.exit(1);
    }
  });

  // ── sgnl gsc queries [siteUrl] ───────────────────────────────────────────
  attachQueryRangeOptions(
    attachDataCommonOptions(
      gsc
        .command('queries [siteUrl]')
        .description('List ranked queries/keywords for a GSC property')
        .option('-l, --limit <number>', 'Max queries to return', '50'),
    ),
  ).action(async (siteUrl: string | undefined, opts: DataSubcommandOptions) => {
    const output = resolveOutputFormat(opts);
    try {
      const auth = await prepareAuthAndProperty(siteUrl);
      if (!auth) process.exit(1);
      const { property, accessToken } = auth!;
      const request = buildRequestContext(property, ['query'], opts);
      const limit = parseInt(opts.limit ?? '50', 10) || 50;

      if (output === 'terminal') {
        logger.info(`Fetching ranked queries for ${property} (${request.date_range.start_date} → ${request.date_range.end_date})...`);
      }

      const queries = await fetchAllRankedQueries(property, accessToken, {
        limit,
        searchType: request.search_type,
        dateRange: request.date_range,
        filters: request.filters,
      });

      let previousQueries: GSCQuery[] | undefined;
      if (request.compare && request.previous_range) {
        previousQueries = await fetchAllRankedQueries(property, accessToken, {
          limit,
          searchType: request.search_type,
          dateRange: request.previous_range,
          filters: request.filters,
        });
      }

      const totals = {
        clicks: queries.reduce((s, q) => s + q.clicks, 0),
        impressions: queries.reduce((s, q) => s + q.impressions, 0),
      };

      const payload: any = { queries, totals };
      if (previousQueries) {
        const prevTotals = {
          clicks: previousQueries.reduce((s, q) => s + q.clicks, 0),
          impressions: previousQueries.reduce((s, q) => s + q.impressions, 0),
        };
        payload.previous = { queries: previousQueries, totals: prevTotals };
        payload.delta = {
          clicks: totals.clicks - prevTotals.clicks,
          impressions: totals.impressions - prevTotals.impressions,
        };
      }

      const envelope: GSCEnvelope<typeof payload> = { request, gsc: payload };

      if (opts.save) {
        try {
          const runDir = createRunDir(`https://gsc/${encodeURIComponent(property)}`, 'gsc-queries');
          fs.writeFileSync(path.join(runDir, 'gsc.json'), JSON.stringify(envelope, null, 2));
          fs.writeFileSync(path.join(runDir, 'gsc.md'), mdQueries(envelope));
          fs.writeFileSync(path.join(runDir, 'gsc.csv'), queriesToCsv(queries));
          logger.info(`Saved to: ${runDir}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.warn(`Failed to save gsc queries report: ${msg}`);
        }
      }

      if (output === 'json') {
        await flushStdout(JSON.stringify(envelope, null, 2) + '\n');
        return;
      }
      if (output === 'csv') {
        await flushStdout(queriesToCsv(queries));
        return;
      }

      console.log(`\n${property}  ·  ${request.date_range.start_date} → ${request.date_range.end_date} (${request.date_range.days}d, ${request.search_type})`);
      if (request.filters.country) console.log(`  country=${request.filters.country}`);
      if (request.filters.device) console.log(`  device=${request.filters.device}`);
      console.log('');
      printGSCTable(
        queries.map(q => ({ ...q, label: q.query })),
        { label: 'Query' },
      );
      if (previousQueries) {
        const prevTotals = {
          clicks: previousQueries.reduce((s, q) => s + q.clicks, 0),
          impressions: previousQueries.reduce((s, q) => s + q.impressions, 0),
        };
        console.log(`  vs previous ${request.previous_range!.start_date} → ${request.previous_range!.end_date}:`);
        console.log(`    Clicks:      ${prevTotals.clicks.toLocaleString()} → ${totals.clicks.toLocaleString()}  (Δ ${totals.clicks - prevTotals.clicks >= 0 ? '+' : ''}${totals.clicks - prevTotals.clicks})`);
        console.log(`    Impressions: ${prevTotals.impressions.toLocaleString()} → ${totals.impressions.toLocaleString()}  (Δ ${totals.impressions - prevTotals.impressions >= 0 ? '+' : ''}${totals.impressions - prevTotals.impressions})`);
        console.log('');
      }
      await flushStdout('');
    } catch (err: unknown) {
      console.error(formatErrorForUser(err, output));
      process.exit(1);
    }
  });

  // ── sgnl gsc url <url> ───────────────────────────────────────────────────
  attachQueryRangeOptions(
    attachDataCommonOptions(
      gsc
        .command('url <url>')
        .description('Per-URL clicks, impressions, CTR, position + top queries'),
    ),
  ).action(async (url: string, opts: DataSubcommandOptions) => {
    const output = resolveOutputFormat(opts);
    try {
      const auth = await prepareAuthAndProperty(url);
      if (!auth) process.exit(1);
      const { property, accessToken } = auth!;
      const request = buildRequestContext(property, ['page', 'query'], opts, { url });

      if (output === 'terminal') {
        logger.info(`Fetching GSC data for ${url}...`);
      }

      const perf: GSCSearchPerformance | null = await fetchSearchAnalytics(url, property, accessToken, {
        dateRange: request.date_range,
        searchType: request.search_type,
        filters: request.filters,
        topQueriesLimit: 25,
      });

      const totals = {
        clicks: perf?.total_clicks ?? 0,
        impressions: perf?.total_impressions ?? 0,
        ctr: perf?.average_ctr ?? 0,
        position: perf?.average_position ?? 0,
      };
      const topQueries = perf?.top_queries ?? [];

      const payload: any = { url, totals, top_queries: topQueries };
      if (request.compare && request.previous_range) {
        const prev = await fetchSearchAnalytics(url, property, accessToken, {
          dateRange: request.previous_range,
          searchType: request.search_type,
          filters: request.filters,
          topQueriesLimit: 25,
        });
        const prevTotals = {
          clicks: prev?.total_clicks ?? 0,
          impressions: prev?.total_impressions ?? 0,
          ctr: prev?.average_ctr ?? 0,
          position: prev?.average_position ?? 0,
        };
        payload.previous = { totals: prevTotals, top_queries: prev?.top_queries ?? [] };
        payload.delta = {
          clicks: totals.clicks - prevTotals.clicks,
          impressions: totals.impressions - prevTotals.impressions,
          ctr: totals.ctr - prevTotals.ctr,
          position: totals.position - prevTotals.position,
        };
      }

      if (opts.verbose && perf) {
        payload.raw = perf;
      }

      const envelope: GSCEnvelope<typeof payload> = { request, gsc: payload };

      if (opts.save) {
        try {
          const runDir = createRunDir(url, 'gsc-url');
          fs.writeFileSync(path.join(runDir, 'gsc.json'), JSON.stringify(envelope, null, 2));
          fs.writeFileSync(path.join(runDir, 'gsc.md'), mdUrl(envelope));
          fs.writeFileSync(path.join(runDir, 'gsc.csv'), queriesToCsv(topQueries));
          logger.info(`Saved to: ${runDir}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.warn(`Failed to save gsc url report: ${msg}`);
        }
      }

      if (output === 'json') {
        await flushStdout(JSON.stringify(envelope, null, 2) + '\n');
        return;
      }
      if (output === 'csv') {
        await flushStdout(queriesToCsv(topQueries));
        return;
      }

      // Terminal
      console.log(`\nGSC URL — ${url}`);
      console.log(`  Property: ${property}`);
      console.log(`  Window: ${request.date_range.start_date} → ${request.date_range.end_date} (${request.date_range.days}d, ${request.search_type})`);
      console.log('');
      console.log(`  Clicks:      ${totals.clicks.toLocaleString()}`);
      console.log(`  Impressions: ${totals.impressions.toLocaleString()}`);
      console.log(`  CTR:         ${(totals.ctr * 100).toFixed(1)}%`);
      console.log(`  Position:    ${totals.position.toFixed(1)}`);
      console.log('');
      if (topQueries.length > 0) {
        printGSCTable(
          topQueries.map(q => ({ ...q, label: q.query })),
          { label: 'Query' },
        );
      } else {
        console.log('  No query breakdown available (below GSC privacy threshold or no data).\n');
      }
      if (payload.previous) {
        const p = payload.previous.totals;
        const d = payload.delta;
        console.log(`  vs previous ${request.previous_range!.start_date} → ${request.previous_range!.end_date}:`);
        console.log(`    Clicks:      ${p.clicks.toLocaleString()} → ${totals.clicks.toLocaleString()}  (Δ ${d.clicks >= 0 ? '+' : ''}${d.clicks})`);
        console.log(`    Impressions: ${p.impressions.toLocaleString()} → ${totals.impressions.toLocaleString()}  (Δ ${d.impressions >= 0 ? '+' : ''}${d.impressions})`);
        console.log(`    Position:    ${p.position.toFixed(1)} → ${totals.position.toFixed(1)}  (Δ ${d.position >= 0 ? '+' : ''}${d.position.toFixed(1)})`);
        console.log('');
      }
      await flushStdout('');
    } catch (err: unknown) {
      console.error(formatErrorForUser(err, output));
      process.exit(1);
    }
  });

  // ── sgnl gsc inspect <url> ───────────────────────────────────────────────
  attachDataCommonOptions(
    gsc
      .command('inspect <url>')
      .description('Google URL Inspection: verdict, canonical, rich results, mobile usability'),
  ).action(async (url: string, opts: DataSubcommandOptions) => {
    const output = resolveOutputFormat(opts);
    try {
      const auth = await prepareAuthAndProperty(url);
      if (!auth) process.exit(1);
      const { property, accessToken } = auth!;

      // inspect has no date/filter knobs; build a minimal request context.
      const request: RequestContext = {
        property,
        date_range: computeDateRange(),
        search_type: 'web',
        filters: {},
        dimensions: [],
        url,
      };

      if (output === 'terminal') {
        logger.info(`Inspecting ${url}...`);
      }

      const inspection = await fetchURLInspection(url, property, accessToken);
      if (!inspection) {
        const msg = 'URL inspection failed. The URL may be outside this property, the API quota may be exhausted, or auth may be stale.';
        if (output === 'json') {
          const envErr = { request, gsc: { url, inspection: null, error: msg } };
          await flushStdout(JSON.stringify(envErr, null, 2) + '\n');
          return;
        }
        console.error(msg);
        process.exit(1);
      }

      const payload: any = { url, inspection };
      if (opts.verbose) payload.raw = inspection;
      const envelope: GSCEnvelope<typeof payload> = { request, gsc: payload };

      if (opts.save) {
        try {
          const runDir = createRunDir(url, 'gsc-inspect');
          fs.writeFileSync(path.join(runDir, 'gsc.json'), JSON.stringify(envelope, null, 2));
          fs.writeFileSync(path.join(runDir, 'gsc.md'), mdInspect(envelope));
          logger.info(`Saved to: ${runDir}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.warn(`Failed to save gsc inspect report: ${msg}`);
        }
      }

      if (output === 'json') {
        await flushStdout(JSON.stringify(envelope, null, 2) + '\n');
        return;
      }
      if (output === 'csv') {
        // CSV for inspect is degenerate — emit key/value pairs.
        const lines = ['key,value'];
        lines.push(`verdict,${csvEscape(inspection!.verdict)}`);
        lines.push(`coverage_state,${csvEscape(inspection!.coverage_state)}`);
        lines.push(`is_page_indexed,${csvEscape(inspection!.is_page_indexed)}`);
        lines.push(`google_canonical,${csvEscape(inspection!.google_canonical ?? '')}`);
        lines.push(`user_canonical,${csvEscape(inspection!.user_canonical ?? '')}`);
        lines.push(`crawl_timestamp,${csvEscape(inspection!.crawl_timestamp ?? '')}`);
        lines.push(`robots_txt_state,${csvEscape(inspection!.robots_txt_state ?? '')}`);
        lines.push(`indexing_state,${csvEscape(inspection!.indexing_state ?? '')}`);
        lines.push(`page_fetch_state,${csvEscape(inspection!.page_fetch_state ?? '')}`);
        lines.push(`mobile_usability_verdict,${csvEscape(inspection!.mobile_usability_verdict ?? '')}`);
        lines.push(`rich_results,${csvEscape((inspection!.rich_results ?? []).join('; '))}`);
        await flushStdout(lines.join('\n') + '\n');
        return;
      }

      // Terminal
      const i = inspection!;
      console.log(`\nGSC URL Inspection — ${url}\n`);
      console.log(`  Verdict:       ${i.verdict}`);
      console.log(`  Coverage:      ${i.coverage_state}`);
      console.log(`  Indexed:       ${i.is_page_indexed ? 'yes' : 'no'}`);
      if (i.google_canonical) console.log(`  Google canonical: ${i.google_canonical}`);
      if (i.user_canonical) console.log(`  User canonical:   ${i.user_canonical}`);
      if (i.crawl_timestamp) console.log(`  Last crawl:    ${i.crawl_timestamp}`);
      if (i.robots_txt_state) console.log(`  Robots state:  ${i.robots_txt_state}`);
      if (i.indexing_state) console.log(`  Indexing state:${i.indexing_state}`);
      if (i.page_fetch_state) console.log(`  Page fetch:    ${i.page_fetch_state}`);
      if (i.rich_results && i.rich_results.length > 0) {
        console.log(`  Rich results:  ${i.rich_results.join(', ')}`);
      }
      if (i.mobile_usability_verdict) {
        console.log(`  Mobile:        ${i.mobile_usability_verdict}`);
      }
      if (i.mobile_usability_issues && i.mobile_usability_issues.length > 0) {
        console.log(`  Mobile issues: ${i.mobile_usability_issues.join(', ')}`);
      }
      if (i.referring_urls && i.referring_urls.length > 0) {
        console.log('');
        console.log('  Referring URLs:');
        for (const u of i.referring_urls.slice(0, 10)) {
          console.log(`    ${u}`);
        }
      }
      console.log('');
      await flushStdout('');
    } catch (err: unknown) {
      console.error(formatErrorForUser(err, output));
      process.exit(1);
    }
  });

  // ── sgnl gsc sitemaps [siteUrl] ──────────────────────────────────────────
  attachDataCommonOptions(
    gsc
      .command('sitemaps [siteUrl]')
      .description('List submitted sitemaps with error/warning counts'),
  ).action(async (siteUrl: string | undefined, opts: DataSubcommandOptions) => {
    const output = resolveOutputFormat(opts);
    try {
      const auth = await prepareAuthAndProperty(siteUrl);
      if (!auth) process.exit(1);
      const { property, accessToken } = auth!;

      const request: RequestContext = {
        property,
        date_range: computeDateRange(),
        search_type: 'web',
        filters: {},
        dimensions: [],
      };

      if (output === 'terminal') {
        logger.info(`Fetching sitemaps for ${property}...`);
      }

      const sitemaps = (await fetchSitemaps(property, accessToken)) ?? [];
      const payload: any = { sitemaps };
      if (opts.verbose) payload.raw = sitemaps;
      const envelope: GSCEnvelope<typeof payload> = { request, gsc: payload };

      if (opts.save) {
        try {
          const runDir = createRunDir(`https://gsc/${encodeURIComponent(property)}`, 'gsc-sitemaps');
          fs.writeFileSync(path.join(runDir, 'gsc.json'), JSON.stringify(envelope, null, 2));
          fs.writeFileSync(path.join(runDir, 'gsc.md'), mdSitemaps(envelope));
          fs.writeFileSync(path.join(runDir, 'gsc.csv'), sitemapsToCsv(sitemaps));
          logger.info(`Saved to: ${runDir}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.warn(`Failed to save gsc sitemaps report: ${msg}`);
        }
      }

      if (output === 'json') {
        await flushStdout(JSON.stringify(envelope, null, 2) + '\n');
        return;
      }
      if (output === 'csv') {
        await flushStdout(sitemapsToCsv(sitemaps));
        return;
      }

      // Terminal
      console.log(`\nGSC Sitemaps — ${property}\n`);
      if (sitemaps.length === 0) {
        console.log('  No sitemaps submitted for this property.\n');
      } else {
        console.log(`  ${sitemaps.length} sitemap(s)\n`);
        for (const sm of sitemaps) {
          console.log(`  ${sm.path}`);
          const meta: string[] = [];
          if (sm.type) meta.push(sm.type);
          if (sm.last_submitted) meta.push(`submitted ${sm.last_submitted.slice(0, 10)}`);
          if (sm.last_downloaded) meta.push(`downloaded ${sm.last_downloaded.slice(0, 10)}`);
          if (meta.length > 0) console.log(`    ${meta.join('  ·  ')}`);
          console.log(`    errors: ${sm.errors}  warnings: ${sm.warnings}${sm.is_pending ? '  (pending)' : ''}`);
          if (sm.contents && sm.contents.length > 0) {
            for (const c of sm.contents) {
              console.log(`    ${c.type ?? 'items'}: ${c.submitted} submitted, ${c.indexed} indexed`);
            }
          }
          console.log('');
        }
      }
      await flushStdout('');
    } catch (err: unknown) {
      console.error(formatErrorForUser(err, output));
      process.exit(1);
    }
  });
}
