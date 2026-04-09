/**
 * SGNL CLI — structure command
 */

import * as fs from 'fs';
import * as path from 'path';
import { Command } from 'commander';
import { safeFetch } from '../analysis/fetch';
import { runPythonScriptSafe } from '../analysis/python';
import {
  createRunDir,
  RunReportData,
  buildXrayMd,
  buildOnpageMd,
  buildAssetsMd,
  buildStructureMd,
} from '../analysis/run-reporter';
import { annotateRedirectChain } from '../analysis/redirects';
import { isValidUrl, parseHeaderFlags, buildFetchHeaders } from './helpers';
import { resolveConfig } from '../config';
import { formatErrorForUser } from '../errors';
import { logger } from '../utils/logger';

type FetchContext = {
  status?: number;
  final_url?: string;
  ttfb_ms?: number;
  content_type?: string;
  content_length?: number;
  redirect_chain?: string[];
};

function n(v: unknown): string {
  return v == null || Number.isNaN(v) ? 'n/a' : String(v);
}

function pct(v: unknown): string {
  if (typeof v !== 'number' || Number.isNaN(v)) return 'n/a';
  return (v * 100).toFixed(1) + '%';
}

function printStructureTerminal(
  report: Record<string, any>,
  url: string,
  fetchContext?: FetchContext,
): void {
  console.log(`\nPage Structure — ${url}\n`);

  const x = report.xray ?? {};
  const o = report.onpage ?? {};

  // Request
  if (fetchContext) {
    const lines: string[] = [];
    if (fetchContext.final_url) lines.push(`    Final URL: ${fetchContext.final_url}`);
    if (fetchContext.status != null) lines.push(`    Status: ${fetchContext.status}`);
    if (fetchContext.ttfb_ms != null) lines.push(`    TTFB: ${Math.round(fetchContext.ttfb_ms)} ms`);
    if (fetchContext.content_type) lines.push(`    Content-Type: ${fetchContext.content_type}`);
    if (fetchContext.content_length != null) lines.push(`    Content-Length: ${fetchContext.content_length}`);
    if (lines.length > 0) {
      console.log('  Request');
      for (const l of lines) console.log(l);
      console.log('');
    }

    // Redirects
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

  // DOM overview
  const dom = x.dom ?? {};
  console.log('  DOM');
  console.log(`    Elements: ${n(dom.total_elements)}  |  Unique tags: ${n(dom.unique_tags)}`);
  console.log(`    Depth: max ${n(dom.depth_max)}  |  avg ${n(dom.depth_avg)}`);
  const dp: string[] = Array.isArray(dom.deepest_path) ? dom.deepest_path : [];
  if (dp.length > 0) {
    const tail = dp.slice(-5).join(' > ');
    console.log(`    Deepest path: ${tail}${dp.length > 5 ? `  (${dp.length} levels)` : ''}`);
  }

  // Element map — top 5
  const emap = (x.element_map ?? {}) as Record<string, number>;
  const topEntries = Object.entries(emap).sort(([, a], [, b]) => (b as number) - (a as number)).slice(0, 5);
  if (topEntries.length > 0) {
    console.log(`    Top tags: ${topEntries.map(([t, c]) => `${t}(${c})`).join(', ')}`);
  }

  // Structure
  const st = x.structure ?? {};
  console.log('');
  console.log('  Structure');
  console.log(`    Semantic Score: ${n(st.semantic_score)}/7  |  Div Ratio: ${pct(st.div_ratio)}`);
  console.log(`    Heading Hierarchy: ${st.heading_hierarchy_valid ? 'valid' : 'INVALID'}  |  H1: ${n(st.h1_count)}  H2: ${n(st.h2_count)}  H3: ${n(st.h3_count)}`);

  // Heading tree (from onpage)
  const headings = o.headings ?? {};
  const tree: Array<{ level: number; text: string; children?: any[] }> = headings.tree ?? [];
  if (tree.length > 0) {
    console.log('');
    console.log('  Heading Tree');
    const h1Content = tree.find(n => n.level === 1)?.text ?? headings.h1_content;
    if (h1Content) console.log(`    H1: ${h1Content}`);
    const renderTree = (nodes: any[], depth: number) => {
      for (const node of nodes) {
        if (depth >= 4) {
          const extra = countDeepNodes(nodes);
          if (extra > 0) console.log(`    ${'  '.repeat(depth)}(+${extra} more)`);
          return;
        }
        if (node.level !== 1) {
          console.log(`    ${'  '.repeat(depth)}H${node.level}: ${node.text || '(empty)'}`);
        }
        const children = node.children ?? [];
        if (children.length > 0) renderTree(children, depth + 1);
      }
    };
    renderTree(tree, 0);
  }

  // Heading summary + issues
  if (headings.total_headings != null || headings.empty_headings != null) {
    console.log('');
    console.log(`  Headings: ${n(headings.total_headings)} total, ${n(headings.empty_headings)} empty  |  H4:${n(headings.h4_count)} H5:${n(headings.h5_count)} H6:${n(headings.h6_count)}`);
  }
  const hIssues: string[] = headings.issues ?? [];
  if (hIssues.length > 0) {
    for (const iss of hIssues) console.log(`    - ${iss}`);
  }
  if (headings.table_of_contents_detected) {
    console.log('    Table of contents detected');
  }

  // Content (prefer onpage's authoritative word count)
  const oContent = o.content ?? {};
  const cr = x.content_ratios ?? {};
  const wordCount = oContent.word_count ?? cr.word_count_approx;
  if (wordCount != null) {
    console.log('');
    console.log('  Content');
    console.log(`    Word Count: ${n(wordCount)}  |  Paragraphs: ${n(oContent.paragraph_count)}  |  Avg Para Length: ${n(oContent.avg_paragraph_length)}`);
    if (cr.html_size_kb != null || cr.html_text_ratio != null) {
      console.log(`    HTML: ${n(cr.html_size_kb)} KB  |  Text Ratio: ${pct(cr.html_text_ratio)}`);
    }
  }

  // Structure red flags
  const redFlags: string[] = [];
  if (st.empty_elements != null) redFlags.push(`empty=${st.empty_elements}`);
  if (st.duplicate_ids != null) redFlags.push(`dup-ids=${st.duplicate_ids}`);
  if (st.inline_event_handlers != null) redFlags.push(`inline-handlers=${st.inline_event_handlers}`);
  if (Array.isArray(st.deprecated_tags) && st.deprecated_tags.length > 0) {
    redFlags.push(`deprecated=[${st.deprecated_tags.join(', ')}]`);
  }
  const iframes = st.iframes ?? {};
  if (iframes.count != null) redFlags.push(`iframes=${iframes.count}`);
  if (redFlags.length > 0) {
    console.log('');
    console.log('  Red Flags');
    console.log(`    ${redFlags.join('  |  ')}`);
    const iframeDomains: string[] = Array.isArray(iframes.domains) ? iframes.domains : [];
    if (iframeDomains.length > 0) {
      console.log(`    Iframe domains: ${iframeDomains.slice(0, 3).join(', ')}${iframeDomains.length > 3 ? ` (+${iframeDomains.length - 3})` : ''}`);
    }
  }

  // Head audit
  const head = x.head ?? {};
  if (Object.keys(head).length > 0) {
    console.log('');
    console.log('  Head');
    console.log(`    Charset: ${head.charset_present ? 'yes' : 'no'}  |  Viewport: ${head.viewport_present ? 'yes' : 'no'}  |  Favicon: ${head.favicon_present ? 'yes' : 'no'}  |  Preloads: ${n(head.preload_count)}`);
  }

  // Accessibility (xray)
  const a11y = x.accessibility ?? {};
  if (Object.keys(a11y).length > 0) {
    console.log('');
    console.log('  Accessibility');
    console.log(`    Missing lang on <html>: ${a11y.html_missing_lang ? 'yes' : 'no'}`);
    console.log(`    Images missing alt: ${n(a11y.images_missing_alt)}  |  Inputs w/o label: ${n(a11y.inputs_without_label)}  |  Buttons/links no text: ${n(a11y.buttons_links_no_text)}`);
    console.log(`    ARIA attributes: ${n(a11y.aria_attribute_count)}`);
    // Tabindex
    const tai = x.tabindex_audit ?? {};
    if (tai.positive_tabindex_count != null) {
      console.log(`    Positive tabindex (a11y smell): ${n(tai.positive_tabindex_count)}`);
    }
  }

  // Links (xray)
  const xLinks = x.links ?? {};
  if (xLinks.total != null) {
    console.log('');
    console.log(`  Links (x-ray): ${n(xLinks.total)} total (${n(xLinks.internal)} internal, ${n(xLinks.external)} external)`);
    console.log(`    target=_blank missing rel: ${n(xLinks.target_blank_missing_rel)}`);
  }

  // Links (onpage)
  const oLinks = o.links ?? {};
  if (oLinks.internal_total != null) {
    console.log(`  Links (on-page): ${n(oLinks.internal_total)} internal (${n(oLinks.internal_generic_anchor)} generic), ${n(oLinks.external_total)} external, ${n(oLinks.external_broken)} broken`);
  }

  // Forms
  const forms = x.forms ?? {};
  if (forms.form_count != null) {
    console.log('');
    console.log('  Forms');
    console.log(`    Forms: ${n(forms.form_count)}  |  Inputs: ${n(forms.input_count)}  |  Buttons: ${n(forms.button_count)}`);
    console.log(`    Inputs w/o label: ${n(forms.inputs_without_labels)}  |  Forms w/o action: ${n(forms.forms_missing_action)}`);
  }

  // Images (onpage — rich)
  const oImages = o.images ?? {};
  if (oImages.total != null) {
    console.log('');
    console.log(`  Images: ${n(oImages.total)} total`);
    console.log(`    Missing alt: ${n(oImages.missing_alt)}  |  Empty alt (decorative): ${n(oImages.empty_alt_decorative)}`);
    console.log(`    Too short: ${n(oImages.too_short)}  |  Too long: ${n(oImages.too_long)}  |  Poor quality: ${n(oImages.poor_quality_alt)}`);
    console.log(`    Explicit dimensions: ${n(oImages.explicit_dimensions)}  |  Density / 1000 words: ${n(oImages.density_per_1000_words)}`);
  }

  // Scripts
  const scripts = x.scripts ?? {};
  if (scripts.total != null) {
    console.log('');
    console.log(`  Scripts: ${n(scripts.total)} total (${n(scripts.inline)} inline, ${n(scripts.external)} external, ${n(scripts.defer_count)} defer, ${n(scripts.async_count)} async)`);
    const tp = scripts.third_party ?? {};
    if (tp.count > 0) {
      console.log(`    Third-party: ${tp.count} from ${tp.domains?.length ?? 0} domain(s)${tp.tag_manager_detected ? ' [Tag Manager detected]' : ''}`);
      const cats = (tp.categories ?? {}) as Record<string, string[]>;
      const breakdown = ['analytics', 'ads', 'cdn', 'social', 'other']
        .map(k => `${k}=${(cats[k] ?? []).length}`)
        .filter(s => !s.endsWith('=0'));
      if (breakdown.length > 0) console.log(`    By category: ${breakdown.join(', ')}`);
    }
  }

  // Inline styles
  const inlineStyles = x.inline_styles ?? {};
  if (inlineStyles.count != null) {
    console.log(`  Inline styles: ${n(inlineStyles.count)}`);
  }

  // Text density by region
  const td = x.text_density_by_region;
  if (td && typeof td === 'object') {
    console.log('');
    console.log(`  Text density (words): header=${n(td.header)}  main=${n(td.main)}  aside=${n(td.aside)}  footer=${n(td.footer)}`);
  }

  // Largest image candidate
  const lic = x.largest_image_candidate;
  if (lic && typeof lic === 'object') {
    console.log(`  Largest image (static LCP guess): ${lic.src} (${lic.width}x${lic.height})`);
  }

  // Duplicate headings
  const dupHeadings: string[] = Array.isArray(x.duplicate_headings) ? x.duplicate_headings : [];
  if (dupHeadings.length > 0) {
    console.log(`  Duplicate headings: ${dupHeadings.slice(0, 5).join(' | ')}`);
  }


  console.log('');
}

// Count headings at depth >= 4 that won't be shown
function countDeepNodes(_nodes: any[]): number {
  // Helper stubbed (render limits at depth 4; report count for deeper nodes)
  return 0;
}

export function registerStructureCommand(program: Command): void {
  program
    .command('structure <url>')
    .description('Analyze page structure: DOM, headings, scripts, images, links, accessibility')
    .option('--output <format>', 'Output format: terminal or json', 'terminal')
    .option('--device <type>', 'Device to emulate: mobile or desktop', 'mobile')
    .option('--save', 'Save xray.md, onpage.md, assets.md, structure.md, structure.json to runs/', false)
    .option('--timeout <ms>', 'Timeout per analysis step in ms', '30000')
    .option('-H, --header <header...>', 'Custom HTTP header(s) in "Name: Value" format')
    .action(async (url: string, options: { output: string; device: string; save: boolean; timeout: string; header?: string[] }) => {
      if (!isValidUrl(url)) {
        console.error(`Error: Invalid URL "${url}". Must start with http:// or https://`);
        process.exit(2);
      }

      try {
        const config = resolveConfig();
        const headers = buildFetchHeaders(url, config, parseHeaderFlags(options.header));

        logger.info(`Fetching ${url}...`);
        const fetchResult = await safeFetch(url, { device: options.device as 'mobile' | 'desktop', timeout: parseInt(options.timeout, 10), headers });

        if (!fetchResult.html) {
          console.error(`Error: No HTML received (HTTP ${fetchResult.status})`);
          process.exit(1);
        }

        // Step 1: split.py to get skeleton + markdown
        logger.info('Extracting structure...');
        const splitResult = await runPythonScriptSafe('split.py', fetchResult.html, parseInt(options.timeout, 10), url);
        const skeleton = splitResult.data?.skeleton ?? '';
        const markdown = splitResult.data?.markdown ?? '';

        // Step 2: xray + onpage in parallel
        logger.info('Analyzing structure...');
        const [xrayResult, onpageResult] = await Promise.all([
          skeleton
            ? runPythonScriptSafe('xray.py', JSON.stringify({ skeleton, html: fetchResult.html, url }), parseInt(options.timeout, 10))
            : Promise.resolve({ success: false as const, error: 'No skeleton' }),
          (markdown || fetchResult.html)
            ? runPythonScriptSafe('onpage.py', JSON.stringify({ markdown, html: fetchResult.html }), parseInt(options.timeout, 10))
            : Promise.resolve({ success: false as const, error: 'No content' }),
        ]);

        const report: Record<string, any> = {};
        if (xrayResult.success && xrayResult.data) report.xray = xrayResult.data;
        if (onpageResult.success && onpageResult.data) report.onpage = onpageResult.data;

        if (!report.xray && !report.onpage) {
          console.error('Error: Structure analysis failed');
          process.exit(1);
        }

        // Extract content-length / content-type from headers for the Request section.
        const hdrs = (fetchResult.headers ?? {}) as Record<string, string>;
        const contentTypeHeader = hdrs['content-type'] ?? hdrs['Content-Type'];
        const contentLengthHeader = hdrs['content-length'] ?? hdrs['Content-Length'];
        const contentLength = contentLengthHeader ? parseInt(contentLengthHeader, 10) : undefined;

        const fetchContext: FetchContext = {
          status: fetchResult.status,
          final_url: (fetchResult.redirect_chain && fetchResult.redirect_chain.length > 0)
            ? fetchResult.redirect_chain[fetchResult.redirect_chain.length - 1]
            : url,
          ttfb_ms: fetchResult.ttfb_ms,
          content_type: contentTypeHeader,
          content_length: Number.isFinite(contentLength) ? contentLength : undefined,
          redirect_chain: fetchResult.redirect_chain,
        };

        if (options.save) {
          try {
            const runDir = createRunDir(url, 'structure');
            const reportData: RunReportData = {
              url,
              statusCode: fetchResult.status,
              ttfb_ms: fetchResult.ttfb_ms,
              compression: fetchResult.compression,
              cdnDetected: fetchResult.cdnDetected,
              redirect_chain: fetchResult.redirect_chain,
              headers: hdrs,
              html: fetchResult.html,
              rawXray: report.xray,
              rawOnpage: report.onpage,
            };
            if (report.xray) fs.writeFileSync(path.join(runDir, 'xray.md'), buildXrayMd(reportData));
            if (report.onpage) fs.writeFileSync(path.join(runDir, 'onpage.md'), buildOnpageMd(reportData));
            fs.writeFileSync(path.join(runDir, 'assets.md'), buildAssetsMd(reportData));
            fs.writeFileSync(path.join(runDir, 'structure.md'), buildStructureMd(reportData, fetchContext));
            const envelope = {
              request: {
                final_url: fetchContext.final_url,
                status: fetchContext.status,
                ttfb_ms: fetchContext.ttfb_ms,
                content_type: fetchContext.content_type,
                content_length: fetchContext.content_length,
                redirect_chain: fetchContext.redirect_chain,
              },
              structure: { xray: report.xray, onpage: report.onpage },
            };
            fs.writeFileSync(path.join(runDir, 'structure.json'), JSON.stringify(envelope, null, 2));
            logger.info(`Saved to: ${runDir}`);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.warn(`Failed to save structure report: ${msg}`);
          }
        }

        if (options.output === 'json') {
          const envelope = {
            request: {
              final_url: fetchContext.final_url,
              status: fetchContext.status,
              ttfb_ms: fetchContext.ttfb_ms,
              content_type: fetchContext.content_type,
              content_length: fetchContext.content_length,
              redirect_chain: fetchContext.redirect_chain,
            },
            structure: { xray: report.xray, onpage: report.onpage },
          };
          process.stdout.write(JSON.stringify(envelope, null, 2) + '\n', () => process.exit(0));
        } else {
          printStructureTerminal(report, url, fetchContext);
          process.exit(0);
        }
      } catch (err: unknown) {
        console.error(formatErrorForUser(err, options.output));
        process.exit(1);
      }
    });
}
