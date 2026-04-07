import axios from 'axios';
import * as fs from 'fs';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PageData {
  url: string;
  status: number;
  title: string;
  h1: string;
  canonical: string | null;
  metaRobots: string;
  isIndexable: boolean;
  rawHtml?: string;   // populated only when storeHtml option is true
}

export interface LinkInfo {
  target: string;
  follow: boolean;
  type: 'internal' | 'external';
}

export interface ExplorerOptions {
  maxPages?: number;
  maxDepth?: number;
  delay?: number;
  timeout?: number;
  userAgent?: string;
  sitemapUrl?: string;
  storeHtml?: boolean;
  crawlSitemap?: boolean;   // seed queue from sitemap; auto-raise maxPages
  excludeSelectors?: string[];  // CSS tag selectors whose links are ignored
  outputFile?: string;          // if set, stream pages to JSONL on disk; Maps stay empty
  maxHtmlBytes?: number;        // Gap 1: truncate HTML at this byte count (default: 2MB)
  maxRedirects?: number;        // Gap 2: max redirect chain length (default: 2)
  googlebot?: boolean;          // Gap 3: use Googlebot Mobile UA + respect robots.txt Disallow/Crawl-delay
  delayExplicit?: boolean;      // true when user explicitly passed --delay; skips robots.txt Crawl-delay floor
  headers?: Record<string, string>; // Custom HTTP headers to send with requests
  resume?: boolean;             // Fix 4: resume from checkpoint if available
  checkpointInterval?: number;  // Fix 4: pages between checkpoints (default: 50)
}

export interface ExplorerResult {
  baseUrl: string;
  pages: Map<string, PageData>;
  graph: Map<string, LinkInfo[]>;
  errors: Map<string, string>;
  sitemapUrls: Set<string>;
  depths: Map<string, number>;
  streamedPages?: number;       // page count when streaming mode is active
  sitemapLastmod: Map<string, Date>;  // Gap 4: URL → last modification date from sitemap
  crawledUrls: Set<string>;     // all URLs actually attempted (visited), always populated
  robotsBlocked: Set<string>;   // URLs skipped by robots.txt check
  queueRemainder: Set<string>;  // URLs still in queue when crawl cap was hit
}

// ---------------------------------------------------------------------------
// Gap 3: robots.txt types, parser, and fetcher
// ---------------------------------------------------------------------------

interface RobotsRules {
  disallowed: string[];
  allowed: string[];
  crawlDelay: number | null;  // milliseconds
}

function parseRobotsTxt(content: string, userAgent: string): RobotsRules {
  const rules: RobotsRules = { disallowed: [], allowed: [], crawlDelay: null };
  const starRules: RobotsRules = { disallowed: [], allowed: [], crawlDelay: null };

  const uaLower = userAgent.toLowerCase();
  // activeBlock: which bucket are we currently writing directives into
  let activeBlock: 'match' | 'star' | 'other' | null = null;
  let inUaGroup = false;
  let foundSpecific = false;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.split('#')[0].trim();
    if (!line) {
      // Blank line ends the current block group
      activeBlock = null;
      inUaGroup = false;
      continue;
    }

    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const field = line.slice(0, colonIdx).trim().toLowerCase();
    const value = line.slice(colonIdx + 1).trim();

    if (field === 'user-agent') {
      if (!inUaGroup) {
        // Starting a fresh UA group — reset only if not already in a match
        if (activeBlock !== 'match') activeBlock = null;
        inUaGroup = true;
      }
      const ua = value.toLowerCase();
      if (ua === '*') {
        if (activeBlock !== 'match') activeBlock = 'star';
      } else if (uaLower.includes(ua) || ua === 'googlebot') {
        activeBlock = 'match';
        foundSpecific = true;
      }
    } else {
      inUaGroup = false;  // past the UA declaration lines
      if (field === 'disallow') {
        if (activeBlock === 'match') rules.disallowed.push(value);
        else if (activeBlock === 'star') starRules.disallowed.push(value);
      } else if (field === 'allow') {
        if (activeBlock === 'match') rules.allowed.push(value);
        else if (activeBlock === 'star') starRules.allowed.push(value);
      } else if (field === 'crawl-delay') {
        const secs = parseFloat(value);
        if (!isNaN(secs)) {
          const ms = secs * 1000;
          if (activeBlock === 'match' && rules.crawlDelay === null) rules.crawlDelay = ms;
          else if (activeBlock === 'star' && starRules.crawlDelay === null) starRules.crawlDelay = ms;
        }
      }
    }
  }

  return foundSpecific ? rules : starRules;
}

function isAllowedByRobots(url: string, rules: RobotsRules): boolean {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return true;
  }
  // Fix 5: longest-path-match wins; Allow wins ties (per Google spec)
  let longestAllow = -1;
  for (const allowed of rules.allowed) {
    if (allowed && pathname.startsWith(allowed) && allowed.length > longestAllow) {
      longestAllow = allowed.length;
    }
  }
  let longestDisallow = -1;
  for (const disallowed of rules.disallowed) {
    if (disallowed && pathname.startsWith(disallowed) && disallowed.length > longestDisallow) {
      longestDisallow = disallowed.length;
    }
  }
  if (longestAllow === -1 && longestDisallow === -1) return true;
  if (longestAllow === -1) return false;
  if (longestDisallow === -1) return true;
  // Both matched: longer wins, Allow wins ties
  return longestAllow >= longestDisallow;
}

async function fetchRobotsTxt(
  origin: string,
  userAgent: string,
  timeout: number,
  customHeaders?: Record<string, string>,
): Promise<RobotsRules | null> {
  try {
    const r = await axios.get(`${origin}/robots.txt`, {
      timeout, maxRedirects: 3,
      headers: { 'User-Agent': userAgent, Accept: 'text/plain', ...customHeaders },
      responseType: 'text', validateStatus: () => true,
    });
    if (r.status === 200 && typeof r.data === 'string') {
      return parseRobotsTxt(r.data, userAgent);
    }
  } catch { /* robots.txt unreachable */ }
  return null;
}

// ---------------------------------------------------------------------------
// Gap 5: Priority Queue (binary max-heap)
// ---------------------------------------------------------------------------

interface QueueItem { url: string; depth: number; score: number; }

class PriorityQueue {
  private heap: QueueItem[] = [];
  private urlSet = new Set<string>();

  push(item: QueueItem): void {
    this.heap.push(item);
    this.urlSet.add(item.url);
    this._bubbleUp(this.heap.length - 1);
  }

  shift(): QueueItem | undefined {
    if (this.heap.length === 0) return undefined;
    const top = this.heap[0];
    const last = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this._sinkDown(0);
    }
    this.urlSet.delete(top.url);
    return top;
  }

  get length(): number { return this.heap.length; }

  drain(): QueueItem[] {
    const items = this.heap.slice();
    this.urlSet.clear();
    return items;
  }

  has(url: string): boolean {
    return this.urlSet.has(url);
  }

  /** If url is in the queue and newScore > current score, update and re-heapify. */
  rescoreIfPresent(url: string, newScore: number): void {
    if (!this.urlSet.has(url)) return;
    for (let i = 0; i < this.heap.length; i++) {
      if (this.heap[i].url === url) {
        if (newScore > this.heap[i].score) {
          this.heap[i].score = newScore;
          this._bubbleUp(i);
        }
        return;
      }
    }
  }

  private _bubbleUp(i: number): void {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.heap[parent].score >= this.heap[i].score) break;
      [this.heap[parent], this.heap[i]] = [this.heap[i], this.heap[parent]];
      i = parent;
    }
  }

  private _sinkDown(i: number): void {
    const n = this.heap.length;
    while (true) {
      let largest = i;
      const l = 2 * i + 1, r = 2 * i + 2;
      if (l < n && this.heap[l].score > this.heap[largest].score) largest = l;
      if (r < n && this.heap[r].score > this.heap[largest].score) largest = r;
      if (largest === i) break;
      [this.heap[largest], this.heap[i]] = [this.heap[i], this.heap[largest]];
      i = largest;
    }
  }
}

function scoreUrl(depth: number, inlinks: number, lastmod?: Date): number {
  const depthScore     = Math.max(0, 1 - depth / 10) * 0.4;
  const inlinkScore    = Math.min(inlinks / 20, 1)   * 0.3;
  const freshnessScore = lastmod
    ? Math.max(0, 1 - (Date.now() - lastmod.getTime()) / (30 * 86_400_000)) * 0.3
    : 0.15;  // unknown = medium freshness
  return depthScore + inlinkScore + freshnessScore;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BINARY_EXTENSIONS = /\.(jpg|jpeg|png|gif|webp|svg|ico|pdf|css|js|mjs|woff|woff2|ttf|eot|otf|mp4|mp3|avi|zip|gz|tar|dmg|exe|apk)(\?.*)?$/i;

// Gap 7: Known analytics / tracking query parameters to strip
const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id',
  'fbclid', 'gclid', 'ref', 'mc_cid', 'mc_eid', '_ga', '_gl',
]);

export function stripTrackingParams(url: string): string {
  try {
    const u = new URL(url);
    let changed = false;
    for (const p of TRACKING_PARAMS) {
      if (u.searchParams.has(p)) { u.searchParams.delete(p); changed = true; }
    }
    return changed ? u.href : url;
  } catch { return url; }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeUrl(raw: string, base: string): string | null {
  try {
    if (!raw || raw.startsWith('mailto:') || raw.startsWith('tel:') || raw.startsWith('javascript:')) {
      return null;
    }
    const u = new URL(raw, base);
    // Normalize: lowercase scheme+host, strip fragment
    u.hash = '';
    u.protocol = u.protocol.toLowerCase();
    u.hostname = u.hostname.toLowerCase();
    // Gap 7: strip tracking params
    for (const p of TRACKING_PARAMS) {
      if (u.searchParams.has(p)) u.searchParams.delete(p);
    }
    const href = u.href;
    // Skip binary extensions
    if (BINARY_EXTENSIONS.test(u.pathname)) return null;
    return href;
  } catch {
    return null;
  }
}

function extractPageData(html: string, url: string, status: number): PageData {
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : '';

  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const h1Raw = h1Match
    ? h1Match[1]
        .replace(/<(?:[^>"']|"[^"]*"|'[^']*')*>/g, '')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
        .replace(/&[a-z]+;/gi, '')
        .replace(/\s+/g, ' ')
        .trim()
    : '';
  const h1 = h1Raw.slice(0, 200);

  const canonicalMatch = html.match(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i)
    || html.match(/<link[^>]+href=["']([^"']+)["'][^>]*rel=["']canonical["']/i);
  const canonical = canonicalMatch ? canonicalMatch[1].trim() : null;

  const metaRobotsMatch = html.match(/<meta[^>]+name=["']robots["'][^>]*content=["']([^"']*)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']*)["'][^>]*name=["']robots["']/i);
  const metaRobots = metaRobotsMatch ? metaRobotsMatch[1].trim().toLowerCase() : '';

  const isIndexable = !metaRobots.includes('noindex') && status < 400;

  return { url, status, title, h1, canonical, metaRobots, isIndexable };
}

// Gap 8: Soft 404 detection
const SOFT_404_TITLES = ['not found', '404', 'page not found', 'page does not exist', 'error 404'];

/** Strip HTML tags, normalize whitespace, take first 2000 chars, return simple numeric hash string. */
export function computeContentHash(html: string): string {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 2000);
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  return String(hash >>> 0); // unsigned 32-bit
}

/** Compute similarity ratio between two content hashes' source texts. */
function contentSimilarity(html: string, fingerprintHtml: string): number {
  const a = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 2000);
  const b = fingerprintHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 2000);
  if (a.length === 0 && b.length === 0) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  // Use trigram overlap as similarity metric
  const trigramsOf = (s: string): Set<string> => {
    const t = new Set<string>();
    for (let i = 0; i <= s.length - 3; i++) t.add(s.slice(i, i + 3));
    return t;
  };
  const ta = trigramsOf(a);
  const tb = trigramsOf(b);
  let overlap = 0;
  for (const t of ta) { if (tb.has(t)) overlap++; }
  return overlap / Math.max(ta.size, tb.size);
}

function isSoft404(title: string, html: string, soft404Fingerprint?: { hash: string; html: string } | null): boolean {
  // Fix 3: fingerprint-based check first
  if (soft404Fingerprint) {
    const pageHash = computeContentHash(html);
    if (pageHash === soft404Fingerprint.hash) return true;
    if (contentSimilarity(html, soft404Fingerprint.html) > 0.8) return true;
  }
  // Original title-based fallback
  const t = title.toLowerCase();
  if (!SOFT_404_TITLES.some(p => t.includes(p))) return false;
  const bodyText = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return bodyText.length < 1000;
}

function eraseTag(html: string, tag: string): string {
  const t = tag.toLowerCase();
  const openRe = new RegExp(`<${t}(\\s[^>]*)?>`, 'gi');
  const closeStr = `</${t}>`;
  const parts: string[] = [];
  let pos = 0;
  openRe.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = openRe.exec(html)) !== null) {
    const start = m.index;
    if (start < pos) continue;
    let depth = 1;
    let i = start + m[0].length;
    while (depth > 0 && i < html.length) {
      const nextOpen  = html.toLowerCase().indexOf(`<${t}`, i);
      const nextClose = html.toLowerCase().indexOf(closeStr, i);
      if (nextClose === -1) { i = html.length; break; }
      if (nextOpen !== -1 && nextOpen < nextClose) {
        const tagEnd = html.indexOf('>', nextOpen);
        if (tagEnd !== -1 && html[tagEnd - 1] !== '/') { depth++; i = tagEnd + 1; }
        else i = nextClose + closeStr.length;
      } else { depth--; i = nextClose + closeStr.length; }
    }
    parts.push(html.slice(pos, start));
    pos = i;
    openRe.lastIndex = i;
  }
  parts.push(html.slice(pos));
  return parts.join('');
}

function processWithinParent(html: string, parent: string, child: string): string {
  const t = parent.toLowerCase();
  const openRe = new RegExp(`<${t}(\\s[^>]*)?>`, 'gi');
  const closeStr = `</${t}>`;
  const parts: string[] = [];
  let pos = 0;
  openRe.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = openRe.exec(html)) !== null) {
    const start = m.index;
    if (start < pos) continue;
    let depth = 1, i = start + m[0].length;
    while (depth > 0 && i < html.length) {
      const nextOpen  = html.toLowerCase().indexOf(`<${t}`, i);
      const nextClose = html.toLowerCase().indexOf(closeStr, i);
      if (nextClose === -1) { i = html.length; break; }
      if (nextOpen !== -1 && nextOpen < nextClose) {
        const tagEnd = html.indexOf('>', nextOpen);
        if (tagEnd !== -1 && html[tagEnd - 1] !== '/') { depth++; i = tagEnd + 1; }
        else i = nextClose + closeStr.length;
      } else { depth--; i = nextClose + closeStr.length; }
    }
    const blockInner = html.slice(start, i);
    parts.push(html.slice(pos, start));
    parts.push(eraseTag(blockInner, child));
    pos = i;
    openRe.lastIndex = i;
  }
  parts.push(html.slice(pos));
  return parts.join('');
}

function stripExcludedElements(html: string, selectors: string[]): string {
  let out = html;
  for (const raw of selectors) {
    const sel = raw.trim();
    if (!sel) continue;
    const parts = sel.split(/\s*>\s*|\s+/);
    if (parts.length >= 2) {
      const parent = parts[0].trim();
      const child  = parts[parts.length - 1].trim();
      out = processWithinParent(out, parent, child);
    } else {
      out = eraseTag(out, sel);
    }
  }
  return out;
}

const MAX_INTERNAL_LINKS = 500;

function extractLinks(html: string, pageUrl: string, baseOrigin: string, excludeSelectors: string[] = []): LinkInfo[] {
  const workHtml = excludeSelectors.length ? stripExcludedElements(html, excludeSelectors) : html;
  const links: LinkInfo[] = [];
  const seen = new Set<string>();
  let internalCount = 0;

  // Match <a href="..." ...>...</a>
  const tagRe = /<a\s([^>]*)>[\s\S]*?<\/a>/gi;
  let m: RegExpExecArray | null;

  while ((m = tagRe.exec(workHtml)) !== null) {
    const attrs = m[1];

    const hrefMatch = attrs.match(/href=["']([^"']*?)["']/i);
    if (!hrefMatch) continue;

    const resolved = normalizeUrl(hrefMatch[1], pageUrl);
    if (!resolved) continue;

    if (seen.has(resolved)) continue;
    seen.add(resolved);

    const relMatch = attrs.match(/rel=["']([^"']*?)["']/i);
    const follow = relMatch ? !relMatch[1].toLowerCase().includes('nofollow') : true;

    let type: 'internal' | 'external';
    try {
      type = new URL(resolved).origin === baseOrigin ? 'internal' : 'external';
    } catch {
      continue;
    }

    if (type === 'internal') {
      if (internalCount >= MAX_INTERNAL_LINKS) continue;
      internalCount++;
    }

    links.push({ target: resolved, follow, type });
  }

  return links;
}

// ---------------------------------------------------------------------------
// Sitemap fetcher — Gap 4: also returns lastmod map
// ---------------------------------------------------------------------------

function sameOrigin(a: string, b: string): boolean {
  const strip = (o: string) => o.replace(/^(https?:\/\/)www\./, '$1');
  return strip(a) === strip(b);
}

export async function fetchSitemap(
  baseUrl: string,
  userAgent: string,
  timeout: number,
  sitemapUrlOverride?: string,
  customHeaders?: Record<string, string>,
): Promise<{ urls: Set<string>; lastmod: Map<string, Date> }> {
  const origin = new URL(baseUrl).origin;
  const urls = new Set<string>();
  const lastmod = new Map<string, Date>();

  // Step 1: robots.txt → find first Sitemap: directive (skipped if override provided)
  let sitemapUrl = sitemapUrlOverride ?? `${origin}/sitemap.xml`; // default fallback
  if (!sitemapUrlOverride) {
    try {
      const r = await axios.get(`${origin}/robots.txt`, {
        timeout, maxRedirects: 3,
        headers: { 'User-Agent': userAgent, Accept: 'text/plain', ...customHeaders },
        responseType: 'text', validateStatus: () => true,
      });
      if (r.status === 200 && typeof r.data === 'string') {
        const m = r.data.match(/^Sitemap:\s*(.+)$/im);
        if (m) sitemapUrl = m[1].trim();
      }
    } catch { /* robots.txt unreachable — use default */ }
  }

  // Step 2: fetch one sitemap (or sitemap index) and parse pages into urls/lastmod
  async function fetchOneSitemap(smUrl: string, depth: number): Promise<void> {
    if (depth > 3) return; // guard against infinite index nesting
    let xml: string;
    try {
      const r = await axios.get(smUrl, {
        timeout, maxRedirects: 3,
        headers: { 'User-Agent': userAgent, Accept: 'application/xml,text/xml', ...customHeaders },
        responseType: 'text', validateStatus: () => true,
      });
      if (r.status !== 200 || typeof r.data !== 'string') return;
      xml = r.data;
    } catch { return; }

    // Sitemap index — recurse into child sitemaps
    if (/<sitemapindex/i.test(xml)) {
      const childPromises: Promise<void>[] = [];
      for (const m of xml.matchAll(/<sitemap>[\s\S]*?<loc>\s*([^<]+)\s*<\/loc>[\s\S]*?<\/sitemap>/gi)) {
        const childUrl = normalizeUrl(m[1].trim(), smUrl);
        if (childUrl) childPromises.push(fetchOneSitemap(childUrl, depth + 1));
      }
      await Promise.all(childPromises);
      return;
    }

    // Regular sitemap — parse <url> blocks
    for (const urlBlock of xml.matchAll(/<url>([\s\S]*?)<\/url>/gi)) {
      const locM     = urlBlock[1].match(/<loc>\s*([^<]+)\s*<\/loc>/i);
      const lastmodM = urlBlock[1].match(/<lastmod>\s*([^<]+)\s*<\/lastmod>/i);
      if (!locM) continue;
      const loc = normalizeUrl(locM[1].trim(), smUrl);
      if (loc && sameOrigin(new URL(loc).origin, origin)) {
        urls.add(loc);
        if (lastmodM) {
          const d = new Date(lastmodM[1].trim());
          if (!isNaN(d.getTime())) lastmod.set(loc, d);
        }
      }
    }
  }

  await fetchOneSitemap(sitemapUrl, 0);

  return { urls, lastmod };
}

// ---------------------------------------------------------------------------
// Crawler
// ---------------------------------------------------------------------------

const GOOGLEBOT_UA = 'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

// Fix 4: Checkpoint types
interface CheckpointData {
  visited: string[];
  queueItems: QueueItem[];
  discoveredInlinks: Record<string, number>;
  crawledCount: number;
  backpressureMultiplier: number;
  errors: Record<string, string>;
}

/** Fix 2: Parse Retry-After header (seconds or HTTP-date), cap at 60s. */
function parseRetryAfter(value: string | undefined): number | null {
  if (!value) return null;
  const secs = Number(value);
  if (!isNaN(secs)) return Math.min(Math.max(secs, 0), 60) * 1000;
  const date = new Date(value);
  if (!isNaN(date.getTime())) {
    const ms = date.getTime() - Date.now();
    return Math.min(Math.max(ms, 0), 60000);
  }
  return null;
}

export class Explorer {
  private readonly baseUrl: string;
  private readonly baseOrigin: string;
  private readonly options: Required<Omit<ExplorerOptions, 'sitemapUrl' | 'storeHtml' | 'crawlSitemap' | 'excludeSelectors' | 'outputFile' | 'maxHtmlBytes' | 'maxRedirects' | 'googlebot' | 'maxPages' | 'delayExplicit' | 'resume' | 'checkpointInterval' | 'headers'>> & { sitemapUrl?: string; storeHtml?: boolean; crawlSitemap?: boolean; excludeSelectors?: string[]; outputFile?: string; maxHtmlBytes?: number; maxRedirects?: number; googlebot?: boolean; maxPages?: number; delayExplicit?: boolean; resume?: boolean; checkpointInterval?: number; headers?: Record<string, string> };

  constructor(baseUrl: string, options: ExplorerOptions = {}) {
    this.baseUrl = baseUrl;
    this.baseOrigin = new URL(baseUrl).origin;
    this.options = {
      maxPages: options.maxPages,  // undefined = defer to sitemap size when crawlSitemap is true
      maxDepth: options.maxDepth ?? 10,
      delay: options.delay ?? 500,
      timeout: options.timeout ?? 15000,
      userAgent: options.userAgent ?? (options.googlebot ? GOOGLEBOT_UA : 'SGNL-LinkExplorer/1.0 (compatible; site-auditor)'),
      sitemapUrl: options.sitemapUrl,
      storeHtml: options.storeHtml,
      crawlSitemap: options.crawlSitemap,
      excludeSelectors: options.excludeSelectors,
      outputFile: options.outputFile,
      maxHtmlBytes: options.maxHtmlBytes,
      maxRedirects: options.maxRedirects,
      googlebot: options.googlebot,
      delayExplicit: options.delayExplicit,
      resume: options.resume,
      checkpointInterval: options.checkpointInterval,
      headers: options.headers,
    };
  }

  async crawl(
    onProgress?: (count: number, url: string, total: number) => void,
    onSitemapFetched?: (size: number) => void,
  ): Promise<ExplorerResult> {
    const pages = new Map<string, PageData>();
    const graph = new Map<string, LinkInfo[]>();
    const errors = new Map<string, string>();
    const visited = new Set<string>();
    const depths = new Map<string, number>();
    const robotsBlocked = new Set<string>();

    const { urls: sitemapUrls, lastmod: sitemapLastmod } = await fetchSitemap(
      this.baseUrl, this.options.userAgent, this.options.timeout, this.options.sitemapUrl, this.options.headers
    );
    onSitemapFetched?.(sitemapUrls.size);

    // Gap 3: fetch robots.txt when in googlebot mode
    let robotsRules: RobotsRules | null = null;
    if (this.options.googlebot) {
      robotsRules = await fetchRobotsTxt(
        this.baseOrigin, this.options.userAgent, this.options.timeout, this.options.headers
      );
    }

    // Gap 5: replace FIFO array with priority queue
    const queue = new PriorityQueue();
    const discoveredInlinks = new Map<string, number>();

    // Fix 2: backpressure multiplier — starts at 1.0, increases on 429s
    let backpressureMultiplier = 1.0;

    // Fix 4: checkpoint path
    const outputFile = this.options.outputFile;
    const checkpointPath = outputFile ? outputFile + '.checkpoint.json' : null;
    const checkpointInterval = this.options.checkpointInterval ?? 50;

    let crawledCount = 0;

    // Fix 4: resume from checkpoint
    let resumed = false;
    if (this.options.resume && checkpointPath && fs.existsSync(checkpointPath)) {
      try {
        const raw = fs.readFileSync(checkpointPath, 'utf-8');
        const cp: CheckpointData = JSON.parse(raw);
        for (const u of cp.visited) visited.add(u);
        for (const item of cp.queueItems) queue.push(item);
        for (const [k, v] of Object.entries(cp.discoveredInlinks)) discoveredInlinks.set(k, v);
        for (const [k, v] of Object.entries(cp.errors)) errors.set(k, v);
        crawledCount = cp.crawledCount;
        backpressureMultiplier = cp.backpressureMultiplier ?? 1.0;
        resumed = true;
      } catch {
        // Corrupt checkpoint — start fresh
      }
    }

    if (!resumed) {
      queue.push({
        url: this.baseUrl,
        depth: 0,
        score: 100, // Always crawl homepage first — must outrank all sitemap URLs
      });
    }

    // Explicit --max-pages wins; otherwise use sitemap size (fallback: 300 if no sitemap)
    const effectiveMaxPages = this.options.maxPages ?? (sitemapUrls.size > 0 ? sitemapUrls.size : 300);

    // Always seed the queue with sitemap URLs (they inform max-pages and coverage)
    if (sitemapUrls.size > 0) {
      for (const u of sitemapUrls) {
        if (!visited.has(u) && !queue.has(u)) {
          queue.push({ url: u, depth: 0, score: scoreUrl(0, 0, sitemapLastmod.get(u)) });
        }
      }
    }

    // Streaming mode: open write stream if outputFile is set
    const writeStream = outputFile
      ? fs.createWriteStream(outputFile, resumed ? { flags: 'a' } : undefined)
      : null;

    // Gap 6: adaptive crawl rate — rolling window of last 20 response times
    const responseTimes: number[] = [];

    // Gap 2: effective max redirects (default 2, matching Googlebot)
    const maxRedirects = this.options.maxRedirects ?? 2;

    // Gap 1: effective HTML truncation limit (default 2MB)
    const maxHtmlBytes = this.options.maxHtmlBytes ?? 2 * 1024 * 1024;

    // Fix 3: soft 404 fingerprint — probe a known-bad URL early
    let soft404Fingerprint: { hash: string; html: string } | null = null;
    try {
      const probeUrl = `${this.baseOrigin}/sgnl-definitely-not-a-real-page-404-test`;
      const probeResp = await axios.get(probeUrl, {
        timeout: this.options.timeout,
        maxRedirects,
        headers: { 'User-Agent': this.options.userAgent, Accept: 'text/html', ...this.options.headers },
        responseType: 'text',
        validateStatus: () => true,
      });
      if (probeResp.status === 200 && typeof probeResp.data === 'string') {
        const probeHtml = probeResp.data;
        soft404Fingerprint = {
          hash: computeContentHash(probeHtml),
          html: probeHtml,
        };
      }
    } catch {
      // Probe failed — no fingerprint, rely on title-based detection
    }

    // Fix 4: track pages since last checkpoint
    let pagesSinceCheckpoint = 0;

    while (queue.length > 0 && crawledCount < effectiveMaxPages) {
      const item = queue.shift()!;
      const { url, depth } = item;

      if (visited.has(url)) continue;

      // Gap 3: skip URLs blocked by robots.txt
      if (robotsRules && !isAllowedByRobots(url, robotsRules)) {
        robotsBlocked.add(url);
        continue;
      }

      visited.add(url);
      if (!writeStream) depths.set(url, depth);

      try {
        // Fix 2: retry loop for 429/503 with backpressure
        let retries = 0;
        const maxRetries = 3;
        let response;
        let elapsed: number;

        while (true) {
          const t0 = Date.now();
          response = await axios.get(url, {
            timeout: this.options.timeout,
            maxRedirects,  // Gap 2
            headers: {
              'User-Agent': this.options.userAgent,
              'Accept': 'text/html,application/xhtml+xml',
              ...this.options.headers,
            },
            responseType: 'text',
            // Validate status so we can record 4xx/5xx without throwing
            validateStatus: () => true,
          });
          elapsed = Date.now() - t0;

          if ((response.status === 429 || response.status === 503) && retries < maxRetries) {
            retries++;
            // Do NOT count 429/503 in responseTimes — they'd skew the adaptive rate
            const retryAfterVal = response.headers?.['retry-after'];
            const retryMs = parseRetryAfter(typeof retryAfterVal === 'string' ? retryAfterVal : undefined);
            const backoffMs = retryMs ?? Math.min(5000 * Math.pow(2, retries - 1), 20000);
            await sleep(backoffMs);
            // Fix 2: 429 increases global backpressure
            if (response.status === 429) {
              backpressureMultiplier = Math.min(backpressureMultiplier * 1.5, 10);
            }
            continue;
          }
          break;
        }

        // Only track successful/non-retryable response times
        if (response.status !== 429 && response.status !== 503) {
          responseTimes.push(elapsed!);
          if (responseTimes.length > 20) responseTimes.shift();
          // Fix 2: decay backpressure slowly on successful requests
          if (backpressureMultiplier > 1.0) {
            backpressureMultiplier = Math.max(1.0, backpressureMultiplier * 0.95);
          }
        }

        // Gap 1: truncate HTML at maxHtmlBytes
        let html: string = typeof response.data === 'string' ? response.data : '';
        if (html.length > maxHtmlBytes) html = html.slice(0, maxHtmlBytes);

        const pageData = extractPageData(html, url, response.status);

        // Gap 8: soft 404 detection — treat as error, skip link extraction
        if (isSoft404(pageData.title, html, soft404Fingerprint)) {
          errors.set(url, 'Soft 404');
          crawledCount++;
          pagesSinceCheckpoint++;
          onProgress?.(crawledCount, url, effectiveMaxPages);
          if (queue.length > 0) {
            await sleep(this._effectiveDelay(responseTimes, robotsRules, backpressureMultiplier));
          }
          continue;
        }

        if (this.options.storeHtml) pageData.rawHtml = html;

        const links = extractLinks(html, url, this.baseOrigin, this.options.excludeSelectors ?? []);

        if (writeStream) {
          writeStream.write(JSON.stringify({
            url, status: pageData.status, title: pageData.title, h1: pageData.h1,
            canonical: pageData.canonical, metaRobots: pageData.metaRobots,
            isIndexable: pageData.isIndexable, crawlDepth: depth,
            links: links.map(l => ({ target: l.target, follow: l.follow, type: l.type })),
          }) + '\n');
        } else {
          pages.set(url, pageData);
          graph.set(url, links);
          depths.set(url, depth);
        }

        crawledCount++;
        pagesSinceCheckpoint++;
        onProgress?.(crawledCount, url, effectiveMaxPages);

        // Fix 4: write checkpoint every N pages in streaming mode
        if (checkpointPath && writeStream && pagesSinceCheckpoint >= checkpointInterval) {
          const cpData: CheckpointData = {
            visited: Array.from(visited),
            queueItems: queue.drain(),
            discoveredInlinks: Object.fromEntries(discoveredInlinks),
            crawledCount,
            backpressureMultiplier,
            errors: Object.fromEntries(errors),
          };
          // drain() clears urlSet, re-push items
          for (const qi of cpData.queueItems) queue.push(qi);
          fs.writeFileSync(checkpointPath, JSON.stringify(cpData));
          pagesSinceCheckpoint = 0;
        }

        if (depth < this.options.maxDepth) {
          for (const link of links) {
            if (
              link.type === 'internal' &&
              !visited.has(link.target) &&
              crawledCount + queue.length < effectiveMaxPages
            ) {
              // Gap 3: skip robots-disallowed URLs before queuing
              if (robotsRules && !isAllowedByRobots(link.target, robotsRules)) continue;

              // Gap 5: track inlinks for scoring
              discoveredInlinks.set(link.target, (discoveredInlinks.get(link.target) ?? 0) + 1);

              const newScore = scoreUrl(
                depth + 1,
                discoveredInlinks.get(link.target) ?? 0,
                sitemapLastmod.get(link.target)
              );

              if (queue.has(link.target)) {
                // Fix 1: re-score if inlinks increased priority
                queue.rescoreIfPresent(link.target, newScore);
              } else {
                queue.push({
                  url: link.target,
                  depth: depth + 1,
                  score: newScore,
                });
              }
            }
          }
        }
      } catch (err: unknown) {
        const msg = (err instanceof Error ? err.message : undefined) ?? 'Unknown error';
        errors.set(url, msg);
        crawledCount++;
        pagesSinceCheckpoint++;
        onProgress?.(crawledCount, url, effectiveMaxPages);
      }

      // Rate limiting — sleep between requests (skip on last item)
      if (queue.length > 0) {
        await sleep(this._effectiveDelay(responseTimes, robotsRules, backpressureMultiplier));
      }
    }

    const queueRemainder = new Set(queue.drain().map(item => item.url));

    if (writeStream) {
      await new Promise<void>(resolve => writeStream.end(resolve));
      // Fix 4: delete checkpoint on clean finish
      if (checkpointPath && fs.existsSync(checkpointPath)) {
        fs.unlinkSync(checkpointPath);
      }
      return {
        baseUrl: this.baseUrl,
        pages: new Map(),
        graph: new Map(),
        errors,
        sitemapUrls,
        depths: new Map(),
        streamedPages: crawledCount,
        sitemapLastmod,
        crawledUrls: visited,
        robotsBlocked,
        queueRemainder,
      };
    }

    return { baseUrl: this.baseUrl, pages, graph, errors, sitemapUrls, depths, sitemapLastmod, crawledUrls: visited, robotsBlocked, queueRemainder };
  }

  // Gap 6: compute adaptive delay based on rolling avg response time
  private _effectiveDelay(responseTimes: number[], robotsRules: RobotsRules | null, backpressureMultiplier: number): number {
    let effective = this.options.delay;

    if (responseTimes.length > 0) {
      const avg = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
      if (avg > 5000)      effective = Math.max(this.options.delay, 2000);
      else if (avg > 2000) effective = Math.max(this.options.delay, 1000);
      else if (avg < 500)  effective = Math.min(this.options.delay, 200);
    }

    // robots.txt Crawl-delay is a hard minimum in googlebot mode (unless user explicitly passed --delay)
    if (this.options.googlebot && !this.options.delayExplicit && robotsRules?.crawlDelay != null) {
      effective = Math.max(effective, robotsRules.crawlDelay);
    }

    // Fix 2: apply backpressure multiplier
    effective = Math.round(effective * backpressureMultiplier);

    return effective;
  }
}
