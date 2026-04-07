import axios from 'axios';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CrawlOptions {
  maxDepth?: number;
  maxPages?: number;
  includePatterns?: string[];
  excludePatterns?: string[];
}

export interface CrawledPage {
  url: string;
  depth: number;
  status: number;
  links: string[];
}

export interface CrawlResult {
  root: string;
  pages: CrawledPage[];
  external_links: string[];
  errors: Array<{ url: string; message: string }>;
  crawl_config: {
    depth: number;
    pages_crawled: number;
    pages_limit: number;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractLinks(html: string, base: string): { internal: string[]; external: string[] } {
  const internal: string[] = [];
  const external: string[] = [];
  const baseOrigin = new URL(base).origin;

  const hrefRe = /href=["']([^"'#?][^"']*?)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = hrefRe.exec(html)) !== null) {
    const raw = m[1].trim();
    if (!raw || raw.startsWith('mailto:') || raw.startsWith('tel:') || raw.startsWith('javascript:')) continue;
    try {
      const resolved = new URL(raw, base).href.split('#')[0].split('?')[0];
      const parsed = new URL(resolved);
      if (parsed.origin === baseOrigin) {
        internal.push(resolved);
      } else if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        external.push(resolved);
      }
    } catch {
      // skip malformed
    }
  }

  return {
    internal: [...new Set(internal)],
    external: [...new Set(external)],
  };
}

function matchesPattern(url: string, pattern: string): boolean {
  const path = new URL(url).pathname;
  // Simple glob: * matches any segment characters
  const regex = new RegExp('^' + pattern.replace(/\*/g, '[^/]*').replace(/\//g, '\\/') + '');
  return regex.test(path);
}

function isAllowed(url: string, include?: string[], exclude?: string[]): boolean {
  if (exclude?.some(p => matchesPattern(url, p))) return false;
  if (include?.length && !include.some(p => matchesPattern(url, p))) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Main crawler
// ---------------------------------------------------------------------------

export async function crawlSite(startUrl: string, options: CrawlOptions = {}): Promise<CrawlResult> {
  const {
    maxDepth = 3,
    maxPages = 100,
    includePatterns,
    excludePatterns,
  } = options;

  const visited = new Set<string>();
  const queue: Array<{ url: string; depth: number }> = [{ url: startUrl, depth: 0 }];
  const pages: CrawledPage[] = [];
  const externalSet = new Set<string>();
  const errors: Array<{ url: string; message: string }> = [];

  while (queue.length > 0 && pages.length < maxPages) {
    const item = queue.shift()!;
    const { url, depth } = item;

    if (visited.has(url)) continue;
    visited.add(url);

    if (!isAllowed(url, includePatterns, excludePatterns)) continue;

    try {
      const response = await axios.get(url, {
        timeout: 10000,
        maxRedirects: 5,
        headers: { 'User-Agent': 'SGNL-Crawler/1.0' },
        responseType: 'text',
      });

      const html: string = typeof response.data === 'string' ? response.data : '';
      const { internal, external } = extractLinks(html, url);

      for (const ext of external) externalSet.add(ext);

      pages.push({ url, depth, status: response.status, links: internal });

      if (depth < maxDepth) {
        for (const link of internal) {
          if (!visited.has(link) && pages.length + queue.length < maxPages) {
            queue.push({ url: link, depth: depth + 1 });
          }
        }
      }
    } catch (err: any) {
      const status = err?.response?.status;
      errors.push({
        url,
        message: status ? `HTTP ${status}` : (err?.message ?? 'Unknown error'),
      });
    }
  }

  return {
    root: startUrl,
    pages,
    external_links: [...externalSet],
    errors,
    crawl_config: {
      depth: maxDepth,
      pages_crawled: pages.length,
      pages_limit: maxPages,
    },
  };
}

// ---------------------------------------------------------------------------
// ASCII tree renderer
// ---------------------------------------------------------------------------

export function formatTreeAsAscii(result: CrawlResult, rootUrl: string): string {
  const rootOrigin = new URL(rootUrl).origin;

  // Build adjacency map from crawled pages
  const childrenOf = new Map<string, string[]>();
  for (const page of result.pages) {
    if (!childrenOf.has(page.url)) childrenOf.set(page.url, []);
    for (const link of page.links) {
      if (result.pages.some(p => p.url === link)) {
        childrenOf.get(page.url)!.push(link);
      }
    }
  }

  const lines: string[] = [];
  const seen = new Set<string>();

  function render(url: string, prefix: string, isLast: boolean): void {
    if (seen.has(url)) {
      lines.push(`${prefix}${isLast ? '└── ' : '├── '}${url.replace(rootOrigin, '')} (↩ already shown)`);
      return;
    }
    seen.add(url);
    const label = url.replace(rootOrigin, '') || '/';
    lines.push(`${prefix}${isLast ? '└── ' : '├── '}${label}`);
    const children = childrenOf.get(url) ?? [];
    const childPrefix = prefix + (isLast ? '    ' : '│   ');
    children.forEach((child, i) => render(child, childPrefix, i === children.length - 1));
  }

  lines.push(rootUrl);
  const rootChildren = childrenOf.get(rootUrl) ?? [];
  rootChildren.forEach((child, i) => render(child, '', i === rootChildren.length - 1));

  return lines.join('\n');
}
