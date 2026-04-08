/**
 * SGNL CLI — content command (rewritten clean, 2026-04-05).
 *
 * Language-neutral content extractor. Fetches a URL, converts HTML to
 * markdown via split.py, then runs content_extract.py to get:
 *   - cleaned markdown body
 *   - objective stats (volume, distribution, structure, media, links, patterns)
 *   - heading outline
 *   - link inventory
 *   - image inventory
 *
 * No subjective judgment. No EEAT. No readability scores. No keyword
 * stuffing heuristics. No per-language stopword lists. The output is
 * designed to be fed to an LLM for any subjective analysis.
 *
 * This is a STANDALONE command. It does NOT feed the analyze pipeline.
 * The analyze pipeline still uses python/content_analysis.py — see
 * sgnl_cli_pipeline_architecture.md.
 */

import * as fs from 'fs';
import * as path from 'path';
import { Command } from 'commander';
import { safeFetch } from '../analysis/fetch';
import { runPythonScriptSafe } from '../analysis/python';
import { createRunDir } from '../analysis/run-reporter';
import { isValidUrl, parseHeaderFlags, buildFetchHeaders } from './helpers';
import { resolveConfig } from '../config';
import { formatErrorForUser } from '../errors';
import { logger } from '../utils/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ContentOptions = {
  output: string;
  device: string;
  statsOnly: boolean;
  bodyOnly: boolean;
  maxBodyChars?: string;
  save: boolean;
  verbose: boolean;
  timeout: string;
};

type ContentRequestContext = {
  url: string;
  final_url?: string;
  status?: number;
  ttfb_ms?: number;
  content_type?: string;
  content_length?: number;
  redirect_chain?: string[];
  device: 'mobile' | 'desktop';
};

type ContentPayload = Record<string, any>;

type ContentEnvelope = {
  request: ContentRequestContext;
  content: ContentPayload;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rawHtmlWordCount(html: string): number {
  if (!html) return 0;
  // Strip script/style, then tags, then count whitespace tokens.
  const noScript = html.replace(/<script\b[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[\s\S]*?<\/style>/gi, ' ');
  const noTags = noScript.replace(/<[^>]+>/g, ' ');
  const text = noTags.replace(/&[a-z#0-9]+;/gi, ' ');
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.length;
}

function num(n: unknown, fallback = 0): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
}

function fmtInt(n: unknown): string {
  const v = typeof n === 'number' ? n : 0;
  return v.toLocaleString('en-US');
}

// ---------------------------------------------------------------------------
// Outline rendering
// ---------------------------------------------------------------------------

type OutlineNode = { level: number; text: string; children: OutlineNode[] };

function renderOutline(nodes: OutlineNode[], indent = 0): string[] {
  const lines: string[] = [];
  for (const n of nodes) {
    const prefix = '    ' + '  '.repeat(indent);
    const hashes = '#'.repeat(n.level);
    lines.push(`${prefix}${hashes} ${n.text}`);
    if (n.children && n.children.length > 0) {
      lines.push(...renderOutline(n.children, indent + 1));
    }
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Terminal printer — concise, neutral. No colors.
// ---------------------------------------------------------------------------

function printContentTerminal(
  payload: ContentPayload,
  url: string,
  opts: { verbose: boolean; statsOnly: boolean; bodyOnly: boolean },
): void {
  const meta = payload.metadata ?? {};
  const stats = payload.stats ?? {};

  console.log(`\nContent — ${url}`);
  console.log(`  Language: ${meta.detected_language ?? 'und'}  |  Title: ${meta.title || '(none)'}`);

  if (opts.bodyOnly) {
    console.log('');
    console.log('  (body-only terminal mode is a no-op — use --save or --output json to get the body)');
    console.log('');
    return;
  }

  const vol = stats.volume ?? {};
  const dist = stats.distribution ?? {};
  const derived = stats.derived ?? {};
  const struct = stats.structure ?? {};
  const media = stats.media ?? {};
  const links = stats.links ?? {};
  const dup = stats.duplication ?? {};
  const pat = stats.patterns ?? {};

  console.log('');
  console.log('  Volume');
  console.log(`    Words: ${fmtInt(vol.word_count)}  |  Sentences: ${fmtInt(vol.sentence_count)}  |  Paragraphs: ${fmtInt(vol.paragraph_count)}`);
  const rt = derived.reading_time_minutes;
  const ld = derived.lexical_diversity;
  const ldL = derived.lexical_diversity_label;
  const ratioStr = derived.content_to_chrome_ratio != null ? `  |  Content/chrome: ${derived.content_to_chrome_ratio}` : '';
  console.log(`    Reading time: ${rt ?? 'n/a'} min  |  Lexical diversity: ${ld ?? 'n/a'}${ldL ? ` (${ldL})` : ''}${ratioStr}`);

  const pl = dist.paragraph_length;
  const sl = dist.sentence_length;
  if (pl) console.log(`    Paragraph length: min ${pl.min}  p50 ${pl.p50}  p90 ${pl.p90}  max ${pl.max}`);
  if (sl) console.log(`    Sentence length:  min ${sl.min}  p50 ${sl.p50}  p90 ${sl.p90}  max ${sl.max}`);

  console.log('');
  console.log('  Structure');
  const hierLabel = struct.heading_hierarchy_valid ? 'valid' : 'INVALID';
  const skipped = Array.isArray(struct.skipped_levels) && struct.skipped_levels.length > 0
    ? `, skipped: ${struct.skipped_levels.join(', ')}`
    : '';
  console.log(`    H1: ${num(struct.h1_count)}  H2: ${num(struct.h2_count)}  H3: ${num(struct.h3_count)}  H4+: ${num(struct.h4plus_count)}  (hierarchy: ${hierLabel}${skipped})`);
  const listCount = num(struct.lists_ordered) + num(struct.lists_unordered);
  console.log(`    Lists: ${listCount} (${num(struct.list_items_total)} items)  Tables: ${num(struct.tables)}  Code blocks: ${num(struct.code_blocks)}  Quotes: ${num(struct.blockquotes)}`);

  console.log('');
  console.log('  Media');
  console.log(`    Images: ${num(media.image_count)} (alt coverage ${media.alt_coverage ?? 0})`);
  console.log(`    Links: ${num(links.internal)} internal, ${num(links.external)} external, ${num(links.naked_urls)} naked URLs${links.total > 200 || links._truncated ? ' (inventory truncated)' : ''}`);

  console.log('');
  console.log('  Patterns');
  const years: number[] = Array.isArray(pat.year_mentions) ? pat.year_mentions : [];
  console.log(`    Years: ${years.length ? years.join(', ') : '(none)'}  |  Percentages: ${num(pat.percentage_count)}`);
  console.log(`    Duplicate paragraphs: ${num(dup.duplicate_paragraphs)}  |  Duplicate sentences: ${num(dup.duplicate_sentences)}`);

  if (!opts.statsOnly) {
    const outline = payload.outline as OutlineNode[] | undefined;
    if (outline && outline.length > 0) {
      console.log('');
      console.log('  Outline');
      const lines = renderOutline(outline, 0);
      for (const l of lines) console.log(l);
    }
  }

  console.log('');
  console.log('  (use --save or --output json to get cleaned body + inventories for AI)');

  if (opts.verbose) {
    console.log('\n  --- Raw payload (--verbose) ---');
    try {
      const raw = JSON.stringify(payload, null, 2);
      const truncated = raw.length > 4000 ? raw.slice(0, 4000) + '\n  ... (truncated, use --output json for full detail)' : raw;
      for (const line of truncated.split('\n')) console.log(`  ${line}`);
    } catch {
      console.log('  (unable to serialize payload)');
    }
  }

  console.log('');
}

// ---------------------------------------------------------------------------
// Stats markdown renderer (for --save content_stats.md)
// ---------------------------------------------------------------------------

export function buildContentStatsMd(payload: ContentPayload, url: string): string {
  const meta = payload.metadata ?? {};
  const stats = payload.stats ?? {};
  const vol = stats.volume ?? {};
  const dist = stats.distribution ?? {};
  const derived = stats.derived ?? {};
  const struct = stats.structure ?? {};
  const media = stats.media ?? {};
  const links = stats.links ?? {};
  const dup = stats.duplication ?? {};
  const pat = stats.patterns ?? {};

  const lines: string[] = [];
  lines.push(`# Content Stats — ${url}`);
  lines.push('');
  lines.push(`_Language_: ${meta.detected_language ?? 'und'}  |  _Title_: ${meta.title || '(none)'}`);
  if (meta.h1) lines.push(`_H1_: ${meta.h1}`);
  lines.push('');

  lines.push('## Volume');
  lines.push('| Metric | Value |');
  lines.push('| --- | --- |');
  lines.push(`| Word count | ${fmtInt(vol.word_count)} |`);
  lines.push(`| Char count | ${fmtInt(vol.char_count)} |`);
  lines.push(`| Char count (no spaces) | ${fmtInt(vol.char_count_no_spaces)} |`);
  lines.push(`| Sentence count | ${fmtInt(vol.sentence_count)} |`);
  lines.push(`| Paragraph count | ${fmtInt(vol.paragraph_count)} |`);
  lines.push(`| Reading time (min) | ${derived.reading_time_minutes ?? 'n/a'} |`);
  lines.push(`| Lexical diversity | ${derived.lexical_diversity ?? 'n/a'} (${derived.lexical_diversity_label ?? 'n/a'}) |`);
  if (derived.content_to_chrome_ratio != null) {
    lines.push(`| Content/chrome ratio | ${derived.content_to_chrome_ratio} |`);
  }
  lines.push('');

  lines.push('## Distribution');
  const pl = dist.paragraph_length ?? {};
  const sl = dist.sentence_length ?? {};
  lines.push('| Metric | min | p50 | p90 | max |');
  lines.push('| --- | --- | --- | --- | --- |');
  lines.push(`| Paragraph length (words) | ${pl.min ?? 0} | ${pl.p50 ?? 0} | ${pl.p90 ?? 0} | ${pl.max ?? 0} |`);
  lines.push(`| Sentence length (words) | ${sl.min ?? 0} | ${sl.p50 ?? 0} | ${sl.p90 ?? 0} | ${sl.max ?? 0} |`);
  lines.push('');

  lines.push('## Structure');
  lines.push('| Element | Count |');
  lines.push('| --- | --- |');
  lines.push(`| H1 | ${num(struct.h1_count)} |`);
  lines.push(`| H2 | ${num(struct.h2_count)} |`);
  lines.push(`| H3 | ${num(struct.h3_count)} |`);
  lines.push(`| H4+ | ${num(struct.h4plus_count)} |`);
  lines.push(`| Hierarchy valid | ${struct.heading_hierarchy_valid ? 'yes' : 'no'} |`);
  if (Array.isArray(struct.skipped_levels) && struct.skipped_levels.length > 0) {
    lines.push(`| Skipped levels | ${struct.skipped_levels.join(', ')} |`);
  }
  lines.push(`| Ordered lists | ${num(struct.lists_ordered)} |`);
  lines.push(`| Unordered lists | ${num(struct.lists_unordered)} |`);
  lines.push(`| List items | ${num(struct.list_items_total)} |`);
  lines.push(`| Tables | ${num(struct.tables)} |`);
  lines.push(`| Code blocks | ${num(struct.code_blocks)} |`);
  lines.push(`| Inline code | ${num(struct.inline_code)} |`);
  lines.push(`| Blockquotes | ${num(struct.blockquotes)} |`);
  lines.push('');

  lines.push('## Media');
  lines.push('| Metric | Value |');
  lines.push('| --- | --- |');
  lines.push(`| Images | ${num(media.image_count)} |`);
  lines.push(`| With alt | ${num(media.images_with_alt)} |`);
  lines.push(`| Missing alt | ${num(media.images_missing_alt)} |`);
  lines.push(`| Alt coverage | ${media.alt_coverage ?? 0} |`);
  lines.push(`| Links total | ${num(links.total)} |`);
  lines.push(`| Internal | ${num(links.internal)} |`);
  lines.push(`| External | ${num(links.external)} |`);
  lines.push(`| Naked URLs | ${num(links.naked_urls)} |`);
  lines.push('');

  lines.push('## Patterns');
  const years: number[] = Array.isArray(pat.year_mentions) ? pat.year_mentions : [];
  lines.push(`- Year mentions: ${years.length ? years.join(', ') : '(none)'}`);
  lines.push(`- Percentage mentions: ${num(pat.percentage_count)}`);
  lines.push(`- Naked URLs in body: ${num(pat.url_in_body_count)}`);
  lines.push(`- Duplicate paragraphs: ${num(dup.duplicate_paragraphs)}`);
  lines.push(`- Duplicate sentences: ${num(dup.duplicate_sentences)}`);
  lines.push('');

  const outline = payload.outline as OutlineNode[] | undefined;
  if (outline && outline.length > 0) {
    lines.push('## Outline');
    lines.push('');
    lines.push('```');
    for (const l of renderOutline(outline, 0)) lines.push(l.trimStart());
    lines.push('```');
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Save helpers
// ---------------------------------------------------------------------------

function buildContentMdWithFrontmatter(payload: ContentPayload, envelope: ContentEnvelope): string {
  const meta = payload.metadata ?? {};
  const fm: string[] = ['---'];
  fm.push(`url: ${envelope.request.url}`);
  if (envelope.request.final_url && envelope.request.final_url !== envelope.request.url) {
    fm.push(`final_url: ${envelope.request.final_url}`);
  }
  fm.push(`title: ${meta.title || '(none)'}`);
  fm.push(`description: ${meta.meta_description || '(none)'}`);
  fm.push(`lang: ${meta.detected_language || 'und'}`);
  fm.push(`fetched_at: ${new Date().toISOString()}`);
  fm.push('---');
  const body = typeof payload.body === 'string' ? payload.body : '';
  return `${fm.join('\n')}\n\n${body}`;
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function registerContentCommand(program: Command): void {
  program
    .command('content <url>')
    .description('Extract clean body + language-neutral stats for AI consumption')
    .option('--output <format>', 'Output format: terminal or json', 'terminal')
    .option('--device <type>', 'Device to emulate: mobile or desktop', 'mobile')
    .option('--stats-only', 'Omit body, outline, link_inventory, image_inventory', false)
    .option('--body-only', 'Emit only metadata + body (no stats/inventories/outline)', false)
    .option('--max-body-chars <n>', 'Truncate body to N characters')
    .option('--verbose', 'In terminal mode, also dump raw payload', false)
    .option('--save', 'Save content.md, content.json, content_stats.md to runs/', false)
    .option('--timeout <ms>', 'Timeout per step in ms', '30000')
    .option('-H, --header <header...>', 'Custom HTTP header(s) in "Name: Value" format')
    .action(async (url: string, options: ContentOptions & { header?: string[] }) => {
      if (!isValidUrl(url)) {
        console.error(`Error: Invalid URL "${url}". Must start with http:// or https://`);
        process.exit(2);
      }

      try {
        const device = (options.device === 'desktop' ? 'desktop' : 'mobile') as 'mobile' | 'desktop';
        const timeout = parseInt(options.timeout, 10);

        const config = resolveConfig();
        const headers = buildFetchHeaders(url, config, parseHeaderFlags(options.header));

        logger.info(`Fetching ${url}...`);
        const fetchResult = await safeFetch(url, { device, timeout, headers });

        if (!fetchResult.html) {
          console.error(`Error: No HTML received (HTTP ${fetchResult.status})`);
          process.exit(1);
        }

        // Cheap raw HTML word count (for content_to_chrome_ratio).
        const rawWords = rawHtmlWordCount(fetchResult.html);

        // Step 1: split.py → markdown
        logger.info('Extracting content...');
        const splitResult = await runPythonScriptSafe('split.py', fetchResult.html, timeout, url);
        const markdown: string = splitResult.data?.markdown ?? '';

        if (!markdown) {
          logger.warn('Could not extract markdown content');
        }

        // Extract title/description for meta (best-effort HTML scrape).
        const titleMatch = fetchResult.html.match(/<title[^>]*>([^<]*)<\/title>/i);
        const descMatch = fetchResult.html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i)
          ?? fetchResult.html.match(/<meta[^>]*content=["']([^"']*)["'][^>]*name=["']description["']/i);
        const canonMatch = fetchResult.html.match(/<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']*)["']/i);
        const finalUrl = (fetchResult.redirect_chain && fetchResult.redirect_chain.length > 0)
          ? fetchResult.redirect_chain[fetchResult.redirect_chain.length - 1]
          : url;

        const meta = {
          url: finalUrl,
          title: titleMatch?.[1]?.trim() ?? '',
          meta_description: descMatch?.[1]?.trim() ?? '',
          canonical: canonMatch?.[1]?.trim(),
          raw_html_word_count: rawWords,
        };

        // Step 2: content_extract.py → payload
        logger.info('Computing stats...');
        const extractResult = await runPythonScriptSafe(
          'content_extract.py',
          markdown || '',
          timeout,
          JSON.stringify(meta),
        );

        if (!extractResult.success || !extractResult.data) {
          console.error(`Error: content_extract.py failed${extractResult.error ? `: ${extractResult.error}` : ''}`);
          process.exit(1);
        }

        const payload: ContentPayload = { ...(extractResult.data as Record<string, any>) };

        // --max-body-chars: truncate body in-place and set a sibling flag.
        if (options.maxBodyChars) {
          const limit = parseInt(options.maxBodyChars, 10);
          if (Number.isFinite(limit) && limit > 0 && typeof payload.body === 'string' && payload.body.length > limit) {
            payload.body = payload.body.slice(0, limit);
            payload.body_truncated = true;
          }
        }

        // --stats-only: drop heavy fields.
        if (options.statsOnly) {
          delete payload.body;
          delete payload.outline;
          delete payload.link_inventory;
          delete payload.image_inventory;
          delete payload.body_truncated;
        }

        // --body-only: keep only metadata + body.
        if (options.bodyOnly) {
          const kept: ContentPayload = {
            metadata: payload.metadata,
            body: payload.body,
          };
          if (payload.body_truncated) kept.body_truncated = true;
          for (const k of Object.keys(payload)) delete payload[k];
          Object.assign(payload, kept);
        }

        // Build request context (matches performance.ts / schema.ts shape).
        const hdrs = (fetchResult.headers ?? {}) as Record<string, string>;
        const contentTypeHeader = hdrs['content-type'] ?? hdrs['Content-Type'];
        const contentLengthHeader = hdrs['content-length'] ?? hdrs['Content-Length'];
        const contentLength = contentLengthHeader ? parseInt(contentLengthHeader, 10) : undefined;

        const request: ContentRequestContext = {
          url,
          final_url: finalUrl,
          status: fetchResult.status,
          ttfb_ms: fetchResult.ttfb_ms,
          content_type: contentTypeHeader,
          content_length: Number.isFinite(contentLength) ? contentLength : undefined,
          redirect_chain: fetchResult.redirect_chain,
          device,
        };

        const envelope: ContentEnvelope = { request, content: payload };

        if (options.save) {
          try {
            const runDir = createRunDir(url, 'content');
            fs.writeFileSync(path.join(runDir, 'content.md'), buildContentMdWithFrontmatter(payload, envelope));
            fs.writeFileSync(path.join(runDir, 'content.json'), JSON.stringify(envelope, null, 2));
            fs.writeFileSync(path.join(runDir, 'content_stats.md'), buildContentStatsMd(payload, url));
            logger.info(`Saved to: ${runDir}`);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.warn(`Failed to save content report: ${msg}`);
          }
        }

        if (options.output === 'json') {
          process.stdout.write(JSON.stringify(envelope, null, 2) + '\n', () => { /* flushed */ });
          await new Promise<void>((resolve) => setImmediate(resolve));
          return;
        } else {
          printContentTerminal(payload, url, {
            verbose: options.verbose === true,
            statsOnly: options.statsOnly === true,
            bodyOnly: options.bodyOnly === true,
          });
          process.stdout.write('', () => { /* flushed */ });
          await new Promise<void>((resolve) => setImmediate(resolve));
          return;
        }
      } catch (err: unknown) {
        console.error(formatErrorForUser(err, options.output));
        process.exit(1);
      }
    });
}
