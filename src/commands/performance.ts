/**
 * SGNL CLI — performance command
 *
 * Path-B focused command: bypasses orchestrator/merger for terminal/JSON,
 * but the same expanded PSIResult shape is forwarded into mergeAnalysis via the
 * orchestrator so `sgnl analyze` consumers see every field too.
 */

import * as fs from 'fs';
import * as path from 'path';
import { Command } from 'commander';
import { callPSI, PSIResult, FieldData } from '../analysis/psi';
import { fetchCrUXData, CruxCollectionPeriod } from '../analysis/crux';
import {
  createRunDir,
  RunReportData,
  buildPsiDebugMd,
  buildPerformanceMd,
  PerformanceReport,
} from '../analysis/run-reporter';
import { isValidUrl } from './helpers';
import { formatErrorForUser } from '../errors';
import { logger } from '../utils/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PerfOptions = {
  output: string;
  device: string;
  strategy?: string;
  save: boolean;
  verbose: boolean;
  timeout: string;
};

type PerfEnvelope = {
  request: {
    url: string;
    strategy: 'mobile' | 'desktop' | 'both';
    elapsed_ms: number;
    crux_api_available: boolean;
    crux_scope?: 'url' | 'origin';
    crux_collection_period?: CruxCollectionPeriod;
  };
  performance: PerformanceReport | { mobile?: PerformanceReport; desktop?: PerformanceReport };
};

// ---------------------------------------------------------------------------
// Core Web Vitals verdict helper
// ---------------------------------------------------------------------------

/**
 * Compute CWV pass/fail verdict at p75 using field data.
 * Returns null if any of LCP / CLS / INP are missing (insufficient data).
 */
function computeCwvPassing(field: FieldData | null | undefined): boolean | null {
  if (!field) return null;
  const lcp = field.lcp?.value;
  const cls = field.cls?.value;
  const inp = field.inp?.value;
  if (lcp == null || cls == null || inp == null) return null;
  if (lcp === 0 && cls === 0 && inp === 0) return null; // all defaults → no data
  return lcp <= 2500 && cls <= 0.1 && inp <= 200;
}

// ---------------------------------------------------------------------------
// Build unified performance block from psi + crux data
// ---------------------------------------------------------------------------

function buildPerformanceReport(
  psi: PSIResult,
  crux: { data: FieldData | null; collectionPeriod?: CruxCollectionPeriod; scope?: 'url' | 'origin' } | null,
): PerformanceReport {
  // Prefer CrUX (direct API) over PSI loadingExperience.
  const field_data = crux?.data ?? psi.field_data ?? null;
  const cwv_passing = computeCwvPassing(field_data);

  return {
    url: psi.url,
    strategy: psi.strategy,
    cwv_passing,
    field_data,
    field_data_scope: crux?.data ? crux.scope : (psi.field_data ? 'url' : undefined),
    field_data_collection_period: crux?.collectionPeriod,
    lab_data: psi.lab_data,
    category_scores: psi.category_scores,
    resource_summary: psi.resource_summary,
    opportunities: psi.opportunities,
    lcp_element: psi.lcp_element,
    cls_elements: psi.cls_elements,
    render_blocking: psi.render_blocking,
    third_party: psi.third_party,
    bootup: psi.bootup,
    server_response_time_ms: psi.server_response_time_ms,
    request_count: psi.request_count,
    diagnostics: psi.diagnostics,
    ...(psi.error ? { error: psi.error } : {}),
  };
}

// ---------------------------------------------------------------------------
// Terminal printer
// ---------------------------------------------------------------------------

function statusSym(s: string | undefined): string {
  if (s === 'good') return 'good';
  if (s === 'warn') return 'needs-improvement';
  if (s === 'fail') return 'poor';
  return s ?? '';
}

function pct(n: number | undefined): string {
  if (n == null || Number.isNaN(n)) return '  --%';
  return `${(n * 100).toFixed(0).padStart(3, ' ')}%`;
}

function formatHistogram(metric: { distribution?: Array<{ proportion: number }> } | undefined): string {
  const d = metric?.distribution;
  if (!Array.isArray(d) || d.length < 3) return '';
  const [good, ni, poor] = d;
  return `    distribution: good ${pct(good.proportion)}  |  needs-improvement ${pct(ni.proportion)}  |  poor ${pct(poor.proportion)}`;
}

function printPerformanceTerminal(
  perf: PerformanceReport,
  url: string,
  verbose: boolean,
): void {
  console.log(`\nPerformance — ${url} (${perf.strategy})\n`);

  // --- Core Web Vitals verdict headline ---
  const verdict = perf.cwv_passing;
  const verdictLabel = verdict === true ? 'PASSING' : verdict === false ? 'FAILING' : 'Insufficient data';
  console.log(`  Core Web Vitals: ${verdictLabel}`);
  console.log('');

  // --- Lighthouse category scores ---
  const cats = perf.category_scores;
  const lab = perf.lab_data;
  if (cats) {
    console.log('  Lighthouse Scores');
    console.log(`    Performance: ${cats.performance}/100  |  Accessibility: ${cats.accessibility}/100`);
    console.log(`    Best Practices: ${cats.best_practices}/100  |  SEO: ${cats.seo}/100`);
    console.log('');
  } else if (lab) {
    console.log(`  Lighthouse Score: ${lab.performance_score}/100\n`);
  }

  // --- Lab metrics ---
  if (lab) {
    console.log('  Lab Metrics');
    console.log(`    Speed Index: ${lab.speed_index_s}s  |  TTI: ${lab.tti_s}s`);
    console.log(`    TBT: ${lab.tbt_ms}ms  |  CLS: ${lab.cls}`);
    if (perf.server_response_time_ms != null) {
      console.log(`    Server Response: ${perf.server_response_time_ms}ms`);
    }
    if (perf.request_count != null) {
      console.log(`    Network Requests: ${perf.request_count}`);
    }
  }

  // --- Field data (prefer CrUX; fall back to PSI loadingExperience) ---
  const field = perf.field_data;
  if (field) {
    const scopeLabel = perf.field_data_scope === 'origin' ? ' (origin-level data)' : '';
    console.log(`\n  Field Data (CrUX)${scopeLabel}`);
    const cp = perf.field_data_collection_period;
    if (cp?.firstDate && cp?.lastDate) {
      console.log(`    Collection period: ${cp.firstDate} → ${cp.lastDate}`);
    }
    if (field.lcp) {
      console.log(`    LCP: ${field.lcp.value}ms (${statusSym(field.lcp.status)})`);
      const hist = formatHistogram(field.lcp);
      if (hist) console.log(hist);
    }
    if (field.fcp && field.fcp.value > 0) {
      console.log(`    FCP: ${field.fcp.value}ms (${statusSym(field.fcp.status)})`);
    }
    if (field.cls) {
      console.log(`    CLS: ${field.cls.value} (${statusSym(field.cls.status)})`);
      const hist = formatHistogram(field.cls);
      if (hist) console.log(hist);
    }
    if (field.inp) {
      console.log(`    INP: ${field.inp.value}ms (${statusSym(field.inp.status)})`);
      const hist = formatHistogram(field.inp);
      if (hist) console.log(hist);
    }
    if (field.fid && field.fid.value > 0) {
      console.log(`    FID: ${field.fid.value}ms (${statusSym(field.fid.status)})`);
    }
  } else {
    console.log('\n  Field Data: not available (insufficient traffic data)');
  }

  // --- Resource summary (bytes + counts) ---
  const rs = perf.resource_summary;
  if (rs) {
    console.log('\n  Resource Summary');
    const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;
    const countSuffix = (c?: number) => (c != null ? ` (${c})` : '');
    console.log(`    Total: ${kb(rs.total_bytes)}${countSuffix(rs.total_requests)}`);
    console.log(`    Scripts: ${kb(rs.script_bytes)}${countSuffix(rs.script_requests)}  |  Styles: ${kb(rs.stylesheet_bytes)}${countSuffix(rs.stylesheet_requests)}`);
    console.log(`    Images: ${kb(rs.image_bytes)}${countSuffix(rs.image_requests)}  |  Fonts: ${kb(rs.font_bytes)}${countSuffix(rs.font_requests)}`);
  }

  // --- LCP element ---
  if (perf.lcp_element) {
    const el = perf.lcp_element;
    console.log('\n  LCP Element');
    if (el.selector) console.log(`    ${el.selector}`);
    if (el.nodeLabel) console.log(`    ${el.nodeLabel}`);
  }

  // --- CLS elements (top 5) ---
  if (perf.cls_elements && perf.cls_elements.length > 0) {
    console.log('\n  CLS Elements');
    for (const el of perf.cls_elements) {
      const scoreStr = el.score != null ? ` (score ${el.score.toFixed(4)})` : '';
      console.log(`    - ${el.selector ?? '(unknown)'}${scoreStr}`);
    }
  }

  // --- Render-blocking resources ---
  if (perf.render_blocking && perf.render_blocking.length > 0) {
    console.log('\n  Render-Blocking Resources');
    for (const r of perf.render_blocking) {
      const wasted = r.wastedMs != null ? ` (~${r.wastedMs}ms)` : '';
      console.log(`    - ${r.url}${wasted}`);
    }
  }

  // --- Third-party summary ---
  if (perf.third_party && perf.third_party.length > 0) {
    console.log('\n  Third-Party Summary');
    for (const tp of perf.third_party) {
      const bt = tp.blockingTime != null ? `${tp.blockingTime}ms block` : '';
      const ts = tp.transferSize != null ? `${Math.round(tp.transferSize / 1024)} KB` : '';
      const rhs = [bt, ts].filter(Boolean).join(', ');
      console.log(`    - ${tp.entity}${rhs ? `  (${rhs})` : ''}`);
    }
  }

  // --- Bootup time ---
  if (perf.bootup && perf.bootup.items.length > 0) {
    console.log('\n  Bootup Time' + (perf.bootup.total_ms != null ? ` (total: ${perf.bootup.total_ms}ms)` : ''));
    for (const b of perf.bootup.items) {
      const parts: string[] = [];
      if (b.scripting != null) parts.push(`scripting ${b.scripting}ms`);
      if (b.scriptParseCompile != null) parts.push(`parse/compile ${b.scriptParseCompile}ms`);
      console.log(`    - ${b.url}${parts.length ? `  (${parts.join(', ')})` : ''}`);
    }
  }

  // --- Diagnostics ---
  const diag = perf.diagnostics;
  if (diag && Object.values(diag).some(v => v != null)) {
    console.log('\n  Diagnostics');
    if (diag.dom_size != null) console.log(`    DOM size: ${diag.dom_size} elements`);
    if (diag.network_rtt != null) console.log(`    Network RTT: ${diag.network_rtt}ms`);
    if (diag.network_server_latency != null) console.log(`    Server latency: ${diag.network_server_latency}ms`);
    if (diag.total_tasks != null) console.log(`    Main-thread tasks: ${diag.total_tasks}`);
    if (diag.main_document_transfer_size != null) {
      console.log(`    Main document transfer: ${Math.round(diag.main_document_transfer_size / 1024)} KB`);
    }
  }

  // --- Opportunities ---
  if (perf.opportunities && perf.opportunities.length > 0) {
    const list = verbose ? perf.opportunities : perf.opportunities.slice(0, 5);
    console.log('\n  Opportunities');
    for (const opp of list) {
      const savingsMs = opp.savings_ms ? ` ~${opp.savings_ms}ms` : '';
      const savingsKb = opp.savings_bytes ? ` / ${(opp.savings_bytes / 1024).toFixed(0)} KB` : '';
      const saveStr = savingsMs || savingsKb ? ` (${savingsMs.trim()}${savingsKb})` : '';
      console.log(`    - ${opp.id}: ${opp.fix}${saveStr}`);
    }
    if (!verbose && perf.opportunities.length > 5) {
      console.log(`    ... and ${perf.opportunities.length - 5} more  (use --verbose to see all)`);
    }
  }

  console.log('');
}

// ---------------------------------------------------------------------------
// Single-strategy runner (mobile OR desktop)
// ---------------------------------------------------------------------------

async function runSingle(
  url: string,
  strategy: 'mobile' | 'desktop',
): Promise<{ perf: PerformanceReport; rawPsi: any; cruxMeta: { available: boolean; scope?: 'url' | 'origin'; collectionPeriod?: CruxCollectionPeriod } }> {
  const formFactor: 'PHONE' | 'DESKTOP' = strategy === 'desktop' ? 'DESKTOP' : 'PHONE';
  const [psiResult, cruxResult] = await Promise.allSettled([
    callPSI(url, strategy),
    fetchCrUXData(url, undefined, { formFactor }),
  ]);

  const psi = psiResult.status === 'fulfilled' ? psiResult.value : null;
  const crux = cruxResult.status === 'fulfilled' ? cruxResult.value : null;

  if (!psi || psi.error) {
    throw new Error(psi?.error ?? 'PageSpeed Insights call failed');
  }

  const perf = buildPerformanceReport(psi, crux);
  return {
    perf,
    rawPsi: psi._raw,
    cruxMeta: {
      available: !!crux && (!!crux.data || !!crux.raw),
      scope: crux?.scope,
      collectionPeriod: crux?.collectionPeriod,
    },
  };
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function registerPerformanceCommand(program: Command): void {
  program
    .command('performance <url>')
    .description('Analyze page performance: Core Web Vitals, speed metrics, opportunities')
    .option('--output <format>', 'Output format: terminal or json', 'terminal')
    .option('--device <type>', 'Device to emulate: mobile or desktop', 'mobile')
    .option('--strategy <type>', 'Strategy: mobile, desktop, or both (dual-strategy)')
    .option('--save', 'Save performance.md, performance.json, and psi_debug.md to runs/', false)
    .option('--verbose', 'Show all opportunities (default: top 5)', false)
    .option('--timeout <ms>', 'Timeout per analysis step in ms', '30000')
    .action(async (url: string, options: PerfOptions) => {
      if (!isValidUrl(url)) {
        console.error(`Error: Invalid URL "${url}". Must start with http:// or https://`);
        process.exit(2);
      }

      // --strategy both is mutually exclusive with --device (the latter is ignored).
      const strategyMode: 'mobile' | 'desktop' | 'both' = (() => {
        if (options.strategy === 'both') return 'both';
        if (options.strategy === 'desktop' || options.strategy === 'mobile') return options.strategy;
        // Fall back to --device
        return options.device === 'desktop' ? 'desktop' : 'mobile';
      })();

      try {
        const started = Date.now();
        let envelope: PerfEnvelope;
        let rawPsiByStrategy: { desktop?: any; mobile?: any } = {};

        if (strategyMode === 'both') {
          logger.info('Running PageSpeed Insights (mobile + desktop)...');
          const [mobileR, desktopR] = await Promise.all([
            runSingle(url, 'mobile'),
            runSingle(url, 'desktop'),
          ]);
          rawPsiByStrategy = { mobile: mobileR.rawPsi, desktop: desktopR.rawPsi };
          const elapsed_ms = Date.now() - started;
          // Use mobile's CrUX meta for the request envelope (both formFactors are queried).
          const cruxMeta = mobileR.cruxMeta;
          envelope = {
            request: {
              url,
              strategy: 'both',
              elapsed_ms,
              crux_api_available: cruxMeta.available,
              ...(cruxMeta.scope ? { crux_scope: cruxMeta.scope } : {}),
              ...(cruxMeta.collectionPeriod ? { crux_collection_period: cruxMeta.collectionPeriod } : {}),
            },
            performance: { mobile: mobileR.perf, desktop: desktopR.perf },
          };
        } else {
          logger.info(`Running PageSpeed Insights (${strategyMode})...`);
          const { perf, rawPsi, cruxMeta } = await runSingle(url, strategyMode);
          rawPsiByStrategy = strategyMode === 'desktop' ? { desktop: rawPsi } : { mobile: rawPsi };
          const elapsed_ms = Date.now() - started;
          envelope = {
            request: {
              url,
              strategy: strategyMode,
              elapsed_ms,
              crux_api_available: cruxMeta.available,
              ...(cruxMeta.scope ? { crux_scope: cruxMeta.scope } : {}),
              ...(cruxMeta.collectionPeriod ? { crux_collection_period: cruxMeta.collectionPeriod } : {}),
            },
            performance: perf,
          };
        }

        // --- --save: write performance.md + performance.json + psi_debug.md ---
        if (options.save) {
          try {
            const runDir = createRunDir(url, 'performance');
            const reportData: RunReportData = {
              url,
              statusCode: 200,
              headers: {},
              html: '',
              rawPsi: rawPsiByStrategy,
            };
            fs.writeFileSync(path.join(runDir, 'psi_debug.md'), buildPsiDebugMd(reportData));
            fs.writeFileSync(path.join(runDir, 'performance.md'), buildPerformanceMd(envelope));
            fs.writeFileSync(path.join(runDir, 'performance.json'), JSON.stringify(envelope, null, 2));
            logger.info(`Saved to: ${runDir}`);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.warn(`Failed to save performance report: ${msg}`);
          }
        }

        if (options.output === 'json') {
          process.stdout.write(JSON.stringify(envelope, null, 2) + '\n', () => process.exit(0));
        } else {
          if (strategyMode === 'both') {
            const perfs = envelope.performance as { mobile?: PerformanceReport; desktop?: PerformanceReport };
            if (perfs.mobile) printPerformanceTerminal(perfs.mobile, url, options.verbose === true);
            if (perfs.desktop) printPerformanceTerminal(perfs.desktop, url, options.verbose === true);
          } else {
            printPerformanceTerminal(envelope.performance as PerformanceReport, url, options.verbose === true);
          }
          process.stdout.write('', () => process.exit(0));
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        // Keep the legacy friendly wording so tests and users recognise it.
        console.error(`Error: PageSpeed Insights failed: ${msg}`);
        console.error('Make sure you have a PSI API key configured (run: sgnl init)');
        console.error(formatErrorForUser(err, options.output));
        process.exit(1);
      }
    });
}
