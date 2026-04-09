import * as fs from 'fs';
import * as path from 'path';
import { loadConfig } from '../config';
import type { ResolvedConfig } from '../config';
import { buildReportMd } from './report-md';
import type {
  FieldData,
  LabData,
  CategoryScores,
  ResourceSummary,
  Opportunity,
  LcpElement,
  ClsElement,
  RenderBlockingResource,
  ThirdPartyEntry,
  BootupEntry,
  PsiDiagnostics,
} from './psi';
import type { CruxCollectionPeriod } from './crux';

export interface RunReportData {
  url: string;
  statusCode: number;
  ttfb_ms?: number;
  compression?: string;
  cdnDetected?: string;
  redirect_chain?: string[];
  headers: Record<string, string>;
  html: string;
  screenshot?: Buffer;
  rawSplit?: { markdown?: string; skeleton?: string };
  rawXray?: Record<string, any>;
  rawTechSeo?: Record<string, any>;
  rawOnpage?: Record<string, any>;
  rawContentAnalysis?: Record<string, any>;
  rawRobotsCheck?: Record<string, any>;
  rawSchemaValidation?: Record<string, any>;
  rawPsi?: { desktop?: any; mobile?: any };
  report?: any;
}

/**
 * Create a run directory for the given URL and return the path.
 */
export function createRunDir(url: string, subdir?: string, config?: ResolvedConfig): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const timestamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}`;
  const parsed   = new URL(url);
  const hostname = parsed.hostname.replace(/\./g, '_');
  const rawPath      = parsed.pathname.replace(/^\/|\/$/g, '');
  const pathSegments = rawPath
    ? rawPath.split('/').map(s => s.replace(/[^a-zA-Z0-9_-]/g, '_'))
    : [];

  const runsPath = config?.runsPath ?? loadConfig().runsPath;
  const base = runsPath ?? path.join(process.cwd(), 'runs');
  const parts = subdir
    ? [base, hostname, subdir, timestamp]
    : [base, hostname, ...pathSegments, timestamp];
  const runDir = path.join(...parts);

  fs.mkdirSync(runDir, { recursive: true });
  return runDir;
}

export async function saveRunReport(data: RunReportData, saveMdFiles = true, config?: ResolvedConfig): Promise<void> {
  try {
    const runDir = createRunDir(data.url, undefined, config);

    if (saveMdFiles) {
      fs.writeFileSync(path.join(runDir, 'content.md'), buildContentMd(data));
      fs.writeFileSync(path.join(runDir, 'xray.md'), buildXrayMd(data));
      fs.writeFileSync(path.join(runDir, 'metadata.md'), buildMetadataMd(data));
      fs.writeFileSync(path.join(runDir, 'assets.md'), buildAssetsMd(data));
      fs.writeFileSync(path.join(runDir, 'onpage.md'), buildOnpageMd(data));
      fs.writeFileSync(path.join(runDir, 'technical_seo.md'), buildTechSeoMd(data));
      fs.writeFileSync(path.join(runDir, 'content_analysis.md'), buildContentAnalysisMd(data));
      fs.writeFileSync(path.join(runDir, 'psi_debug.md'), buildPsiDebugMd(data));
      fs.writeFileSync(path.join(runDir, 'robots_check.md'), buildRobotsCheckMd(data));
      fs.writeFileSync(path.join(runDir, 'schema_validation.md'), buildSchemaValidationMd(data));
    }
    if (data.screenshot) {
      fs.writeFileSync(path.join(runDir, 'screenshot.png'), data.screenshot);
    }
    if (data.report) {
      fs.writeFileSync(path.join(runDir, 'report.json'), JSON.stringify(data.report, null, 2));
      fs.writeFileSync(path.join(runDir, 'report.md'), buildReportMd(data.report));
    }
  } catch {
    // Never crash the CLI for report file failures
  }
}

// ---------------------------------------------------------------------------
// content.md — clean markdown with frontmatter
// ---------------------------------------------------------------------------

export function buildContentMd(data: RunReportData): string {
  const techSeo = data.rawTechSeo;
  const title = techSeo?.meta?.title?.content ?? '';
  const description = techSeo?.meta?.description?.content ?? '';
  const markdown = data.rawSplit?.markdown ?? '';

  const frontmatter = [
    '---',
    `url: ${data.url}`,
    title ? `title: ${title}` : 'title: (none)',
    description ? `description: ${description}` : 'description: (none)',
    `statusCode: ${data.statusCode}`,
    `timestamp: ${new Date().toISOString()}`,
    '---',
  ].join('\n');

  return `${frontmatter}\n\n${markdown}`;
}

// ---------------------------------------------------------------------------
// xray.md — DOM X-Ray report
// ---------------------------------------------------------------------------

export function buildXrayMd(data: RunReportData): string {
  const x = data.rawXray;
  if (!x) return `# DOM X-Ray: ${data.url}\n\n_No xray data available._\n`;

  const dom = x.dom ?? {};
  const structure = x.structure ?? {};
  const head = x.head ?? {};
  const elementMap: Record<string, number> = x.element_map ?? {};

  const lines: string[] = [`# DOM X-Ray: ${new URL(data.url).hostname}`, ''];

  // DOM Overview
  lines.push('## DOM Overview', '');
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Total Elements | ${dom.total_elements ?? 'n/a'} |`);
  lines.push(`| Unique Tags | ${dom.unique_tags ?? 'n/a'} |`);
  lines.push(`| Max Depth | ${dom.depth_max ?? 'n/a'} |`);
  lines.push(`| Avg Depth | ${dom.depth_avg != null ? dom.depth_avg.toFixed(2) : 'n/a'} |`);
  lines.push('');

  // Element Distribution
  const sorted = Object.entries(elementMap).sort(([, a], [, b]) => b - a);
  if (sorted.length > 0) {
    lines.push('## Element Distribution', '');
    lines.push('| Tag | Count |');
    lines.push('|-----|-------|');
    for (const [tag, count] of sorted) {
      lines.push(`| \`${tag}\` | ${count} |`);
    }
    lines.push('');
  }

  // Structure Analysis
  lines.push('## Structure Analysis', '');
  lines.push('| Property | Value |');
  lines.push('|----------|-------|');
  lines.push(`| Div Ratio | ${structure.div_ratio != null ? (structure.div_ratio * 100).toFixed(1) + '%' : 'n/a'} |`);
  lines.push(`| Semantic Score | ${structure.semantic_score ?? 'n/a'} / 7 |`);
  lines.push(`| H1 Count | ${structure.h1_count ?? 'n/a'} |`);
  lines.push(`| H2 Count | ${structure.h2_count ?? 'n/a'} |`);
  lines.push(`| H3 Count | ${structure.h3_count ?? 'n/a'} |`);
  lines.push(`| Heading Hierarchy Valid | ${structure.heading_hierarchy_valid != null ? (structure.heading_hierarchy_valid ? 'yes' : 'no') : 'n/a'} |`);
  lines.push(`| Empty Elements | ${structure.empty_elements ?? 'n/a'} |`);
  lines.push(`| Duplicate IDs | ${structure.duplicate_ids ?? 'n/a'} |`);
  lines.push(`| Inline Event Handlers | ${structure.inline_event_handlers ?? 'n/a'} |`);
  if (structure.deprecated_tags?.length) {
    lines.push(`| Deprecated Tags | ${structure.deprecated_tags.join(', ')} |`);
  }
  if (structure.iframes) {
    lines.push(`| Iframes | ${structure.iframes.count ?? 0} |`);
    if (structure.iframes.domains?.length) {
      lines.push(`| Iframe Domains | ${structure.iframes.domains.join(', ')} |`);
    }
  }
  lines.push('');

  // Head Audit
  lines.push('## Head Audit', '');
  lines.push('| Check | Present |');
  lines.push('|-------|---------|');
  lines.push(`| Charset | ${head.charset_present ? 'yes' : 'no'} |`);
  lines.push(`| Viewport | ${head.viewport_present ? 'yes' : 'no'} |`);
  lines.push(`| Favicon | ${head.favicon_present ? 'yes' : 'no'} |`);
  lines.push(`| Preloads | ${head.preload_count ?? 0} |`);
  lines.push('');

  // Content Ratios
  const cr = x.content_ratios ?? {};
  if (cr.html_size_kb != null || cr.word_count_approx != null) {
    lines.push('## Content Ratios', '');
    lines.push('| Metric | Value |');
    lines.push('|--------|-------|');
    lines.push(`| HTML Size | ${cr.html_size_kb ?? 'n/a'} KB |`);
    lines.push(`| Word Count (approx) | ${cr.word_count_approx ?? 'n/a'} |`);
    lines.push(`| HTML-to-Text Ratio | ${cr.html_text_ratio != null ? (cr.html_text_ratio * 100).toFixed(1) + '%' : 'n/a'} |`);
    lines.push('');
  }

  // Scripts
  const scripts = x.scripts ?? {};
  if (scripts.total != null) {
    lines.push('## Scripts', '');
    lines.push('| Metric | Value |');
    lines.push('|--------|-------|');
    lines.push(`| Total | ${scripts.total ?? 0} |`);
    lines.push(`| Inline | ${scripts.inline ?? 0} |`);
    lines.push(`| External | ${scripts.external ?? 0} |`);
    lines.push(`| Defer | ${scripts.defer_count ?? 0} |`);
    lines.push(`| Async | ${scripts.async_count ?? 0} |`);
    lines.push('');

    const tp = scripts.third_party ?? {};
    if (tp.count > 0) {
      lines.push('### Third-Party Scripts', '');
      lines.push(`Count: **${tp.count}**`);
      lines.push(`Tag Manager Detected: **${tp.tag_manager_detected ? 'yes' : 'no'}**`, '');
      if (tp.domains?.length) {
        lines.push('| Domain |');
        lines.push('|--------|');
        for (const d of (tp.domains as string[])) {
          lines.push(`| ${d} |`);
        }
        lines.push('');
      }
      const categories = tp.categories ?? {};
      const catEntries = Object.entries(categories);
      if (catEntries.length > 0) {
        lines.push('| Category | Domains |');
        lines.push('|----------|---------|');
        for (const [cat, domains] of catEntries) {
          lines.push(`| ${cat} | ${(domains as string[]).join(', ')} |`);
        }
        lines.push('');
      }
    }
  }

  // SEO Audit
  const seo = x.seo ?? {};
  if (Object.keys(seo).length > 0) {
    lines.push('## SEO Audit', '');
    lines.push('| Check | Value |');
    lines.push('|-------|-------|');
    lines.push(`| Title Non-Empty | ${seo.title_non_empty != null ? (seo.title_non_empty ? 'yes' : 'no') : 'n/a'} |`);
    lines.push(`| Has Meta Description | ${seo.has_meta_description != null ? (seo.has_meta_description ? 'yes' : 'no') : 'n/a'} |`);
    lines.push(`| Has Canonical | ${seo.has_canonical != null ? (seo.has_canonical ? 'yes' : 'no') : 'n/a'} |`);
    lines.push(`| Has Lang Attribute | ${seo.has_lang != null ? (seo.has_lang ? 'yes' : 'no') : 'n/a'} |`);
    lines.push('');
  }

  // Accessibility
  const a11y = x.accessibility ?? {};
  if (Object.keys(a11y).length > 0) {
    lines.push('## Accessibility', '');
    lines.push('| Metric | Value |');
    lines.push('|--------|-------|');
    lines.push(`| ARIA Roles | ${a11y.aria_roles_count ?? 0} |`);
    lines.push(`| ARIA Labels | ${a11y.aria_labels_count ?? 0} |`);
    lines.push(`| ARIA Attribute Count | ${a11y.aria_attribute_count ?? 0} |`);
    lines.push(`| Skip Nav Present | ${a11y.skip_nav_present ? 'yes' : 'no'} |`);
    lines.push(`| Lang Attribute | ${a11y.lang_attribute ?? '(none)'} |`);
    lines.push(`| Missing lang on <html> | ${a11y.html_missing_lang ? 'yes' : 'no'} |`);
    lines.push(`| Images missing alt | ${a11y.images_missing_alt ?? 0} |`);
    lines.push(`| Inputs without label | ${a11y.inputs_without_label ?? 0} |`);
    lines.push(`| Buttons/links no text | ${a11y.buttons_links_no_text ?? 0} |`);
    const tabindexAudit = x.tabindex_audit ?? {};
    if (tabindexAudit.positive_tabindex_count != null) {
      lines.push(`| Positive tabindex (a11y smell) | ${tabindexAudit.positive_tabindex_count} |`);
    }
    lines.push('');
  }

  // Forms
  const forms = x.forms ?? {};
  if (forms.form_count != null) {
    lines.push('## Forms', '');
    lines.push('| Metric | Value |');
    lines.push('|--------|-------|');
    lines.push(`| Forms | ${forms.form_count ?? 0} |`);
    lines.push(`| Inputs | ${forms.input_count ?? 0} |`);
    lines.push(`| Buttons | ${forms.button_count ?? 0} |`);
    lines.push(`| Inputs without labels | ${forms.inputs_without_labels ?? 0} |`);
    lines.push(`| Forms missing action | ${forms.forms_missing_action ?? 0} |`);
    lines.push('');
  }

  // xray Links
  const xLinks = x.links ?? {};
  if (xLinks.total != null) {
    lines.push('## Links (x-ray)', '');
    lines.push('| Metric | Value |');
    lines.push('|--------|-------|');
    lines.push(`| Total | ${xLinks.total ?? 0} |`);
    lines.push(`| Internal | ${xLinks.internal ?? 0} |`);
    lines.push(`| External | ${xLinks.external ?? 0} |`);
    lines.push(`| target=_blank missing rel | ${xLinks.target_blank_missing_rel ?? 0} |`);
    lines.push('');
  }

  // Inline Styles
  const inlineStyles = x.inline_styles ?? {};
  if (inlineStyles.count != null) {
    lines.push(`## Inline Styles\n\nCount: **${inlineStyles.count}**`, '');
  }

  // Text density by region
  const td = x.text_density_by_region;
  if (td && typeof td === 'object') {
    lines.push('## Text Density by Region', '');
    lines.push('| Region | Words |');
    lines.push('|--------|-------|');
    lines.push(`| header | ${td.header ?? 0} |`);
    lines.push(`| main | ${td.main ?? 0} |`);
    lines.push(`| aside | ${td.aside ?? 0} |`);
    lines.push(`| footer | ${td.footer ?? 0} |`);
    lines.push('');
  }

  // Largest image candidate
  const lic = x.largest_image_candidate;
  if (lic && typeof lic === 'object') {
    lines.push('## Largest Image Candidate (static LCP guess)', '');
    lines.push('| Field | Value |');
    lines.push('|-------|-------|');
    lines.push(`| src | ${lic.src ?? '(none)'} |`);
    lines.push(`| width | ${lic.width ?? 'n/a'} |`);
    lines.push(`| height | ${lic.height ?? 'n/a'} |`);
    lines.push('');
  }

  // Duplicate headings
  const dupHeadings: string[] = Array.isArray(x.duplicate_headings) ? x.duplicate_headings : [];
  if (dupHeadings.length > 0) {
    lines.push('## Duplicate Headings', '');
    for (const h of dupHeadings) lines.push(`- ${h}`);
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// metadata.md — HTTP response + meta tags
// ---------------------------------------------------------------------------

export function buildMetadataMd(data: RunReportData): string {
  const t = data.rawTechSeo;
  const lines: string[] = [`# Metadata: ${new URL(data.url).hostname}`, ''];

  // Response info
  lines.push('## HTTP Response', '');
  lines.push('| Field | Value |');
  lines.push('|-------|-------|');
  lines.push(`| Status | ${data.statusCode} |`);
  if (data.ttfb_ms != null) lines.push(`| TTFB | ${data.ttfb_ms} ms |`);
  if (data.compression) lines.push(`| Compression | ${data.compression} |`);
  if (data.cdnDetected) lines.push(`| CDN | ${data.cdnDetected} |`);
  lines.push('');

  // Response headers
  const headerEntries = Object.entries(data.headers);
  if (headerEntries.length > 0) {
    lines.push('## Response Headers', '');
    lines.push('| Header | Value |');
    lines.push('|--------|-------|');
    for (const [k, v] of headerEntries) {
      lines.push(`| \`${k}\` | ${v} |`);
    }
    lines.push('');
  }

  if (!t) {
    lines.push('_No technical SEO data available._\n');
    return lines.join('\n');
  }

  // Meta tags
  lines.push('## Meta Tags', '');
  lines.push('| Tag | Value |');
  lines.push('|-----|-------|');
  lines.push(`| Title | ${t.meta?.title?.content ?? '(none)'} |`);
  lines.push(`| Description | ${t.meta?.description?.content ?? '(none)'} |`);
  lines.push(`| Canonical | ${t.canonical?.url ?? (t.canonical?.present ? '(present, no URL)' : '(none)')} |`);
  lines.push(`| Robots | ${t.meta?.robots?.content ?? '(none)'} |`);
  lines.push('');

  // Open Graph
  const og = t.open_graph ?? {};
  const ogEntries = Object.entries(og).filter(([, v]) => v);
  if (ogEntries.length > 0) {
    lines.push('## Open Graph', '');
    lines.push('| Property | Value |');
    lines.push('|----------|-------|');
    for (const [k, v] of ogEntries) {
      lines.push(`| og:${k} | ${v} |`);
    }
    lines.push('');
  }

  // Schema
  lines.push('## Schema.org', '');
  lines.push(`JSON-LD blocks found: **${t.schema?.blocks_found ?? 0}**`, '');
  if (t.schema?.types?.length) {
    lines.push(`Types: ${t.schema.types.join(', ')}`, '');
  }

  // Indexability
  lines.push('## Indexability', '');
  lines.push(`| Check | Value |`);
  lines.push(`|-------|-------|`);
  lines.push(`| Blocked by robots | ${t.indexability?.blocked ? 'yes' : 'no'} |`);
  if (t.indexability?.reason) lines.push(`| Reason | ${t.indexability.reason} |`);
  lines.push('');

  // Redirect Analysis (from merged report)
  const redir = data.report?.redirect_analysis;
  if (redir) {
    lines.push('## Redirect Analysis', '');
    lines.push('| Field | Value |');
    lines.push('|-------|-------|');
    lines.push(`| Chain Length | ${redir.chain_length} |`);
    lines.push(`| HTTP → HTTPS | ${redir.has_http_to_https ? 'yes' : 'no'} |`);
    lines.push(`| WWW Redirect | ${redir.has_www_redirect ? 'yes' : 'no'} |`);
    lines.push('');
    if (redir.chain?.length) {
      lines.push('### Redirect Chain', '');
      for (let i = 0; i < redir.chain.length; i++) {
        lines.push(`${i + 1}. ${redir.chain[i]}`);
      }
      lines.push('');
    }
    if (redir.issues?.length) {
      lines.push('### Issues', '');
      for (const issue of redir.issues) {
        lines.push(`- ${issue}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// assets.md — parsed from raw HTML
// ---------------------------------------------------------------------------

interface ImageAsset { src: string; alt: string }
interface LinkAsset { href: string; extra?: string }

function extractAttr(tag: string, attr: string): string {
  const m = tag.match(new RegExp(`${attr}=["']([^"']*)["']`, 'i'));
  return m ? m[1] : '';
}

function parseAssets(html: string): {
  images: ImageAsset[];
  externalScripts: string[];
  inlineScripts: number;
  stylesheets: string[];
  preloads: LinkAsset[];
} {
  const images: ImageAsset[] = [];
  const externalScripts: string[] = [];
  let inlineScripts = 0;
  const stylesheets: string[] = [];
  const preloads: LinkAsset[] = [];

  // Images
  const imgRe = /<img[^>]+>/gi;
  let m: RegExpExecArray | null;
  while ((m = imgRe.exec(html)) !== null) {
    images.push({ src: extractAttr(m[0], 'src'), alt: extractAttr(m[0], 'alt') });
  }

  // Scripts
  const scriptRe = /<script([^>]*)>/gi;
  while ((m = scriptRe.exec(html)) !== null) {
    const src = extractAttr(m[0], 'src');
    if (src) externalScripts.push(src);
    else inlineScripts++;
  }

  // Stylesheets
  const ssRe = /<link[^>]+rel=["']stylesheet["'][^>]*>/gi;
  while ((m = ssRe.exec(html)) !== null) {
    const href = extractAttr(m[0], 'href');
    if (href) stylesheets.push(href);
  }

  // Preloads
  const preRe = /<link[^>]+rel=["']preload["'][^>]*>/gi;
  while ((m = preRe.exec(html)) !== null) {
    const href = extractAttr(m[0], 'href');
    const as = extractAttr(m[0], 'as');
    if (href) preloads.push({ href, extra: as || undefined });
  }

  return { images, externalScripts, inlineScripts, stylesheets, preloads };
}

// ---------------------------------------------------------------------------
// onpage.md — On-page SEO analysis
// ---------------------------------------------------------------------------

export function buildOnpageMd(data: RunReportData): string {
  const o = data.rawOnpage;
  if (!o) return `# On-Page SEO: ${new URL(data.url).hostname}\n\n_No onpage data available._\n`;

  const content = o.content ?? {};
  const headings = o.headings ?? {};
  const links = o.links ?? {};
  const images = o.images ?? {};
  const lines: string[] = [`# On-Page SEO: ${new URL(data.url).hostname}`, ''];

  // Content
  lines.push('## Content', '');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Word Count | ${content.word_count ?? 'n/a'} |`);
  lines.push(`| Paragraph Count | ${content.paragraph_count ?? 'n/a'} |`);
  lines.push(`| Avg Paragraph Length | ${content.avg_paragraph_length ?? 'n/a'} words |`);
  lines.push('');

  // Headings
  lines.push('## Headings', '');
  lines.push('| Tag | Count |');
  lines.push('|-----|-------|');
  for (const level of [1, 2, 3, 4, 5, 6]) {
    const count = headings[`h${level}_count`];
    if (count != null) lines.push(`| H${level} | ${count} |`);
  }
  lines.push('');
  if (headings.h1_content) lines.push(`H1 text: **${headings.h1_content}**`, '');
  lines.push('| Check | Value |');
  lines.push('|-------|-------|');
  lines.push(`| Hierarchy Valid | ${headings.hierarchy_valid ? 'yes' : 'no'} |`);
  lines.push(`| Empty Headings | ${headings.empty_headings ?? 0} |`);
  lines.push(`| Total Headings | ${headings.total_headings ?? 0} |`);
  if (headings.table_of_contents_detected !== undefined) {
    lines.push(`| Table of Contents Detected | ${headings.table_of_contents_detected ? 'yes' : 'no'} |`);
  }
  lines.push('');

  // Heading Violations
  const violations: Array<{ from_level: number; to_level: number; heading: string; issue_type: string }> = headings.violations ?? [];
  if (violations.length > 0) {
    lines.push('### Violations', '');
    for (const v of violations) {
      if (v.issue_type === 'missing_h1') {
        lines.push('- Missing H1 tag');
      } else if (v.issue_type === 'multiple_h1') {
        lines.push(`- Multiple H1: "${v.heading}"`);
      } else if (v.issue_type === 'skipped_level') {
        lines.push(`- Skipped level: H${v.from_level} → H${v.to_level} ("${v.heading}")`);
      } else {
        lines.push(`- ${v.issue_type}: "${v.heading}"`);
      }
    }
    lines.push('');
  }

  // Heading Tree
  const tree: Array<{ level: number; text: string; children?: any[] }> = headings.tree ?? [];
  if (tree.length > 0) {
    lines.push('### Heading Tree', '');
    const renderTree = (nodes: any[], indent: number) => {
      for (const node of nodes) {
        const prefix = '  '.repeat(indent);
        lines.push(`${prefix}- H${node.level}: ${node.text || '(empty)'}`);
        if (node.children?.length) renderTree(node.children, indent + 1);
      }
    };
    renderTree(tree, 0);
    lines.push('');
  }

  // Links
  lines.push('## Links', '');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Internal Links | ${links.internal_total ?? 'n/a'} |`);
  lines.push(`| Internal Generic Anchors | ${links.internal_generic_anchor ?? 'n/a'} |`);
  lines.push(`| External Links | ${links.external_total ?? 'n/a'} |`);
  lines.push(`| External Broken | ${links.external_broken ?? 'n/a'} |`);
  lines.push('');

  // Images
  lines.push('## Images', '');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Total | ${images.total ?? 'n/a'} |`);
  lines.push(`| Missing Alt | ${images.missing_alt ?? 'n/a'} |`);
  lines.push(`| Empty Alt (decorative) | ${images.empty_alt_decorative ?? 'n/a'} |`);
  lines.push(`| Alt Too Short (<3 chars) | ${images.too_short ?? 'n/a'} |`);
  lines.push(`| Alt Too Long (>125 chars) | ${images.too_long ?? 'n/a'} |`);
  lines.push(`| Poor Quality Alt | ${images.poor_quality_alt ?? 'n/a'} |`);
  lines.push(`| With Lazy Loading | ${images.lazy_loading ?? 'n/a'} |`);
  lines.push(`| Modern Format (webp/avif) | ${images.modern_format ?? 'n/a'} |`);
  lines.push(`| Explicit Dimensions | ${images.explicit_dimensions ?? 'n/a'} |`);
  if (images.density_per_1000_words != null) {
    lines.push(`| Density per 1000 words | ${images.density_per_1000_words} |`);
  }
  lines.push('');


  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// technical_seo.md — raw output from technical_seo.py
// ---------------------------------------------------------------------------

export function buildTechSeoMd(data: RunReportData): string {
  const t = data.rawTechSeo;
  if (!t) return `# Technical SEO: ${new URL(data.url).hostname}\n\n_No technical SEO data available._\n`;

  const lines: string[] = [`# Technical SEO: ${new URL(data.url).hostname}`, ''];

  // Request (Phase 2e)
  const reqRows: string[][] = [];
  reqRows.push(['Status', String(data.statusCode)]);
  if (data.ttfb_ms != null) reqRows.push(['TTFB', `${Math.round(data.ttfb_ms)} ms`]);
  if (data.compression) reqRows.push(['Compression', data.compression]);
  if (data.cdnDetected) reqRows.push(['CDN', data.cdnDetected]);
  if (reqRows.length > 0) {
    lines.push('## Request', '');
    lines.push('| Field | Value |');
    lines.push('|-------|-------|');
    for (const [k, v] of reqRows) lines.push(`| ${k} | ${v} |`);
    lines.push('');
  }

  // Redirects (Phase 2e)
  const chain = data.redirect_chain ?? [];
  if (chain.length > 0) {
    // Local lightweight annotation (keeps run-reporter self-contained; mirrors terminal logic).
    lines.push(`## Redirects (${chain.length} hop${chain.length === 1 ? '' : 's'})`, '');
    lines.push('| # | From | To | Labels |');
    lines.push('|---|------|----|--------|');
    let prev = data.url;
    for (let i = 0; i < chain.length; i++) {
      const next = chain[i];
      const labels: string[] = [];
      try {
        const f = new URL(prev);
        const tU = new URL(next);
        if (f.protocol === 'http:' && tU.protocol === 'https:') labels.push('HTTP→HTTPS');
        const fw = f.hostname.startsWith('www.');
        const tw = tU.hostname.startsWith('www.');
        if (fw && !tw) labels.push('www → apex');
        if (!fw && tw) labels.push('apex → www');
        if (f.pathname !== tU.pathname && f.pathname.replace(/\/+$/, '') === tU.pathname.replace(/\/+$/, '')) {
          labels.push('trailing-slash');
        }
      } catch { /* ignore */ }
      lines.push(`| ${i + 1} | ${prev} | ${next} | ${labels.join(', ') || '—'} |`);
      prev = next;
    }
    lines.push('');
    if (chain.length > 1) {
      lines.push(`> Long redirect chain (${chain.length} hops) — consider consolidating.`, '');
    }
  }

  // Meta Tags
  lines.push('## Meta Tags', '');
  lines.push('| Tag | Content | Length | Status |');
  lines.push('|-----|---------|--------|--------|');
  const title = t.meta?.title ?? {};
  lines.push(`| title | ${title.content ?? '(none)'} | ${title.length ?? 'n/a'} | ${title.status ?? 'n/a'} |`);
  const desc = t.meta?.description ?? {};
  lines.push(`| description | ${desc.content ?? '(none)'} | ${desc.length ?? 'n/a'} | ${desc.status ?? 'n/a'} |`);
  lines.push('');

  lines.push('| Tag | Value |');
  lines.push('|-----|-------|');
  const robots = t.meta?.robots ?? {};
  lines.push(`| robots index | ${robots.index != null ? String(robots.index) : 'n/a'} |`);
  lines.push(`| robots follow | ${robots.follow != null ? String(robots.follow) : 'n/a'} |`);
  lines.push(`| robots content | ${robots.content ?? '(none)'} |`);
  lines.push(`| charset | ${t.meta?.charset?.present != null ? String(t.meta.charset.present) : '(none)'} |`);
  lines.push(`| viewport | ${t.meta?.viewport?.present != null ? String(t.meta.viewport.present) : '(none)'} |`);
  lines.push('');

  // Canonical
  lines.push('## Canonical', '');
  lines.push('| Field | Value |');
  lines.push('|-------|-------|');
  const canonical = t.canonical ?? {};
  lines.push(`| present | ${canonical.present != null ? String(canonical.present) : 'n/a'} |`);
  lines.push(`| href | ${canonical.href ?? '(none)'} |`);
  lines.push(`| self_referencing | ${canonical.self_referencing != null ? String(canonical.self_referencing) : 'n/a'} |`);
  lines.push(`| status | ${canonical.status ?? 'n/a'} |`);
  lines.push('');

  // Open Graph
  lines.push('## Open Graph', '');
  lines.push('| Property | Present |');
  lines.push('|----------|---------|');
  const og = t.open_graph ?? {};
  for (const key of ['title', 'description', 'image', 'url']) {
    lines.push(`| og:${key} | ${og[key] != null ? String(og[key]) : 'n/a'} |`);
  }
  // Phase 1h — article timestamps
  if (og.published_time) lines.push(`| article:published_time | ${og.published_time} |`);
  if (og.modified_time) lines.push(`| article:modified_time | ${og.modified_time} |`);
  if (og.updated_time) lines.push(`| og:updated_time | ${og.updated_time} |`);
  lines.push('');

  // Indexability
  lines.push('## Indexability', '');
  lines.push('| Field | Value |');
  lines.push('|-------|-------|');
  const idx = t.indexability ?? {};
  lines.push(`| blocked | ${idx.blocked != null ? String(idx.blocked) : 'n/a'} |`);
  if (idx.signals?.length) {
    lines.push(`| signals | ${idx.signals.join(', ')} |`);
  }
  if (idx.conflicts?.length) {
    lines.push(`| conflicts | ${idx.conflicts.join(', ')} |`);
  }
  lines.push('');

  // Twitter Card
  const tc = t.open_graph?.twitter_card ?? {};
  lines.push('## Twitter Card', '');
  lines.push('| Field | Value |');
  lines.push('|-------|-------|');
  lines.push(`| present | ${tc.present != null ? String(tc.present) : 'no'} |`);
  if (tc.card_type) lines.push(`| card_type | ${tc.card_type} |`);
  lines.push(`| title | ${tc.title ? 'yes' : 'no'} |`);
  lines.push(`| image | ${tc.image ? 'yes' : 'no'} |`);
  lines.push(`| description | ${tc.description ? 'yes' : 'no'} |`);
  lines.push('');

  // Security Headers
  const sec = t.security_headers ?? {};
  lines.push('## Security Headers', '');
  lines.push(`Grade: **${sec.grade ?? 'n/a'}** (${sec.count ?? 0} / 6)`, '');
  if (sec.present?.length) {
    lines.push('| Header | Status |');
    lines.push('|--------|--------|');
    for (const h of (sec.present as string[])) {
      lines.push(`| ${h} | ✓ present |`);
    }
    for (const h of (sec.missing as string[] ?? [])) {
      lines.push(`| ${h} | ✗ missing |`);
    }
  }
  lines.push('');

  // Hreflang
  const hreflang = t.hreflang ?? {};
  lines.push('## Hreflang', '');
  if (hreflang.present) {
    lines.push(`Languages found: **${hreflang.count ?? 0}**`, '');
    if (hreflang.languages?.length) {
      lines.push('| Lang | href |');
      lines.push('|------|------|');
      for (const lang of (hreflang.languages as Array<{ lang: string; href: string }>)) {
        lines.push(`| ${lang.lang} | ${lang.href} |`);
      }
    }
    if (hreflang.issues?.length) {
      lines.push('');
      lines.push(`Issues: ${(hreflang.issues as string[]).join(', ')}`);
    }
  } else {
    lines.push('_No hreflang tags found._');
  }
  lines.push('');

  // Pagination / AMP
  const pa = t.pagination_amp ?? {};
  if (pa.is_paginated || pa.is_amp) {
    lines.push('## Pagination / AMP', '');
    lines.push('| Field | Value |');
    lines.push('|-------|-------|');
    if (pa.has_prev) lines.push(`| prev | ${pa.prev_href ?? 'present'} |`);
    if (pa.has_next) lines.push(`| next | ${pa.next_href ?? 'present'} |`);
    if (pa.is_amp) lines.push(`| AMP | ${pa.amp_link_present ? 'amphtml link present' : 'html[amp] attribute'} |`);
    lines.push('');
  }

  // Schema Completeness
  const schemaCompleteness = t.schema?.schema_completeness ?? [];
  if (schemaCompleteness.length > 0) {
    lines.push('## Schema Completeness', '');
    lines.push('| Type | Complete | Missing Fields |');
    lines.push('|------|----------|----------------|');
    for (const entry of (schemaCompleteness as Array<{ type: string; complete: boolean; missing_fields: string[] }>)) {
      const missing = entry.missing_fields.length > 0 ? entry.missing_fields.join(', ') : '—';
      lines.push(`| ${entry.type} | ${entry.complete ? '✓' : '✗'} | ${missing} |`);
    }
    lines.push('');
  }

  // Links
  lines.push('## Links', '');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  const lnk = t.links ?? {};
  lines.push(`| internal_total | ${lnk.internal_total ?? 'n/a'} |`);
  lines.push(`| internal_generic_anchor | ${lnk.internal_generic_anchor ?? 'n/a'} |`);
  lines.push(`| external_total | ${lnk.external_total ?? 'n/a'} |`);
  lines.push(`| external_broken | ${lnk.external_broken ?? 'n/a'} |`);
  lines.push('');

  // Caching
  const caching = t.caching ?? {};
  if (caching.has_cache_control != null) {
    lines.push('## Caching', '');
    lines.push('| Field | Value |');
    lines.push('|-------|-------|');
    lines.push(`| Cache-Control | ${caching.cache_control ?? '(none)'} |`);
    lines.push(`| Has ETag | ${caching.has_etag ? 'yes' : 'no'} |`);
    lines.push(`| Has Last-Modified | ${caching.has_last_modified ? 'yes' : 'no'} |`);
    lines.push(`| Max-Age | ${caching.max_age_seconds != null ? `${caching.max_age_seconds}s` : 'n/a'} |`);
    lines.push(`| Cacheable | ${caching.is_cacheable ? 'yes' : 'no'} |`);
    lines.push('');
    const cachingIssues: string[] = caching.issues ?? [];
    if (cachingIssues.length > 0) {
      for (const issue of cachingIssues) {
        lines.push(`- ${issue}`);
      }
      lines.push('');
    }
  }

  // Resource Hints
  const rh = t.resource_hints ?? {};
  if (rh.preload_count != null || rh.dns_prefetch_count != null || rh.preconnect_count != null) {
    lines.push('## Resource Hints', '');
    lines.push('| Type | Count |');
    lines.push('|------|-------|');
    lines.push(`| Preload | ${rh.preload_count ?? 0} |`);
    lines.push(`| Prefetch | ${(rh.prefetch as string[] | undefined)?.length ?? 0} |`);
    lines.push(`| DNS Prefetch | ${rh.dns_prefetch_count ?? 0} |`);
    lines.push(`| Preconnect | ${rh.preconnect_count ?? 0} |`);
    lines.push('');
    if ((rh.preload as any[])?.length) {
      lines.push('### Preloaded Resources', '');
      lines.push('| href | as |');
      lines.push('|------|----|');
      for (const p of (rh.preload as Array<{ href: string; as: string }>)) {
        lines.push(`| ${p.href} | ${p.as} |`);
      }
      lines.push('');
    }
    if ((rh.dns_prefetch as string[])?.length) {
      lines.push(`DNS Prefetch domains: ${(rh.dns_prefetch as string[]).join(', ')}`, '');
    }
    if ((rh.preconnect as string[])?.length) {
      lines.push(`Preconnect domains: ${(rh.preconnect as string[]).join(', ')}`, '');
    }
  }

  // URL Structure
  const urlStr = t.url_structure ?? {};
  if (urlStr.length != null) {
    lines.push('## URL Structure', '');
    lines.push('| Field | Value |');
    lines.push('|-------|-------|');
    lines.push(`| Length | ${urlStr.length} chars |`);
    lines.push(`| Path | ${urlStr.path ?? '/'} |`);
    lines.push(`| Trailing Slash | ${urlStr.has_trailing_slash ? 'yes' : 'no'} |`);
    lines.push(`| Uppercase | ${urlStr.has_uppercase ? 'yes' : 'no'} |`);
    lines.push(`| Special Chars | ${urlStr.has_special_chars ? 'yes' : 'no'} |`);
    lines.push(`| Double Slashes | ${urlStr.has_double_slashes ? 'yes' : 'no'} |`);
    lines.push(`| Keyword Segments | ${urlStr.keyword_segments ?? 0} / ${urlStr.total_segments ?? 0} |`);
    lines.push('');
    const urlIssues: string[] = urlStr.issues ?? [];
    if (urlIssues.length > 0) {
      for (const issue of urlIssues) {
        lines.push(`- ${issue}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// content_analysis.md — Section 5 detailed report
// ---------------------------------------------------------------------------

export function buildContentAnalysisMd(data: RunReportData): string {
  const ca = data.rawContentAnalysis;
  if (!ca) return `# Content Analysis: ${new URL(data.url).hostname}\n\n_No content analysis data available._\n`;

  const hostname = new URL(data.url).hostname;
  const lines: string[] = [`# Content Analysis: ${hostname}`, ''];

  // Overview
  lines.push('## Overview', '');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  if (ca.detected_language) lines.push(`| Detected Language | ${ca.detected_language} |`);
  lines.push(`| Depth | ${ca.content_depth?.depth_label ?? 'n/a'} |`);
  lines.push(`| E-E-A-T | ${ca.eeat_signals?.eeat_label ?? 'n/a'} |`);
  lines.push(`| Freshness | ${ca.content_freshness?.freshness_status ?? 'n/a'} |`);
  lines.push(`| Thin Content Risk | ${ca.thin_content?.thin_content_risk ?? 'n/a'} |`);
  lines.push(`| Snippet Eligible | ${ca.featured_snippet?.snippet_eligible ? 'yes' : 'no'} |`);
  lines.push(`| Reading Level | ${ca.readability?.reading_level ?? 'n/a'} |`);
  lines.push(`| CTA Present | ${ca.cta?.cta_present ? 'yes' : 'no'} |`);
  lines.push(`| TOC Present | ${ca.toc?.toc_present ? 'yes' : 'no'} |`);
  lines.push(`| Author Bio | ${ca.author_bio?.author_bio_present ? 'yes' : 'no'} |`);
  lines.push('');

  // Content Depth
  const depth = ca.content_depth ?? {};
  lines.push('## Content Depth', '');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Word Count | ${depth.word_count ?? 'n/a'} |`);
  lines.push(`| Paragraph Count | ${depth.paragraph_count ?? 'n/a'} |`);
  lines.push(`| Avg Paragraph Length | ${depth.avg_paragraph_length ?? 'n/a'} words |`);
  lines.push(`| Depth Label | ${depth.depth_label ?? 'n/a'} |`);
  if (depth.reading_time_minutes != null) lines.push(`| Reading Time | ${depth.reading_time_minutes} min |`);
  if (depth.lexical_diversity != null) lines.push(`| Lexical Diversity | ${depth.lexical_diversity} (${depth.lexical_diversity_label ?? 'n/a'}) |`);
  const pld = depth.paragraph_length_distribution;
  if (pld) {
    lines.push(`| Paragraph Length Distribution | min ${pld.min} · p50 ${pld.p50} · p90 ${pld.p90} · max ${pld.max} (words) |`);
  }
  const depthIssues: string[] = Array.isArray(depth.issues) ? depth.issues : [];
  if (depthIssues.length > 0) {
    lines.push('');
    lines.push('**Depth issues:**');
    for (const i of depthIssues) lines.push(`- ${i}`);
  }
  lines.push('');

  // Content Relevance
  const relevance = ca.content_relevance ?? {};
  lines.push('## Content Relevance', '');
  lines.push('| Check | Value |');
  lines.push('|-------|-------|');
  lines.push(`| Title in H1 | ${relevance.title_in_h1 != null ? (relevance.title_in_h1 ? 'yes' : 'no') : 'n/a'} |`);
  lines.push(`| Title in Intro | ${relevance.title_in_intro != null ? (relevance.title_in_intro ? 'yes' : 'no') : 'n/a'} |`);
  lines.push(`| Heading Alignment Score | ${relevance.heading_alignment_score ?? 'n/a'} |`);
  lines.push(`| Keyword Stuffing | ${relevance.keyword_stuffing_detected ? 'detected' : 'none'} |`);
  lines.push('');

  // E-E-A-T
  const eeat = ca.eeat_signals ?? {};
  lines.push('## E-E-A-T Signals', '');
  lines.push('| Signal | Value |');
  lines.push('|--------|-------|');
  lines.push(`| First Person | ${eeat.first_person_present ? `yes (${eeat.first_person_count} mentions)` : 'no'} |`);
  lines.push(`| Statistics | ${eeat.statistics_count ?? 0} found |`);
  lines.push(`| Citations | ${eeat.citation_patterns ?? 0} found |`);
  lines.push(`| Author Mention | ${eeat.author_mention_detected ? 'yes' : 'no'} |`);
  lines.push(`| Date Found | ${eeat.most_recent_date ?? 'none'} |`);
  lines.push(`| Time-Sensitive Without Date | ${eeat.time_sensitive_without_date ? 'yes' : 'no'} |`);
  lines.push(`| E-E-A-T Label | **${eeat.eeat_label ?? 'n/a'}** |`);
  lines.push('');
  const signalsPresent = eeat.eeat_signals_present;
  if (signalsPresent && typeof signalsPresent === 'object') {
    const entries = Object.entries(signalsPresent);
    if (entries.length > 0) {
      lines.push('**Signals Present**', '');
      lines.push('| Signal | Present |');
      lines.push('|--------|---------|');
      for (const [k, v] of entries) lines.push(`| ${k} | ${v ? 'yes' : 'no'} |`);
      lines.push('');
    }
  }

  // Freshness
  const freshness = ca.content_freshness ?? {};
  lines.push('## Content Freshness', '');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Most Recent Year | ${freshness.most_recent_year ?? 'none'} |`);
  lines.push(`| Freshness Status | **${freshness.freshness_status ?? 'n/a'}** |`);
  if (freshness.time_sensitive_phrases_found?.length) {
    lines.push(`| Time-Sensitive Phrases | ${(freshness.time_sensitive_phrases_found as string[]).join(', ')} |`);
  }
  lines.push('');

  // Featured Snippet
  const snippet = ca.featured_snippet ?? {};
  lines.push('## Featured Snippet Eligibility', '');
  lines.push('| Type | Eligible |');
  lines.push('|------|---------|');
  lines.push(`| Paragraph (definition) | ${snippet.definition_paragraph_present ? 'yes' : 'no'} |`);
  lines.push(`| List | ${snippet.list_snippet_eligible ? 'yes' : 'no'} |`);
  lines.push(`| FAQ / Q&A (${snippet.qa_pattern_count ?? 0} pairs) | ${snippet.faq_schema_recommended ? 'yes — FAQ schema recommended' : 'no'} |`);
  lines.push(`| Table | ${snippet.table_snippet_eligible ? 'yes' : 'no'} |`);
  if ((snippet.snippet_types_eligible as string[] | undefined)?.length) {
    lines.push('');
    lines.push(`Eligible types: **${(snippet.snippet_types_eligible as string[]).join(', ')}**`);
  }
  lines.push('');

  const qaPairs: Array<{ question?: string; answer_preview?: string; answer_length?: number }> =
    Array.isArray(snippet.qa_pairs_found) ? (snippet.qa_pairs_found as any[]) : [];
  if (qaPairs.length > 0) {
    lines.push(`**Q&A pairs found: ${qaPairs.length}**`, '');
    for (const pair of qaPairs.slice(0, 5)) {
      lines.push(`- **${pair.question ?? '(no question)'}** — ${pair.answer_preview ?? ''}`);
    }
    lines.push('');
  }
  const luh: Array<{ heading?: string; list_type?: string; item_count?: number; snippet_eligible?: boolean }> =
    Array.isArray(snippet.lists_under_headings) ? (snippet.lists_under_headings as any[]) : [];
  if (luh.length > 0) {
    lines.push(`**Lists under headings: ${luh.length}**`, '');
    lines.push('| Heading | Type | Items | Eligible |');
    lines.push('|---------|------|-------|----------|');
    for (const l of luh.slice(0, 5)) {
      lines.push(`| ${l.heading ?? '(heading)'} | ${l.list_type ?? 'n/a'} | ${l.item_count ?? 0} | ${l.snippet_eligible ? 'yes' : 'no'} |`);
    }
    lines.push('');
  }

  // Thin Content
  const thin = ca.thin_content ?? {};
  lines.push('## Thin Content Signals', '');
  lines.push('| Signal | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Boilerplate | ${thin.boilerplate_present ? `yes (${(thin.boilerplate_detected as string[] | undefined)?.join(', ')})` : 'none'} |`);
  lines.push(`| Duplicate Sentences | ${thin.duplicate_sentences_found ?? 0} |`);
  lines.push(`| Duplicate Paragraphs | ${(thin as any).duplicate_paragraphs_found ?? 0} |`);
  lines.push(`| Skeleton Page | ${thin.skeleton_page_detected ? 'yes' : 'no'} |`);
  lines.push(`| Heading to Content Ratio | ${thin.heading_to_content_ratio ?? 'n/a'} |`);
  lines.push(`| **Thin Content Risk** | **${thin.thin_content_risk ?? 'n/a'}** |`);
  lines.push('');

  // Anchor Quality
  const anchor = ca.anchor_text_quality ?? {};
  lines.push('## Anchor Text Quality', '');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Total Links | ${anchor.total_internal_links ?? 0} |`);
  lines.push(`| Descriptive | ${anchor.descriptive_count ?? 0} |`);
  lines.push(`| Generic | ${anchor.generic_count ?? 0} |`);
  lines.push(`| Naked URL | ${anchor.naked_url_count ?? 0} |`);
  lines.push(`| Empty | ${anchor.empty_count ?? 0} |`);
  lines.push(`| Descriptive Ratio | ${anchor.descriptive_ratio ?? 'n/a'} |`);
  lines.push(`| **Quality Score** | **${anchor.anchor_quality_score ?? 'n/a'}** |`);
  lines.push('');

  // Readability
  const readability = ca.readability ?? {};
  lines.push('## Readability', '');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Reading Level | **${readability.reading_level ?? 'n/a'}** |`);
  lines.push(`| Flesch Reading Ease | ${readability.flesch_reading_ease ?? 'n/a'} |`);
  lines.push(`| Gunning Fog Index | ${readability.gunning_fog_index ?? 'n/a'} |`);
  lines.push(`| Avg Words / Sentence | ${readability.avg_words_per_sentence ?? 'n/a'} |`);
  lines.push(`| Long Sentences (>30 words) | ${readability.long_sentences_count ?? 0} |`);
  lines.push(`| Short Sentences (<5 words) | ${readability.short_sentences_count ?? 0} |`);
  const sld = (readability as any).sentence_length_distribution as
    | { min: number; max: number; p50: number; p90: number }
    | undefined;
  if (sld) {
    lines.push(`| Sentence Length Distribution | min ${sld.min} · p50 ${sld.p50} · p90 ${sld.p90} · max ${sld.max} (words) |`);
  }
  lines.push('');

  // Passive Voice
  const passive = ca.passive_voice ?? {};
  if (passive.passive_voice_count != null) {
    lines.push('## Passive Voice', '');
    lines.push('| Metric | Value |');
    lines.push('|--------|-------|');
    lines.push(`| Count | ${passive.passive_voice_count} |`);
    const ratioPct = ((passive.passive_voice_ratio ?? 0) as number) * 100;
    lines.push(`| Ratio | ${ratioPct.toFixed(2)}% of words |`);
    lines.push('');
    const examples = (passive as any).examples;
    if (Array.isArray(examples) && examples.length > 0) {
      lines.push('**Examples:**');
      for (const e of (examples as unknown[]).slice(0, 3)) lines.push(`- ${String(e)}`);
      lines.push('');
    }
  }

  // Image Alt Text
  const imgAlt = ca.image_alt_text ?? {};
  if (imgAlt.images_total != null) {
    lines.push('## Image Alt Text', '');
    lines.push('| Metric | Value |');
    lines.push('|--------|-------|');
    lines.push(`| Total Images | ${imgAlt.images_total} |`);
    lines.push(`| Missing Alt | ${imgAlt.images_missing_alt ?? 0} |`);
    lines.push(`| Alt Coverage Ratio | ${imgAlt.alt_coverage_ratio ?? 'n/a'} |`);
    if ((imgAlt as any).images_empty_alt != null) lines.push(`| Empty Alt | ${(imgAlt as any).images_empty_alt} |`);
    if ((imgAlt as any).images_decorative != null) lines.push(`| Decorative | ${(imgAlt as any).images_decorative} |`);
    if ((imgAlt as any).images_informative != null) lines.push(`| Informative | ${(imgAlt as any).images_informative} |`);
    lines.push('');
  }

  // Heading Hierarchy (Python content-side view — see note below)
  const hh = ca.heading_hierarchy ?? {};
  if (hh.hierarchy_valid != null) {
    lines.push('## Heading Hierarchy (content-side)', '');
    lines.push('_Analyzed from the extracted markdown headings. For the DOM-level view see `structure.md`._', '');
    lines.push('| Metric | Value |');
    lines.push('|--------|-------|');
    lines.push(`| Hierarchy Valid | ${hh.hierarchy_valid ? 'yes' : 'no'} |`);
    if ((hh as any).h1_count != null) lines.push(`| H1 Count | ${(hh as any).h1_count} |`);
    if ((hh as any).skipped_levels != null) lines.push(`| Skipped Levels | ${(hh as any).skipped_levels} |`);
    if ((hh as any).orphan_headings != null) lines.push(`| Orphan Headings | ${(hh as any).orphan_headings} |`);
    const hhViolations: unknown[] = Array.isArray(hh.violations) ? (hh.violations as unknown[]) : [];
    lines.push(`| Violations | ${hhViolations.length} |`);
    lines.push('');
    if (hhViolations.length > 0) {
      lines.push('**First violations:**');
      for (const v of hhViolations.slice(0, 5)) {
        if (typeof v === 'object' && v !== null) {
          const rec = v as Record<string, unknown>;
          lines.push(`- level ${rec.from ?? '?'} → ${rec.to ?? '?'}: ${rec.heading ?? ''}`);
        } else {
          lines.push(`- ${String(v)}`);
        }
      }
      lines.push('');
    }
  }

  // Transition Words
  const tw = ca.transition_words ?? {};
  if (tw.transition_word_count != null) {
    lines.push('## Transition Words', '');
    lines.push('| Metric | Value |');
    lines.push('|--------|-------|');
    lines.push(`| Count | ${tw.transition_word_count} |`);
    const ratioPct = ((tw.transition_word_ratio ?? 0) as number) * 100;
    lines.push(`| Ratio | ${ratioPct.toFixed(2)}% |`);
    lines.push(`| Label | ${tw.transition_label ?? 'n/a'} |`);
    const types: unknown = (tw as any).transition_types_found ?? (tw as any).types_found;
    if (Array.isArray(types) && types.length > 0) {
      lines.push(`| Types Found | ${(types as string[]).join(', ')} |`);
    }
    lines.push('');
  }

  // Meta Description
  const mdInfo = (ca as any).meta_description ?? ca.meta_description_info;
  if (mdInfo && typeof mdInfo === 'object') {
    lines.push('## Meta Description', '');
    lines.push('| Metric | Value |');
    lines.push('|--------|-------|');
    lines.push(`| Length | ${mdInfo.meta_description_length ?? 'n/a'} |`);
    lines.push(`| Status | ${mdInfo.meta_description_status ?? 'n/a'} |`);
    if (mdInfo.on_page != null) lines.push(`| On Page | ${mdInfo.on_page ? 'yes' : 'no'} |`);
    lines.push('');
    const mdIssues: unknown = mdInfo.issues ?? mdInfo.quality_flags;
    if (Array.isArray(mdIssues) && mdIssues.length > 0) {
      lines.push('**Flags:**');
      for (const i of mdIssues as unknown[]) lines.push(`- ${String(i)}`);
      lines.push('');
    }
  }

  // First Paragraph
  const fp = (ca as any).first_paragraph;
  if (fp && typeof fp === 'object' && fp.word_count != null) {
    lines.push('## First Paragraph', '');
    lines.push('| Metric | Value |');
    lines.push('|--------|-------|');
    lines.push(`| Word Count | ${fp.word_count} |`);
    lines.push(`| Contains Title Keyword | ${fp.contains_title_keyword ? 'yes' : 'no'} |`);
    lines.push(`| Has Hook | ${fp.has_hook ? 'yes' : 'no'} |`);
    lines.push('');
  }

  // CTA
  const cta = ca.cta ?? {};
  lines.push('## CTA Detection', '');
  lines.push(`CTA Present: **${cta.cta_present ? 'yes' : 'no'}**`, '');
  if (cta.cta_patterns_found?.length) {
    lines.push(`Patterns found: ${(cta.cta_patterns_found as string[]).join(', ')}`, '');
  }

  // TOC + Author Bio
  const toc = ca.toc ?? {};
  const authorBio = ca.author_bio ?? {};
  lines.push('## Structure Signals', '');
  lines.push('| Signal | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Table of Contents | ${toc.toc_present ? `yes (${toc.toc_entry_count} entries)` : 'no'} |`);
  if (toc.toc_recommended) lines.push(`| TOC Recommended | yes (long-form content) |`);
  lines.push(`| Author Bio | ${authorBio.author_bio_present ? 'yes' : 'no'} |`);
  const linkDensity = ca.link_density ?? {};
  lines.push(`| Internal Link Density | ${linkDensity.links_per_1000_words ?? 'n/a'} links/1000 words |`);
  const ldIssues: string[] = Array.isArray((linkDensity as any).issues) ? (linkDensity as any).issues : [];
  if (ldIssues.length > 0) {
    lines.push(`| Link Density Flags | ${ldIssues.join(', ')} |`);
  }
  lines.push('');

  // Top Keywords
  const topKw: Array<{ word: string; count: number; tfidf?: number }> = ca.top_keywords ?? [];
  if (topKw.length > 0) {
    lines.push('## Top Keywords', '');
    lines.push('| Keyword | Count | TF-IDF |');
    lines.push('|---------|-------|--------|');
    for (const kw of topKw) {
      lines.push(`| ${kw.word} | ${kw.count} | ${kw.tfidf != null ? kw.tfidf.toFixed(3) : 'n/a'} |`);
    }
    lines.push('');
  }

  // Top Phrases
  const topPh: Array<{ phrase: string; count: number }> = ca.top_phrases ?? [];
  if (topPh.length > 0) {
    lines.push('## Top Phrases', '');
    lines.push('| Phrase | Count |');
    lines.push('|--------|-------|');
    for (const ph of topPh) {
      lines.push(`| ${ph.phrase} | ${ph.count} |`);
    }
    lines.push('');
  }

  // Issues
  const issues: string[] = ca.issues ?? [];
  if (issues.length > 0) {
    lines.push('## Issues', '');
    for (const issue of issues) {
      lines.push(`- ${issue}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// (score.md removed — scoring was arbitrary, issues live in report.json)
// ---------------------------------------------------------------------------

export function buildScoreMd(data: RunReportData): string {
  const ca = data.rawContentAnalysis;
  if (!ca) return `# Score Report: ${new URL(data.url).hostname}\n\n_No content analysis data available._\n`;

  const hostname = new URL(data.url).hostname;
  const lines: string[] = [
    `# Score Report — ${hostname}`,
    `> URL: ${data.url}`,
    `> Generated: ${new Date().toISOString()}`,
    '',
  ];

  // ── Overall Score ──────────────────────────────────────────────────────────
  const score: number = ca.score ?? 0;
  const scoreLabel: string = ca.score_label ?? 'unknown';
  lines.push(`## Overall Score: ${score} / 100  (${scoreLabel})`, '');

  // Compute deductions (mirrors calculate_score() weights in content_analysis.py)
  const depth        = ca.content_depth ?? {};
  const relevance    = ca.content_relevance ?? {};
  const eeat         = ca.eeat_signals ?? {};
  const freshness    = ca.content_freshness ?? {};
  const thin         = ca.thin_content ?? {};
  const anchor       = ca.anchor_text_quality ?? {};

  const deductions: { dimension: string; amount: number; reason: string }[] = [];

  // Content depth
  if (depth.depth_label === 'thin')  deductions.push({ dimension: 'Content Depth',  amount: 15, reason: 'thin (< 100 words)' });
  else if (depth.depth_label === 'short') deductions.push({ dimension: 'Content Depth', amount: 7, reason: 'short content' });

  // Content relevance
  if (relevance.title_in_h1 === false)           deductions.push({ dimension: 'Relevance', amount: 10, reason: 'title not found in H1' });
  if (relevance.title_in_intro === false)         deductions.push({ dimension: 'Relevance', amount: 5,  reason: 'title not found in intro' });
  if ((relevance.heading_alignment_score ?? 1) < 0.5) deductions.push({ dimension: 'Relevance', amount: 5,  reason: `heading alignment low (${relevance.heading_alignment_score})` });
  if (relevance.keyword_stuffing_detected)        deductions.push({ dimension: 'Relevance', amount: 15, reason: 'keyword stuffing detected' });

  // E-E-A-T
  const eeatCount: number = eeat.eeat_signals_count ?? 0;
  if (eeatCount === 0)      deductions.push({ dimension: 'E-E-A-T', amount: 20, reason: '0 trust signals present' });
  else if (eeatCount === 1) deductions.push({ dimension: 'E-E-A-T', amount: 12, reason: '1 trust signal present' });
  else if (eeatCount === 2) deductions.push({ dimension: 'E-E-A-T', amount: 6,  reason: '2 trust signals present' });

  // Freshness
  if (freshness.freshness_status === 'very_stale') deductions.push({ dimension: 'Freshness', amount: 10, reason: `most recent year: ${freshness.most_recent_year ?? 'unknown'}` });
  else if (freshness.freshness_status === 'stale') deductions.push({ dimension: 'Freshness', amount: 5,  reason: `most recent year: ${freshness.most_recent_year ?? 'unknown'}` });

  // Thin content
  if (thin.thin_content_risk === 'high')   deductions.push({ dimension: 'Thin Content', amount: 20, reason: 'high risk' });
  else if (thin.thin_content_risk === 'medium') deductions.push({ dimension: 'Thin Content', amount: 10, reason: 'medium risk' });
  else if (thin.thin_content_risk === 'low')    deductions.push({ dimension: 'Thin Content', amount: 5,  reason: 'low risk' });

  // Anchor quality
  if (anchor.anchor_quality_score === 'poor') deductions.push({ dimension: 'Anchor Quality', amount: 10, reason: 'high ratio of generic/empty anchors' });
  else if (anchor.anchor_quality_score === 'fair') deductions.push({ dimension: 'Anchor Quality', amount: 5, reason: 'some generic anchors detected' });

  // Readability
  const readability = ca.readability ?? {};
  if (readability.reading_level === 'academic') deductions.push({ dimension: 'Readability', amount: 10, reason: `academic level (Flesch: ${readability.flesch_reading_ease ?? 'n/a'})` });
  else if (readability.reading_level === 'difficult') deductions.push({ dimension: 'Readability', amount: 5, reason: `difficult level (Flesch: ${readability.flesch_reading_ease ?? 'n/a'})` });

  if (deductions.length > 0) {
    lines.push('### Score Deductions', '');
    lines.push('| Dimension | −Points | Reason |');
    lines.push('|-----------|---------|--------|');
    for (const d of deductions.sort((a, b) => b.amount - a.amount)) {
      lines.push(`| ${d.dimension} | −${d.amount} | ${d.reason} |`);
    }
    const totalDeducted = deductions.reduce((s, d) => s + d.amount, 0);
    lines.push(`|  | **−${totalDeducted} total** | (base 100 → ${100 - totalDeducted}, clamped to ${score}) |`);
    lines.push('');
  } else {
    lines.push('_No deductions — page scored 100._', '');
  }

  lines.push('---', '');

  // ── Content Depth ─────────────────────────────────────────────────────────
  lines.push('## Content Depth', '');
  lines.push(`- **Label:** ${depth.depth_label ?? 'n/a'}`);
  lines.push(`- **Word count:** ${depth.word_count ?? 'n/a'}`);
  lines.push(`- **Paragraphs:** ${depth.paragraph_count ?? 'n/a'}  |  Avg length: ${depth.avg_paragraph_length ?? 'n/a'} words`);
  const depthIssues: string[] = depth.issues ?? [];
  if (depthIssues.length) {
    for (const i of depthIssues) lines.push(`- ⚠ ${i}`);
  }
  lines.push('');

  // ── Content Relevance ─────────────────────────────────────────────────────
  lines.push('## Content Relevance', '');
  const yn = (v: boolean | undefined) => v == null ? 'n/a' : v ? '✓' : '✗';
  lines.push(`- Title in H1: ${yn(relevance.title_in_h1)}`);
  lines.push(`- Title in intro: ${yn(relevance.title_in_intro)}${relevance.title_in_intro_word_position != null ? `  (word position: ${relevance.title_in_intro_word_position})` : ''}`);
  lines.push(`- Heading alignment score: ${relevance.heading_alignment_score ?? 'n/a'}`);
  lines.push(`- Keyword stuffing: ${relevance.keyword_stuffing_detected ? '**DETECTED**' : 'none detected'}`);
  lines.push('');

  // ── E-E-A-T ───────────────────────────────────────────────────────────────
  lines.push('## E-E-A-T Signals', '');
  lines.push(`- **Label:** ${eeat.eeat_label ?? 'n/a'}  (${eeatCount} / 5 signals present)`);
  lines.push(`- First-person language: ${eeat.first_person_present ? `✓  ${eeat.first_person_count} instance(s)` : '✗ none'}`);
  lines.push(`- Statistics / data references: ${eeat.statistics_count ?? 0}`);
  lines.push(`- Citation patterns: ${eeat.citation_patterns ?? 0}  _(e.g. "according to", "study by")_`);
  lines.push(`- Author mention: ${eeat.author_mention_detected ? '✓' : '✗'}`);
  const datesFound: string[] = eeat.dates_found ?? [];
  lines.push(`- Dates found: ${datesFound.length ? datesFound.join(', ') : 'none'}`);
  lines.push(`- Time-sensitive content without a date: ${eeat.time_sensitive_without_date ? '⚠ yes' : 'no'}`);
  lines.push('');

  // ── Content Freshness ─────────────────────────────────────────────────────
  lines.push('## Content Freshness', '');
  lines.push(`- **Status:** ${freshness.freshness_status ?? 'n/a'}`);
  lines.push(`- Most recent year detected: ${freshness.most_recent_year ?? 'none'}  (current year: ${new Date().getFullYear()})`);
  const yearsMentioned: number[] = freshness.years_mentioned ?? [];
  lines.push(`- Years mentioned: ${yearsMentioned.length ? yearsMentioned.join(', ') : 'none'}`);
  const tsPhrases: string[] = freshness.time_sensitive_phrases_found ?? [];
  lines.push(`- Time-sensitive phrases found: ${tsPhrases.length ? tsPhrases.join(', ') : 'none'}`);
  lines.push('');

  // ── Thin Content ──────────────────────────────────────────────────────────
  lines.push('## Thin Content', '');
  lines.push(`- **Risk:** ${thin.thin_content_risk ?? 'n/a'}`);
  const boilerplate: string[] = thin.boilerplate_detected ?? [];
  lines.push(`- Boilerplate detected: ${boilerplate.length ? boilerplate.map(b => `"${b}"`).join(', ') : 'none'}`);
  lines.push(`- Duplicate sentences: ${thin.duplicate_sentences_found ?? 0}`);
  lines.push(`- Skeleton page (heading-heavy): ${thin.skeleton_page_detected ? `yes  (ratio: ${thin.heading_to_content_ratio})` : 'no'}`);
  const signals = thin.thin_content_signals ?? {};
  if (Object.keys(signals).length) {
    const sigParts = Object.entries(signals as Record<string, boolean>).map(([k, v]) => `${k}=${v}`);
    lines.push(`- Signals: ${sigParts.join(', ')}`);
  }
  lines.push('');

  // ── Anchor Text Quality ───────────────────────────────────────────────────
  lines.push('## Anchor Text Quality', '');
  lines.push(`- **Score:** ${anchor.anchor_quality_score ?? 'n/a'}`);
  lines.push(`- Total internal links: ${anchor.total_internal_links ?? 0}`);
  lines.push(`- Descriptive: ${anchor.descriptive_count ?? 0}  |  Generic: ${anchor.generic_count ?? 0}  |  Naked URL: ${anchor.naked_url_count ?? 0}  |  Empty: ${anchor.empty_count ?? 0}`);
  lines.push(`- Descriptive ratio: ${anchor.descriptive_ratio ?? 'n/a'}`);
  lines.push('');

  const anchorMap: Array<{ text: string; url: string; classification: string }> = anchor.anchor_quality_map ?? [];
  const badAnchors = anchorMap.filter(a => a.classification !== 'descriptive');
  if (badAnchors.length > 0) {
    lines.push('### Non-descriptive anchors', '');
    lines.push('| Classification | Anchor text | URL |');
    lines.push('|----------------|-------------|-----|');
    for (const a of badAnchors) {
      lines.push(`| ${a.classification} | ${a.text || '_(empty)_'} | ${a.url} |`);
    }
    lines.push('');
  }

  // ── Featured Snippet Eligibility ──────────────────────────────────────────
  const snippet = ca.featured_snippet ?? {};
  lines.push('## Featured Snippet Eligibility', '');
  lines.push(`- **Eligible:** ${snippet.snippet_eligible ? 'yes' : 'no'}`);
  const eligibleTypes: string[] = snippet.snippet_types_eligible ?? [];
  if (eligibleTypes.length) lines.push(`- Eligible types: ${eligibleTypes.join(', ')}`);
  lines.push('');

  const qaPairs: Array<{ question: string; answer_preview: string; answer_length: number }> = snippet.qa_pairs_found ?? [];
  if (qaPairs.length > 0) {
    lines.push('### Q&A Pairs found', '');
    lines.push('| Question | Answer preview | Length |');
    lines.push('|----------|----------------|--------|');
    for (const qa of qaPairs) {
      lines.push(`| ${qa.question} | ${qa.answer_preview} | ${qa.answer_length} chars |`);
    }
    lines.push('');
  }

  const listsUnderHeadings: Array<{ heading: string; list_type: string; item_count: number; avg_item_length: number; snippet_eligible: boolean }> = snippet.lists_under_headings ?? [];
  if (listsUnderHeadings.length > 0) {
    lines.push('### Lists under headings', '');
    lines.push('| Heading | Type | Items | Avg item length | Snippet eligible |');
    lines.push('|---------|------|-------|-----------------|-----------------|');
    for (const l of listsUnderHeadings) {
      lines.push(`| ${l.heading} | ${l.list_type} | ${l.item_count} | ${l.avg_item_length} | ${l.snippet_eligible ? '✓' : '✗'} |`);
    }
    lines.push('');
  }

  // ── Issues ────────────────────────────────────────────────────────────────
  const issues: string[] = ca.issues ?? [];
  if (issues.length > 0) {
    lines.push('## Content Issues', '');
    for (const issue of issues) {
      lines.push(`- ${issue}`);
    }
    lines.push('');
  }

  // ── Report Issues (critical / warning / info from generateIssues) ──────
  const reportIssues = data.report?.issues;
  if (reportIssues) {
    lines.push('---', '');
    lines.push('## Analysis Issues', '');
    const critical: string[] = reportIssues.critical ?? [];
    const warning: string[] = reportIssues.warning ?? [];
    const info: string[] = reportIssues.info ?? [];
    if (critical.length > 0) {
      lines.push(`### Critical (${critical.length})`, '');
      for (const c of critical) lines.push(`- ${c}`);
      lines.push('');
    }
    if (warning.length > 0) {
      lines.push(`### Warning (${warning.length})`, '');
      for (const w of warning) lines.push(`- ${w}`);
      lines.push('');
    }
    if (info.length > 0) {
      lines.push(`### Info (${info.length})`, '');
      for (const i of info) lines.push(`- ${i}`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// psi_debug.md — raw PSI + CrUX API responses for debugging
// ---------------------------------------------------------------------------

export function buildPsiDebugMd(data: RunReportData): string {
  const hostname = new URL(data.url).hostname;
  const lines: string[] = [`# PSI Debug: ${hostname}`, '', `URL: ${data.url}`, ''];

  const buildPsiSection = (label: string, raw: any) => {
    lines.push(`## PSI ${label}`, '');
    if (!raw) {
      lines.push(`_No PSI ${label} data (API key missing, error, or timeout)._`, '');
      return;
    }

    // Performance score
    const perfScore = raw.lighthouseResult?.categories?.performance?.score;
    lines.push(`Lighthouse performance score: **${perfScore != null ? Math.round(perfScore * 100) : 'n/a'}**`, '');

    // loadingExperience metrics (real-user field data)
    const le = raw.loadingExperience;
    lines.push('### loadingExperience metrics', '');
    if (!le || !le.metrics) {
      lines.push('_No loadingExperience metrics in PSI response._', '');
    } else {
      lines.push('| Metric key | p75 value | category |');
      lines.push('|------------|-----------|----------|');
      for (const [key, val] of Object.entries(le.metrics as Record<string, any>)) {
        lines.push(`| \`${key}\` | ${(val as any)?.percentile ?? 'n/a'} | ${(val as any)?.category ?? 'n/a'} |`);
      }
      lines.push('');
      lines.push(`Overall category: **${le.overall_category ?? 'n/a'}**`, '');
    }

    // Key Lighthouse audits
    const audits = raw.lighthouseResult?.audits ?? {};
    const cwvAuditIds = ['largest-contentful-paint', 'cumulative-layout-shift', 'total-blocking-time', 'speed-index', 'interactive'];
    lines.push('### Key Lighthouse Audits', '');
    lines.push('| Audit | Display Value | Numeric Value | Score |');
    lines.push('|-------|---------------|---------------|-------|');
    for (const id of cwvAuditIds) {
      const a = audits[id];
      if (a) {
        lines.push(`| ${id} | ${a.displayValue ?? 'n/a'} | ${a.numericValue ?? 'n/a'} | ${a.score ?? 'n/a'} |`);
      }
    }
    lines.push('');

    // Resource Summary
    const resSummary = audits['resource-summary'];
    if (resSummary?.details?.items?.length) {
      lines.push('### Resource Summary', '');
      lines.push('| Resource Type | Count | Size |');
      lines.push('|---------------|-------|------|');
      for (const item of (resSummary.details.items as Array<{ resourceType: string; requestCount: number; transferSize: number }>)) {
        const sizeKb = item.transferSize != null ? `${(item.transferSize / 1024).toFixed(1)} KB` : 'n/a';
        lines.push(`| ${item.resourceType} | ${item.requestCount ?? 'n/a'} | ${sizeKb} |`);
      }
      lines.push('');
    }

    lines.push('### Raw PSI Response', '');
    lines.push('```json');
    const condensed = { ...raw };
    if (condensed.lighthouseResult) {
      condensed.lighthouseResult = { ...condensed.lighthouseResult };
      delete condensed.lighthouseResult.audits;
      delete condensed.lighthouseResult.i18n;
      delete condensed.lighthouseResult.timing;
      delete condensed.lighthouseResult.fullPageScreenshot;
    }
    lines.push(JSON.stringify(condensed, null, 2));
    lines.push('```', '');
  };

  buildPsiSection('Desktop', data.rawPsi?.desktop);
  buildPsiSection('Mobile', data.rawPsi?.mobile);

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// robots_check.md — robots.txt validation report
// ---------------------------------------------------------------------------

export function buildRobotsCheckMd(data: RunReportData): string {
  const r = data.rawRobotsCheck;
  const hostname = new URL(data.url).hostname;

  if (!r) return `# Robots.txt Check: ${hostname}\n\n_No robots check data available._\n`;

  const lines: string[] = [`# Robots.txt Check: ${hostname}`, ''];

  // --- Request section -------------------------------------------------
  const req = r.request ?? {};
  lines.push('## Request', '');
  lines.push('| Field | Value |');
  lines.push('|-------|-------|');
  lines.push(`| robots.txt URL | ${req.robots_url ?? r.robots_url ?? 'n/a'} |`);
  lines.push(`| Final URL | ${req.final_url ?? r.final_url ?? 'n/a'} |`);
  lines.push(`| Status Code | ${req.status_code ?? r.status_code ?? 'n/a'} |`);
  lines.push(`| Content-Type | ${req.content_type ?? r.content_type ?? 'n/a'} |`);
  lines.push(`| Content-Length | ${req.content_length ?? r.content_length ?? 'n/a'} bytes |`);
  lines.push(`| Elapsed | ${req.elapsed_ms ?? r.elapsed_ms ?? 'n/a'} ms |`);
  lines.push('');

  const chain = (req.redirect_chain ?? r.redirect_chain) as string[] | undefined;
  if (chain && chain.length > 0) {
    lines.push('## Redirects', '');
    lines.push('| # | Target |');
    lines.push('|---|--------|');
    chain.forEach((u, i) => lines.push(`| ${i + 1} | ${u} |`));
    lines.push('');
  }

  // --- Summary ---------------------------------------------------------
  lines.push('## Summary', '');
  lines.push('| Field | Value |');
  lines.push('|-------|-------|');
  lines.push(`| Fetched | ${r.fetched ? 'yes' : 'no'} |`);
  lines.push(`| Path Disallowed | ${r.path_disallowed ? '⚠ yes' : 'no'}${r.reason ? ` (${r.reason})` : ''} |`);
  lines.push(`| Crawl Delay | ${r.crawl_delay != null ? `${r.crawl_delay}s` : 'none'} |`);
  const disallowRules: string[] = r.disallow_rules ?? [];
  const entireSite = r.has_wildcard_disallow === true && disallowRules.includes('/');
  lines.push(`| Blocks Entire Site | ${entireSite ? '⚠ YES (Disallow: /)' : 'no'} |`);
  lines.push(`| Conflict with Meta Robots | ${r.conflict_with_meta ? '⚠ yes' : 'no'} |`);
  lines.push('');

  // --- Multi-agent verdict --------------------------------------------
  const verdicts = (r.per_agent_verdict ?? {}) as Record<string, string>;
  if (Object.keys(verdicts).length > 0) {
    lines.push('## Multi-agent Verdict', '');
    lines.push('| User-agent | Verdict |');
    lines.push('|------------|---------|');
    for (const [agent, v] of Object.entries(verdicts)) {
      const mark = v === 'disallowed' ? '⚠' : '✓';
      lines.push(`| ${agent} | ${mark} ${v} |`);
    }
    lines.push('');
  }

  // --- AI Bots ---------------------------------------------------------
  const ai = r.ai_bot_summary;
  if (ai && typeof ai === 'object') {
    lines.push('## AI Bots', '');
    lines.push(`- ${ai.blocked_count}/${ai.total_checked} AI crawlers explicitly blocked`);
    if (Array.isArray(ai.blocked_agents) && ai.blocked_agents.length > 0) {
      lines.push(`- Blocked: ${ai.blocked_agents.join(', ')}`);
    }
    lines.push('');
  }

  if ((r.sitemaps as string[] | undefined)?.length) {
    lines.push('## Sitemaps in robots.txt', '');
    for (const sitemap of (r.sitemaps as string[])) {
      lines.push(`- ${sitemap}`);
    }
    lines.push('');
  }

  if (disallowRules.length > 0) {
    lines.push('## Disallow Rules (for *)', '');
    for (const rule of disallowRules) {
      lines.push(`- \`${rule}\``);
    }
    lines.push('');
  }

  const allowRules: string[] = r.allow_rules ?? [];
  if (allowRules.length > 0) {
    lines.push('## Allow Rules (for *)', '');
    for (const rule of allowRules) {
      lines.push(`- \`${rule}\``);
    }
    lines.push('');
  }

  // --- Sitemap analyses (all, not just first) --------------------------
  const analyses: any[] = Array.isArray(r.sitemap_analyses)
    ? r.sitemap_analyses
    : r.sitemap_analysis ? [r.sitemap_analysis] : [];
  if (analyses.length > 0) {
    lines.push('## Sitemap Analysis', '');
    for (const sa of analyses) {
      lines.push(`### ${sa.url ?? '(no url)'}`, '');
      lines.push('| Field | Value |');
      lines.push('|-------|-------|');
      lines.push(`| URL Count | ${sa.url_count ?? 0} |`);
      lines.push(`| Has Lastmod | ${sa.has_lastmod ? 'yes' : 'no'} |`);
      lines.push(`| Is Index | ${sa.is_index ? 'yes' : 'no'} |`);
      if (sa.discovered_via_fallback) lines.push('| Discovered | via fallback probe |');
      if (sa.children_fetched != null) {
        lines.push(`| Children Fetched | ${sa.children_fetched} |`);
        lines.push(`| URLs Across Children | ${sa.total_urls_across_children ?? 0} |`);
      }
      if (sa.error) lines.push(`| Error | ${sa.error} |`);
      lines.push('');
    }
  }

  // --- Validation warnings --------------------------------------------
  const syntaxWarnings: string[] = r.syntax_warnings ?? [];
  if (syntaxWarnings.length > 0
      || r.size_exceeds_google_limit
      || (r.content_type && r.content_type_is_text_plain === false)
      || r.cross_origin_redirect) {
    lines.push('## Validation Warnings', '');
    if (r.size_exceeds_google_limit) {
      lines.push(`- robots.txt exceeds Google's 500 KiB limit (${r.content_length} bytes)`);
    }
    if (r.content_type && r.content_type_is_text_plain === false) {
      lines.push(`- Content-Type is "${r.content_type}" (expected text/plain)`);
    }
    if (r.cross_origin_redirect) {
      lines.push('- robots.txt redirected cross-origin');
    }
    for (const w of syntaxWarnings) lines.push(`- ${w}`);
    lines.push('');
  }

  if ((r.issues as string[] | undefined)?.length) {
    lines.push('## Issues', '');
    for (const issue of (r.issues as string[])) {
      lines.push(`- ${issue}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function buildAssetsMd(data: RunReportData): string {
  const lines: string[] = [`# Assets: ${new URL(data.url).hostname}`, ''];
  const { images, externalScripts, inlineScripts, stylesheets, preloads } = parseAssets(data.html);

  // Images
  lines.push(`## Images (${images.length})`, '');
  if (images.length > 0) {
    lines.push('| src | alt |');
    lines.push('|-----|-----|');
    for (const img of images) {
      lines.push(`| ${img.src || '(none)'} | ${img.alt || '(none)'} |`);
    }
  } else {
    lines.push('_None found._');
  }
  lines.push('');

  // Scripts
  lines.push(`## Scripts`, '');
  lines.push(`Inline scripts: **${inlineScripts}**`, '');
  if (externalScripts.length > 0) {
    lines.push(`External scripts (${externalScripts.length}):`, '');
    lines.push('| src |');
    lines.push('|-----|');
    for (const src of externalScripts) {
      lines.push(`| ${src} |`);
    }
  } else {
    lines.push('_No external scripts found._');
  }
  lines.push('');

  // Stylesheets
  lines.push(`## Stylesheets (${stylesheets.length})`, '');
  if (stylesheets.length > 0) {
    lines.push('| href |');
    lines.push('|------|');
    for (const href of stylesheets) {
      lines.push(`| ${href} |`);
    }
  } else {
    lines.push('_None found._');
  }
  lines.push('');

  // Preloads
  lines.push(`## Preloads / Resource Hints (${preloads.length})`, '');
  if (preloads.length > 0) {
    lines.push('| href | as |');
    lines.push('|------|----|');
    for (const p of preloads) {
      lines.push(`| ${p.href} | ${p.extra ?? ''} |`);
    }
  } else {
    lines.push('_None found._');
  }
  lines.push('');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// schema_validation.md — Schema.org validation from schema_validator.py
// ---------------------------------------------------------------------------

export function buildSchemaValidationMd(data: RunReportData): string {
  const sv = data.rawSchemaValidation as any;
  const hostname = new URL(data.url).hostname;

  if (!sv) return `# Schema Validation: ${hostname}\n\n_No schema validation data available._\n`;

  const lines: string[] = [`# Schema Validation: ${hostname}`, '', `> URL: ${data.url}`, ''];

  // Summary
  const summary = sv.summary ?? {};
  lines.push('## Summary', '');
  lines.push('| Field | Value |');
  lines.push('|-------|-------|');
  lines.push(`| Blocks Found | ${sv.blocks_found ?? 0} |`);
  if (summary.total_blocks != null) lines.push(`| Total Blocks | ${summary.total_blocks} |`);
  if (summary.valid_blocks != null) lines.push(`| Valid Blocks | ${summary.valid_blocks} |`);
  if (sv.overall_score != null) lines.push(`| Overall Score | ${sv.overall_score}/100 |`);
  const typesFound: string[] = summary.types_found ?? [];
  lines.push(`| Types Found | ${typesFound.length > 0 ? typesFound.join(', ') : 'none'} |`);
  const richEligible: string[] = summary.rich_results_eligible ?? [];
  lines.push(`| Rich Results Eligible | ${richEligible.length > 0 ? richEligible.join(', ') : 'none'} |`);
  const richIneligible: string[] = summary.rich_results_ineligible ?? [];
  if (richIneligible.length > 0) {
    lines.push(`| Rich Results Ineligible | ${richIneligible.join(', ')} |`);
  }
  const dupTypes: string[] = summary.duplicate_types ?? [];
  if (dupTypes.length > 0) {
    lines.push(`| Duplicate Types | ${dupTypes.join(', ')} |`);
  }
  lines.push('');

  // Per-block details — uses the real SchemaBlock shape
  const blocks: any[] = sv.blocks ?? [];
  if (blocks.length > 0) {
    lines.push('## Schema Blocks', '');
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      const v = b?.validation ?? {};
      const rr = b?.rich_results ?? {};
      lines.push(`### Block ${i + 1}: ${b?.type ?? 'Unknown'}`, '');

      lines.push('| Field | Value |');
      lines.push('|-------|-------|');
      if (b?.score != null) lines.push(`| Score | ${b.score}/100 |`);
      lines.push(`| Rich Results Eligible | ${rr?.eligible ? 'yes' : 'no'} |`);
      if (Array.isArray(rr?.types) && rr.types.length > 0) {
        lines.push(`| Rich Result Types | ${rr.types.join(', ')} |`);
      }
      if (Array.isArray(rr?.missing_for_eligibility) && rr.missing_for_eligibility.length > 0) {
        lines.push(`| Missing for Eligibility | ${rr.missing_for_eligibility.join(', ')} |`);
      }

      const req = v?.required ?? {};
      const reqFields: string[] = req.fields ?? [];
      const reqPresent: string[] = req.present ?? [];
      const reqMissing: string[] = req.missing ?? [];
      if (reqFields.length > 0) {
        lines.push(`| Required (present/total) | ${reqPresent.length}/${reqFields.length} |`);
      }
      if (reqPresent.length > 0) lines.push(`| Required Present | ${reqPresent.join(', ')} |`);
      if (reqMissing.length > 0) lines.push(`| Required Missing | ${reqMissing.join(', ')} |`);

      const rec = v?.recommended ?? {};
      const recFields: string[] = rec.fields ?? [];
      const recPresent: string[] = rec.present ?? [];
      const recMissing: string[] = rec.missing ?? [];
      if (recFields.length > 0) {
        lines.push(`| Recommended (present/total) | ${recPresent.length}/${recFields.length} |`);
      }
      if (recPresent.length > 0) lines.push(`| Recommended Present | ${recPresent.join(', ')} |`);
      if (recMissing.length > 0) lines.push(`| Recommended Missing | ${recMissing.join(', ')} |`);
      lines.push('');

      // Format errors
      const fmtErrors: Array<{ field: string; value?: unknown; expected?: string; message: string }> = v?.format_errors ?? [];
      if (fmtErrors.length > 0) {
        lines.push('**Format Errors:**', '');
        lines.push('| Field | Value | Expected | Message |');
        lines.push('|-------|-------|----------|---------|');
        for (const err of fmtErrors) {
          const val = err.value != null ? String(err.value).slice(0, 60) : '';
          lines.push(`| ${err.field} | ${val} | ${err.expected ?? ''} | ${err.message} |`);
        }
        lines.push('');
      }

      // Warnings
      const warns: Array<{ field: string; message: string }> = v?.warnings ?? [];
      if (warns.length > 0) {
        lines.push('**Warnings:**', '');
        for (const w of warns) lines.push(`- \`${w.field}\`: ${w.message}`);
        lines.push('');
      }
    }
  }

  // Recommendations
  const recs: Array<{ priority: string; type: string; message: string }> = sv.recommendations ?? [];
  if (recs.length > 0) {
    lines.push('## Recommendations', '');
    lines.push('| Priority | Type | Message |');
    lines.push('|----------|------|---------|');
    const order: Record<string, number> = { high: 0, medium: 1, low: 2 };
    const sorted = [...recs].sort((a, b) => (order[a.priority] ?? 9) - (order[b.priority] ?? 9));
    for (const r of sorted) {
      lines.push(`| ${r.priority} | ${r.type} | ${r.message} |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// structure.md — unified structure report (xray + onpage)
// ---------------------------------------------------------------------------

export function buildStructureMd(
  data: RunReportData,
  fetchContext?: {
    status?: number;
    final_url?: string;
    ttfb_ms?: number;
    content_type?: string;
    content_length?: number;
    redirect_chain?: string[];
  },
): string {
  const hostname = new URL(data.url).hostname;
  const x = data.rawXray ?? {};
  const o = data.rawOnpage ?? {};
  const lines: string[] = [`# Page Structure: ${hostname}`, '', `> URL: ${data.url}`, ''];

  // Request
  if (fetchContext) {
    const rows: string[][] = [];
    if (fetchContext.final_url) rows.push(['Final URL', fetchContext.final_url]);
    if (fetchContext.status != null) rows.push(['Status', String(fetchContext.status)]);
    if (fetchContext.ttfb_ms != null) rows.push(['TTFB', `${Math.round(fetchContext.ttfb_ms)} ms`]);
    if (fetchContext.content_type) rows.push(['Content-Type', fetchContext.content_type]);
    if (fetchContext.content_length != null) rows.push(['Content-Length', String(fetchContext.content_length)]);
    if (rows.length > 0) {
      lines.push('## Request', '');
      lines.push('| Field | Value |');
      lines.push('|-------|-------|');
      for (const [k, v] of rows) lines.push(`| ${k} | ${v} |`);
      lines.push('');
    }

    // Redirects
    const chain = fetchContext.redirect_chain ?? [];
    if (chain.length > 0) {
      lines.push(`## Redirects (${chain.length} hop${chain.length === 1 ? '' : 's'})`, '');
      lines.push('| # | From | To | Labels |');
      lines.push('|---|------|----|--------|');
      let prev = data.url;
      for (let i = 0; i < chain.length; i++) {
        const next = chain[i];
        const labels: string[] = [];
        try {
          const f = new URL(prev);
          const tU = new URL(next);
          if (f.protocol === 'http:' && tU.protocol === 'https:') labels.push('HTTP→HTTPS');
          const fw = f.hostname.startsWith('www.');
          const tw = tU.hostname.startsWith('www.');
          if (fw && !tw) labels.push('www → apex');
          if (!fw && tw) labels.push('apex → www');
          if (f.pathname !== tU.pathname && f.pathname.replace(/\/+$/, '') === tU.pathname.replace(/\/+$/, '')) {
            labels.push('trailing-slash');
          }
        } catch { /* ignore */ }
        lines.push(`| ${i + 1} | ${prev} | ${next} | ${labels.join(', ') || '—'} |`);
        prev = next;
      }
      lines.push('');
    }
  }

  // DOM
  const dom = x.dom ?? {};
  lines.push('## DOM', '');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Total Elements | ${dom.total_elements ?? 'n/a'} |`);
  lines.push(`| Unique Tags | ${dom.unique_tags ?? 'n/a'} |`);
  lines.push(`| Max Depth | ${dom.depth_max ?? 'n/a'} |`);
  lines.push(`| Avg Depth | ${dom.depth_avg ?? 'n/a'} |`);
  const dp: string[] = Array.isArray(dom.deepest_path) ? dom.deepest_path : [];
  if (dp.length > 0) {
    lines.push(`| Deepest Path (last 5) | ${dp.slice(-5).join(' > ')} |`);
  }
  lines.push('');

  // Element map (top 5)
  const emap = (x.element_map ?? {}) as Record<string, number>;
  const topEntries = Object.entries(emap).sort(([, a], [, b]) => b - a).slice(0, 5);
  if (topEntries.length > 0) {
    lines.push('## Top Tags', '');
    lines.push('| Tag | Count |');
    lines.push('|-----|-------|');
    for (const [t, c] of topEntries) lines.push(`| \`${t}\` | ${c} |`);
    lines.push('');
  }

  // Structure
  const st = x.structure ?? {};
  lines.push('## Structure', '');
  lines.push('| Property | Value |');
  lines.push('|----------|-------|');
  lines.push(`| Semantic Score | ${st.semantic_score ?? 'n/a'} / 7 |`);
  lines.push(`| Div Ratio | ${st.div_ratio != null ? (st.div_ratio * 100).toFixed(1) + '%' : 'n/a'} |`);
  lines.push(`| Heading Hierarchy Valid | ${st.heading_hierarchy_valid ? 'yes' : 'no'} |`);
  lines.push(`| H1 / H2 / H3 | ${st.h1_count ?? 0} / ${st.h2_count ?? 0} / ${st.h3_count ?? 0} |`);
  lines.push(`| Empty Elements | ${st.empty_elements ?? 'n/a'} |`);
  lines.push(`| Duplicate IDs | ${st.duplicate_ids ?? 'n/a'} |`);
  lines.push(`| Inline Event Handlers | ${st.inline_event_handlers ?? 'n/a'} |`);
  if (Array.isArray(st.deprecated_tags) && st.deprecated_tags.length > 0) {
    lines.push(`| Deprecated Tags | ${st.deprecated_tags.join(', ')} |`);
  }
  const iframes = st.iframes ?? {};
  if (iframes.count != null) {
    lines.push(`| Iframes | ${iframes.count} |`);
  }
  lines.push('');

  // Heading Tree
  const headings = o.headings ?? {};
  const tree: Array<{ level: number; text: string; children?: any[] }> = headings.tree ?? [];
  if (tree.length > 0) {
    lines.push('## Heading Tree', '');
    if (headings.h1_content) lines.push(`**H1:** ${headings.h1_content}`, '');
    const renderTree = (nodes: any[], indent: number) => {
      for (const node of nodes) {
        const prefix = '  '.repeat(indent);
        lines.push(`${prefix}- H${node.level}: ${node.text || '(empty)'}`);
        if (node.children?.length) renderTree(node.children, indent + 1);
      }
    };
    renderTree(tree, 0);
    lines.push('');
  }

  const hIssues: string[] = headings.issues ?? [];
  if (hIssues.length > 0) {
    lines.push('### Heading Issues', '');
    for (const iss of hIssues) lines.push(`- ${iss}`);
    lines.push('');
  }
  if (headings.table_of_contents_detected) {
    lines.push('_Table of contents detected._', '');
  }

  // Content
  const content = o.content ?? {};
  const cr = x.content_ratios ?? {};
  lines.push('## Content', '');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Word Count | ${content.word_count ?? cr.word_count_approx ?? 'n/a'} |`);
  lines.push(`| Paragraphs | ${content.paragraph_count ?? 'n/a'} |`);
  lines.push(`| Avg Paragraph Length | ${content.avg_paragraph_length ?? 'n/a'} words |`);
  lines.push(`| HTML Size | ${cr.html_size_kb ?? 'n/a'} KB |`);
  lines.push(`| HTML / Text Ratio | ${cr.html_text_ratio != null ? (cr.html_text_ratio * 100).toFixed(1) + '%' : 'n/a'} |`);
  lines.push('');

  // Head audit
  const head = x.head ?? {};
  if (Object.keys(head).length > 0) {
    lines.push('## Head', '');
    lines.push('| Check | Value |');
    lines.push('|-------|-------|');
    lines.push(`| Charset | ${head.charset_present ? 'yes' : 'no'} |`);
    lines.push(`| Viewport | ${head.viewport_present ? 'yes' : 'no'} |`);
    lines.push(`| Favicon | ${head.favicon_present ? 'yes' : 'no'} |`);
    lines.push(`| Preload Count | ${head.preload_count ?? 0} |`);
    lines.push('');
  }

  // Accessibility
  const a11y = x.accessibility ?? {};
  if (Object.keys(a11y).length > 0) {
    lines.push('## Accessibility', '');
    lines.push('| Metric | Value |');
    lines.push('|--------|-------|');
    lines.push(`| Missing lang on <html> | ${a11y.html_missing_lang ? 'yes' : 'no'} |`);
    lines.push(`| Images missing alt | ${a11y.images_missing_alt ?? 0} |`);
    lines.push(`| Inputs without label | ${a11y.inputs_without_label ?? 0} |`);
    lines.push(`| Buttons/links no text | ${a11y.buttons_links_no_text ?? 0} |`);
    lines.push(`| ARIA attribute count | ${a11y.aria_attribute_count ?? 0} |`);
    const tabindexAudit = x.tabindex_audit ?? {};
    if (tabindexAudit.positive_tabindex_count != null) {
      lines.push(`| Positive tabindex | ${tabindexAudit.positive_tabindex_count} |`);
    }
    lines.push('');
  }

  // Forms
  const forms = x.forms ?? {};
  if (forms.form_count != null) {
    lines.push('## Forms', '');
    lines.push('| Metric | Value |');
    lines.push('|--------|-------|');
    lines.push(`| Forms | ${forms.form_count} |`);
    lines.push(`| Inputs | ${forms.input_count ?? 0} |`);
    lines.push(`| Buttons | ${forms.button_count ?? 0} |`);
    lines.push(`| Inputs without labels | ${forms.inputs_without_labels ?? 0} |`);
    lines.push(`| Forms missing action | ${forms.forms_missing_action ?? 0} |`);
    lines.push('');
  }

  // Images
  const images = o.images ?? {};
  if (images.total != null) {
    lines.push('## Images', '');
    lines.push('| Metric | Value |');
    lines.push('|--------|-------|');
    lines.push(`| Total | ${images.total} |`);
    lines.push(`| Missing Alt | ${images.missing_alt ?? 0} |`);
    lines.push(`| Empty Alt (decorative) | ${images.empty_alt_decorative ?? 0} |`);
    lines.push(`| Too short | ${images.too_short ?? 0} |`);
    lines.push(`| Too long | ${images.too_long ?? 0} |`);
    lines.push(`| Poor quality | ${images.poor_quality_alt ?? 0} |`);
    lines.push(`| Explicit dimensions | ${images.explicit_dimensions ?? 0} |`);
    lines.push(`| Density per 1000 words | ${images.density_per_1000_words ?? 0} |`);
    lines.push('');
  }

  // Links (x-ray + onpage)
  const xLinks = x.links ?? {};
  const oLinks = o.links ?? {};
  if (xLinks.total != null || oLinks.internal_total != null) {
    lines.push('## Links', '');
    lines.push('| Metric | Value |');
    lines.push('|--------|-------|');
    if (xLinks.total != null) {
      lines.push(`| Total (x-ray) | ${xLinks.total} |`);
      lines.push(`| Internal (x-ray) | ${xLinks.internal ?? 0} |`);
      lines.push(`| External (x-ray) | ${xLinks.external ?? 0} |`);
      lines.push(`| target=_blank missing rel | ${xLinks.target_blank_missing_rel ?? 0} |`);
    }
    if (oLinks.internal_total != null) {
      lines.push(`| Internal (on-page) | ${oLinks.internal_total} |`);
      lines.push(`| Internal generic anchor | ${oLinks.internal_generic_anchor ?? 0} |`);
      lines.push(`| External (on-page) | ${oLinks.external_total ?? 0} |`);
      lines.push(`| External broken | ${oLinks.external_broken ?? 0} |`);
    }
    lines.push('');
  }

  // Scripts
  const scripts = x.scripts ?? {};
  if (scripts.total != null) {
    lines.push('## Scripts', '');
    lines.push('| Metric | Value |');
    lines.push('|--------|-------|');
    lines.push(`| Total | ${scripts.total ?? 0} |`);
    lines.push(`| Inline | ${scripts.inline ?? 0} |`);
    lines.push(`| External | ${scripts.external ?? 0} |`);
    lines.push(`| Defer | ${scripts.defer_count ?? 0} |`);
    lines.push(`| Async | ${scripts.async_count ?? 0} |`);
    const tp = scripts.third_party ?? {};
    if (tp.count) {
      lines.push(`| Third-party | ${tp.count} from ${tp.domains?.length ?? 0} domain(s) |`);
      lines.push(`| Tag Manager | ${tp.tag_manager_detected ? 'detected' : 'no'} |`);
    }
    lines.push('');
    const cats = (tp.categories ?? {}) as Record<string, string[]>;
    const catKeys = ['analytics', 'ads', 'cdn', 'social', 'other'];
    const catRows = catKeys.filter(k => (cats[k] ?? []).length > 0);
    if (catRows.length > 0) {
      lines.push('### Third-party categories', '');
      lines.push('| Category | Count |');
      lines.push('|----------|-------|');
      for (const k of catRows) lines.push(`| ${k} | ${(cats[k] ?? []).length} |`);
      lines.push('');
    }
  }

  // Inline styles
  const inlineStyles = x.inline_styles ?? {};
  if (inlineStyles.count != null) {
    lines.push(`## Inline Styles\n\nCount: **${inlineStyles.count}**`, '');
  }

  // Text density by region
  const td = x.text_density_by_region;
  if (td && typeof td === 'object') {
    lines.push('## Text Density by Region', '');
    lines.push('| Region | Words |');
    lines.push('|--------|-------|');
    lines.push(`| header | ${td.header ?? 0} |`);
    lines.push(`| main | ${td.main ?? 0} |`);
    lines.push(`| aside | ${td.aside ?? 0} |`);
    lines.push(`| footer | ${td.footer ?? 0} |`);
    lines.push('');
  }

  // Largest image candidate
  const lic = x.largest_image_candidate;
  if (lic && typeof lic === 'object') {
    lines.push('## Largest Image Candidate', '');
    lines.push(`- src: ${lic.src ?? '(none)'}`);
    lines.push(`- width: ${lic.width ?? 'n/a'}`);
    lines.push(`- height: ${lic.height ?? 'n/a'}`);
    lines.push('');
  }

  // Duplicate headings
  const dupHeadings: string[] = Array.isArray(x.duplicate_headings) ? x.duplicate_headings : [];
  if (dupHeadings.length > 0) {
    lines.push('## Duplicate Headings', '');
    for (const h of dupHeadings) lines.push(`- ${h}`);
    lines.push('');
  }


  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// performance.md — unified performance report for the `sgnl performance` command
// ---------------------------------------------------------------------------

/**
 * Unified performance report shape used by both the terminal printer (via the
 * command file) and the markdown builder. Every field is optional because PSI
 * / CrUX may return partial data.
 */
export interface PerformanceReport {
  url: string;
  strategy: 'mobile' | 'desktop';
  cwv_passing: boolean | null;
  field_data: FieldData | null;
  field_data_scope?: 'url' | 'origin';
  field_data_collection_period?: CruxCollectionPeriod;
  lab_data: LabData;
  category_scores?: CategoryScores;
  resource_summary?: ResourceSummary;
  opportunities: Opportunity[];
  lcp_element?: LcpElement;
  cls_elements?: ClsElement[];
  render_blocking?: RenderBlockingResource[];
  third_party?: ThirdPartyEntry[];
  bootup?: { total_ms?: number; items: BootupEntry[] };
  server_response_time_ms?: number;
  request_count?: number;
  diagnostics?: PsiDiagnostics;
  error?: string;
}

export interface PerformanceEnvelope {
  request: {
    url: string;
    strategy: 'mobile' | 'desktop' | 'both';
    elapsed_ms: number;
    crux_api_available: boolean;
    crux_scope?: 'url' | 'origin';
    crux_collection_period?: CruxCollectionPeriod;
  };
  performance: PerformanceReport | { mobile?: PerformanceReport; desktop?: PerformanceReport };
}

function pctStr(n: number | undefined): string {
  if (n == null || Number.isNaN(n)) return 'n/a';
  return `${(n * 100).toFixed(0)}%`;
}

/**
 * Build a single-strategy performance section.
 */
function buildPerformanceSection(perf: PerformanceReport): string[] {
  const lines: string[] = [];

  // Heading per-strategy when part of a `both` envelope; caller controls outer "# Performance".
  lines.push(`## Performance (${perf.strategy})`, '');

  // Core Web Vitals verdict
  const verdictLabel = perf.cwv_passing === true
    ? 'PASSING'
    : perf.cwv_passing === false
      ? 'FAILING'
      : 'Insufficient data';
  lines.push(`**Core Web Vitals: ${verdictLabel}**`, '');

  // Lighthouse Scores
  if (perf.category_scores) {
    const c = perf.category_scores;
    lines.push('### Lighthouse Scores', '');
    lines.push('| Category | Score |');
    lines.push('|----------|-------|');
    lines.push(`| Performance | ${c.performance}/100 |`);
    lines.push(`| Accessibility | ${c.accessibility}/100 |`);
    lines.push(`| Best Practices | ${c.best_practices}/100 |`);
    lines.push(`| SEO | ${c.seo}/100 |`);
    lines.push('');
  } else if (perf.lab_data) {
    lines.push(`### Lighthouse Score: ${perf.lab_data.performance_score}/100`, '');
  }

  // Lab Metrics
  const lab = perf.lab_data;
  if (lab) {
    lines.push('### Lab Metrics', '');
    lines.push('| Metric | Value |');
    lines.push('|--------|-------|');
    lines.push(`| Speed Index | ${lab.speed_index_s}s |`);
    lines.push(`| TTI | ${lab.tti_s}s |`);
    lines.push(`| TBT | ${lab.tbt_ms}ms |`);
    lines.push(`| CLS | ${lab.cls} |`);
    if (perf.server_response_time_ms != null) lines.push(`| Server Response | ${perf.server_response_time_ms}ms |`);
    if (perf.request_count != null) lines.push(`| Network Requests | ${perf.request_count} |`);
    lines.push('');
  }

  // Field Data
  const field = perf.field_data;
  if (field) {
    const scopeLabel = perf.field_data_scope === 'origin' ? ' (origin-level data)' : '';
    lines.push(`### Field Data (CrUX)${scopeLabel}`, '');
    const cp = perf.field_data_collection_period;
    if (cp?.firstDate && cp?.lastDate) {
      lines.push(`Collection period: **${cp.firstDate} → ${cp.lastDate}**`, '');
    }
    lines.push('| Metric | Value | Rating | Good | Needs-Improvement | Poor |');
    lines.push('|--------|-------|--------|------|-------------------|------|');
    const row = (label: string, m: FieldData['lcp'] | undefined, fmt: (v: number) => string) => {
      if (!m) return;
      const d = m.distribution ?? [];
      const g = d[0]?.proportion;
      const n = d[1]?.proportion;
      const p = d[2]?.proportion;
      lines.push(`| ${label} | ${fmt(m.value)} | ${m.status} | ${pctStr(g)} | ${pctStr(n)} | ${pctStr(p)} |`);
    };
    row('LCP', field.lcp, v => `${v}ms`);
    row('CLS', field.cls, v => String(v));
    row('INP', field.inp, v => `${v}ms`);
    row('FCP', field.fcp, v => `${v}ms`);
    row('FID', field.fid, v => `${v}ms`);
    lines.push('');
  } else {
    lines.push('### Field Data', '', '_Not available (insufficient traffic data or no API key)._', '');
  }

  // Resource Summary
  const rs = perf.resource_summary;
  if (rs) {
    const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;
    lines.push('### Resource Summary', '');
    lines.push('| Type | Size | Requests |');
    lines.push('|------|------|----------|');
    lines.push(`| Total | ${kb(rs.total_bytes)} | ${rs.total_requests ?? 'n/a'} |`);
    lines.push(`| Scripts | ${kb(rs.script_bytes)} | ${rs.script_requests ?? 'n/a'} |`);
    lines.push(`| Stylesheets | ${kb(rs.stylesheet_bytes)} | ${rs.stylesheet_requests ?? 'n/a'} |`);
    lines.push(`| Images | ${kb(rs.image_bytes)} | ${rs.image_requests ?? 'n/a'} |`);
    lines.push(`| Fonts | ${kb(rs.font_bytes)} | ${rs.font_requests ?? 'n/a'} |`);
    lines.push(`| Other | ${kb(rs.other_bytes)} | ${rs.other_requests ?? 'n/a'} |`);
    lines.push('');
  }

  // LCP Element
  if (perf.lcp_element) {
    const el = perf.lcp_element;
    lines.push('### LCP Element', '');
    if (el.selector) lines.push(`- selector: \`${el.selector}\``);
    if (el.nodeLabel) lines.push(`- node: ${el.nodeLabel}`);
    if (el.snippet) lines.push(`- snippet: \`${el.snippet}\``);
    lines.push('');
  }

  // CLS Elements
  if (perf.cls_elements && perf.cls_elements.length > 0) {
    lines.push('### CLS Elements', '');
    lines.push('| Selector | Score |');
    lines.push('|----------|-------|');
    for (const el of perf.cls_elements) {
      lines.push(`| \`${el.selector ?? '(unknown)'}\` | ${el.score ?? 'n/a'} |`);
    }
    lines.push('');
  }

  // Render-Blocking Resources
  if (perf.render_blocking && perf.render_blocking.length > 0) {
    lines.push('### Render-Blocking Resources', '');
    lines.push('| URL | Wasted ms |');
    lines.push('|-----|-----------|');
    for (const r of perf.render_blocking) {
      lines.push(`| ${r.url} | ${r.wastedMs ?? 'n/a'} |`);
    }
    lines.push('');
  }

  // Third-Party Summary
  if (perf.third_party && perf.third_party.length > 0) {
    lines.push('### Third-Party Summary', '');
    lines.push('| Entity | Blocking Time | Transfer Size |');
    lines.push('|--------|---------------|---------------|');
    for (const tp of perf.third_party) {
      const bt = tp.blockingTime != null ? `${tp.blockingTime}ms` : 'n/a';
      const ts = tp.transferSize != null ? `${Math.round(tp.transferSize / 1024)} KB` : 'n/a';
      lines.push(`| ${tp.entity} | ${bt} | ${ts} |`);
    }
    lines.push('');
  }

  // Bootup Time
  if (perf.bootup && perf.bootup.items.length > 0) {
    const total = perf.bootup.total_ms != null ? ` (total ${perf.bootup.total_ms}ms)` : '';
    lines.push(`### Bootup Time${total}`, '');
    lines.push('| Script | Scripting | Parse/Compile |');
    lines.push('|--------|-----------|---------------|');
    for (const b of perf.bootup.items) {
      lines.push(`| ${b.url} | ${b.scripting ?? 'n/a'}ms | ${b.scriptParseCompile ?? 'n/a'}ms |`);
    }
    lines.push('');
  }

  // Diagnostics
  const diag = perf.diagnostics;
  if (diag && Object.values(diag).some(v => v != null)) {
    lines.push('### Diagnostics', '');
    lines.push('| Metric | Value |');
    lines.push('|--------|-------|');
    if (diag.dom_size != null) lines.push(`| DOM size | ${diag.dom_size} elements |`);
    if (diag.network_rtt != null) lines.push(`| Network RTT | ${diag.network_rtt}ms |`);
    if (diag.network_server_latency != null) lines.push(`| Network server latency | ${diag.network_server_latency}ms |`);
    if (diag.total_tasks != null) lines.push(`| Main-thread tasks | ${diag.total_tasks} |`);
    if (diag.main_document_transfer_size != null) {
      lines.push(`| Main document transfer | ${Math.round(diag.main_document_transfer_size / 1024)} KB |`);
    }
    lines.push('');
  }

  // Opportunities (full list in markdown)
  if (perf.opportunities && perf.opportunities.length > 0) {
    lines.push('### Opportunities', '');
    lines.push('| Audit | Fix | Savings (ms) | Savings (bytes) | Status |');
    lines.push('|-------|-----|--------------|-----------------|--------|');
    for (const opp of perf.opportunities) {
      const ms = opp.savings_ms ? `${opp.savings_ms}` : 'n/a';
      const bytes = opp.savings_bytes != null ? `${opp.savings_bytes}` : 'n/a';
      lines.push(`| ${opp.id} | ${opp.fix} | ${ms} | ${bytes} | ${opp.status} |`);
    }
    lines.push('');
  }

  return lines;
}

/**
 * Build the unified `performance.md` report. Accepts the envelope shape the
 * performance command produces (`{ request, performance }`), supporting both
 * single-strategy and `strategy: 'both'` dual-strategy modes.
 */
export function buildPerformanceMd(envelope: PerformanceEnvelope): string {
  const { request, performance } = envelope;
  const hostname = (() => { try { return new URL(request.url).hostname; } catch { return request.url; } })();

  const lines: string[] = [`# Performance: ${hostname}`, '', `> URL: ${request.url}`, ''];

  // Request block
  lines.push('## Request', '');
  lines.push('| Field | Value |');
  lines.push('|-------|-------|');
  lines.push(`| URL | ${request.url} |`);
  lines.push(`| Strategy | ${request.strategy} |`);
  lines.push(`| Elapsed | ${request.elapsed_ms} ms |`);
  lines.push(`| CrUX API | ${request.crux_api_available ? 'available' : 'unavailable'} |`);
  if (request.crux_scope) lines.push(`| CrUX scope | ${request.crux_scope} |`);
  if (request.crux_collection_period?.firstDate && request.crux_collection_period?.lastDate) {
    lines.push(`| CrUX period | ${request.crux_collection_period.firstDate} → ${request.crux_collection_period.lastDate} |`);
  }
  lines.push('');

  if (request.strategy === 'both' && performance && typeof performance === 'object' && ('mobile' in performance || 'desktop' in performance)) {
    const both = performance as { mobile?: PerformanceReport; desktop?: PerformanceReport };
    if (both.mobile) lines.push(...buildPerformanceSection(both.mobile));
    if (both.desktop) lines.push(...buildPerformanceSection(both.desktop));
  } else {
    lines.push(...buildPerformanceSection(performance as PerformanceReport));
  }

  return lines.join('\n');
}
