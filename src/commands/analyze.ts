/**
 * SGNL CLI — analyze command
 */

import { Command } from 'commander';
import { buildReport, buildReportStream } from '../analysis/orchestrator';
import { crawlSite, formatTreeAsAscii } from '../analysis/link-crawler';
import { isValidUrl, parseHeaderFlags, buildFetchHeaders } from './helpers';
import { resolveConfig } from '../config';
import { SgnlError, formatErrorForUser } from '../errors';

export function registerAnalyzeCommand(program: Command): void {
  program
    .command('analyze <url>')
    .description('Analyze a URL for performance, SEO, and structure')
    .option('--output <format>', 'Output format: terminal (default) or json', 'terminal')
    .option('--debug', 'Include raw analysis data in output', false)
    .option('--skip-python', 'Skip Python analysis layer (faster, but no DOM/SEO analysis)', false)
    .option('--python-only', 'Run Python analysis only, skip PageSpeed Insights', false)
    .option('--stream', 'Enable streaming output (show partial results as soon as available)', false)
    .option('--follow', 'Crawl internal links and build link tree', false)
    .option('--depth <number>', 'Maximum crawl depth for --follow', '3')
    .option('--max-pages <number>', 'Maximum pages to crawl for --follow', '100')
    .option('--include <pattern>', 'Include only paths matching pattern (e.g., /blog/*)', '')
    .option('--exclude <pattern>', 'Exclude paths matching pattern (e.g., /admin/*)', '')
    .option('--device <type>', 'Device to emulate: mobile or desktop', 'mobile')
    .option('--save', 'Save .md report files to runs/ directory', false)
    .option('--timeout <ms>', 'Timeout per analysis step in ms', '30000')
    .option('-v, --verbose', 'Print full detailed report to terminal', false)
    .option('-H, --header <header...>', 'Custom HTTP header(s) in "Name: Value" format')
    .action(async (url: string, options: { output: string; debug: boolean; skipPython: boolean; pythonOnly: boolean; stream: boolean; follow: boolean; depth: string; maxPages: string; include: string; exclude: string; device: string; save: boolean; timeout: string; verbose: boolean; header?: string[] }) => {
      // Validate URL
      if (!isValidUrl(url)) {
        console.error(`Error: Invalid URL "${url}". Must start with http:// or https://`);
        process.exit(2);
      }

      const config = resolveConfig();
      const headers = buildFetchHeaders(url, config, parseHeaderFlags(options.header));

      try {
        // Handle --follow flag for link tree crawler
        if (options.follow) {
          const maxDepth = Math.max(1, parseInt(options.depth, 10) || 3);
          const maxPages = Math.max(1, parseInt(options.maxPages, 10) || 100);

          const crawlResult = await crawlSite(url, {
            maxDepth,
            maxPages,
            includePatterns: options.include ? [options.include] : undefined,
            excludePatterns: options.exclude ? [options.exclude] : undefined,
          });

          if (options.output === 'json') {
            process.stdout.write(JSON.stringify(crawlResult, null, 2) + '\n', () => process.exit(0));
          } else {
            // Terminal output: ASCII tree format
            const asciiTree = formatTreeAsAscii(crawlResult, url);
            console.log('\nLink Tree:');
            console.log(asciiTree);
            console.log(`\nCrawl Summary:`);
            console.log(`  Pages crawled: ${crawlResult.crawl_config.pages_crawled}/${crawlResult.crawl_config.pages_limit}`);
            console.log(`  Max depth: ${crawlResult.crawl_config.depth}`);
            console.log(`  External links: ${crawlResult.external_links.length}`);
            console.log(`  Errors: ${crawlResult.errors.length}`);
            process.exit(0);
          }
        } else if (options.output === 'json') {
          // JSON mode: run pipeline, print JSON
          if (options.stream) {
            // Streaming JSON: output each report as it arrives
            for await (const report of buildReportStream(url, {
              skipPython: options.skipPython,
              skipPSI: options.pythonOnly,
              device: options.device as 'mobile' | 'desktop',
              save: options.save,
              timeout: parseInt(options.timeout, 10),
              headers,
            })) {
              if (!options.debug && report._raw) delete report._raw;
              process.stdout.write(JSON.stringify(report, null, 2) + '\n');
            }
            process.exit(0);
          } else {
            // Non-streaming: wait for final report
            const report = await buildReport(url, {
              skipPython: options.skipPython,
              skipPSI: options.pythonOnly,
              device: options.device as 'mobile' | 'desktop',
              save: options.save,
              timeout: parseInt(options.timeout, 10),
              headers,
            });
            if (!options.debug && report._raw) delete report._raw;
            process.stdout.write(JSON.stringify(report, null, 2) + '\n', () => process.exit(0));
          }
        } else {
          // Terminal UI mode — render live App (handles pipeline internally)
          try {
            const React = await import('react');
            const { render } = await import('ink');
            const { App } = await import('../ui/App');
            const { ErrorBoundary } = await import('../ui/ErrorBoundary');
            const { waitUntilExit } = render(
              React.default.createElement(ErrorBoundary, null,
                React.default.createElement(App, {
                  url,
                  flags: { skipPython: options.skipPython, pythonOnly: options.pythonOnly, device: options.device as 'mobile' | 'desktop', save: options.save, verbose: options.verbose },
                })
              )
            );
            await waitUntilExit();
            process.exit(0);
          } catch (renderErr: unknown) {
            const msg = renderErr instanceof Error ? renderErr.message : String(renderErr);
            console.error(`UI render error: ${msg}`);
            // Fallback: run pipeline and print JSON
            const report = await buildReport(url, { skipPython: options.skipPython, skipPSI: options.pythonOnly, device: options.device as 'mobile' | 'desktop', save: options.save, timeout: parseInt(options.timeout, 10), headers });
            console.log('\nFallback JSON output:');
            console.log(JSON.stringify(report, null, 2));
            process.exit(0);
          }
        }
      } catch (err: unknown) {
        console.error(formatErrorForUser(err, options.output));
        process.exit(1);
      }
    });
}
