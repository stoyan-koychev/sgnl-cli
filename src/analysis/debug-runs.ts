import * as fs from 'fs';
import * as path from 'path';

export interface DebugRunData {
  url: string;
  statusCode: number;
  ttfb_ms?: number;
  compression?: string;
  cdnDetected?: string;
  headers: Record<string, string>;
  html: string;
  rawSplit?: { markdown?: string; skeleton?: string };
  rawXray?: Record<string, any>;
  rawTechSeo?: Record<string, any>;
  rawOnpage?: Record<string, any>;
}

export async function saveDebugRun(data: DebugRunData): Promise<void> {
  try {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const timestamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}`;
    const hostname = new URL(data.url).hostname.replace(/\./g, '_');
    const runDir = path.join(process.cwd(), 'runs', `${timestamp}-${hostname}`);

    fs.mkdirSync(runDir, { recursive: true });

    fs.writeFileSync(path.join(runDir, 'content.md'), buildContentMd(data));
    fs.writeFileSync(path.join(runDir, 'xray.md'), buildXrayMd(data));
    fs.writeFileSync(path.join(runDir, 'metadata.md'), buildMetadataMd(data));
    fs.writeFileSync(path.join(runDir, 'assets.md'), buildAssetsMd(data));
    fs.writeFileSync(path.join(runDir, 'onpage.md'), buildOnpageMd(data));
    fs.writeFileSync(path.join(runDir, 'technical_seo.md'), buildTechSeoMd(data));
  } catch {
    // Never crash the CLI for debug file failures
  }
}

// ---------------------------------------------------------------------------
// content.md — clean markdown with frontmatter
// ---------------------------------------------------------------------------

function buildContentMd(data: DebugRunData): string {
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

function buildXrayMd(data: DebugRunData): string {
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

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// metadata.md — HTTP response + meta tags
// ---------------------------------------------------------------------------

function buildMetadataMd(data: DebugRunData): string {
  const t = data.rawTechSeo;
  const lines: string[] = [`# Metadata: ${new URL(data.url).hostname}`, ''];

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

function buildOnpageMd(data: DebugRunData): string {
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
  lines.push('');

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
  lines.push('');


  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// technical_seo.md — raw output from technical_seo.py
// ---------------------------------------------------------------------------

function buildTechSeoMd(data: DebugRunData): string {
  const t = data.rawTechSeo;
  if (!t) return `# Technical SEO: ${new URL(data.url).hostname}\n\n_No technical SEO data available._\n`;

  const lines: string[] = [`# Technical SEO: ${new URL(data.url).hostname}`, ''];

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
  lines.push('');

  // Schema
  lines.push('## JSON-LD Schema', '');
  lines.push(`Blocks found: **${t.schema?.blocks_found ?? 0}**`, '');
  if (t.schema?.types?.length) {
    lines.push('| Type |');
    lines.push('|------|');
    for (const type of t.schema.types) {
      lines.push(`| ${type} |`);
    }
    lines.push('');
  }
  if (t.schema?.errors?.length) {
    lines.push('**Errors:**', '');
    lines.push('| Error |');
    lines.push('|-------|');
    for (const err of t.schema.errors) {
      lines.push(`| ${err} |`);
    }
    lines.push('');
  }

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

  return lines.join('\n');
}

function buildAssetsMd(data: DebugRunData): string {
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
