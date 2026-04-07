# `sgnl explorer` — Site Crawler & Link Graph Visualization

Site-level crawl tool that simulates Googlebot-like discovery to map site
structure, compute PageRank, detect content clusters, and generate
interactive PixiJS visualizations. Unlike the other commands (`technical`,
`structure`, `robots`, `performance`, `schema`, `content`, `gsc`) which
operate on a single URL or a GSC property, **explorer crawls an entire
domain** and produces a structural model of the site as a link graph.

The `explorer` command group contains 13 subcommands:

1. **`crawl`** — BFS crawl with priority queue, generates visualization
2. **`inspect`** — Show all data for a single page node
3. **`links`** — Inbound and outbound links for a page
4. **`list-issues`** — Pages with structural issues (orphans, dead-ends, errors)
5. **`top-pages`** — Top pages by PageRank
6. **`clusters`** — Content clusters with page counts
7. **`cluster`** — Pages in a specific cluster
8. **`depth-map`** — Pages grouped by crawl depth
9. **`external`** — Top external domains and linking pages
10. **`unranked`** — Pages not ranking in GSC
11. **`canonicals`** — Pages with canonical mismatches or missing canonicals
12. **`robots-blocked`** — Pages blocked by robots.txt during crawl
13. **`compare`** — Diff two crawl runs (new/lost pages, PageRank movers, status changes)

---

## Contents

- [When to use it](#when-to-use-it)
- [Subcommands](#subcommands)
  - [`crawl`](#sgnl-explorer-crawl-url)
  - [`inspect`](#sgnl-explorer-inspect-url)
  - [`links`](#sgnl-explorer-links-url)
  - [`list-issues`](#sgnl-explorer-list-issues)
  - [`top-pages`](#sgnl-explorer-top-pages)
  - [`clusters`](#sgnl-explorer-clusters)
  - [`cluster`](#sgnl-explorer-cluster-segment)
  - [`depth-map`](#sgnl-explorer-depth-map)
  - [`external`](#sgnl-explorer-external)
  - [`unranked`](#sgnl-explorer-unranked)
  - [`canonicals`](#sgnl-explorer-canonicals)
  - [`robots-blocked`](#sgnl-explorer-robots-blocked)
  - [`compare`](#sgnl-explorer-compare)
- [Crawl features](#crawl-features)
- [Query options](#query-options)
- [Output formats](#output-formats)
- [Run directory layout](#run-directory-layout)
- [Compact wire format (v3)](#compact-wire-format-v3)
- [GSC enrichment](#gsc-enrichment)
- [Known limitations](#known-limitations)
- [Implementation](#implementation)
- [See also](#see-also)

---

## When to use it

Use `sgnl explorer` when:

- You need **site-wide structural analysis** — orphan pages, dead-ends, deep pages, crawl depth distribution, content clusters.
- You want an **interactive link graph visualization** showing how pages connect, coloured by community and sized by PageRank.
- You're auditing **internal linking** — which pages have authority (PageRank), which are orphaned, which are buried too deep.
- You need to **compare two crawl runs** to track structural changes over time (new/lost pages, PageRank movers, status changes).
- You want to find pages **not ranking in GSC** despite being crawled, or pages that rank but have no internal links pointing to them.
- You need a **canonical audit** across the entire site — mismatches and missing tags at scale.
- You want to identify pages **blocked by robots.txt** that the crawler encountered.

Use `sgnl analyze` instead when you need per-page content/performance/technical analysis on a single URL.

---

## Subcommands

### `sgnl explorer crawl <url>`

Crawl a site starting from `<url>`, build a link graph, compute PageRank and content clusters, and generate an interactive HTML visualization.

```
sgnl explorer crawl <url> [flags]
```

| Flag | Type | Default | Description |
|---|---|---|---|
| `--max-pages <n>` | number | auto from sitemap, or 300 | Maximum pages to crawl. If omitted, uses sitemap URL count. |
| `--delay <ms>` | number | `500` | Delay between HTTP requests in milliseconds. |
| `--depth <n>` | number | `10` | Maximum crawl depth from the start URL. |
| `--quiet` | boolean | `false` | Suppress progress output to stderr. |
| `--sitemap-url <url>` | string | — | Use this sitemap directly instead of discovering via `robots.txt`. |
| `--crawl-sitemap` | boolean | `false` | Seed the crawl queue with all URLs from the sitemap. Without this, only the start URL seeds the queue (sitemap URLs still inform max-pages). |
| `--exclude-el <selectors>` | string | — | Comma-separated CSS selectors — links inside matching elements are ignored. Example: `"header>nav,footer"`. |
| `--googlebot` | boolean | `false` | Use Googlebot mobile User-Agent and respect `robots.txt` Disallow and Crawl-delay directives. |
| `--page-stats` | boolean | `false` | Run Python content analysis per page (adds DOM, readability, schema data). Slower. |
| `--resume` | boolean | `false` | Resume an interrupted crawl from the last checkpoint. |

**Examples:**

```bash
# Basic crawl with defaults
sgnl explorer crawl https://example.com

# Crawl up to 1000 pages, faster
sgnl explorer crawl https://example.com --max-pages 1000 --delay 100

# Crawl only what's in the sitemap
sgnl explorer crawl https://example.com --crawl-sitemap

# Simulate Googlebot, exclude nav links
sgnl explorer crawl https://example.com --googlebot --exclude-el "header>nav,footer>nav"

# Resume an interrupted crawl
sgnl explorer crawl https://example.com --resume

# Use a specific sitemap, shallow crawl
sgnl explorer crawl https://example.com --sitemap-url https://example.com/blog-sitemap.xml --depth 3
```

**Example output:**

```
Link Explorer — https://example.com
Settings: max-pages=auto (sitemap size), delay=500ms, depth=10

  Fetching robots.txt and sitemap…
  Found 342 URLs in sitemap.
  [342/342] https://example.com/blog/last-post…

  Analyzing with Python…

  Summary
  Pages crawled : 342
  Errors        : 3
  Sitemap URLs  : 342

  Saved to: runs/example_com/2026-03-26_14-30/explorer/index.html
```

**Requires:** Python 3.8+ (for graph analysis phase). GSC data is automatically included if authenticated.

---

### `sgnl explorer inspect <url>`

Show all stored data for a specific page node from a previous crawl.

```
sgnl explorer inspect <url> [flags]
```

| Flag | Type | Default | Description |
|---|---|---|---|
| `--run-dir <path>` | string | — | Path to a specific run directory containing `compact.json`. |
| `--domain <domain>` | string | — | Find the latest run for this domain. |
| `--json` | boolean | `false` | Output as JSON instead of formatted text. |

**Examples:**

```bash
sgnl explorer inspect https://example.com/blog/my-post
sgnl explorer inspect https://example.com/about --domain example.com
sgnl explorer inspect https://example.com/ --json
```

**Example output:**

```
URL:          https://example.com/blog/my-post
Title:        How to Optimize Core Web Vitals
Status:       200
Type:         normal
Inlinks:      12
Outlinks:     8
External:     3
Crawl Depth:  2
Link Depth:   2
PageRank:     0.0234
Indexable:    Yes
In Sitemap:   Yes
Dead End:     No
H1:           How to Optimize Core Web Vitals
Canonical:    https://example.com/blog/my-post
GSC Position: 4.2
Cluster:      /blog (#3)
```

---

### `sgnl explorer links <url>`

Show all inbound and outbound internal links for a page from a previous crawl.

```
sgnl explorer links <url> [flags]
```

Accepts `--run-dir`, `--domain`, and `--json` (same as `inspect`).

**Examples:**

```bash
sgnl explorer links https://example.com/blog/my-post
sgnl explorer links https://example.com/ --json
```

**Example output:**

```
Outgoing (8):
  → https://example.com/blog/post-2
  → https://example.com/about
  → https://example.com/contact (nofollow)

Incoming (12):
  ← https://example.com/
  ← https://example.com/blog
  ← https://example.com/blog/related-post
```

---

### `sgnl explorer list-issues`

List pages with structural issues from a previous crawl.

```
sgnl explorer list-issues [flags]
```

| Flag | Type | Default | Description |
|---|---|---|---|
| `--type <type>` | string | — | Filter by issue type: `orphans`, `dead-ends`, `deep`, `errors`, `no-sitemap`, `external`. |
| `--run-dir`, `--domain`, `--json` | — | — | Same as other query commands. |

**Examples:**

```bash
sgnl explorer list-issues
sgnl explorer list-issues --type orphans
sgnl explorer list-issues --domain example.com --json
```

**Example output:**

```
Orphan Pages (3):
  https://example.com/old-landing-page
  https://example.com/test-page
  https://example.com/unlinked-post

Dead Ends (5):
  https://example.com/about/careers
  https://example.com/legal/terms
  ...

Deep Pages (>3 clicks) (12):
  https://example.com/blog/archive/2022/jan/post
  ...
```

**Issue types:**

| Type | Meaning |
|---|---|
| `orphans` | Pages with zero inbound internal links |
| `dead-ends` | Pages with zero outbound internal links |
| `deep` | Pages more than 3 clicks from the start URL |
| `errors` | Pages returning 4xx or 5xx status codes |
| `no-sitemap` | Crawled pages not found in the sitemap |
| `external` | Pages with an excessive number of external links |

---

### `sgnl explorer top-pages`

Show the highest-authority pages by PageRank from a previous crawl.

```
sgnl explorer top-pages [flags]
```

| Flag | Type | Default | Description |
|---|---|---|---|
| `-l, --limit <n>` | number | `10` | Number of pages to show. |
| `--run-dir`, `--domain`, `--json` | — | — | Same as other query commands. |

**Examples:**

```bash
sgnl explorer top-pages
sgnl explorer top-pages --limit 25 --json
```

**Example output:**

```
#   PageRank  Inlinks  URL
──────────────────────────────────────────────────────────────────────
  1     0.1247       48  https://example.com/
  2     0.0534       23  https://example.com/blog
  3     0.0312       18  https://example.com/products
```

---

### `sgnl explorer clusters`

List detected content clusters (communities) with page counts.

```
sgnl explorer clusters [flags]
```

Accepts `--run-dir`, `--domain`, and `--json`.

**Examples:**

```bash
sgnl explorer clusters
sgnl explorer clusters --domain example.com --json
```

**Example output:**

```
#   Segment              Pages
─────────────────────────────────────────────
  1   /blog                   48
  2   /products               23
  3   /docs                   15
  4   /about                   4
```

Only clusters with 2 or more pages are shown.

---

### `sgnl explorer cluster <segment>`

List all pages in a specific content cluster, sorted by PageRank.

```
sgnl explorer cluster <segment> [flags]
```

| Argument | Required | Description |
|---|---|---|
| `<segment>` | Yes | Cluster segment name, e.g. `/blog` or `blog` (leading slash is optional). |

Accepts `--run-dir`, `--domain`, and `--json`.

**Examples:**

```bash
sgnl explorer cluster /blog
sgnl explorer cluster blog
sgnl explorer cluster /docs --json
```

**Example output:**

```
Cluster: /blog (48 pages)
  https://example.com/blog/post-1   PR:0.0312  In:12  Out:8
  https://example.com/blog/post-2   PR:0.0287  In:10  Out:6
  ...
```

---

### `sgnl explorer depth-map`

Show pages grouped by crawl depth (clicks from start URL).

```
sgnl explorer depth-map [flags]
```

Accepts `--run-dir`, `--domain`, and `--json`.

**Examples:**

```bash
sgnl explorer depth-map
sgnl explorer depth-map --json
```

**Example output:**

```
Depth 0 (1 pages):
  https://example.com/

Depth 1 (8 pages):
  https://example.com/blog
  https://example.com/about
  ...

Depth 2 (45 pages):
  https://example.com/blog/post-1
  ...
```

Pages are capped at 30 per depth level in terminal output (all shown in JSON).

---

### `sgnl explorer external`

Show the most-linked-to external domains and which internal pages link to them.

```
sgnl explorer external [flags]
```

| Flag | Type | Default | Description |
|---|---|---|---|
| `-l, --limit <n>` | number | `10` | Number of external domains to show. |
| `--run-dir`, `--domain`, `--json` | — | — | Same as other query commands. |

**Examples:**

```bash
sgnl explorer external
sgnl explorer external --limit 20 --json
```

**Example output:**

```
#   Domain                     Links  Pages linking out
──────────────────────────────────────────────────────────────────────
  1   fonts.googleapis.com          34  /, /blog, /about +31
  2   analytics.google.com          28  /, /blog, /products +25
  3   cdn.example.com               12  /blog/post-1, /blog/post-2 +10
```

---

### `sgnl explorer unranked`

Show pages that are not ranking in Google Search Console. Requires GSC data in the crawl run.

```
sgnl explorer unranked [flags]
```

Accepts `--run-dir`, `--domain`, and `--json`.

**Examples:**

```bash
sgnl explorer unranked
sgnl explorer unranked --domain example.com --json
```

**Example output:**

```
Not Ranked (42 pages):
  https://example.com/old-page    Inlinks:5  Depth:2
  https://example.com/draft       Inlinks:1  Depth:4
  ...

Ranked but Orphaned — add internal links! (2):
  https://example.com/popular-post    Pos:3.2

Ranked but Deep (>3 clicks) — flatten! (5):
  https://example.com/archive/old-post    Pos:8.4  Depth:5
```

---

### `sgnl explorer canonicals`

Show pages where the canonical URL differs from the page URL, or where the canonical tag is missing entirely.

```
sgnl explorer canonicals [flags]
```

Accepts `--run-dir`, `--domain`, and `--json`.

**Examples:**

```bash
sgnl explorer canonicals
sgnl explorer canonicals --domain example.com --json
```

**Example output:**

```
Canonical Mismatch (4):
  Page URL                                                    Canonical URL
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  https://example.com/blog/old-slug                           https://example.com/blog/new-slug
  https://example.com/products?ref=nav                        https://example.com/products

Missing Canonical (2):
  https://example.com/landing/promo
  https://example.com/test-page

Summary: 290 match, 4 mismatch, 2 missing
```

---

### `sgnl explorer robots-blocked`

Show pages that were blocked by robots.txt during the crawl. Only available when the crawl was run with `--googlebot`.

```
sgnl explorer robots-blocked [flags]
```

Accepts `--run-dir`, `--domain`, and `--json`.

**Examples:**

```bash
sgnl explorer robots-blocked
sgnl explorer robots-blocked --domain example.com --json
```

**Example output:**

```
Robots-Blocked URLs (7):
  https://example.com/admin/dashboard
  https://example.com/api/internal
  https://example.com/tmp/cache
  ...
```

---

### `sgnl explorer compare`

Diff two crawl runs to see new/lost pages, PageRank movers, depth changes, and status changes.

```
sgnl explorer compare [flags]
```

| Flag | Type | Default | Description |
|---|---|---|---|
| `--with <path>` | string | — | Path to the second run directory to compare against. |
| `--domain <domain>` | string | — | Auto-compare the two most recent runs for this domain. |
| `--run-dir`, `--json` | — | — | Same as other query commands. |

**Examples:**

```bash
# Auto-compare two most recent runs for a domain
sgnl explorer compare --domain example.com

# Compare a specific run against another
sgnl explorer compare --run-dir runs/example_com/2026-04-01_10-00 --with runs/example_com/2026-03-15_10-00

# JSON output
sgnl explorer compare --domain example.com --json
```

**Example output:**

```
Compare: runs/example_com/2026-03-15_10-00
     vs: runs/example_com/2026-04-01_10-00

  Pages: 312 -> 328 (+16)
  Avg PageRank: 0.0032 -> 0.0030

New Pages (12):
  + https://example.com/blog/new-post-1
  + https://example.com/blog/new-post-2
  ...

Lost Pages (4):
  - https://example.com/old-promo
  ...

Status Changes (1):
  https://example.com/removed-page  200 -> 404

Top PageRank Movers (8 changed):
  https://example.com/blog  0.0534 -> 0.0612 (+0.0078)
  https://example.com/about  0.0287 -> 0.0201 (-0.0086)
```

---

## Crawl features

The crawler in `src/explorer/crawler.ts` implements several features beyond a naive BFS:

### Priority queue

URLs are not crawled in simple FIFO order. A binary max-heap scores each URL using three weighted signals:

- **Depth** (40%) — shallower pages score higher.
- **Inlinks** (30%) — pages with more discovered inbound links score higher.
- **Sitemap freshness** (30%) — pages with a recent `<lastmod>` in the sitemap score higher. Unknown freshness gets a medium default.

### Adaptive rate limiting

A rolling window of the last 20 response times tracks server health. The base delay between requests is the value of `--delay` (default 500 ms), adjusted by the adaptive rate limiter based on observed response times.

### 429/503 backpressure

When the server returns HTTP 429 (Too Many Requests) or 503 (Service Unavailable):

1. The `Retry-After` header is parsed (supports both seconds and HTTP-date formats, capped at 60 s).
2. On retry, a **backpressure multiplier** increases (1.5x per retry, up to 3 retries).
3. The multiplier is applied to the base delay for all subsequent requests, gradually backing off site-wide.
4. Exponential backoff is applied per-URL on retries: `Retry-After` or `baseDelay * 2^retries * multiplier`.

### Soft 404 fingerprinting

Before the main crawl begins, the crawler probes a known-bad URL (`/sgnl-definitely-not-a-real-page-404-test`) to capture a fingerprint of the site's custom 404 page:

1. Computes a **djb2 hash** of the stripped text content.
2. During crawl, any page returning HTTP 200 is checked against the fingerprint using both exact hash match and **trigram similarity** (threshold > 0.8).
3. Falls back to title-based detection (`"not found"`, `"404"`, `"page not found"`, etc.) when no fingerprint is available.

### Googlebot mode

When `--googlebot` is passed:

- User-Agent is set to Googlebot Mobile (`Googlebot/2.1`).
- `robots.txt` is fetched and parsed with longest-match Allow/Disallow resolution.
- `Crawl-delay` is respected as a floor for the delay (unless `--delay` was explicitly set).
- Blocked URLs are recorded in `metadata.json` and queryable via `sgnl explorer robots-blocked`.

### Sitemap-driven crawling

The crawler always fetches the sitemap (via `robots.txt` Sitemap directive or `--sitemap-url`):

- Sitemap URLs seed the priority queue alongside BFS-discovered URLs.
- Sitemap `<lastmod>` dates feed the freshness scoring signal.
- `--crawl-sitemap` additionally raises `max-pages` to cover all sitemap URLs.
- Sitemap index files are recursed up to 3 levels deep.

### Checkpoint/resume

Every 50 pages (configurable via `checkpointInterval`), the crawler writes a `checkpoint.json` containing the visited set, queue state, inlink counts, error map, and backpressure multiplier. On `--resume`, the crawl picks up from the last checkpoint. The checkpoint file is deleted on successful completion.

### Streaming JSONL

When an output file is configured, pages are streamed to disk as newline-delimited JSON (one object per line) instead of accumulating in memory. This keeps memory bounded regardless of crawl size.

### Tracking parameter stripping

URLs are normalised by stripping known analytics parameters before deduplication: `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`, `utm_id`, `fbclid`, `gclid`, `ref`, `mc_cid`, `mc_eid`, `_ga`, `_gl`.

---

## Query options

All query subcommands (`inspect`, `links`, `list-issues`, `top-pages`, `clusters`, `cluster`, `depth-map`, `external`, `unranked`, `canonicals`, `robots-blocked`, `compare`) share these flags:

| Flag | Type | Default | Description |
|---|---|---|---|
| `--run-dir <path>` | string | — | Path to a specific run directory containing `compact.json`. |
| `--domain <domain>` | string | — | Find the latest run for this domain. |
| `--json` | boolean | `false` | Output as JSON instead of formatted text. |

If neither `--run-dir` nor `--domain` is provided, the most recent run across all domains is used.

---

## Output formats

- **Terminal** (default) — human-readable tables and summaries. Uses stderr for progress, stdout for data.
- **`--json`** — structured JSON on stdout, suitable for piping into `jq` or CI pipelines.

---

## Run directory layout

Each crawl writes to `runs/{hostname}/{timestamp}/`:

```
runs/{hostname}/{timestamp}/
├── crawl.jsonl              # Raw crawl data (one JSON object per page per line)
├── metadata.json            # Crawl metadata: base URL, timestamp, sitemap URLs, errors, robotsBlocked
├── compact.json             # Compressed link graph: PageRank, communities, node/edge arrays, URL index
├── checkpoint.json          # (during crawl only, deleted on completion)
└── explorer/
    ├── index.html           # Interactive PixiJS visualization shell
    ├── bundle.js            # Pre-built React + PixiJS app
    ├── worker.js            # d3-force Web Worker for layout simulation
    └── styles.css           # Extracted CSS
```

---

## Compact wire format (v3)

The `compact.json` file uses a Structure-of-Arrays (SoA) layout for minimal JSON size:

- **`urls[]`** — flat array of all unique URL strings. Every other field references URLs by integer index into this array.
- **`nodes`** — parallel arrays (`url[]`, `inlinks[]`, `outlinks[]`, `pageRank[]`, `type[]`, `status[]`, `crawlDepth[]`, `communityId[]`, etc.) where position `i` describes the same node.
- **`edges`** — parallel arrays (`source[]`, `target[]`, `follow[]`) of integer indices.
- **`segMap`** — `[segment, communityId]` pairs mapping URL path segments to community IDs.
- **`meta`** — issue lists (`orphans`, `deadEnds`, `deepPages`, `errors4xx`, `errors5xx`, `notInSitemap`, `tooManyExternal`) as arrays of URL indices.

This format is consumed directly by the browser visualization and by all query subcommands via `loadRun()` in `src/explorer/query.ts`.

---

## GSC enrichment

When the user is authenticated with Google Search Console (`sgnl gsc login`), the crawl action automatically:

1. Resolves the GSC property for the crawled domain.
2. Fetches all ranked pages via `fetchAllRankedPages(property, token, { limit })`.
3. Enriches each crawled node with `gscPosition` (average position from GSC Search Analytics).

This enables the `unranked` subcommand, which cross-references crawled pages against GSC ranking data to find pages with no search presence, ranked pages with no internal links (orphaned), and ranked pages buried too deep in the site structure.

---

## Known limitations

1. **No JavaScript rendering.** The crawler fetches static HTML only. Pages that require client-side rendering (SPAs, CSR React apps) will appear empty or incomplete.
2. **Community detection is URL-path-based, not graph-theoretic.** Pages are grouped by their first URL path segment (`/blog/`, `/docs/`, `/products/`), not by graph clustering algorithms like Louvain or label propagation.
3. **`MAX_INTERNAL_LINKS = 500` per page cap.** The link extractor stops collecting internal links after 500 per page. Pages with very large navigation menus may have their deep links truncated.
4. **Python 3 required for graph analysis phase.** The crawl itself runs in pure TypeScript, but PageRank computation and community detection delegate to `python/graph_analysis.py`. Without Python, the crawl data is saved to `crawl.jsonl` but no `compact.json` or visualization is produced.
5. **Response time per page not yet stored.** The adaptive rate limiter tracks response times internally but they are not persisted to `crawl.jsonl` or `compact.json`.
6. **Single origin only.** The crawler stays within the origin of the start URL. Multi-subdomain sites (`www` vs `blog` vs `app`) require separate crawl runs.
7. **HTML truncation.** Pages larger than 2 MB are truncated before link extraction. Very large pages may lose links near the bottom.
8. **Max redirects default is 2.** Chains longer than 2 hops are treated as errors, matching Googlebot's documented behaviour.

---

## Implementation

| File | Role |
|---|---|
| `src/commands/explorer.ts` | CLI command definitions, flag parsing, subcommand registration, crawl action, all 12 query subcommand handlers |
| `src/explorer/crawler.ts` | BFS crawler with priority queue, adaptive rate limiting, 429/503 backpressure, soft 404 fingerprinting, Googlebot mode, checkpoint/resume, streaming JSONL |
| `src/explorer/data-processor.ts` | PageRank computation, community detection, compact format (v3) generation, inlink counting, node classification |
| `src/explorer/html-generator.ts` | PixiJS visualization output — writes `index.html`, `bundle.js`, `worker.js`, `styles.css` |
| `src/explorer/query.ts` | Run loading (`loadRun`), domain resolution, latest-run finder — shared by all query subcommands |
| `src/explorer/types.ts` | TypeScript interfaces for the compact wire format |
| `src/explorer/graph-algorithms/pagerank.ts` | Power-iteration PageRank (~50 iterations, damping factor 0.85) |
| `src/explorer/graph-algorithms/community-detection.ts` | URL-segment-based community assignment |
| `src/analysis/python.ts` | `runGraphAnalysis` — Python graph analysis bridge |
| `src/analysis/gsc.ts` | `fetchAllRankedPages`, `resolveGSCProperty` — GSC enrichment for the `unranked` subcommand |

---

## See also

- [`docs/technical-seo.md`](./technical-seo.md) — the `sgnl technical` command reference.
- [`docs/structure.md`](./structure.md) — the `sgnl structure` command reference.
- [`docs/robots.md`](./robots.md) — the `sgnl robots` command reference.
- [`docs/performance.md`](./performance.md) — the `sgnl performance` command reference.
- [`docs/schema.md`](./schema.md) — the `sgnl schema` command reference.
- [`docs/content.md`](./content.md) — the `sgnl content` command reference.
- [`docs/gsc.md`](./gsc.md) — the `sgnl gsc` command reference.
- [`src/explorer/HOW_IT_WORKS.md`](../src/explorer/HOW_IT_WORKS.md) — internal architecture walkthrough.
- [README — Explorer sections](../README.md#sgnl-explorer-crawl-url) — quick-start examples.
