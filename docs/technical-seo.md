# `sgnl technical` — Technical SEO Command

Focused, fast technical SEO audit of a single URL. Runs the HTTP fetch layer plus `python/technical_seo.py` — no PageSpeed Insights, no Chrome UX Report, no DOM/content/structure analysis. Fastest of the focused commands, typically 1–3 seconds per URL (vs. 10–60s for `sgnl analyze`).

Unlike `sgnl analyze`, this command bypasses the orchestrator/merger pipeline entirely. It talks directly to the Python script and formats its raw output, so **you always see the full fidelity** of what `technical_seo.py` produces — no mapper squeeze, no cherry-picking.

---

## Contents

- [When to use it](#when-to-use-it)
- [Usage](#usage)
- [Pipeline](#pipeline)
- [Terminal output](#terminal-output)
- [Sections reference](#sections-reference)
- [JSON output](#json-output)
- [Markdown output](#markdown-output)
- [Canonical self-referencing detection](#canonical-self-referencing-detection)
- [Redirect chain annotation](#redirect-chain-annotation)
- [Known limitations](#known-limitations)
- [Implementation](#implementation)
- [See also](#see-also)

---

## When to use it

Use `sgnl technical` when:

- You want a **quick technical SEO snapshot** without waiting for PageSpeed Insights (which can take 10–30s and may rate-limit without an API key).
- You're running **CI smoke tests** on many URLs and only need the fast HTTP+HTML signals, not Core Web Vitals.
- You want to **verify a single fix** (canonical, hreflang, security header) without re-running the full analyze pipeline.
- **PSI or CrUX are unavailable** (no API key, rate-limited, target page too new for field data).
- You're **batching** across dozens or hundreds of URLs in a script where per-URL latency matters.

Use `sgnl analyze` instead when you want Core Web Vitals, content quality scoring, DOM structure analysis, Lighthouse opportunities, and a merged issues list alongside the technical signals.

---

## Usage

```
sgnl technical <url> [flags]
```

### Flags

| Flag | Type | Default | Description |
|---|---|---|---|
| `--output <format>` | string | `terminal` | `terminal` (human-readable) or `json` (pipe-friendly, structured) |
| `--device <type>` | string | `mobile` | `mobile` or `desktop`. Affects the User-Agent used on the fetch. |
| `--save` | boolean | `false` | Also write `technical_seo.md` to the runs directory (default `~/.sgnl/runs/<timestamp>/`). |
| `--timeout <ms>` | number | `30000` | Per-step timeout in milliseconds (applies to fetch and Python script execution). |

### Examples

```bash
# Human-readable terminal output
sgnl technical https://example.com

# JSON for piping into jq or a CI pipeline
sgnl technical https://example.com --output json | jq '.technical.security_headers'

# Save a Markdown report next to the JSON
sgnl technical https://example.com --save

# Desktop User-Agent
sgnl technical https://example.com --device desktop

# Tighter timeout for batch scripts
sgnl technical https://example.com --timeout 10000 --output json
```

### Requirements

Python 3.8+ with `beautifulsoup4` and `lxml` installed. Without Python, the command fails immediately — unlike `sgnl analyze`, there is no degraded-mode fallback since `technical_seo.py` is the only data source.

---

## Pipeline

The command is intentionally short — no merger, no orchestrator, no PSI call:

```
  sgnl technical <url>
        │
        ▼
  safeFetch(url, { device, timeout })
        │
        │  (html, headers, status, ttfb_ms, compression,
        │   cdnDetected, redirect_chain)
        │
        ▼
  runPythonScriptSafe(
    'technical_seo.py',
    { html, headers, url }
  )
        │
        │  (full Python output — meta, canonical,
        │   open_graph, indexability, links,
        │   security_headers, hreflang,
        │   pagination_amp, caching, resource_hints,
        │   url_structure)
        │
        ▼
  printTechnicalTerminal / buildTechSeoMd / JSON wrapper
        │
        ▼
  terminal • JSON stdout • technical_seo.md
```

The fetch-layer output (`status`, `ttfb_ms`, `compression`, `cdnDetected`, `redirect_chain`) is surfaced in a `Request` section and a `Redirects` section alongside the Python analysis — these are not produced by the Python script itself but are part of the same unified output.

---

## Terminal output

Full example against `https://github.com`:

```
Technical SEO — https://github.com

  Request
    Status: 200
    TTFB: 267 ms
    Compression: gzip
    CDN: fastly

  Redirects (1 hop)
    1. http://github.com → https://github.com/     [HTTP→HTTPS]

  Meta Tags
    Title: GitHub · Build and ship software...  (51 chars, pass)
    Description: GitHub is where over 100 million...  (132 chars, pass)
    Robots: index, follow
    Charset: yes  |  Viewport: yes

  Canonical: https://github.com/  (self-referencing)  (pass)

  Open Graph: 4/4 tags present (title, description, image, url)
    Published: 2024-03-12T09:00:00Z
  Twitter Card: summary_large_image

  Indexability: indexable

  Security Headers: good (5/6)
    Present: HSTS, CSP, X-Content-Type-Options, X-Frame-Options, Referrer-Policy
    Missing: Permissions-Policy
    HSTS: max-age=31536000; includeSubDomains; preload
    X-Frame-Options: DENY
    Referrer-Policy: strict-origin-when-cross-origin

  Caching: cacheable (max-age: 0s)
    Cache-Control: max-age=0, private, must-revalidate
    ETag: yes  |  Last-Modified: no

  Resource Hints: preload=2, dns-prefetch=4, preconnect=3
    preload: https://github.githubassets.com/assets/light.css (as=style)
    preconnect: github.githubassets.com, avatars.githubusercontent.com, api.github.com

  URL Structure: 19 chars, 0/0 keyword segments

  Hreflang: 6 language(s) (x-default present)
    en-us → https://github.com
    de-de → https://github.com/de
    fr-fr → https://github.com/fr
    ...

  Links
    Internal: 52 total (3 generic-anchor)
    External: 98 total (0 broken)

  Pagination & AMP
    AMP: not detected
```

Sections that are empty or not applicable to the page are omitted entirely — for example, the `Redirects` section only appears when the fetch actually followed redirects, and `Pagination & AMP` only shows when `rel=prev`, `rel=next`, or AMP markers are present.

---

## Sections reference

### Request

Populated from the fetch layer (`FetchResult`), not the Python script.

| Field | Source | Meaning |
|---|---|---|
| `Status` | `fetchResult.status` | Final HTTP status after any redirects were followed |
| `TTFB` | `fetchResult.ttfb_ms` | Time to first byte in milliseconds — server response latency |
| `Compression` | `fetchResult.compression` | Detected Content-Encoding: `gzip`, `brotli`, `deflate`, or omitted when none |
| `CDN` | `fetchResult.cdnDetected` | Detected CDN: `cloudflare`, `cloudfront`, `fastly`, `akamai`, `aws`, or omitted |

CDN detection is header-based and best-effort; a site can be behind a CDN without matching any of the known fingerprints.

### Redirects

Populated from `fetchResult.redirect_chain`. Each hop is annotated with labels from `src/analysis/redirects.ts:annotateRedirectChain()`:

| Label | When it fires |
|---|---|
| `HTTP→HTTPS` | Scheme upgrade from `http://` to `https://` |
| `www→apex` | `https://www.example.com` → `https://example.com` |
| `apex→www` | `https://example.com` → `https://www.example.com` |
| `trailing-slash` | Pure trailing-slash normalization (path differs only by trailing `/`) |

Labels are cumulative — a single hop can carry multiple labels. Chains longer than 1 hop are flagged as a technical-SEO issue in both the terminal summary and the saved markdown.

### Meta Tags

From `technical_seo.py:_analyze_meta_tags()`.

| Field | Source HTML | Notes |
|---|---|---|
| `Title` | `<title>` | `status: pass` when 30–60 chars, else `warn` |
| `Description` | `<meta name="description">` | `status: pass` when 120–160 chars, `warn` outside, `fail` when missing |
| `Robots` | `<meta name="robots">` | Parses `index` / `noindex`, `follow` / `nofollow` directives |
| `Charset` | `<meta charset="...">` | Presence boolean only |
| `Viewport` | `<meta name="viewport">` | Presence boolean only (does not validate content like `width=device-width`) |

### Canonical

From `_analyze_canonical()`. See [Canonical self-referencing detection](#canonical-self-referencing-detection) for the normalization logic.

| Field | Meaning |
|---|---|
| `present` | Whether `<link rel="canonical">` exists |
| `href` | The canonical URL as declared |
| `self_referencing` | `true` when the normalized canonical href equals the normalized page URL, `false` when it points elsewhere, `null` when indeterminate (no URL passed to the analyzer) |
| `status` | `pass` when the canonical tag has an href, `fail` when missing or empty |

### Open Graph

From `_analyze_open_graph()`.

- Reports presence of the 4 core tags: `og:title`, `og:description`, `og:image`, `og:url`
- Extracts `article:published_time`, `article:modified_time`, and `og:updated_time` when present — these double as freshness signals
- Twitter Card detection is nested inside the Open Graph result (`twitter_card.present`, `twitter_card.card_type`)

### Indexability

From `_analyze_indexability()`. Cross-references meta robots and the `X-Robots-Tag` HTTP header.

| Field | Meaning |
|---|---|
| `blocked` | `true` if any signal indicates noindex |
| `signals[]` | Which sources are blocking: `meta_noindex`, `header_noindex` |
| `conflicts[]` | Detected contradictions between meta tags and headers |

### Security Headers

From `_analyze_security_headers()`. Checks the 6 headers that make up a modern baseline:

| Header | What we extract |
|---|---|
| `Strict-Transport-Security` (HSTS) | Full policy string |
| `Content-Security-Policy` (CSP) | Presence only (full policy is too large for terminal display; available in JSON) |
| `X-Content-Type-Options` | Value (`nosniff`) |
| `X-Frame-Options` | Value (`DENY`, `SAMEORIGIN`, etc.) |
| `Referrer-Policy` | Value (`no-referrer`, `strict-origin-when-cross-origin`, etc.) |
| `Permissions-Policy` | Presence only |

Grade mapping: **5–6 present = `good`**, **3–4 = `moderate`**, **0–2 = `weak`**.

### Caching

From `_analyze_caching()`.

| Field | Source header | Meaning |
|---|---|---|
| `cache_control` | `Cache-Control` | Raw header string |
| `max_age_seconds` | `Cache-Control: max-age=N` | Parsed integer, `null` if absent |
| `is_cacheable` | derived | `true` when `Cache-Control` is present and not `no-store` |
| `has_etag` | `ETag` | Presence boolean |
| `has_last_modified` | `Last-Modified` | Presence boolean |
| `issues[]` | computed | Warns about missing `Cache-Control`, `no-store`, or very short TTLs (<300s) |

### Resource Hints

From `_analyze_resource_hints()`. Scans `<link rel=...>` for performance hints.

| Kind | What's captured |
|---|---|
| `preload` | Array of `{ href, as }` pairs |
| `prefetch` | Array of hrefs |
| `dns_prefetch` | Array of extracted domains |
| `preconnect` | Array of extracted domains |

Terminal output shows counts and the first 5 of each kind; JSON output includes the full lists.

### URL Structure

From `_analyze_url_structure()`. Requires the page URL to be passed to the Python script.

| Field | Meaning |
|---|---|
| `length` | Full URL character count. Flagged as an issue if >75. |
| `path` | The URL path component |
| `has_trailing_slash` | True when path has a trailing slash (excluding `/` root) |
| `has_uppercase` | True when any character in path is uppercase |
| `has_special_chars` | True when path contains chars outside `[a-zA-Z0-9/_.-]` |
| `has_double_slashes` | True when path contains `//` |
| `keyword_segments` | Count of path segments that look like keywords (3+ chars, lowercase, alpha only) |
| `total_segments` | Total path segments |
| `issues[]` | Human-readable issue strings derived from the flags above |

### Hreflang

From `_analyze_hreflang()`. Scans `<link rel="alternate" hreflang="...">` tags.

| Field | Meaning |
|---|---|
| `present` | True when at least one hreflang tag exists |
| `count` | Number of hreflang tags |
| `languages[]` | Full list of `{ lang, href }` entries |
| `has_x_default` | True when an `hreflang="x-default"` tag is present |
| `issues[]` | Includes `missing_x_default` when hreflang is present but no x-default |

### Links

From `_analyze_links()`. Counts-only analysis of `<a href>` tags.

| Field | Meaning |
|---|---|
| `internal_total` | Count of links whose href starts with `/`, `#`, or does not contain `http` |
| `internal_generic_anchor` | Count of internal links whose anchor text matches generic patterns (`click here`, `read more`, `learn more`, `more`, `link`, `here`, `go`) or is empty |
| `external_total` | Count of links whose href starts with `http(s)://` and points off-site |
| `external_broken` | Heuristic count — currently a placeholder, does not actually check external URLs |

### Pagination & AMP

From `_analyze_pagination_amp()`.

| Field | Source | Meaning |
|---|---|---|
| `has_prev` | `<link rel="prev">` | Presence |
| `has_next` | `<link rel="next">` | Presence |
| `prev_href`, `next_href` | link hrefs | URLs when present |
| `is_paginated` | derived | True when either prev or next exists |
| `amp_link_present` | `<link rel="amphtml">` | AMP version linked from canonical HTML |
| `amp_html` | `<html amp>` or `<html ⚡>` | This document IS the AMP version |
| `is_amp` | derived | Either flag true |

This section is omitted from terminal output when all fields are false.

---

## JSON output

`--output json` wraps the fetch context and the technical analysis in a two-key envelope so consumers get everything in a single payload:

```json
{
  "request": {
    "status": 200,
    "ttfb_ms": 267,
    "compression": "gzip",
    "cdn": "fastly",
    "redirects": [
      { "from": "http://github.com", "to": "https://github.com/", "labels": ["HTTP→HTTPS"] }
    ]
  },
  "technical": {
    "meta": { ... },
    "canonical": { ... },
    "open_graph": { ... },
    "indexability": { ... },
    "links": { ... },
    "security_headers": { ... },
    "hreflang": { ... },
    "pagination_amp": { ... },
    "caching": { ... },
    "resource_hints": { ... },
    "url_structure": { ... }
  }
}
```

> **Note on the shape change**: prior versions of `sgnl technical --output json` returned the raw Python output at the root. Now the Python output is nested under a `technical` key and fetch context is available under `request`. Existing scripts that read `.meta.title` directly need to switch to `.technical.meta.title`.

The `technical` section faithfully reflects `technical_seo.py`'s output — no mapper, no field renaming, no information loss. This is deliberate: `sgnl technical` is meant to be the ground-truth source for the Python layer's technical SEO analysis.

---

## Markdown output

### `technical_seo.md` (standalone, via `--save`)

`sgnl technical <url> --save` writes `technical_seo.md` into a new timestamped runs directory. The same file is also written by `sgnl analyze --save` as one of its per-section debug outputs, so the format is shared.

Sections (in order):

1. **Request** — table with Status, TTFB, Compression, CDN
2. **Redirects** — table listing each hop with labels (omitted when the chain is empty)
3. **Meta Tags** — table of title, description, robots, charset, viewport
4. **Canonical** — table with href, self_referencing, status
5. **Open Graph** — table of the 4 core tags plus article timestamps
6. **Twitter Card**
7. **Indexability** — including conflicts
8. **Security Headers** — present, missing, full detail values
9. **Caching** — cache_control raw value, flags, issues
10. **Resource Hints** — full preload/preconnect/dns-prefetch lists
11. **URL Structure**
12. **Hreflang** — full locale list
13. **Links**
14. **Pagination & AMP** — only when any pagination or AMP signal is truthy

### Integration into `report.md` (via `sgnl analyze --save`)

When you run the full analyze pipeline with `--save`, the technical SEO signals appear in two places:

- The main `report.md` includes a Technical SEO section pulling from `report.seo.technical` and `report.analysis_detail.technical_seo`. The Speed section inside Performance now also shows HTTP Status and CDN. The Redirect Analysis section renders an annotated hop table using the same labeler as the standalone `technical_seo.md`.
- The same `technical_seo.md` file is written as a sibling of `report.md` for users who want the focused view.

Both paths share the renderer (`buildTechSeoMd` in `src/analysis/run-reporter.ts`) and the labeler (`annotateRedirectChain` in `src/analysis/redirects.ts`), so the output is identical regardless of which command produced it.

---

## Canonical self-referencing detection

Early versions of `sgnl` hardcoded `self_referencing: true` whenever a canonical tag was present, regardless of whether the href actually matched the page URL. This was a bug — a canonical that points to a different page should be reported as `false`.

The corrected logic in `_analyze_canonical()`:

1. If no URL was passed to the Python script, return `self_referencing: null` (indeterminate — don't lie).
2. If the canonical has no href, return `self_referencing: null`.
3. Otherwise, resolve the canonical href against the page URL using `urljoin` (handles relative hrefs like `/foo`).
4. Normalize both URLs:
   - Lowercase the scheme and host
   - Strip trailing slashes (unless the path is just `/`)
5. Return `true` when the normalized pair is equal, `false` otherwise.

**Examples:**

| Page URL | Canonical href | Result |
|---|---|---|
| `https://example.com/foo` | `https://example.com/foo` | `true` |
| `https://example.com/foo` | `/foo` (relative) | `true` |
| `https://example.com/foo/` | `https://example.com/foo` | `true` (trailing slash normalized) |
| `https://Example.com/foo` | `https://example.com/foo` | `true` (case insensitive) |
| `http://example.com/foo` | `https://example.com/foo` | `false` (scheme differs) |
| `https://example.com/foo` | `https://example.com/bar` | `false` |
| `https://example.com/foo` | *(missing tag)* | `null` |

Tests for each case live in `tests/python/test_technical_seo.py::TestCanonical`.

---

## Redirect chain annotation

`src/analysis/redirects.ts:annotateRedirectChain()` converts a raw `string[]` redirect chain into an array of `RedirectHop` objects with human-readable labels:

```ts
type RedirectHop = {
  from: string;
  to: string;
  labels: Array<'HTTP→HTTPS' | 'www→apex' | 'apex→www' | 'trailing-slash'>;
};
```

Labels are computed per hop, cumulatively. A single hop that both upgrades to HTTPS and adds `www` gets `['HTTP→HTTPS', 'apex→www']`.

This shared helper is used by `printTechnicalTerminal` (terminal output), `buildTechSeoMd` (markdown), and `buildReportMarkdown` (big analyze report), so all three outputs annotate hops identically.

---

## Known limitations

1. **External broken-link detection is a placeholder.** `_analyze_links()` reports `external_broken` based only on whether the `href` starts with `http`, not whether the destination responds. Treat this field as "non-http scheme" count, not as actual broken links. Real broken-link checking would require crawling — use `sgnl explorer` for that.
2. **Security header grading is coarse.** Presence-only check against a fixed list of 6 headers. Does not validate policy strings (e.g., a weak CSP is graded the same as a strong one). For deeper security analysis, pair with a dedicated tool like [Mozilla Observatory](https://observatory.mozilla.org/).
3. **Hreflang validation is shallow.** Detects presence, counts, and `x-default` but does not verify that referenced URLs are reachable, that reciprocal hreflang tags exist on target pages, or that language codes are valid BCP 47.
4. **URL structure keyword detection is English-biased.** The regex `^[a-z][a-z-]{2,}$` only recognizes lowercase Latin segments. Non-Latin scripts (Cyrillic, CJK, Arabic) will never be counted as keyword segments.
5. **CSP body is not parsed.** The presence of a CSP header is reported but the policy directives are not validated or summarized.
6. **No validation of `X-Robots-Tag` beyond `noindex`.** The Python indexability check scans for `noindex` as a substring; it does not parse the full set of Google-supported directives (`nofollow`, `noarchive`, `nosnippet`, `unavailable_after`, `max-snippet`, `max-image-preview`, `max-video-preview`, per-bot directives).
7. **No mixed content detection.** HTTPS pages referencing `http://` resources are not currently flagged. Planned.
8. **`<html lang>` attribute is not extracted.** Also planned — i18n signal missing from the current output.
9. **Link HTTP header is ignored.** RFC 5988 `Link:` headers can carry `rel=canonical`, `rel=preload`, `rel=alternate`, `rel=hreflang` outside HTML. Google honors these. Not currently parsed.

See the [roadmap](../README.md#roadmap) for planned improvements.

---

## Implementation

| File | Role |
|---|---|
| `src/commands/technical.ts` | Command entry point, flag parsing, terminal printer, JSON wrapper |
| `src/analysis/fetch.ts` | `safeFetch()` — provides Request section data |
| `src/analysis/python.ts` | `runPythonScriptSafe()` — spawns and captures the Python script |
| `python/technical_seo.py` | All SEO analysis logic (meta, canonical, OG, headers, etc.) |
| `src/analysis/run-reporter.ts` | `buildTechSeoMd()` — markdown generator used by `--save` and by `sgnl analyze --save` |
| `src/analysis/report-md.ts` | `buildReportMarkdown()` — big analyze report; includes the technical section and the annotated redirect hop table |
| `src/analysis/redirects.ts` | `annotateRedirectChain()` — shared hop labeler used by terminal, technical_seo.md, and report.md |

The technical command does **not** use `src/analysis/orchestrator.ts`, `src/analysis/merger.ts`, or any of the typed interfaces in `src/analysis/scoring.ts`. Those exist for the full `sgnl analyze` pipeline. This is by design — `sgnl technical` is a direct pipe from Python to output with minimal transformation.

For the full data-flow diagram of the analyze pipeline (which is more complex), see [HOW-IT-WORKS.md](./HOW-IT-WORKS.md).

---

## See also

- [`sgnl analyze`](../README.md#sgnl-analyze-url) — full pipeline (technical + content + structure + performance + scoring)
- [`docs/content.md`](./content.md) — the `sgnl content` command reference (content quality, E-E-A-T, readability, first-paragraph hook, passive voice, transition words, heading hierarchy).
- [`sgnl structure`](./structure.md) — DOM structure focused command
- [`sgnl performance`](./performance.md) — Core Web Vitals + Lighthouse focused command
- [`sgnl robots`](./robots.md) — robots.txt focused command
- [`sgnl schema`](./schema.md) — JSON-LD structured data focused command (per-block scoring, rich results eligibility, correctness checks)
- [`sgnl gsc`](./gsc.md) — Google Search Console focused command (pages, queries, URL inspection, sitemaps)
- [`docs/explorer.md`](./explorer.md) — site crawler, link graph visualization, and structural analysis.
- [`SgnlClient`](../README.md#library-api-programmatic-usage) — programmatic usage of the full pipeline
- [HOW-IT-WORKS.md](./HOW-IT-WORKS.md) — architecture walkthrough of the sgnl-cli codebase
