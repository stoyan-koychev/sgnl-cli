/**
 * Unified report.md generator.
 *
 * Takes a final AnalysisReport (report.json) and produces a single
 * human-scannable + LLM-parseable Markdown file.
 */

import { AnalysisReport } from './merger';

// ─────────────────────────────────────────────────────────────────────────────
// Layer 1 — Formatting utilities
// ─────────────────────────────────────────────────────────────────────────────

const EM = '\u2014'; // —

export function dash(v: unknown): string {
  if (v === null || v === undefined || v === '') return EM;
  return String(v);
}

export function fmtInt(v: number | undefined | null): string {
  if (v === null || v === undefined) return EM;
  return v.toLocaleString('en-US');
}

export function fmtMs(v: number | undefined | null): string {
  if (v === null || v === undefined) return EM;
  return `${fmtInt(Math.round(v))} ms`;
}

export function fmtS(v: number | undefined | null): string {
  if (v === null || v === undefined) return EM;
  return `${Number(v).toFixed(1)} s`;
}

export function fmtKB(bytes: number | undefined | null): string {
  if (bytes === null || bytes === undefined) return EM;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export function fmtPct(v: number | undefined | null): string {
  if (v === null || v === undefined) return EM;
  return `${Math.round(v * 100)}%`;
}

export function fmtFloat(v: number | undefined | null, decimals = 1): string {
  if (v === null || v === undefined) return EM;
  return Number(v).toFixed(decimals);
}

export function icon(ok: boolean | undefined | null): string {
  if (ok === null || ok === undefined) return EM;
  return ok ? '\u2713' : '\u2717'; // ✓ / ✗
}

export function boolYN(v: boolean | undefined | null): string {
  if (v === null || v === undefined) return EM;
  return v ? 'yes' : 'no';
}

export function escCell(s: string): string {
  return s.replace(/\|/g, '\\|');
}

export function statusToIcon(s: string | undefined): string {
  if (s === 'pass') return '\u2713';
  if (s === 'warn') return '\u26A0';
  if (s === 'fail') return '\u2717';
  return EM;
}

function truncate(s: string | undefined, max: number): string {
  if (!s) return EM;
  if (s.length <= max) return escCell(s);
  return escCell(s.slice(0, max)) + '\u2026';
}

// ── CWV rating thresholds ──

interface CWVThreshold { good: number; poor: number; unit: string; decimals?: number }

const CWV_THRESHOLDS: Record<string, CWVThreshold> = {
  lcp:  { good: 2500, poor: 4000, unit: 'ms' },
  fcp:  { good: 1800, poor: 3000, unit: 'ms' },
  cls:  { good: 0.10, poor: 0.25, unit: '', decimals: 2 },
  inp:  { good: 200,  poor: 500,  unit: 'ms' },
  fid:  { good: 100,  poor: 300,  unit: 'ms' },
};

export function cwvRating(metric: string, value: number | undefined | null): { icon: string; label: string; target: string } {
  const t = CWV_THRESHOLDS[metric];
  if (!t || value === null || value === undefined) return { icon: EM, label: EM, target: EM };
  const target = t.unit ? `< ${fmtInt(t.good)} ${t.unit}` : `< ${t.good}`;
  if (value <= t.good) return { icon: '\u2713', label: 'good', target };
  if (value <= t.poor) return { icon: '\u26A0', label: 'needs improvement', target };
  return { icon: '\u2717', label: 'poor', target };
}

function cwvValue(metric: string, value: number | undefined | null): string {
  if (value === null || value === undefined) return EM;
  const t = CWV_THRESHOLDS[metric];
  if (!t) return String(value);
  if (t.decimals) return fmtFloat(value, t.decimals);
  return `${fmtInt(Math.round(value))} ${t.unit}`;
}

// ── Table builder ──

export function table(headers: string[], rows: string[][]): string {
  if (rows.length === 0) return '';
  const sep = headers.map(() => '------');
  const lines = [
    `| ${headers.join(' | ')} |`,
    `| ${sep.join(' | ')} |`,
    ...rows.map(r => `| ${r.join(' | ')} |`),
  ];
  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Layer 2 — Section builders
// ─────────────────────────────────────────────────────────────────────────────

function hostname(url: string): string {
  try { return new URL(url).hostname; } catch { return url; }
}

// ── Section 1: Frontmatter ──

function buildFrontmatter(r: AnalysisReport): string {
  const title = (r.seo?.technical?.title ?? '').replace(/"/g, '\\"');
  const desc = (r.seo?.technical?.description ?? '').replace(/"/g, '\\"');
  const cdn = r.performance?.cdn?.toLowerCase() ?? 'none';
  const ic = r.issues?.critical?.length ?? 0;
  const iw = r.issues?.warning?.length ?? 0;
  const ii = r.issues?.info?.length ?? 0;

  return [
    '---',
    `url: ${r.url}`,
    `title: "${title}"`,
    `description: "${desc}"`,
    `canonical: ${r.seo?.technical?.canonical ?? EM}`,
    `http_status: ${r.http_status}`,
    `https: ${r.https}`,
    `crawlable: ${r.crawlable}`,
    `indexable: ${r.seo?.technical?.indexable ?? false}`,
    `cdn: ${cdn}`,
    `timestamp: ${r.timestamp}`,
    `issues_summary: ${ic} critical \u00B7 ${iw} warnings \u00B7 ${ii} info`,
    '---',
  ].join('\n');
}

// ── Section 2: Title ──

function buildTitle(r: AnalysisReport): string {
  return `# SGNL Report \u00B7 ${hostname(r.url)}`;
}

// ── Section 3: Performance ──

function buildPerformanceSection(r: AnalysisReport): string {
  const parts: string[] = ['## Performance'];
  const cwv = r.performance?.core_web_vitals;
  const speed = r.performance?.speed_metrics;
  const res = r.performance?.resource_summary;
  const perf = r.performance;

  // CWV verdict headline
  const verdict = cwv?.cwv_passing;
  const verdictLabel = verdict === true
    ? 'PASSING'
    : verdict === false
      ? 'FAILING'
      : 'Insufficient data';
  parts.push('', `**Core Web Vitals: ${verdictLabel}**`);

  // Lighthouse category scores (if available)
  if (perf?.category_scores) {
    const c = perf.category_scores;
    parts.push('', '### Lighthouse Scores', '');
    parts.push(table(['Category', 'Score'], [
      ['Performance', `${c.performance} / 100`],
      ['Accessibility', `${c.accessibility} / 100`],
      ['Best Practices', `${c.best_practices} / 100`],
      ['SEO', `${c.seo} / 100`],
    ]));
  }

  // 3a — Core Web Vitals
  parts.push('', '### Core Web Vitals', '');
  if (perf?.field_data_scope === 'origin') {
    parts.push('_Field data is origin-level (URL-level not available)._', '');
  }
  if (perf?.field_data_collection_period?.firstDate && perf.field_data_collection_period.lastDate) {
    parts.push(`_Collection period: ${perf.field_data_collection_period.firstDate} → ${perf.field_data_collection_period.lastDate}_`, '');
  }
  const cwvMetrics: Array<{ key: string; label: string; value: number | undefined }> = [
    { key: 'lcp', label: 'LCP', value: cwv?.lcp_ms },
    { key: 'fcp', label: 'FCP', value: cwv?.fcp_ms },
    { key: 'cls', label: 'CLS', value: cwv?.cls },
    { key: 'inp', label: 'INP', value: cwv?.inp_ms },
    { key: 'fid', label: 'FID', value: cwv?.fid_ms },
  ];
  const cwvRows = cwvMetrics.map(m => {
    const rating = cwvRating(m.key, m.value);
    return [m.label, cwvValue(m.key, m.value), `${rating.icon} ${rating.label}`, rating.target];
  });
  parts.push(table(['Metric', 'Value', 'Rating', 'Target'], cwvRows));

  // 3b — Speed
  parts.push('', '### Speed', '');
  const speedRows: string[][] = [
    ['HTTP Status', r.http_status != null ? String(r.http_status) : EM],
    ['TTFB', fmtMs(speed?.ttfb_ms)],
    ['Speed Index', fmtS(speed?.speed_index_s)],
    ['TTI', fmtS(speed?.tti_s)],
    ['TBT', fmtMs(speed?.tbt_ms)],
    ['Lighthouse Score', speed?.performance_score != null ? `${speed.performance_score} / 100` : EM],
    ['Compression', dash(r.performance?.compression)],
    ['CDN', dash(r.performance?.cdn)],
  ];
  parts.push(table(['Metric', 'Value'], speedRows));

  // 3c — Resources
  if (res) {
    parts.push('', '### Resources', '');
    const rq = (n?: number) => (n != null ? ` (${n})` : '');
    const resRows: string[][] = [
      ['Total', `${fmtKB(res.total_bytes)}${rq(res.total_requests)}`],
      ['Scripts', `${fmtKB(res.script_bytes)}${rq(res.script_requests)}`],
      ['Images', `${fmtKB(res.image_bytes)}${rq(res.image_requests)}`],
      ['Fonts', `${fmtKB(res.font_bytes)}${rq(res.font_requests)}`],
      ['Stylesheets', `${fmtKB(res.stylesheet_bytes)}${rq(res.stylesheet_requests)}`],
      ['Other', `${fmtKB(res.other_bytes)}${rq(res.other_requests)}`],
    ];
    parts.push(table(['Type', 'Size (Requests)'], resRows));

    // Third-party scripts
    const tp = r.third_party_scripts;
    if (tp && tp.count > 0) {
      parts.push('', '### Third-Party Scripts', '');
      const tpRows: string[][] = [
        ['Count', String(tp.count)],
        ['Domains', tp.domains.length > 0 ? tp.domains.join(', ') : 'none'],
        ['Tag manager', boolYN(tp.tag_manager_detected)],
      ];
      const cats = Object.entries(tp.categories ?? {});
      if (cats.length > 0) {
        for (const [cat, domains] of cats) {
          tpRows.push([escCell(cat), (domains as string[]).join(', ')]);
        }
      }
      parts.push(table(['Metric', 'Value'], tpRows));
    }
  }

  // LCP Element
  if (perf?.lcp_element) {
    const el = perf.lcp_element;
    parts.push('', '### LCP Element', '');
    const rows: string[][] = [];
    if (el.selector) rows.push(['Selector', escCell(el.selector)]);
    if (el.nodeLabel) rows.push(['Node', escCell(el.nodeLabel)]);
    if (el.snippet) rows.push(['Snippet', escCell(el.snippet)]);
    if (rows.length > 0) parts.push(table(['Field', 'Value'], rows));
  }

  // CLS Elements
  if (perf?.cls_elements && perf.cls_elements.length > 0) {
    parts.push('', '### CLS Elements (top 5)', '');
    const rows = perf.cls_elements.map(el => [
      escCell(el.selector ?? '(unknown)'),
      el.score != null ? String(el.score) : EM,
    ]);
    parts.push(table(['Selector', 'Score'], rows));
  }

  // Render-Blocking Resources
  if (perf?.render_blocking && perf.render_blocking.length > 0) {
    parts.push('', '### Render-Blocking Resources (top 5)', '');
    const rows = perf.render_blocking.map(r => [escCell(r.url), r.wastedMs != null ? `${r.wastedMs} ms` : EM]);
    parts.push(table(['URL', 'Wasted'], rows));
  }

  // Third-Party Summary (Lighthouse audit)
  if (perf?.third_party && perf.third_party.length > 0) {
    parts.push('', '### Third-Party Summary (top 5)', '');
    const rows = perf.third_party.map(tp => [
      escCell(tp.entity),
      tp.blockingTime != null ? `${tp.blockingTime} ms` : EM,
      tp.transferSize != null ? fmtKB(tp.transferSize) : EM,
    ]);
    parts.push(table(['Entity', 'Blocking Time', 'Transfer Size'], rows));
  }

  // Bootup Time
  if (perf?.bootup && perf.bootup.items.length > 0) {
    const total = perf.bootup.total_ms != null ? ` (total ${perf.bootup.total_ms} ms)` : '';
    parts.push('', `### Bootup Time${total}`, '');
    const rows = perf.bootup.items.map(b => [
      escCell(b.url),
      b.scripting != null ? `${b.scripting} ms` : EM,
      b.scriptParseCompile != null ? `${b.scriptParseCompile} ms` : EM,
    ]);
    parts.push(table(['Script', 'Scripting', 'Parse/Compile'], rows));
  }

  // Diagnostics
  const diag = perf?.diagnostics;
  if (diag && Object.values(diag).some(v => v != null)) {
    parts.push('', '### Diagnostics', '');
    const rows: string[][] = [];
    if (diag.dom_size != null) rows.push(['DOM size', `${diag.dom_size} elements`]);
    if (diag.network_rtt != null) rows.push(['Network RTT', `${diag.network_rtt} ms`]);
    if (diag.network_server_latency != null) rows.push(['Server latency', `${diag.network_server_latency} ms`]);
    if (diag.total_tasks != null) rows.push(['Main-thread tasks', String(diag.total_tasks)]);
    if (diag.main_document_transfer_size != null) {
      rows.push(['Main document transfer', fmtKB(diag.main_document_transfer_size)]);
    }
    if (perf?.server_response_time_ms != null) rows.push(['Server response', `${perf.server_response_time_ms} ms`]);
    if (perf?.request_count != null) rows.push(['Network requests', String(perf.request_count)]);
    parts.push(table(['Metric', 'Value'], rows));
  }

  return parts.join('\n');
}

// ── Section 4: SEO Technical ──

function buildSeoTechnicalSection(r: AnalysisReport): string {
  const parts: string[] = ['## SEO \u00B7 Technical'];
  const td = r.analysis_detail?.technical_seo;

  // 4a — Meta
  parts.push('', '### Meta', '');
  const meta = td?.meta;
  if (meta) {
    const metaRows: string[][] = [
      ['Title', truncate(meta.title?.content, 50), dash(meta.title?.length), `${statusToIcon(meta.title?.status)} ${dash(meta.title?.status)}`],
      ['Description', truncate(meta.description?.content, 50), dash(meta.description?.length), `${statusToIcon(meta.description?.status)} ${dash(meta.description?.status)}`],
      ['Robots', escCell(dash(meta.robots?.content)), EM, `${statusToIcon(meta.robots?.status)} ${dash(meta.robots?.status)}`],
      ['Canonical', escCell(dash(td?.canonical?.href)) + (td?.canonical?.self_referencing ? ' (self-referencing)' : ''), EM, `${statusToIcon(td?.canonical?.status)} ${dash(td?.canonical?.status)}`],
    ];
    parts.push(table(['Tag', 'Content', 'Length', 'Status'], metaRows));
    parts.push('', `| Charset | ${icon(meta.charset?.present)} | Viewport | ${icon(meta.viewport?.present)} |`);
  } else {
    // Fallback to top-level data
    const tech = r.seo?.technical;
    const metaRows: string[][] = [
      ['Title', truncate(tech?.title, 50), tech?.title ? String(tech.title.length) : EM, tech?.title ? '\u2713 pass' : '\u2717 fail'],
      ['Description', truncate(tech?.description, 50), tech?.description ? String(tech.description.length) : EM, tech?.description ? '\u2713 pass' : '\u2717 fail'],
      ['Canonical', escCell(dash(tech?.canonical)), EM, tech?.canonical ? '\u2713 pass' : '\u2717 fail'],
    ];
    parts.push(table(['Tag', 'Content', 'Length', 'Status'], metaRows));
  }

  // 4b — Open Graph & Social
  const og = td?.open_graph;
  if (og) {
    parts.push('', '### Open Graph & Social', '');
    const pubDate = og.published_time ? String(og.published_time).slice(0, 10) : EM;
    const modDate = og.modified_time ? String(og.modified_time).slice(0, 10) : EM;
    const ogRows: string[][] = [
      ['og:title', icon(og.title)],
      ['og:description', icon(og.description)],
      ['og:image', icon(og.image)],
      ['og:url', icon(og.url)],
      ['og:published_time', pubDate],
      ['og:modified_time', modDate],
      ['Twitter card', `${dash(og.twitter_card?.card_type)} ${icon(og.twitter_card?.present)}`],
    ];
    parts.push(table(['Property', 'Status'], ogRows));
  }

  // 4c — Schema.org (JSON-LD)
  const sv = r.schema_validation;
  if (sv) {
    parts.push('', '### Schema.org (JSON-LD)', '');
    if (sv.blocks_found === 0) {
      parts.push('No JSON-LD blocks found.');
    } else {
      const schemaRows = (sv.types ?? []).map(t => {
        const eligible = (sv.rich_results_eligible ?? []).includes(t);
        const hasHighIssue = (sv.recommendations ?? []).some(rec => rec.type === t && rec.priority === 'high');
        let status = 'no';
        if (eligible && !hasHighIssue) status = 'yes';
        else if (eligible && hasHighIssue) status = 'no (eligible type, has issues)';
        return [t, status];
      });
      parts.push(table(['Type', 'Rich Results Eligible'], schemaRows));

      if (sv.recommendations && sv.recommendations.length > 0) {
        parts.push('', 'Schema issues:', '');
        const recRows = sv.recommendations.map(rec => [
          rec.priority ?? '',
          rec.type ?? '',
          escCell(rec.message.replace(/^'|'$/g, '')),
        ]);
        parts.push(table(['Priority', 'Type', 'Issue'], recRows));
      }
    }
  }

  // 4d — Security Headers
  const sec = td?.security_headers;
  if (sec) {
    const total = (sec.count ?? 0) + (sec.missing?.length ?? 0);
    parts.push('', `### Security Headers (${sec.count ?? 0}/${total} \u00B7 ${dash(sec.grade)})`, '');
    const secRows: string[][] = [];
    for (const h of sec.present ?? []) {
      const detail = sec.details?.[h];
      secRows.push([escCell(h), `\u2713 ${detail ? escCell(String(detail)) : 'present'}`]);
    }
    for (const h of sec.missing ?? []) {
      secRows.push([escCell(h), '\u2717 missing']);
    }
    parts.push(table(['Header', 'Status'], secRows));
  }

  // 4e — Crawlability
  const robots = r.robots;
  const hreflang = td?.hreflang;
  const pagination = td?.pagination_amp;
  parts.push('', '### Crawlability', '');
  const crawlRows: string[][] = [
    ['Robots.txt', robots?.fetched ? '\u2713 fetched' : '\u2717 not found'],
    ['Crawl delay', robots?.crawl_delay != null ? String(robots.crawl_delay) : 'none'],
    ['Wildcard disallow', robots ? boolYN(robots.has_wildcard_disallow) : EM],
    ['Sitemap', robots?.sitemaps?.length ? robots.sitemaps[0] : 'none'],
    ['Hreflang', hreflang?.count ? `${hreflang.count} languages (${(hreflang.languages ?? []).join(', ')})` : 'none'],
    ['Pagination', pagination?.is_paginated ? 'yes' : 'none'],
    ['AMP', pagination?.is_amp ? 'yes' : 'no'],
  ];
  parts.push(table(['Check', 'Value'], crawlRows));

  // Disallow rules
  if (robots?.disallow_rules && robots.disallow_rules.length > 0) {
    parts.push('', `Disallow rules: ${robots.disallow_rules.map(r => `\`${r}\``).join(', ')}`);
  }

  // Allow rules
  if (robots?.allow_rules && robots.allow_rules.length > 0) {
    parts.push('', `Allow rules: ${robots.allow_rules.map(r => `\`${r}\``).join(', ')}`);
  }

  // Multi-agent verdict
  if (robots?.per_agent_verdict && Object.keys(robots.per_agent_verdict).length > 0) {
    parts.push('', 'Multi-agent verdict:', '');
    const verdictRows = Object.entries(robots.per_agent_verdict).map(([agent, v]) => [
      agent,
      v === 'disallowed' ? '\u26A0 disallowed' : '\u2713 allowed',
    ]);
    parts.push(table(['User-agent', 'Verdict'], verdictRows));
  }

  // AI bot summary
  if (robots?.ai_bot_summary) {
    const ai = robots.ai_bot_summary;
    parts.push('', `AI bots: ${ai.blocked_count}/${ai.total_checked} explicitly blocked${
      ai.blocked_agents.length > 0 ? ` (${ai.blocked_agents.join(', ')})` : ''
    }`);
  }

  // Validation warnings
  const validationLines: string[] = [];
  if (robots?.size_exceeds_google_limit) {
    validationLines.push(`\u26A0 robots.txt exceeds Google's 500 KiB limit (${robots.content_length} bytes)`);
  }
  if (robots?.content_type && robots.content_type_is_text_plain === false) {
    validationLines.push(`\u26A0 Content-Type is "${robots.content_type}" (expected text/plain)`);
  }
  if (robots?.cross_origin_redirect) {
    validationLines.push('\u26A0 robots.txt redirected cross-origin');
  }
  if (robots?.syntax_warnings && robots.syntax_warnings.length > 0) {
    for (const w of robots.syntax_warnings.slice(0, 5)) validationLines.push(`\u2022 ${w}`);
  }
  if (validationLines.length > 0) {
    parts.push('', 'Robots validation:', '');
    for (const l of validationLines) parts.push(l);
  }

  // Robots issues
  if (robots?.issues && robots.issues.length > 0) {
    parts.push('', 'Robots issues:', '');
    parts.push(table(['#', 'Issue'], robots.issues.map((issue, i) => [String(i + 1), escCell(issue)])));
  }

  // 4f — Caching
  const caching = r.caching;
  if (caching) {
    parts.push('', '### Caching', '');
    const maxAge = caching.max_age_seconds;
    const maxAgeStr = maxAge != null ? `${maxAge} s${maxAge < 60 ? ' \u26A0' : ''}` : EM;
    const cacheRows: string[][] = [
      ['Cache-Control', dash(caching.cache_control)],
      ['Cacheable', boolYN(caching.is_cacheable)],
      ['ETag', boolYN(caching.has_etag)],
      ['Last-Modified', boolYN(caching.has_last_modified)],
      ['Max-Age', maxAgeStr],
    ];
    parts.push(table(['Field', 'Value'], cacheRows));

    if (caching.issues && caching.issues.length > 0) {
      parts.push('', 'Caching issues:', '');
      parts.push(table(['#', 'Issue'], caching.issues.map((issue, i) => [String(i + 1), escCell(issue)])));
    }
  }

  // 4g — Redirect Analysis
  const redir = r.redirect_analysis;
  if (redir) {
    parts.push('', '### Redirect Analysis', '');
    const redirRows: string[][] = [
      ['Chain length', String(redir.chain_length)],
      ['HTTP \u2192 HTTPS', boolYN(redir.has_http_to_https)],
      ['WWW redirect', boolYN(redir.has_www_redirect)],
    ];
    parts.push(table(['Field', 'Value'], redirRows));
    if (redir.chain.length > 0) {
      parts.push('', 'Chain:', '');
      // Annotated hop rows with labels
      const hopRows: string[][] = [];
      let prev = r.url;
      for (let i = 0; i < redir.chain.length; i++) {
        const next = redir.chain[i];
        const labels: string[] = [];
        try {
          const f = new URL(prev);
          const tU = new URL(next);
          if (f.protocol === 'http:' && tU.protocol === 'https:') labels.push('HTTP\u2192HTTPS');
          const fw = f.hostname.startsWith('www.');
          const tw = tU.hostname.startsWith('www.');
          if (fw && !tw) labels.push('www \u2192 apex');
          if (!fw && tw) labels.push('apex \u2192 www');
          if (f.pathname !== tU.pathname && f.pathname.replace(/\/+$/, '') === tU.pathname.replace(/\/+$/, '')) {
            labels.push('trailing-slash');
          }
        } catch { /* ignore */ }
        hopRows.push([String(i + 1), escCell(prev), escCell(next), labels.join(', ') || EM]);
        prev = next;
      }
      parts.push(table(['#', 'From', 'To', 'Labels'], hopRows));
    }
    if (redir.issues.length > 0) {
      parts.push('', table(['#', 'Issue'], redir.issues.map((issue, i) => [String(i + 1), escCell(issue)])));
    }
  }

  // 4h — URL Structure
  const urlStruct = td?.url_structure;
  if (urlStruct) {
    parts.push('', '### URL Structure', '');
    let cleanUrl = '\u2713';
    const problems: string[] = [];
    if (urlStruct.has_uppercase) problems.push('has uppercase');
    if (urlStruct.has_special_chars) problems.push('has special chars');
    if (urlStruct.has_double_slashes) problems.push('has double slashes');
    if (problems.length > 0) cleanUrl = `\u26A0 (${problems.join(', ')})`;
    else cleanUrl = '\u2713 (no uppercase, no special chars, no double slashes)';

    const urlRows: string[][] = [
      ['Length', `${dash(urlStruct.length)} chars`],
      ['Path', dash(urlStruct.path)],
      ['Clean URL', cleanUrl],
    ];
    parts.push(table(['Field', 'Value'], urlRows));
  }

  return parts.join('\n');
}

// ── Section 5: SEO On-Page ──

function buildSeoOnPageSection(r: AnalysisReport): string {
  const parts: string[] = ['## SEO \u00B7 On-Page'];
  const op = r.analysis_detail?.onpage;
  const xray = r.analysis_detail?.xray;

  // 5a — Content Stats
  parts.push('', '### Content Stats', '');
  if (op) {
    const h = op.headings;
    const contentRows: string[][] = [
      ['Word count', fmtInt(op.content?.word_count)],
      ['Paragraphs', dash(op.content?.paragraph_count)],
      ['Avg paragraph length', op.content?.avg_paragraph_length != null ? `${fmtFloat(op.content.avg_paragraph_length)} words` : EM],
      ['H1', `${dash(h?.h1_count)}${h?.h1_content ? ` \u2014 "${escCell(String(h.h1_content))}"` : ''}`],
      ['H2', dash(h?.h2_count)],
      ['H3', dash(h?.h3_count)],
      ['H4', dash(h?.h4_count)],
      ['H5', dash(h?.h5_count)],
      ['H6', dash(h?.h6_count)],
      ['Total headings', dash(h?.total_headings)],
      ['Empty headings', dash(h?.empty_headings)],
      ['Heading hierarchy', h?.hierarchy_valid ? '\u2713 valid' : '\u2717 invalid'],
    ];
    parts.push(table(['Metric', 'Value'], contentRows));

    // Heading violations
    const violations = h?.violations;
    if (Array.isArray(violations) && violations.length > 0) {
      parts.push('', 'Heading violations:', '');
      parts.push(table(['#', 'Violation'], violations.map((v: any, i: number) => [String(i + 1), escCell(String(v))])));
    }
  } else {
    const sc = r.seo?.content;
    const contentRows: string[][] = [
      ['Word count', fmtInt(sc?.word_count)],
      ['H1 count', dash(sc?.h1_count)],
      ['Headings valid', sc?.headings_valid ? '\u2713 valid' : '\u2717 invalid'],
      ['Images total', dash(sc?.images_total)],
      ['Images missing alt', dash(sc?.images_alt_missing)],
    ];
    parts.push(table(['Metric', 'Value'], contentRows));
  }

  // 5b — Links
  const opLinks = op?.links;
  const seoLinks = r.seo?.links;
  if (opLinks || seoLinks) {
    parts.push('', '### Links', '');
    const internal = opLinks?.internal_total ?? seoLinks?.internal_total ?? 0;
    const generic = opLinks?.internal_generic_anchor ?? seoLinks?.generic_anchor_text ?? 0;
    const genericPct = internal > 0 ? `${Math.round((generic / internal) * 100)}%` : '0%';
    const linkRows: string[][] = [
      ['Internal', dash(internal)],
      ['External', dash(opLinks?.external_total ?? seoLinks?.external_total)],
      ['Broken', dash(opLinks?.external_broken)],
      ['Generic anchors', `${generic} (${genericPct})`],
    ];
    if (xray?.links?.target_blank_missing_rel != null) {
      linkRows.push(['target=_blank missing rel', dash(xray.links.target_blank_missing_rel)]);
    }
    parts.push(table(['Metric', 'Value'], linkRows));
  }

  // 5c — Images
  const imgs = op?.images;
  if (imgs) {
    parts.push('', '### Images', '');
    const total = imgs.total ?? 0;
    const modernPct = total > 0 ? `${Math.round(((imgs.modern_format ?? 0) / total) * 100)}%` : '0%';
    const imgRows: string[][] = [
      ['Total', dash(imgs.total)],
      ['Missing alt', dash(imgs.missing_alt)],
      ['Empty alt (decorative)', dash(imgs.empty_alt_decorative)],
      ['Alt too short (< 3 chars)', dash(imgs.too_short)],
      ['Alt too long (> 125 chars)', dash(imgs.too_long)],
      ['Poor quality alt', dash(imgs.poor_quality_alt)],
      ['Lazy loaded', dash(imgs.lazy_loading)],
      ['Modern format (WebP/AVIF)', modernPct],
      ['Missing dimensions', dash(xray?.images?.missing_dimensions)],
      ['With explicit dimensions', dash(imgs.explicit_dimensions)],
      ['Density', imgs.density_per_1000_words != null ? `${fmtFloat(imgs.density_per_1000_words)} / 1,000 words` : EM],
    ];
    parts.push(table(['Metric', 'Value'], imgRows));
  }


  return parts.join('\n');
}

// ── Section 6: Content Analysis ──

function buildContentAnalysisSection(r: AnalysisReport): string {
  const ca = r.content_analysis;
  const cad = r.analysis_detail?.content_analysis;
  if (!ca && !cad) return '';

  const parts: string[] = ['## Content Analysis'];

  // 6a — Signals
  parts.push('', '### Signals', '');
  const signalRows: string[][] = [];

  if (ca) {
    // Language
    if (cad?.detected_language) {
      signalRows.push(['Language', dash(cad.detected_language), EM]);
    }

    // Depth
    const depthDetail = cad ? `${fmtInt(cad.content_depth?.word_count)} words, ${dash(cad.content_depth?.paragraph_count)} content paragraphs` : EM;
    signalRows.push(['Depth', dash(ca.depth_label), depthDetail]);

    // E-E-A-T
    let eeatDetail = EM;
    if (cad?.eeat_signals) {
      const es = cad.eeat_signals;
      const bits = [`${dash(es.first_person_count)} first-person mentions`, `${dash(es.statistics_count)} statistics`];
      if (cad.author_bio?.author_bio_present) bits.push('author bio present');
      eeatDetail = bits.join(', ');
    }
    signalRows.push(['E-E-A-T', dash(ca.eeat_label), eeatDetail]);

    // Freshness
    const freshDetail = cad?.content_freshness?.most_recent_year
      ? `Most recent year ref: ${cad.content_freshness.most_recent_year}`
      : EM;
    signalRows.push(['Freshness', dash(ca.freshness_status), freshDetail]);

    // Thin risk
    let thinDetail = EM;
    if (cad?.thin_content) {
      const tc = cad.thin_content;
      const bits = [`${dash(tc.duplicate_sentences_found)} duplicate sentence(s)`];
      if (tc.boilerplate_present && tc.boilerplate_detected?.length) {
        bits.push(`boilerplate (${tc.boilerplate_detected[0]}) detected`);
      }
      thinDetail = bits.join(', ');
    }
    signalRows.push(['Thin risk', dash(ca.thin_content_risk), thinDetail]);

    // Anchor quality
    const anchorDetail = cad?.anchor_text_quality?.descriptive_ratio != null
      ? `${Math.round(cad.anchor_text_quality.descriptive_ratio * 100)}% descriptive ratio`
      : EM;
    signalRows.push(['Anchor quality', dash(ca.anchor_quality_score), anchorDetail]);

    // Snippet eligible
    let snippetDetail = EM;
    if (cad?.featured_snippet) {
      const fs = cad.featured_snippet;
      const types: string[] = [];
      if (fs.definition_paragraph_present) types.push('definition block');
      if (fs.list_snippet_eligible) types.push('list');
      if (fs.qa_pattern_count > 0) types.push(`Q&A (${fs.qa_pattern_count} pair(s))`);
      if (fs.table_snippet_eligible) types.push('table');
      snippetDetail = types.length > 0 ? types.join(', ') : 'none qualifying';
    }
    signalRows.push(['Snippet eligible', boolYN(ca.snippet_eligible), snippetDetail]);

    // CTA
    if (cad?.cta) {
      signalRows.push([
        'CTA present',
        boolYN(cad.cta.cta_present),
        cad.cta.cta_patterns_found?.length ? cad.cta.cta_patterns_found.join(', ') : EM,
      ]);
    }

    // TOC
    if (cad?.toc) {
      const tocDetail = cad.toc.toc_entry_count != null ? `${cad.toc.toc_entry_count} entries` : EM;
      signalRows.push(['TOC', boolYN(cad.toc.toc_present), tocDetail]);
    }

    // Link density
    if (cad?.link_density) {
      const ldDetail = cad.link_density.links_per_1000_words != null
        ? `${fmtFloat(cad.link_density.links_per_1000_words)} / 1,000 words`
        : EM;
      signalRows.push(['Link density', ldDetail, (cad.link_density.issues ?? []).join(', ') || EM]);
    }

    // Meta description (from content analysis)
    if (cad?.meta_description) {
      signalRows.push([
        'Meta description',
        `${dash(cad.meta_description.meta_description_length)} chars`,
        dash(cad.meta_description.meta_description_status),
      ]);
    }

    // Image alt coverage
    if (cad?.image_alt_text?.alt_coverage_ratio != null) {
      signalRows.push(['Alt coverage', `${Math.round(cad.image_alt_text.alt_coverage_ratio * 100)}%`, EM]);
    }
  }

  parts.push(table(['Signal', 'Value', 'Detail'], signalRows));

  // 6b — Readability
  if (cad?.readability) {
    const rd = cad.readability;
    parts.push('', '### Readability', '');
    const readRows: string[][] = [
      ['Reading level', dash(rd.reading_level)],
      ['Flesch Reading Ease', fmtFloat(rd.flesch_reading_ease)],
      ['Gunning Fog Index', fmtFloat(rd.gunning_fog_index)],
      ['Avg words/sentence', fmtFloat(rd.avg_words_per_sentence)],
      ['Long sentences (> 30 words)', dash(rd.long_sentences_count)],
    ];
    // Passive voice
    if (cad?.passive_voice) {
      const pv = cad.passive_voice;
      const pvPct = pv.passive_voice_ratio != null ? ` (${Math.round(pv.passive_voice_ratio * 100)}%)` : '';
      readRows.push(['Passive voice', `${dash(pv.passive_voice_count)}${pvPct}`]);
    }
    // Transition words
    if (cad?.transition_words) {
      const tw = cad.transition_words;
      const twPct = tw.transition_word_ratio != null ? ` (${Math.round(tw.transition_word_ratio * 100)}%)` : '';
      const twLabel = tw.transition_label ? ` \u2014 ${tw.transition_label}` : '';
      readRows.push(['Transition words', `${dash(tw.transition_word_count)}${twPct}${twLabel}`]);
    }
    parts.push(table(['Metric', 'Value'], readRows));
  }

  // 6c — Relevance
  if (cad?.content_relevance) {
    const cr = cad.content_relevance;
    parts.push('', '### Relevance', '');
    const relRows: string[][] = [
      ['Title in H1', boolYN(cr.title_in_h1)],
      ['Title in intro', boolYN(cr.title_in_intro)],
      ['Heading alignment', fmtFloat(cr.heading_alignment_score)],
      ['Keyword stuffing', cr.keyword_stuffing_detected ? 'detected' : 'none'],
    ];
    parts.push(table(['Check', 'Value'], relRows));
  }

  // 6d — Top Keywords
  if (cad?.top_keywords && cad.top_keywords.length > 0) {
    parts.push('', '### Top Keywords', '');
    const kwRows = cad.top_keywords.slice(0, 8).map((kw: any) => [escCell(kw.word), fmtInt(kw.count)]);
    parts.push(table(['Keyword', 'Count'], kwRows));
  }

  // 6e — Top Phrases
  if (cad?.top_phrases) {
    const bigrams = cad.top_phrases.bigrams ?? [];
    const trigrams = cad.top_phrases.trigrams ?? [];
    if (bigrams.length > 0 || trigrams.length > 0) {
      parts.push('', '### Top Phrases', '');
      if (bigrams.length > 0) {
        parts.push('', '**Bigrams**', '');
        const biRows = bigrams.slice(0, 8).map((p: any) => [escCell(p.phrase), fmtInt(p.count)]);
        parts.push(table(['Phrase', 'Count'], biRows));
      }
      if (trigrams.length > 0) {
        parts.push('', '**Trigrams**', '');
        const triRows = trigrams.slice(0, 8).map((p: any) => [escCell(p.phrase), fmtInt(p.count)]);
        parts.push(table(['Phrase', 'Count'], triRows));
      }
    }
  }

  return parts.join('\n');
}

// ── Section 7: DOM & Structure ──

function buildDomStructureSection(r: AnalysisReport): string {
  const xray = r.analysis_detail?.xray;
  const parts: string[] = ['## DOM & Structure'];

  // Main metrics table
  parts.push('');
  const domRows: string[][] = [
    ['Elements', xray?.dom ? fmtInt(xray.dom.total_elements) : fmtInt(r.structure?.dom_elements)],
    ['Unique tags', dash(xray?.dom?.unique_tags)],
    ['Max depth', dash(xray?.dom?.depth_max)],
    ['Avg depth', dash(xray?.dom?.depth_avg)],
    ['Div ratio', xray?.structure ? `${Math.round((xray.structure.div_ratio ?? 0) * 100)}%` : fmtPct(r.structure?.div_ratio)],
    ['Semantic score', `${r.structure?.semantic_score ?? dash(xray?.structure?.semantic_score)} / 7`],
    ['Empty elements', xray?.structure ? fmtInt(xray.structure.empty_elements) : EM],
    ['Duplicate IDs', dash(xray?.structure?.duplicate_ids)],
    ['Inline styles', dash(xray?.inline_styles?.count)],
    ['Inline event handlers', dash(xray?.structure?.inline_event_handlers)],
    ['Iframes', dash(xray?.structure?.iframes?.count)],
    ['HTML size', xray?.content_ratios?.html_size_kb != null ? `${fmtFloat(xray.content_ratios.html_size_kb)} KB` : EM],
    ['HTML-to-text ratio', xray?.content_ratios?.html_text_ratio != null ? `${(xray.content_ratios.html_text_ratio * 100).toFixed(1)}%` : EM],
    ['Favicon', xray?.head ? boolYN(xray.head.favicon_present) : EM],
  ];
  parts.push(table(['Metric', 'Value'], domRows));

  // 7a — Scripts
  if (xray?.scripts) {
    const sc = xray.scripts;
    parts.push('', '### Scripts', '');
    const scriptRows: string[][] = [
      ['Total', `${dash(sc.total)} (${dash(sc.inline)} inline, ${dash(sc.external)} external)`],
      ['Defer', dash(sc.defer_count)],
      ['Async', dash(sc.async_count)],
    ];
    parts.push(table(['Metric', 'Value'], scriptRows));
  }

  // 7b — Forms
  if (xray?.forms) {
    const f = xray.forms;
    parts.push('', '### Forms', '');
    const formRows: string[][] = [
      ['Forms', dash(f.form_count)],
      ['Inputs', dash(f.input_count)],
      ['Buttons', dash(f.button_count)],
      ['Inputs without labels', dash(f.inputs_without_labels)],
      ['Forms missing action', dash(f.forms_missing_action)],
    ];
    parts.push(table(['Metric', 'Value'], formRows));
  }

  // 7c — Resource Hints
  const hints = r.resource_hints;
  if (hints) {
    parts.push('', '### Resource Hints', '');
    // Group preloads by `as` field
    let preloadDetail = String(hints.preload_count ?? 0);
    if (hints.preload && hints.preload.length > 0) {
      const groups: Record<string, number> = {};
      for (const p of hints.preload) {
        const key = p.as || 'other';
        groups[key] = (groups[key] ?? 0) + 1;
      }
      const parts2 = Object.entries(groups).map(([k, v]) => `${v} ${k}`);
      preloadDetail = `${hints.preload_count} (${parts2.join(', ')})`;
    }
    const hintRows: string[][] = [
      ['Preload', preloadDetail],
      ['Prefetch', dash(hints.prefetch?.length ?? 0)],
      ['DNS Prefetch', dash(hints.dns_prefetch_count)],
      ['Preconnect', dash(hints.preconnect_count)],
    ];
    parts.push(table(['Type', 'Count'], hintRows));
  }

  return parts.join('\n');
}

// ── Section 8: Accessibility ──

function buildAccessibilitySection(r: AnalysisReport): string {
  const xray = r.analysis_detail?.xray;
  if (!xray?.accessibility) return '';

  const a = xray.accessibility;
  const s = xray.structure;
  const parts: string[] = ['## Accessibility', ''];

  const btnWarn = (a.buttons_links_no_text ?? 0) > 0 ? ' \u26A0' : '';
  const dupWarn = (s?.duplicate_ids ?? 0) > 0 ? ' \u26A0' : '';

  const accRows: string[][] = [
    ['Images missing alt', dash(a.images_missing_alt)],
    ['Inputs without label', dash(a.inputs_without_label)],
    ['Buttons/links no text', `${dash(a.buttons_links_no_text)}${btnWarn}`],
    ['ARIA attributes', dash(a.aria_attribute_count)],
    ['Lang attribute', a.html_missing_lang ? 'missing' : 'present'],
    ['Duplicate IDs', `${dash(s?.duplicate_ids)}${dupWarn}`],
  ];
  parts.push(table(['Check', 'Value'], accRows));

  return parts.join('\n');
}

// ── Section 9: Heading Tree ──

interface TreeNode { level: number; text: string; children?: TreeNode[] }

function renderTreeNode(node: TreeNode, prefix: string, isLast: boolean): string[] {
  const connector = isLast ? '\u2514\u2500\u2500' : '\u251C\u2500\u2500'; // └── or ├──
  const lines: string[] = [`${prefix}${connector} H${node.level}: ${node.text || '(empty)'}`];
  const childPrefix = prefix + (isLast ? '    ' : '\u2502   '); // │   or 4 spaces
  const children = node.children ?? [];
  children.forEach((child, i) => {
    lines.push(...renderTreeNode(child, childPrefix, i === children.length - 1));
  });
  return lines;
}

function renderTree(nodes: TreeNode[]): string {
  const lines: string[] = [];
  nodes.forEach((node) => {
    // Top-level nodes: show directly
    lines.push(`H${node.level}: ${node.text || '(empty)'}`);
    const children = node.children ?? [];
    children.forEach((child, j) => {
      lines.push(...renderTreeNode(child, '', j === children.length - 1));
    });
  });
  return lines.join('\n');
}

function buildHeadingTreeSection(r: AnalysisReport): string {
  // Prefer typed field on onpage_seo (populated by mapOnpageToOnPageSEO);
  // fall back to raw analysis_detail path for backward compatibility.
  const tree = ((r as any).onpage_seo?.heading_tree)
    ?? r.analysis_detail?.onpage?.headings?.tree;
  if (!Array.isArray(tree) || tree.length === 0) return '';

  return ['## Heading Tree', '', '```', renderTree(tree), '```'].join('\n');
}

// ── Section 10: Issues ──

function issueTable(items: string[]): string {
  if (items.length === 0) return '\nNone.';
  const rows = items.map((item, i) => [String(i + 1), escCell(item.replace(/: /g, ' \u2014 '))]);
  return '\n' + table(['#', 'Issue'], rows);
}

function dedup(items: string[]): { text: string; count: number }[] {
  const map = new Map<string, number>();
  for (const item of items) {
    map.set(item, (map.get(item) ?? 0) + 1);
  }
  return Array.from(map.entries()).map(([text, count]) => ({ text, count }));
}

function buildIssuesSection(r: AnalysisReport): string {
  const parts: string[] = ['## Issues'];
  const issues = r.issues ?? { critical: [], warning: [], info: [] };

  // 10a — Warnings
  parts.push('', `### Warnings (${issues.warning.length})`);
  parts.push(issueTable(issues.warning));

  // 10b — Info
  parts.push('', `### Info (${issues.info.length})`);
  parts.push(issueTable(issues.info));

  // 10c — Content Issues (deduplicated)
  const contentIssues = r.content_analysis?.issues ?? [];
  if (contentIssues.length > 0) {
    const deduped = dedup(contentIssues);
    parts.push('', `### Content Issues (${deduped.length})`);
    const rows = deduped.map((d, i) => {
      const prefix = d.count > 1 ? `${d.count}\u00D7 ` : '';
      return [String(i + 1), escCell(`${prefix}${d.text}`)];
    });
    parts.push('\n' + table(['#', 'Issue'], rows));
  }

  // 10d — Schema Recommendations
  const recs = r.schema_validation?.recommendations ?? [];
  parts.push('', `### Schema Recommendations (${recs.length})`);
  if (recs.length === 0) {
    parts.push('\nNone.');
  } else {
    const recRows = recs.map(rec => [
      rec.priority ?? '',
      rec.type ?? '',
      escCell(rec.message.replace(/^'|'$/g, '')),
    ]);
    parts.push('\n' + table(['Priority', 'Type', 'Recommendation'], recRows));
  }

  return parts.join('\n');
}

// ── Section: Google Search Console ──

function buildSearchConsoleSection(r: AnalysisReport): string {
  const sc = r.search_console;
  if (!sc) return '';

  const parts: string[] = ['## Google Search Console'];

  // Index status
  const is = sc.index_status;
  const indexIcon = is.is_page_indexed ? '\u2713' : '\u2717';
  parts.push(`\n### Index Status\n`);
  parts.push(`| Field | Value |`);
  parts.push(`| ------ | ------ |`);
  parts.push(`| Indexed | ${indexIcon} ${is.coverage_state} |`);
  if (is.crawl_timestamp) {
    parts.push(`| Last Crawled | ${is.crawl_timestamp} |`);
  }
  if (is.google_canonical) {
    parts.push(`| Google Canonical | ${escCell(is.google_canonical)} |`);
  }
  if (is.rich_results && is.rich_results.length > 0) {
    parts.push(`| Rich Results | ${is.rich_results.join(', ')} |`);
  }

  // Search performance
  const sp = sc.search_performance;
  if (sp.top_queries.length > 0) {
    parts.push(`\n### Search Performance (28 days)\n`);
    parts.push(`Clicks: **${fmtInt(sp.total_clicks)}** | Impressions: **${fmtInt(sp.total_impressions)}** | Avg CTR: **${fmtPct(sp.average_ctr)}** | Avg Position: **${fmtFloat(sp.average_position, 1)}**\n`);

    const queryRows = sp.top_queries.map(q => [
      escCell(q.query),
      fmtInt(q.clicks),
      fmtInt(q.impressions),
      fmtPct(q.ctr),
      fmtFloat(q.position, 1),
    ]);
    parts.push(table(['Query', 'Clicks', 'Impressions', 'CTR', 'Position'], queryRows));
  }

  // Sitemaps
  if (sc.sitemaps && sc.sitemaps.length > 0) {
    parts.push(`\n### Submitted Sitemaps\n`);
    const smRows = sc.sitemaps.map(sm => [
      escCell(sm.path),
      sm.last_downloaded ?? EM,
      String(sm.errors),
      String(sm.warnings),
    ]);
    parts.push(table(['Sitemap', 'Last Downloaded', 'Errors', 'Warnings'], smRows));
  }

  return parts.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Layer 3 — Public entry point
// ─────────────────────────────────────────────────────────────────────────────

export function buildReportMd(report: AnalysisReport): string {
  const sections: string[] = [
    buildFrontmatter(report),
    buildTitle(report),
  ];

  const bodySections = [
    buildPerformanceSection(report),
    buildSeoTechnicalSection(report),
    buildSeoOnPageSection(report),
    buildContentAnalysisSection(report),
    buildDomStructureSection(report),
    buildAccessibilitySection(report),
    buildHeadingTreeSection(report),
    buildSearchConsoleSection(report),
    buildIssuesSection(report),
  ].filter(s => s.length > 0);

  sections.push(...bodySections);

  // If analysis_detail is entirely absent, add a note
  if (!report.analysis_detail) {
    sections.push('> Note: Detailed analysis data unavailable. Report generated from summary fields only.');
  }

  return sections.join('\n\n---\n\n') + '\n';
}
