/**
 * SGNL CLI — schema command
 *
 * Path-B focused command: validates JSON-LD structured data and emits a
 * `{ request, schema }` envelope that matches the technical / structure /
 * robots / performance shape.
 */

import * as fs from 'fs';
import * as path from 'path';
import { Command } from 'commander';
import { safeFetch } from '../analysis/fetch';
import { runSchemaValidation, SchemaReport } from '../analysis/schema';
import {
  createRunDir,
  RunReportData,
  buildSchemaValidationMd,
} from '../analysis/run-reporter';
import { isValidUrl, parseHeaderFlags, buildFetchHeaders } from './helpers';
import { resolveConfig } from '../config';
import { formatErrorForUser } from '../errors';
import { logger } from '../utils/logger';

type SchemaOptions = {
  output: string;
  device: string;
  save: boolean;
  verbose: boolean;
  timeout: string;
};

type SchemaRequestContext = {
  url: string;
  final_url?: string;
  status?: number;
  ttfb_ms?: number;
  content_type?: string;
  content_length?: number;
  redirect_chain?: string[];
  device: 'mobile' | 'desktop';
};

type SchemaEnvelope = {
  request: SchemaRequestContext;
  schema: SchemaReport;
};

// ---------------------------------------------------------------------------
// Terminal printer
// ---------------------------------------------------------------------------

function printSchemaTerminal(
  report: SchemaReport,
  url: string,
  request: SchemaRequestContext,
  verbose: boolean,
): void {
  console.log(`\nSchema.org Validation — ${url}\n`);

  // Request
  const reqLines: string[] = [];
  if (request.status != null) reqLines.push(`    Status: ${request.status}`);
  if (request.ttfb_ms != null) reqLines.push(`    TTFB: ${Math.round(request.ttfb_ms)} ms`);
  if (request.content_type) reqLines.push(`    Content-Type: ${request.content_type}`);
  if (reqLines.length > 0) {
    console.log('  Request');
    for (const l of reqLines) console.log(l);
    console.log('');
  }

  if (report.blocks_found === 0) {
    console.log('  No JSON-LD structured data found on this page.\n');
    console.log('  Recommendation: Add JSON-LD markup for your primary content type');
    console.log('  (Article, Product, LocalBusiness, etc.) to enable Google rich results.\n');
    return;
  }

  // Summary
  const summary = report.summary;
  console.log(`  Blocks found: ${report.blocks_found}`);
  if (summary) {
    if (summary.valid_blocks != null && summary.total_blocks != null) {
      console.log(`  Valid blocks: ${summary.valid_blocks}/${summary.total_blocks}`);
    }
    if ((report as any).overall_score != null) {
      console.log(`  Overall score: ${(report as any).overall_score}/100`);
    }
    if (summary.rich_results_ineligible && summary.rich_results_ineligible.length > 0) {
      console.log(`  Rich results ineligible: ${summary.rich_results_ineligible.join(', ')}`);
    }
    if (summary.duplicate_types && summary.duplicate_types.length > 0) {
      console.log(`  Duplicate types: ${summary.duplicate_types.join(', ')}`);
    }
  }
  console.log('');

  report.blocks.forEach((block, i) => {
    const scoreStr = block.score != null ? `  [${block.score}/100]` : '';
    console.log(`  ${i + 1}. ${block.type}${scoreStr}`);

    const req = block.validation.required;
    if (req.fields.length > 0) {
      console.log(`     Required:  ${req.present.length > 0 ? req.present.join(', ') : '(none)'}  (${req.present.length}/${req.fields.length})`);
      if (req.missing.length > 0) {
        console.log(`     Missing:   ${req.missing.join(', ')}`);
      }
    }

    const rec = block.validation.recommended;
    if (rec.present.length > 0 || rec.missing.length > 0) {
      if (rec.present.length > 0) {
        console.log(`     Recommended: ${rec.present.join(', ')}  (${rec.present.length}/${rec.fields.length})`);
      }
      if (rec.missing.length > 0) {
        console.log(`     Rec. missing: ${rec.missing.join(', ')}`);
      }
    }

    for (const err of block.validation.format_errors) {
      console.log(`     Format:   ${err.message}`);
    }

    for (const warn of block.validation.warnings) {
      console.log(`     Warning:  ${warn.message}`);
    }

    const rr = block.rich_results;
    if (rr.eligible) {
      console.log(`     Rich Results: ELIGIBLE (${rr.types.join(', ')})`);
    } else if (rr.missing_for_eligibility.length > 0) {
      console.log(`     Rich Results: NOT ELIGIBLE (missing: ${rr.missing_for_eligibility.join(', ')})`);
    }

    if (verbose) {
      try {
        const raw = JSON.stringify(block.raw_json, null, 2);
        const truncated = raw.length > 600 ? raw.slice(0, 600) + '\n     ... (truncated)' : raw;
        console.log('     Raw JSON-LD:');
        for (const line of truncated.split('\n')) {
          console.log(`       ${line}`);
        }
      } catch {
        /* ignore serialization issues */
      }
    }

    console.log('');
  });

  if (report.recommendations.length > 0) {
    console.log('  Recommendations:');
    for (const rec of report.recommendations) {
      const tag = rec.priority === 'high' ? 'HIGH' : rec.priority === 'medium' ? 'MED' : 'LOW';
      const pad = tag === 'MED' ? ' ' : tag === 'LOW' ? ' ' : '';
      console.log(`    [${tag}]${pad} ${rec.type}: ${rec.message}`);
    }
    console.log('');
  }

  console.log('  Note: Only JSON-LD markup is validated. Microdata and RDFa are not checked.\n');
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function registerSchemaCommand(program: Command): void {
  program
    .command('schema <url>')
    .description('Validate Schema.org structured data (JSON-LD) on a page')
    .option('--output <format>', 'Output format: terminal or json', 'terminal')
    .option('--device <type>', 'Device to emulate: mobile or desktop', 'mobile')
    .option('--save', 'Save schema.md, schema.json, and per-block JSON-LD files to runs/', false)
    .option('--verbose', 'Print raw JSON-LD per block (truncated) in terminal mode', false)
    .option('--timeout <ms>', 'Timeout per analysis step in ms', '30000')
    .option('-H, --header <header...>', 'Custom HTTP header(s) in "Name: Value" format')
    .action(async (url: string, options: SchemaOptions & { header?: string[] }) => {
      if (!isValidUrl(url)) {
        console.error(`Error: Invalid URL "${url}". Must start with http:// or https://`);
        process.exit(2);
      }

      try {
        const config = resolveConfig();
        const cliHeaders = buildFetchHeaders(url, config, parseHeaderFlags(options.header));

        logger.info(`Fetching ${url}...`);
        const device = (options.device === 'desktop' ? 'desktop' : 'mobile') as 'mobile' | 'desktop';
        const fetchResult = await safeFetch(url, { device, timeout: parseInt(options.timeout, 10), headers: cliHeaders });

        if (!fetchResult.html) {
          console.error(`Error: No HTML received (HTTP ${fetchResult.status})`);
          process.exit(1);
        }

        logger.info('Validating schema markup...');
        const report = await runSchemaValidation(fetchResult.html, parseInt(options.timeout, 10));

        if (!report) {
          console.error('Error: Schema validation failed');
          process.exit(1);
        }

        // Build request context from safeFetch result
        const hdrs = (fetchResult.headers ?? {}) as Record<string, string>;
        const contentTypeHeader = hdrs['content-type'] ?? hdrs['Content-Type'];
        const contentLengthHeader = hdrs['content-length'] ?? hdrs['Content-Length'];
        const contentLength = contentLengthHeader ? parseInt(contentLengthHeader, 10) : undefined;
        const finalUrl = (fetchResult.redirect_chain && fetchResult.redirect_chain.length > 0)
          ? fetchResult.redirect_chain[fetchResult.redirect_chain.length - 1]
          : url;

        const request: SchemaRequestContext = {
          url,
          final_url: finalUrl,
          status: fetchResult.status,
          ttfb_ms: fetchResult.ttfb_ms,
          content_type: contentTypeHeader,
          content_length: Number.isFinite(contentLength) ? contentLength : undefined,
          redirect_chain: fetchResult.redirect_chain,
          device,
        };

        const envelope: SchemaEnvelope = { request, schema: report };

        // --- --save: write schema.md + schema.json + per-block JSON-LD ---
        if (options.save) {
          try {
            const runDir = createRunDir(url, 'schema');

            // Per-block raw JSON-LD files (keep existing feature)
            report.blocks.forEach((block, i) => {
              const typeName = (block.type || 'unknown').replace(/[^a-zA-Z0-9]/g, '_');
              fs.writeFileSync(
                path.join(runDir, `${i + 1}_${typeName}.json`),
                JSON.stringify(block.raw_json, null, 2),
              );
            });

            const reportData: RunReportData = {
              url,
              statusCode: fetchResult.status,
              ttfb_ms: fetchResult.ttfb_ms,
              compression: fetchResult.compression,
              cdnDetected: fetchResult.cdnDetected,
              redirect_chain: fetchResult.redirect_chain,
              headers: hdrs,
              html: '',
              rawSchemaValidation: report as unknown as Record<string, any>,
            };
            fs.writeFileSync(path.join(runDir, 'schema.md'), buildSchemaValidationMd(reportData));
            fs.writeFileSync(path.join(runDir, 'schema.json'), JSON.stringify(envelope, null, 2));
            logger.info(`Saved to: ${runDir}`);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.warn(`Failed to save schema report: ${msg}`);
          }
        }

        if (options.output === 'json') {
          process.stdout.write(JSON.stringify(envelope, null, 2) + '\n', () => { /* flushed */ });
          await new Promise<void>((resolve) => setImmediate(resolve));
          return;
        } else {
          printSchemaTerminal(report, url, request, options.verbose === true);
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
