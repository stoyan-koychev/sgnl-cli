/**
 * SGNL Phase 8 — Ink UI Report Renderer
 * React/Ink terminal component for rendering AnalysisReport
 */

import React from 'react';
import { Box, Text, render, Newline } from 'ink';
import { AnalysisReport } from '../analysis/merger';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const WIDTH = 76;
const BAR_WIDTH = 40;

// ─────────────────────────────────────────────────────────────────────────────
// Helper: ScoreBar
// ─────────────────────────────────────────────────────────────────────────────

export function ScoreBar({ score }: { score: number }): React.ReactElement {
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const filled = Math.round((clamped / 100) * BAR_WIDTH);
  const empty = BAR_WIDTH - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  const color =
    clamped >= 90 ? 'green' : clamped >= 60 ? 'yellow' : 'red';

  return (
    <Text>
      <Text color={color}>{bar}</Text>
      <Text>  {clamped}/100</Text>
    </Text>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: StatusBadge
// ─────────────────────────────────────────────────────────────────────────────

export function StatusBadge({
  text,
  status,
}: {
  text: string;
  status: 'pass' | 'warn' | 'fail';
}): React.ReactElement {
  const color =
    status === 'pass' ? 'green' : status === 'warn' ? 'yellow' : 'red';
  const icon =
    status === 'pass' ? '✓' : status === 'warn' ? '⚠' : '✗';
  return (
    <Text color={color}>
      {icon} {text}
    </Text>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Divider line
// ─────────────────────────────────────────────────────────────────────────────

function HR({ char = '─' }: { char?: string }): React.ReactElement {
  return <Text dimColor>{''.padStart(WIDTH, char)}</Text>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Section header
// ─────────────────────────────────────────────────────────────────────────────

function SectionHeader({
  title,
}: {
  title: string;
}): React.ReactElement {
  const label = title;
  return (
    <Box marginTop={1}>
      <Text bold color="cyan">
        {label}
      </Text>
    </Box>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: center text in WIDTH
// ─────────────────────────────────────────────────────────────────────────────

function center(str: string, width: number): string {
  const pad = Math.max(0, width - str.length);
  const left = Math.floor(pad / 2);
  const right = pad - left;
  return ' '.repeat(left) + str + ' '.repeat(right);
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: format metric value
// ─────────────────────────────────────────────────────────────────────────────

function fmtMs(ms?: number): string {
  if (ms === undefined || ms === null) return 'n/a';
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms}ms`;
}

function fmtCls(v?: number): string {
  if (v === undefined || v === null) return 'n/a';
  return v.toFixed(2);
}

// ─────────────────────────────────────────────────────────────────────────────
// Header Component
// ─────────────────────────────────────────────────────────────────────────────

function Header({
  url,
  timestamp,
}: {
  url: string;
  timestamp: string;
}): React.ReactElement {
  const top = '╔' + '═'.repeat(WIDTH) + '╗';
  const bot = '╚' + '═'.repeat(WIDTH) + '╝';
  const row = (s: string): string => '║' + center(s, WIDTH) + '║';

  return (
    <Box flexDirection="column">
      <Text color="blue">{top}</Text>
      <Text color="blue">{row('SGNL Analysis Report')}</Text>
      <Text color="blue">{row(url)}</Text>
      <Text color="blue">{row(timestamp)}</Text>
      <Text color="blue">{bot}</Text>
    </Box>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Issues Banner
// ─────────────────────────────────────────────────────────────────────────────

function IssuesBanner({
  report,
}: {
  report: AnalysisReport;
}): React.ReactElement {
  const critical = report.issues?.critical?.length ?? 0;
  const warning = report.issues?.warning?.length ?? 0;
  const info = report.issues?.info?.length ?? 0;

  const top = '┌' + '─'.repeat(WIDTH) + '┐';
  const bot = '└' + '─'.repeat(WIDTH) + '┘';

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text dimColor>{top}</Text>
      <Box>
        <Text dimColor>│ </Text>
        <Text bold>ISSUES</Text>
        <Text>  </Text>
        <Text color={critical > 0 ? 'red' : 'green'}>{critical} critical</Text>
        <Text dimColor> · </Text>
        <Text color={warning > 0 ? 'yellow' : 'green'}>{warning} warnings</Text>
        <Text dimColor> · </Text>
        <Text>{info} info</Text>
        <Text dimColor> │</Text>
      </Box>
      <Text dimColor>{bot}</Text>
    </Box>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Status Bar
// ─────────────────────────────────────────────────────────────────────────────

function StatusBar({ report }: { report: AnalysisReport }): React.ReactElement {
  const top = '┌' + '─'.repeat(WIDTH) + '┐';
  const bot = '└' + '─'.repeat(WIDTH) + '┘';
  const httpStatus = report.http_status ?? 0;
  const httpColor = httpStatus < 400 ? 'green' : 'red';
  const httpsPass = report.https ? 'pass' : 'fail';
  const crawlPass = report.crawlable ? 'pass' : 'fail';
  const cdn = report.performance?.cdn;

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text dimColor>{top}</Text>
      <Box>
        <Text dimColor>│ </Text>
        <Text color={httpColor}>HTTP {httpStatus} </Text>
        <StatusBadge text="" status={httpStatus < 400 ? 'pass' : 'fail'} />
        <Text>  </Text>
        <StatusBadge text="HTTPS" status={httpsPass} />
        <Text>  </Text>
        <StatusBadge text="CRAWLABLE" status={crawlPass} />
        {cdn && <Text>  CDN: {cdn}</Text>}
        <Text dimColor> │</Text>
      </Box>
      <Text dimColor>{bot}</Text>
    </Box>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Performance Section
// ─────────────────────────────────────────────────────────────────────────────

function cwvStatus(val: number | undefined, good: number, warn: number): 'pass' | 'warn' | 'fail' {
  if (val === undefined) return 'fail';
  if (val <= good) return 'pass';
  if (val <= warn) return 'warn';
  return 'fail';
}

function cwvLabel(status: 'pass' | 'warn' | 'fail'): string {
  return status === 'pass' ? '✓ Good' : status === 'warn' ? '⚠ Warn' : '✗ Poor';
}

function cwvIcon(status: 'pass' | 'warn' | 'fail'): string {
  return status === 'pass' ? '✓' : status === 'warn' ? '⚠' : '✗';
}

function cwvColor(status: 'pass' | 'warn' | 'fail'): string {
  return status === 'pass' ? 'green' : status === 'warn' ? 'yellow' : 'red';
}

function ttfbStatus(ms: number): 'pass' | 'warn' | 'fail' {
  if (ms < 300) return 'pass';
  if (ms < 1000) return 'warn';
  return 'fail';
}

function ttfbWhy(ms: number): string {
  if (ms < 100) return 'Excellent — server responds almost instantly';
  if (ms < 300) return 'Good — server response within acceptable range';
  if (ms < 1000) return 'Slow — server response time hurts Time to First Byte';
  return 'Very slow — investigate server performance or hosting';
}

function PerformanceSection({ report }: { report: AnalysisReport }): React.ReactElement {
  const cwv = report.performance?.core_web_vitals ?? {};
  const speed = report.performance?.speed_metrics ?? { ttfb_ms: 0 };

  const lcpStatus = cwvStatus(cwv.lcp_ms, 2500, 4000);
  const clsStatus = cwvStatus(cwv.cls, 0.1, 0.25);
  const inpStatus = cwvStatus(cwv.inp_ms, 200, 500);
  const fidStatus = cwvStatus(cwv.fid_ms, 100, 300);
  const ttfbSt = ttfbStatus(speed.ttfb_ms ?? 0);

  return (
    <Box flexDirection="column">
      <SectionHeader title="PERFORMANCE" />
      <Text bold color="white">Core Web Vitals:</Text>
      <Box flexDirection="column" paddingLeft={2}>
        <Text>
          <Text color={cwvColor(lcpStatus)}>⚡ LCP   </Text>
          <Text>{fmtMs(cwv.lcp_ms).padEnd(8)}</Text>
          <Text color={cwvColor(lcpStatus)}>{cwvLabel(lcpStatus)} (target: &lt;2.5s)</Text>
        </Text>
        <Text>
          <Text color={cwvColor(clsStatus)}>⚠ CLS   </Text>
          <Text>{fmtCls(cwv.cls).padEnd(8)}</Text>
          <Text color={cwvColor(clsStatus)}>{cwvLabel(clsStatus)} (target: &lt;0.1)</Text>
        </Text>
        <Text>
          <Text color={cwvColor(inpStatus)}>⚡ INP   </Text>
          <Text>{fmtMs(cwv.inp_ms).padEnd(8)}</Text>
          <Text color={cwvColor(inpStatus)}>{cwvLabel(inpStatus)} (target: &lt;200ms)</Text>
        </Text>
        <Text>
          <Text color={cwvColor(fidStatus)}>⚡ FID   </Text>
          <Text>{fmtMs(cwv.fid_ms).padEnd(8)}</Text>
          <Text color={cwvColor(fidStatus)}>{cwvLabel(fidStatus)} (target: &lt;100ms)</Text>
        </Text>
      </Box>

      <Box marginTop={1}>
        <Text bold color="white">Speed Metrics:</Text>
      </Box>
      <Box flexDirection="column" paddingLeft={2}>
        <Text>• TTFB         {fmtMs(speed.ttfb_ms)}</Text>
        {speed.speed_index_s !== undefined && (
          <Text>• Speed Index  {speed.speed_index_s}s</Text>
        )}
        {speed.tti_s !== undefined && (
          <Text>• TTI          {speed.tti_s}s</Text>
        )}
      </Box>

      <Box marginTop={1}>
        <Text bold color="white">Metric details:</Text>
      </Box>
      <Box flexDirection="column" paddingLeft={2}>
        <Box flexDirection="column">
          <Text>
            <Text color={cwvColor(lcpStatus)}>{cwvIcon(lcpStatus)} </Text>
            <Text>{'LCP'.padEnd(6)}{fmtMs(cwv.lcp_ms).padEnd(10)}</Text>
            <Text dimColor>
              {lcpStatus === 'pass' ? 'Largest element loaded fast — good user experience' :
                lcpStatus === 'warn' ? 'Largest element slow to load — affects perceived speed' :
                  cwv.lcp_ms === undefined ? 'No field data available — run PSI for real-user data' :
                    'Very slow LCP — critical impact on Core Web Vitals score'}
            </Text>
          </Text>
          <Text>
            <Text color={cwvColor(clsStatus)}>{cwvIcon(clsStatus)} </Text>
            <Text>{'CLS'.padEnd(6)}{fmtCls(cwv.cls).padEnd(10)}</Text>
            <Text dimColor>
              {clsStatus === 'pass' ? 'Layout is stable — no unexpected content shifts' :
                clsStatus === 'warn' ? 'Some layout shift — check images without dimensions' :
                  cwv.cls === undefined ? 'No field data available' :
                    'Severe layout instability — hurts user experience and ranking'}
            </Text>
          </Text>
          <Text>
            <Text color={cwvColor(inpStatus)}>{cwvIcon(inpStatus)} </Text>
            <Text>{'INP'.padEnd(6)}{fmtMs(cwv.inp_ms).padEnd(10)}</Text>
            <Text dimColor>
              {inpStatus === 'pass' ? 'Page responds quickly to user interactions' :
                inpStatus === 'warn' ? 'Interaction lag detected — optimize JS execution' :
                  cwv.inp_ms === undefined ? 'No field data available' :
                    'Very slow interaction — large JS bundles or long tasks blocking main thread'}
            </Text>
          </Text>
          <Text>
            <Text color={cwvColor(fidStatus)}>{cwvIcon(fidStatus)} </Text>
            <Text>{'FID'.padEnd(6)}{fmtMs(cwv.fid_ms).padEnd(10)}</Text>
            <Text dimColor>
              {fidStatus === 'pass' ? 'First input responds within target threshold' :
                fidStatus === 'warn' ? 'Some delay on first interaction' :
                  cwv.fid_ms === undefined ? 'No field data available' :
                    'Poor first input delay — reduce render-blocking JS'}
            </Text>
          </Text>
          <Text>
            <Text color={cwvColor(ttfbSt)}>{cwvIcon(ttfbSt)} </Text>
            <Text>{'TTFB'.padEnd(6)}{fmtMs(speed.ttfb_ms).padEnd(10)}</Text>
            <Text dimColor>{ttfbWhy(speed.ttfb_ms ?? 0)}</Text>
          </Text>
        </Box>
      </Box>
    </Box>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SEO Section
// ─────────────────────────────────────────────────────────────────────────────

const TECH_WHY: Record<string, string> = {
  title: 'Required for search snippets and page identity',
  description: 'Affects click-through rate in search results',
  canonical: 'Prevents duplicate content penalties across URLs',
  schema: 'Enables rich results (stars, FAQs, breadcrumbs) in SERPs',
  og: 'Controls social share preview (title, image, description)',
  indexable: 'Must be true for page to appear in search index',
  https: 'Secure connection — ranking signal and trust factor',
};

function SeoSection({ report }: { report: AnalysisReport }): React.ReactElement {
  const tech = report.seo?.technical ?? {} as AnalysisReport['seo']['technical'];
  const content = report.seo?.content ?? {} as AnalysisReport['seo']['content'];
  const links = report.seo?.links ?? {} as AnalysisReport['seo']['links'];

  const techChecks: Array<{ pass: boolean; label: string; whyKey: string }> = [
    { pass: !!(tech.title), label: 'Title present', whyKey: 'title' },
    { pass: !!(tech.description), label: 'Description present', whyKey: 'description' },
    { pass: !!(tech.canonical), label: 'Canonical valid', whyKey: 'canonical' },
    { pass: (tech.schema_count ?? 0) > 0, label: `Schema found (${tech.schema_count ?? 0} blocks)`, whyKey: 'schema' },
    { pass: tech.open_graph, label: 'Open Graph tags', whyKey: 'og' },
    { pass: tech.indexable, label: 'Indexable', whyKey: 'indexable' },
    { pass: report.https, label: 'HTTPS enforced', whyKey: 'https' },
  ];

  return (
    <Box flexDirection="column">
      <SectionHeader title="SEO" />

      <Text bold color="white">Technical:</Text>
      <Box flexDirection="column" paddingLeft={2}>
        {techChecks.map(({ pass, label, whyKey }) => (
          <Box key={whyKey} flexDirection="column">
            <Text color={pass ? 'green' : 'red'}>{pass ? '✓' : '✗'} {label}</Text>
            <Text dimColor>  → {TECH_WHY[whyKey]}</Text>
          </Box>
        ))}
      </Box>

      <Box marginTop={1}>
        <Text bold color="white">Content:</Text>
      </Box>
      <Box flexDirection="column" paddingLeft={2}>
        <Box>
          <Box width={36}>
            <Text>• Word count: {(content.word_count ?? 0).toLocaleString()} words</Text>
          </Box>
          <Text>• H1 count: {content.h1_count ?? 0}</Text>
        </Box>
        <Box>
          <Box width={36}>
            <Text color={content.headings_valid ? 'green' : 'yellow'}>
              {content.headings_valid ? '✓' : '⚠'} Heading hierarchy {content.headings_valid ? 'valid' : 'invalid'}
            </Text>
          </Box>
          <Text>• Images: {content.images_total ?? 0} ({content.images_alt_missing ?? 0} missing alt)</Text>
        </Box>
      </Box>

      <Box marginTop={1}>
        <Text bold color="white">Links:</Text>
      </Box>
      <Box flexDirection="column" paddingLeft={2}>
        <Box>
          <Box width={36}>
            <Text>• Internal: {links.internal_total ?? 0} links</Text>
          </Box>
          <Text>• External: {links.external_total ?? 0} links</Text>
        </Box>
        <Text>• Generic anchor text: {links.generic_anchor_text ?? 0}%</Text>
      </Box>
    </Box>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Structure Section
// ─────────────────────────────────────────────────────────────────────────────

function StructureSection({ report }: { report: AnalysisReport }): React.ReactElement {
  const st = report.structure ?? {} as AnalysisReport['structure'];

  return (
    <Box flexDirection="column">
      <SectionHeader title="STRUCTURE" />
      <Text bold color="white">DOM Quality:</Text>
      <Box flexDirection="column" paddingLeft={2}>
        <Box>
          <Box width={32}>
            <Text>• Elements: {st.dom_elements ?? 'n/a'}</Text>
          </Box>
          <Text>• Div ratio: {st.div_ratio !== undefined ? Math.round(st.div_ratio * 100) + '%' : 'n/a'}</Text>
        </Box>
        <Box>
          <Box width={32}>
            <Text>• Semantic score: {st.semantic_score ?? 'n/a'}/7</Text>
          </Box>
          <Text color={st.heading_hierarchy_valid ? 'green' : 'yellow'}>
            {st.heading_hierarchy_valid ? '✓' : '⚠'} Heading hierarchy {st.heading_hierarchy_valid ? 'valid' : 'invalid'}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Content Analysis Section
// ─────────────────────────────────────────────────────────────────────────────

const EEAT_WHY: Record<string, string> = {
  strong: 'Expert tone, cites sources, or first-person experience detected',
  moderate: 'Some authority signals present but lacks depth',
  weak: 'Low expertise signals — add credentials, stats, or direct experience',
  unknown: 'Could not assess E-E-A-T signals',
};

const DEPTH_WHY: Record<string, string> = {
  comprehensive: 'Rich content with sufficient word count and topic coverage',
  adequate: 'Acceptable depth but could benefit from more detail',
  shallow: 'Low word count or limited topic coverage — expand content',
  unknown: 'Could not assess content depth',
};

const FRESH_WHY: Record<string, string> = {
  current: 'Content references recent dates or was recently updated',
  recent: 'Content appears reasonably up to date',
  stale: 'Content references dates 1–3 years ago — consider refreshing',
  very_stale: 'References dates 3+ years ago — strongly consider updating',
  undated: 'No date signals found — add publication or update dates',
};

const THIN_WHY: Record<string, string> = {
  none: 'No boilerplate or skeleton content detected',
  low: 'Minor repetition or thin sections present',
  moderate: 'Notable thin content — review for boilerplate text',
  high: 'High boilerplate or repeated content — major risk for ranking',
  unknown: 'Could not assess thin content risk',
};

const ANCHOR_WHY: Record<string, string> = {
  excellent: 'All anchor text is descriptive — no generic phrases detected',
  good: 'Descriptive anchor text found, minimal generic phrases',
  fair: 'Some generic anchors ("click here", "read more") detected',
  poor: 'High ratio of generic anchor text — use descriptive link labels',
  unknown: 'Could not assess anchor text quality',
};

function eeatColor(label: string): string {
  if (label === 'strong') return 'green';
  if (label === 'moderate') return 'yellow';
  return 'red';
}

function thinColor(risk: string): string {
  if (risk === 'none') return 'green';
  if (risk === 'low') return 'yellow';
  return 'red';
}

function freshColor(status: string): string {
  if (status === 'current' || status === 'recent') return 'green';
  if (status === 'stale') return 'yellow';
  return 'red';
}

function anchorColor(score: string): string {
  if (score === 'excellent') return 'green';
  if (score === 'good') return 'green';
  if (score === 'fair') return 'yellow';
  return 'red';
}

function ContentAnalysisSection({ report }: { report: AnalysisReport }): React.ReactElement | null {
  const ca = report.content_analysis;
  if (!ca) return null;

  const signals: Array<{ label: string; value: string; color: string; why: string }> = [
    {
      label: 'Depth',
      value: ca.depth_label,
      color: ca.depth_label === 'comprehensive' ? 'green' : ca.depth_label === 'adequate' ? 'yellow' : 'red',
      why: DEPTH_WHY[ca.depth_label] ?? DEPTH_WHY['unknown'],
    },
    {
      label: 'E-E-A-T',
      value: ca.eeat_label,
      color: eeatColor(ca.eeat_label),
      why: EEAT_WHY[ca.eeat_label] ?? EEAT_WHY['unknown'],
    },
    {
      label: 'Freshness',
      value: ca.freshness_status,
      color: freshColor(ca.freshness_status),
      why: FRESH_WHY[ca.freshness_status] ?? FRESH_WHY['undated'],
    },
    {
      label: 'Thin risk',
      value: ca.thin_content_risk,
      color: thinColor(ca.thin_content_risk),
      why: THIN_WHY[ca.thin_content_risk] ?? THIN_WHY['unknown'],
    },
    {
      label: 'Anchors',
      value: ca.anchor_quality_score,
      color: anchorColor(ca.anchor_quality_score),
      why: ANCHOR_WHY[ca.anchor_quality_score] ?? ANCHOR_WHY['unknown'],
    },
    {
      label: 'Snippet eligible',
      value: ca.snippet_eligible ? 'yes' : 'no',
      color: ca.snippet_eligible ? 'green' : 'white',
      why: ca.snippet_eligible
        ? 'Has concise answer blocks suitable for featured snippets'
        : 'No clear concise answer blocks — add Q&A or definition-style content',
    },
  ];

  return (
    <Box flexDirection="column">
      <SectionHeader title="CONTENT ANALYSIS" />
      <Text bold color="white">Signals:</Text>
      <Box flexDirection="column" paddingLeft={2}>
        {signals.map(({ label, value, color, why }) => (
          <Box key={label} flexDirection="column">
            <Text color={color}>{color === 'green' ? '✓' : color === 'yellow' ? '⚠' : color === 'red' ? '✗' : '○'} {label}: {value}</Text>
            <Text dimColor>  → {why}</Text>
          </Box>
        ))}
      </Box>

      {ca.issues.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold color="white">Content Issues ({ca.issues.length}):</Text>
          <Box flexDirection="column" paddingLeft={2}>
            {ca.issues.map((issue, i) => (
              <Text key={i} color="yellow">⚠  {issue}</Text>
            ))}
          </Box>
        </Box>
      )}
    </Box>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Issues Section
// ─────────────────────────────────────────────────────────────────────────────

function IssuesSection({ report }: { report: AnalysisReport }): React.ReactElement {
  const issues = report.issues ?? { critical: [], warning: [], info: [] };
  const critical = issues.critical ?? [];
  const warning = issues.warning ?? [];
  const info = issues.info ?? [];
  const total = critical.length + warning.length + info.length;

  return (
    <Box flexDirection="column">
      <Box marginTop={1}>
        {total === 0 ? (
          <Text bold color="green">✓  NO ISSUES</Text>
        ) : (
          <Text bold color={critical.length > 0 ? 'red' : 'yellow'}>
            ⚠  ISSUES  {critical.length} critical · {warning.length} warnings · {info.length} info
          </Text>
        )}
      </Box>

      {critical.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold color="red">CRITICAL ({critical.length}):</Text>
          <Box flexDirection="column" paddingLeft={2}>
            {critical.map((msg, i) => (
              <Text key={i} color="red">❌ {msg}</Text>
            ))}
          </Box>
        </Box>
      )}

      {warning.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold color="yellow">WARNINGS ({warning.length}):</Text>
          <Box flexDirection="column" paddingLeft={2}>
            {warning.map((msg, i) => (
              <Text key={i} color="yellow">⚠  {msg}</Text>
            ))}
          </Box>
        </Box>
      )}

      {info.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold color="blue">INFO ({info.length}):</Text>
          <Box flexDirection="column" paddingLeft={2}>
            {info.map((msg, i) => (
              <Text key={i} color="blue">ℹ  {msg}</Text>
            ))}
          </Box>
        </Box>
      )}
    </Box>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Search Console Section
// ─────────────────────────────────────────────────────────────────────────────

function SearchConsoleSection({ report }: { report: AnalysisReport }): React.ReactElement | null {
  const sc = report.search_console;
  if (!sc) return null;

  const is = sc.index_status;
  const sp = sc.search_performance;

  return (
    <Box flexDirection="column">
      <SectionHeader title="Google Search Console" />
      <HR />

      <Box marginTop={1}>
        <Text dimColor>  Index Status:  </Text>
        {is.is_page_indexed
          ? <Text color="green">Indexed ({is.coverage_state})</Text>
          : <Text color="red">Not Indexed ({is.coverage_state})</Text>
        }
      </Box>
      {is.crawl_timestamp && (
        <Box>
          <Text dimColor>  Last Crawled:  </Text>
          <Text>{is.crawl_timestamp}</Text>
        </Box>
      )}
      {is.google_canonical && (
        <Box>
          <Text dimColor>  Google Canon:  </Text>
          <Text>{is.google_canonical}</Text>
        </Box>
      )}
      {is.rich_results && is.rich_results.length > 0 && (
        <Box>
          <Text dimColor>  Rich Results:  </Text>
          <Text>{is.rich_results.join(', ')}</Text>
        </Box>
      )}

      {sp.top_queries.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>  Top Queries (28d)  </Text>
          <Text dimColor>  Clicks: {sp.total_clicks} | Impressions: {sp.total_impressions} | CTR: {(sp.average_ctr * 100).toFixed(1)}%</Text>
          {sp.top_queries.map((q, i) => (
            <Box key={i} paddingLeft={2}>
              <Text dimColor>{String(i + 1).padStart(2)}. </Text>
              <Text>{q.query.slice(0, 35).padEnd(35)}</Text>
              <Text dimColor> pos </Text>
              <Text color={q.position <= 3 ? 'green' : q.position <= 10 ? 'yellow' : 'red'}>
                {q.position.toFixed(1).padStart(5)}
              </Text>
              <Text dimColor>  {String(q.clicks).padStart(5)} clicks  {String(q.impressions).padStart(7)} impr  {(q.ctr * 100).toFixed(1)}%</Text>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Footer
// ─────────────────────────────────────────────────────────────────────────────

function Footer(): React.ReactElement {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text dimColor>Generated by SGNL</Text>
      <Text dimColor>https://github.com/stoyan-koychev/sgnl-cli</Text>
    </Box>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main ReportRenderer Component
// ─────────────────────────────────────────────────────────────────────────────

export function ReportRenderer({ report }: { report: AnalysisReport }): React.ReactElement {
  return (
    <Box flexDirection="column" paddingX={1}>
      <Header url={report.url} timestamp={report.timestamp} />
      <IssuesBanner report={report} />
      <StatusBar report={report} />
      <PerformanceSection report={report} />
      <SeoSection report={report} />
      <StructureSection report={report} />
      <ContentAnalysisSection report={report} />
      <SearchConsoleSection report={report} />

      <IssuesSection report={report} />
      <Footer />
    </Box>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// renderReport — renders ReportRenderer to terminal
// ─────────────────────────────────────────────────────────────────────────────

export function renderReport(report: AnalysisReport): void {
  render(<ReportRenderer report={report} />);
}

export default ReportRenderer;

// ─────────────────────────────────────────────────────────────────────────────
// SummaryCard — compact terminal output (default, replaces box-drawn report)
// ─────────────────────────────────────────────────────────────────────────────

function fmtNum(n: number | undefined): string {
  if (n === undefined || n === null) return '—';
  return n.toLocaleString('en-US');
}

function cwvBadge(metric: string, value: number | undefined): React.ReactElement {
  if (value === undefined || value === null) return <Text dimColor>—</Text>;
  const thresholds: Record<string, [number, number]> = {
    lcp: [2500, 4000],
    fcp: [1800, 3000],
    cls: [0.1, 0.25],
    inp: [200, 500],
    fid: [100, 300],
  };
  const [good, poor] = thresholds[metric] ?? [0, 0];
  if (value <= good) return <Text color="green">✓</Text>;
  if (value <= poor) return <Text color="yellow">⚠</Text>;
  return <Text color="red">✗</Text>;
}

export function SummaryCard({ report }: { report: AnalysisReport }): React.ReactElement {
  const hostname = (() => { try { return new URL(report.url).hostname; } catch { return report.url; } })();
  const cwv = report.performance?.core_web_vitals ?? {};
  const speed = report.performance?.speed_metrics ?? { ttfb_ms: 0 };
  const tech = report.seo?.technical;
  const issues = report.issues ?? { critical: [], warning: [], info: [] };
  const ca = report.content_analysis;
  const xray = report.analysis_detail?.xray;
  const detailCA = report.analysis_detail?.content_analysis;

  const critCount = issues.critical.length;
  const warnCount = issues.warning.length;
  const infoCount = issues.info.length;

  const lcpS = cwv.lcp_ms != null ? `${(cwv.lcp_ms / 1000).toFixed(1)}s` : '—';
  const clsV = cwv.cls != null ? cwv.cls.toFixed(2) : '—';
  const inpV = cwv.inp_ms != null ? `${cwv.inp_ms}ms` : '—';
  const fidV = cwv.fid_ms != null ? `${cwv.fid_ms}ms` : '—';

  const seoIcon = (ok: boolean | undefined) =>
    ok ? <Text color="green">✓</Text> : <Text color="red">✗</Text>;

  return (
    <Box flexDirection="column">
      <Box>
        <Text dimColor>sgnl  </Text>
        <Text bold>{hostname}</Text>
      </Box>
      <Text> </Text>

      {/* Status bar */}
      <Box>
        <Text>  HTTP {report.http_status}</Text>
        {report.https && <Text> · HTTPS</Text>}
        {report.crawlable && <Text> · Crawlable</Text>}
        {report.performance?.cdn && <Text> · {report.performance.cdn}</Text>}
      </Box>

      {/* Issue counts */}
      <Box>
        <Text>  </Text>
        <Text color={critCount > 0 ? 'red' : undefined} dimColor={critCount === 0}>{critCount} critical</Text>
        <Text dimColor> · </Text>
        <Text color={warnCount > 0 ? 'yellow' : undefined} dimColor={warnCount === 0}>{warnCount} warnings</Text>
        <Text dimColor> · </Text>
        <Text dimColor>{infoCount} info</Text>
      </Box>
      <Text> </Text>

      {/* PERF row */}
      <Box>
        <Text dimColor>  {'PERF'.padEnd(8)}</Text>
        <Text>LCP {lcpS} </Text>{cwvBadge('lcp', cwv.lcp_ms)}
        <Text>  CLS {clsV} </Text>{cwvBadge('cls', cwv.cls)}
        <Text>  INP {inpV} </Text>{cwvBadge('inp', cwv.inp_ms)}
        <Text>  FID {fidV} </Text>{cwvBadge('fid', cwv.fid_ms)}
        {speed.performance_score != null && <Text>  Score {speed.performance_score}</Text>}
      </Box>

      {/* SEO row */}
      <Box>
        <Text dimColor>  {'SEO'.padEnd(8)}</Text>
        <Text>Title </Text>{seoIcon(!!tech?.title)}
        <Text>  Desc </Text>{seoIcon(!!tech?.description)}
        <Text>  Canon </Text>{seoIcon(!!tech?.canonical)}
        <Text>  Schema {tech?.schema_count ?? 0}</Text>
        <Text>  OG </Text>{seoIcon(tech?.open_graph)}
        <Text>  Index </Text>{seoIcon(tech?.indexable)}
      </Box>

      {/* DOM row */}
      {xray && (
        <Box>
          <Text dimColor>  {'DOM'.padEnd(8)}</Text>
          <Text>{fmtNum(xray.dom?.total_elements)} el</Text>
          <Text dimColor> · </Text>
          <Text>{Math.round((xray.structure?.div_ratio ?? 0) * 100)}% div</Text>
          <Text dimColor> · </Text>
          <Text>{xray.structure?.semantic_score ?? 0}/7 semantic</Text>
          <Text dimColor> · </Text>
          <Text>{fmtNum(xray.structure?.empty_elements)} empty</Text>
        </Box>
      )}

      {/* A11Y row */}
      {xray && (
        <Box>
          <Text dimColor>  {'A11Y'.padEnd(8)}</Text>
          {(() => {
            const parts: string[] = [];
            if ((xray.accessibility?.buttons_links_no_text ?? 0) > 0)
              parts.push(`${xray.accessibility.buttons_links_no_text} unlabelled`);
            if ((xray.structure?.duplicate_ids ?? 0) > 0)
              parts.push(`${xray.structure.duplicate_ids} dup ID`);
            if ((xray.accessibility?.inputs_without_label ?? 0) > 0)
              parts.push(`${xray.accessibility.inputs_without_label} unlabelled inputs`);
            return parts.length > 0
              ? <Text>{parts.join(' · ')}</Text>
              : <Text color="green">No issues</Text>;
          })()}
        </Box>
      )}

      <Text> </Text>

      {/* Content row */}
      {ca && (
        <Box>
          <Text dimColor>  {'Content'.padEnd(10)}</Text>
          <Text>{fmtNum(report.seo?.content?.word_count)} words</Text>
          <Text dimColor> · </Text>
          <Text>{ca.depth_label}</Text>
          <Text dimColor> · </Text>
          <Text>E-E-A-T {ca.eeat_label}</Text>
          <Text dimColor> · </Text>
          <Text>{ca.freshness_status}</Text>
        </Box>
      )}

      {/* Readability row */}
      {detailCA?.readability && (
        <Box>
          <Text dimColor>  {'Read'.padEnd(10)}</Text>
          <Text>{detailCA.readability.reading_level} (Flesch {detailCA.readability.flesch_reading_ease})</Text>
          <Text dimColor> · </Text>
          <Text>{detailCA.readability.long_sentences_count} long sentences</Text>
        </Box>
      )}

      {/* GSC row */}
      {report.search_console && (
        <>
          <Box>
            <Text dimColor>  {'GSC'.padEnd(10)}</Text>
            <Text>{report.search_console.index_status.is_page_indexed
              ? <Text color="green">Indexed</Text>
              : <Text color="red">Not indexed</Text>
            }</Text>
            <Text dimColor> · </Text>
            <Text>{fmtNum(report.search_console.search_performance.total_clicks)} clicks</Text>
            <Text dimColor> · </Text>
            <Text>{fmtNum(report.search_console.search_performance.total_impressions)} impr</Text>
            <Text dimColor> · </Text>
            <Text>{(report.search_console.search_performance.average_ctr * 100).toFixed(1)}% CTR</Text>
          </Box>
          {report.search_console.search_performance.top_queries.slice(0, 5).map((q, i) => (
            <Box key={`gsc${i}`}>
              <Text dimColor>  {''.padEnd(10)}</Text>
              <Text dimColor>{String(i + 1).padStart(2)}. </Text>
              <Text>{q.query.slice(0, 40).padEnd(40)}</Text>
              <Text dimColor> pos </Text>
              <Text>{q.position.toFixed(1)}</Text>
              <Text dimColor>  {fmtNum(q.clicks)} clicks</Text>
            </Box>
          ))}
        </>
      )}

      <Text> </Text>

      {/* Critical issues */}
      {issues.critical.map((issue, i) => (
        <Box key={`c${i}`}>
          <Text color="red">  ✗ CRIT  </Text>
          <Text>{issue}</Text>
        </Box>
      ))}

      {/* Warning issues */}
      {issues.warning.map((issue, i) => (
        <Box key={`w${i}`}>
          <Text color="yellow">  ⚠ WARN  </Text>
          <Text>{issue}</Text>
        </Box>
      ))}

      <Text> </Text>
    </Box>
  );
}
