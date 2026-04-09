# SGNL — Signal Intelligence CLI

> **Analyze any URL for performance, SEO, and structure — in seconds.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-1.0.0-brightgreen.svg)](package.json)
[![Tests](https://img.shields.io/badge/tests-842%20passing-brightgreen.svg)](#testing)

---

## Overview

SGNL is a command-line tool that analyzes web pages for performance, SEO, and structural quality. Give it a URL and it returns Core Web Vitals, technical SEO signals, content quality metrics, DOM structure analysis, and actionable issues — from the terminal, as JSON, or as Markdown files.

It combines three data sources in a single pipeline: a headless Chromium fetch (via Playwright) with full JavaScript rendering, header/redirect analysis, and mobile screenshots; Google's PageSpeed Insights and Chrome UX Report APIs for lab and field performance data; and a Python layer that parses the rendered HTML for SEO, structure, and content signals. Results are merged with a priority chain (real user field data > lab data) and presented through a live terminal UI or piped as structured output.

### Who it's for

SEO engineers, web developers, and site reliability teams who want to audit page health from the command line — whether manually, in CI pipelines, or as input to other tools.

### Key features

- **Core Web Vitals** — LCP, CLS, INP from Chrome UX Report (real field data), with Lighthouse lab fallback
- **Technical SEO** — meta tags, canonical (with accurate self-referencing detection), Open Graph, Twitter Card, indexability, security headers (full policy detail), caching, hreflang, pagination/AMP, resource hints, redirect chain analysis
- **Content extraction** — language-neutral stats (volume, distribution, structure, media, links, patterns), heading outline, link inventory, image inventory, and cleaned markdown body designed to be fed to an LLM for subjective judgment (quality, EEAT, tone). No English-only heuristics.
- **DOM structure** — element count, element distribution map, semantic score, heading hierarchy validation, script audit (including third-party detection), accessibility checks, form analysis
- **robots.txt analysis** — longest-match Allow/Disallow resolution with `*`/`$` wildcards, multi-agent verdict matrix, AI bot blocking summary, sitemap index expansion, HTTP validation (size, content-type, cross-origin redirect, syntax warnings)
- **Schema.org validation** — JSON-LD extraction, required/recommended field checks, per-block validation errors, rich results eligibility
- **Site explorer** — crawl an entire site, compute PageRank, detect content clusters, generate an interactive HTML visualization
- **Google Search Console integration** — OAuth2 authentication, ranked pages/queries, ranking data overlaid on explorer crawls
- **Focused commands** — run `technical`, `content`, `structure`, `performance`, `robots`, or `schema` individually against a single URL
- **Multiple output formats** — live terminal UI (Ink/React), JSON (pipe-friendly), Markdown reports (`--save`)
- **Streaming mode** — partial results emitted as each analysis phase completes
- **Device emulation** — analyze as mobile (default) or desktop

### Requirements and limitations

- **Node.js 18+** is required
- **Playwright** is used by `analyze` and `content` commands for headless Chromium rendering (JS-rendered pages, mobile screenshots). Install browsers with `npx playwright install chromium`
- **Python 3.8+** is optional but recommended — without it, DOM analysis, on-page SEO, content analysis, and robots.txt checks are unavailable. The tool degrades silently; you still get HTTP, PSI, and CrUX data
- **Google API key** is optional — without `SGNL_PSI_KEY`, PageSpeed Insights runs in keyless mode (rate-limited). CrUX requires the same key
- **Python is required** for the `explorer crawl`, `technical`, `content`, `structure`, `robots`, and `schema` commands — these will fail without it
- Only **JSON-LD** structured data is validated; Microdata and RDFa are not checked
- Field data (Core Web Vitals) is only available for sites with sufficient Chrome traffic; low-traffic sites fall back to lab data only

---

## Installation and Setup

### Prerequisites

| Dependency                | Version   | Required             | Purpose                                                      |
| ------------------------- | --------- | -------------------- | ------------------------------------------------------------ |
| Node.js                   | >= 18.0.0 | Yes                  | Runtime for the CLI                                          |
| Playwright + Chromium     | latest    | Yes (auto-installed) | Headless browser for JS rendering and screenshots            |
| Python                    | >= 3.8    | No (but recommended) | HTML parsing, SEO analysis, content analysis, graph analysis |
| Google API key            | —         | No                   | Unlocks PageSpeed Insights and CrUX without rate limits      |
| Google OAuth2 credentials | —         | No                   | Google Search Console integration                            |

### 1. Install the CLI

```bash
# pnpm (recommended)
pnpm add -g sgnl-cli

# npm
npm install -g sgnl-cli

# yarn
yarn global add sgnl-cli
```

On `pnpm install`, a `postinstall` script (`scripts/ensure-python-deps.js`) attempts to detect Python and install the required Python packages automatically. If it fails, Python features still work after manual setup (step 2).

### 2. Set up Python (recommended)

Python enables the `technical`, `content`, `structure`, `robots`, and `schema` commands, as well as `explorer crawl`. Without Python, only `analyze` (with `--skip-python`), `performance`, and `gsc` commands work fully.

```bash
# Create a virtual environment in the project root
python3 -m venv .venv
source .venv/bin/activate            # macOS / Linux
# .venv\Scripts\activate             # Windows

# Install dependencies
pip install -r python/requirements.txt
```

The required Python packages are:

| Package          | Min version | Purpose                                      |
| ---------------- | ----------- | -------------------------------------------- |
| `beautifulsoup4` | 4.12.0      | HTML parsing and DOM traversal               |
| `html2text`      | 2024.1.0    | HTML-to-Markdown conversion                  |
| `lxml`           | 4.9.0       | Fast XML/HTML parser (used by BeautifulSoup) |

`lxml` requires a C compiler. If installation fails:

- **macOS:** `xcode-select --install`
- **Ubuntu/Debian:** `apt install python3-dev libxml2-dev libxslt-dev`

Alternatively, use the setup scripts:

```bash
pnpm run setup-python                                             # macOS / Linux
powershell -ExecutionPolicy Bypass -File scripts/setup-python.ps1 # Windows
```

SGNL auto-detects Python in this order: `.venv/bin/python3` → `venv/bin/python3` → `/opt/homebrew/bin/python3` → `/usr/local/bin/python3` → `/usr/bin/python3` → system `python3`.

#### Platform-specific Python installation

| Platform      | Install command                                                         |
| ------------- | ----------------------------------------------------------------------- |
| macOS         | `brew install python@3.12`                                              |
| Ubuntu/Debian | `apt install python3 python3-pip python3-venv`                          |
| Windows       | `winget install Python.Python.3.12` or [python.org](https://python.org) |

### 3. Configure API key (optional)

A Google API key removes rate limits on PageSpeed Insights and enables Chrome UX Report (CrUX) field data. Without it, PSI still works but may throttle under heavy use, and CrUX calls will fail.

Get a free key from the [Google Cloud Console](https://developers.google.com/speed/docs/insights/v5/get-started#APIKey). Enable the **PageSpeed Insights API** and **Chrome UX Report API** for the key.

Set it via environment variable:

```bash
export SGNL_PSI_KEY=AIzaSyB1-your-actual-key-here
```

Or use the interactive setup, which saves it to `~/.sgnl/config.json`:

```bash
sgnl init
```

### 4. Set up Google Search Console (optional)

GSC integration adds ranking position, clicks, impressions, and CTR data to analysis and explorer crawls. It requires OAuth2 credentials.

**Create credentials:**

1. Go to [Google Cloud Console → APIs & Credentials](https://console.cloud.google.com/apis/credentials)
2. Create an **OAuth 2.0 Client ID** (application type: **Desktop app**)
3. Enable the **Google Search Console API** for your project

**Authenticate:**

```bash
sgnl gsc login
```

This prompts for your OAuth Client ID and Client Secret (if not already stored), then opens a browser for Google consent. On success, tokens are saved to `~/.sgnl/gsc-tokens.json` and your verified properties are stored in `~/.sgnl/config.json`.

Check auth status at any time:

```bash
sgnl gsc status
```

Remove stored credentials:

```bash
sgnl gsc logout
```

### Environment variables

| Variable       | Purpose                                                                                                  | Example                    |
| -------------- | -------------------------------------------------------------------------------------------------------- | -------------------------- |
| `SGNL_PSI_KEY` | Google API key for PageSpeed Insights and CrUX. Without it, PSI is rate-limited and CrUX is unavailable. | `AIzaSyB1a2b3c4d5e6f7g8h9` |
| `SGNL_DEBUG`   | Set to `1` to attach raw fetch, PSI, and Python data to the report output under a `_raw` field.          | `1`                        |

### Config files

All config is stored under `~/.sgnl/`:

| File              | Created by                      | Contents                                                                                |
| ----------------- | ------------------------------- | --------------------------------------------------------------------------------------- |
| `config.json`     | `sgnl init` or `sgnl gsc login` | API key (`psiKey`), output directory (`runsPath`), GSC OAuth credentials and properties |
| `gsc-tokens.json` | `sgnl gsc login`                | OAuth2 access token, refresh token, and expiry. Auto-refreshed on use.                  |

Example `~/.sgnl/config.json`:

```json
{
  "psiKey": "AIzaSyB1a2b3c4d5e6f7g8h9",
  "runsPath": "/Users/you/.sgnl/runs",
  "gsc": {
    "clientId": "123456789-abc.apps.googleusercontent.com",
    "clientSecret": "GOCSPX-your-secret-here",
    "properties": ["sc-domain:example.com", "https://www.example.com/"]
  }
}
```

- `psiKey` — same as `SGNL_PSI_KEY` env var. The env var takes precedence if both are set.
- `runsPath` — directory where `--save` writes report files and `explorer crawl` stores crawl data. Defaults to `~/.sgnl/runs`.
- `gsc.clientId` / `gsc.clientSecret` — OAuth2 desktop app credentials from Google Cloud Console.
- `gsc.properties` — auto-populated after `sgnl gsc login`. Lists your verified Search Console properties.

### 5. Verify the installation

```bash
# Check the CLI is available
sgnl --help

# Quick test — runs HTTP fetch + PSI (no Python needed)
sgnl analyze https://example.com --skip-python --output json

# Verify Python is working
sgnl technical https://example.com --output json

# Verify PSI API key (look for field_data in output)
sgnl performance https://example.com --output json
```

If `sgnl technical` fails with a Python error, check that `python3 -c "import bs4, html2text, lxml"` runs without errors. If not, reinstall: `pip install -r python/requirements.txt`.

---

## Command Reference

All commands that accept a `<url>` argument require a fully qualified URL starting with `http://` or `https://`. Invalid URLs exit with code 2.

---

### `sgnl init`

Interactive setup wizard. Prompts for a PSI API key and an output directory for saved reports.

```
sgnl init
```

No flags. Saves to `~/.sgnl/config.json`.

**Examples:**

```bash
# First-time setup
sgnl init

# Re-run to change API key or output path (existing values shown as defaults)
sgnl init
```

**Output:**

```
Welcome to SGNL setup!

? PSI API key: AIzaSy...
? Path to save run reports [/Users/you/.sgnl/runs]:

✓ Config saved to /Users/you/.sgnl/config.json

You're all set. Try:
  sgnl analyze https://example.com
```

**Errors:**

None — blank input keeps existing values or uses defaults.

---

### `sgnl analyze <url>`

Run the full analysis pipeline: HTTP fetch, Python HTML analysis, PageSpeed Insights, Chrome UX Report, and optional Google Search Console data. Merges all sources into a single report.

```
sgnl analyze <url> [flags]
```

| Flag                  | Type    | Default    | Description                                                                                  |
| --------------------- | ------- | ---------- | -------------------------------------------------------------------------------------------- |
| `--output <format>`   | string  | `terminal` | Output format: `terminal` (live UI) or `json`                                                |
| `--debug`             | boolean | `false`    | Include raw fetch, PSI, and Python data in a `_raw` field on the JSON output.                |
| `--skip-python`       | boolean | `false`    | Skip the Python analysis layer. Faster, but no DOM, SEO, or content analysis.                |
| `--python-only`       | boolean | `false`    | Run only the Python layer, skip PageSpeed Insights and CrUX.                                 |
| `--stream`            | boolean | `false`    | Emit partial JSON reports as each pipeline phase completes. Only works with `--output json`. |
| `--follow`            | boolean | `false`    | Instead of full analysis, crawl internal links and display an ASCII link tree.               |
| `--depth <n>`         | number  | `3`        | Maximum crawl depth when using `--follow`.                                                   |
| `--max-pages <n>`     | number  | `100`      | Maximum pages to crawl when using `--follow`.                                                |
| `--include <pattern>` | string  | —          | Only crawl/analyze paths matching this glob (e.g. `/blog/*`). Used with `--follow`.          |
| `--exclude <pattern>` | string  | —          | Skip paths matching this glob (e.g. `/admin/*`). Used with `--follow`.                       |
| `--device <type>`     | string  | `mobile`   | Device emulation: `mobile` or `desktop`. Affects User-Agent and PSI strategy.                |
| `--save`              | boolean | `false`    | Save Markdown report files and mobile screenshot to `runs/` directory. A `report.json` is always saved regardless. |
| `--timeout <ms>`      | number  | `30000`    | Timeout per analysis step in ms (fetch, PSI, Python).                                        |
| `-v, --verbose`       | boolean | `false`    | Show full detailed report in terminal mode (more sections visible).                          |
| `--full-content`      | boolean | `false`    | Keep nav/header/footer in content extraction (disable main-content filtering).               |
| `--exclude-tags <selectors...>` | string[] | — | CSS selectors to exclude from content extraction.                                    |
| `--include-tags <selectors...>` | string[] | — | CSS selectors to include (extract only these elements).                               |

**Examples:**

```bash
# Default: live terminal UI with progress indicators
sgnl analyze https://example.com

# JSON output, pipe to jq
sgnl analyze https://example.com --output json | jq '.performance'

# Save markdown reports to disk
sgnl analyze https://example.com --save --verbose

# Fast mode: skip Python, get only PSI/CrUX data
sgnl analyze https://example.com --skip-python --output json

# Desktop analysis instead of mobile
sgnl analyze https://example.com --device desktop

# Streaming: get partial results as they arrive
sgnl analyze https://example.com --stream --output json

# Crawl internal links (link tree mode)
sgnl analyze https://example.com --follow --depth 5 --max-pages 50

# Crawl only blog pages
sgnl analyze https://example.com --follow --include '/blog/*' --exclude '/blog/drafts/*'
```

**Terminal output** shows a live Ink/React UI with step-by-step progress, then a summary covering Core Web Vitals, SEO signals, structure, content quality, opportunities, and issues.

**JSON output** is an `AnalysisReport` object printed to stdout. Progress messages go to stderr, so `--output json` is safe to pipe.

**Follow mode output:**

```
Link Tree:
https://example.com
├── /about
│   └── /about/team
├── /blog
│   ├── /blog/post-1
│   └── /blog/post-2
└── /contact

Crawl Summary:
  Pages crawled: 6/100
  Max depth: 3
  External links: 12
  Errors: 0
```

**Errors:**

| Error                                  | Meaning                                                          |
| -------------------------------------- | ---------------------------------------------------------------- |
| `Error: Invalid URL "..."`             | URL doesn't start with `http://` or `https://`. Exit code 2.     |
| `Network error: Could not reach "..."` | DNS failure, connection refused, or timeout. Exit code 1.        |
| `Analysis failed: ...`                 | Pipeline error (Python crash, unexpected response). Exit code 1. |

---

### `sgnl technical <url>`

Focused, fast technical SEO audit. Fetches the page and runs `technical_seo.py` — no PageSpeed Insights, no CrUX, no DOM/content analysis. Typically 1–3 seconds per URL.

```
sgnl technical <url> [flags]
```

| Flag                | Type    | Default    | Description                                   |
| ------------------- | ------- | ---------- | --------------------------------------------- |
| `--output <format>` | string  | `terminal` | `terminal` or `json`                          |
| `--device <type>`   | string  | `mobile`   | `mobile` or `desktop`                         |
| `--save`            | boolean | `false`    | Save `technical_seo.md` to the runs directory |
| `--timeout <ms>`    | number  | `30000`    | Timeout per step in ms                        |

**Examples:**

```bash
# Terminal summary
sgnl technical https://example.com

# JSON for scripting
sgnl technical https://example.com --output json | jq '.technical.security_headers'

# Desktop User-Agent, save report
sgnl technical https://example.com --device desktop --save
```

**Covers:** Request context (status, TTFB, compression, CDN), redirect chain with annotated hop labels (HTTP→HTTPS, www↔apex, trailing-slash), meta tags with pass/warn/fail status, canonical with accurate self-referencing detection, Open Graph and article timestamps, Twitter Card, indexability (meta + `X-Robots-Tag`), security headers with full policy detail, caching with raw `Cache-Control` value, resource hints (preload/preconnect/dns-prefetch with URLs), URL structure flags, hreflang locale list, internal and external link counts with generic anchor detection, pagination (`rel=prev/next`) and AMP signals. The same sections land in `technical_seo.md` via `--save` and in `report.md` when produced by `sgnl analyze --save`.

**→ See [docs/technical-seo.md](docs/technical-seo.md) for the full reference**: per-section field documentation, JSON envelope shape, terminal and markdown output examples, canonical normalization logic, redirect annotation rules, known limitations, and implementation file map.

**Errors:**

| Error                                  | Meaning                                                     |
| -------------------------------------- | ----------------------------------------------------------- |
| `Error: No HTML received (HTTP 403)`   | Server returned a non-HTML response or blocked the request. |
| `Error: Technical SEO analysis failed` | Python script returned no data. Check Python installation.  |

**Requires:** Python 3.8+.

---

### `sgnl content <url>`

Language-neutral content extractor. Fetches the page, converts HTML to
Markdown via `split.py`, then runs `content_extract.py` to return objective
stats, heading outline, link inventory, image inventory, and the cleaned
body — designed to be fed to an LLM for any subjective judgment (quality,
EEAT, tone, relevance).

No EEAT heuristics. No readability scores. No keyword stuffing. No
per-language stopword lists. Just clean numbers and a clean body.

See [docs/content.md](docs/content.md) for the full field reference.

```
sgnl content <url> [flags]
```

| Flag                   | Type    | Default    | Description                                                    |
| ---------------------- | ------- | ---------- | -------------------------------------------------------------- |
| `--output <format>`    | string  | `terminal` | `terminal` or `json`                                           |
| `--device <type>`      | string  | `mobile`   | `mobile` or `desktop` — echoed into `request.device`           |
| `--stats-only`         | boolean | `false`    | Omit body, outline, link_inventory, image_inventory            |
| `--body-only`          | boolean | `false`    | Emit only metadata + body                                      |
| `--max-body-chars <n>` | integer | unlimited  | Truncate body to N chars; sets `body_truncated: true`          |
| `--save`               | boolean | `false`    | Save `content.md`, `content.json`, `content_stats.md` to runs/ |
| `--verbose`            | boolean | `false`    | Dump the raw payload (truncated) at the end of terminal output |
| `--timeout <ms>`       | number  | `30000`    | Timeout per step in ms                                         |
| `--full-content`       | boolean | `false`    | Keep nav/header/footer (disable main-content extraction)       |
| `--exclude-tags <selectors...>` | string[] | — | CSS selectors to exclude from extraction                |
| `--include-tags <selectors...>` | string[] | — | CSS selectors to include (extract only these elements)  |

**Examples:**

```bash
# Quick terminal stats
sgnl content https://example.com/blog/my-post

# Full AI-ready envelope
sgnl content https://example.com/blog/my-post --output json > page.json

# Body only, truncated
sgnl content https://example.com/blog/my-post --body-only --max-body-chars 8000 --output json

# Save cleaned body + stats + JSON to runs/
sgnl content https://example.com/blog/my-post --save
```

**Covers:** detected language, volume (words, chars, sentences, paragraphs),
paragraph + sentence length distributions (min/p50/p90/max), reading time,
lexical diversity, content-to-chrome ratio, heading counts + hierarchy
validation, list/table/code-block/blockquote counts, image alt coverage,
internal/external link split, duplicate paragraph/sentence counts, year
mentions, percentage count, nested heading outline, capped link inventory
(200 entries), capped image inventory (100 entries), and the cleaned
markdown body.

**Requires:** Playwright (headless Chromium) and Python 3.8+ with `beautifulsoup4` and `html2text`.

---

### `sgnl structure <url>`

Focused page structure audit: DOM metrics, heading tree, forms, images, scripts, accessibility, text density by region, and more. Runs `split.py`, `xray.py`, and `onpage.py` — no PSI. Emits a `{ request, structure: { xray, onpage } }` JSON envelope and writes `xray.md`, `onpage.md`, `assets.md`, `structure.md`, and `structure.json` with `--save`.

See [docs/structure.md](docs/structure.md) for the full per-section field reference, JSON envelope shape, markdown outputs, webflow-tier signals (positive-tabindex audit, largest-image LCP heuristic, text density by region, duplicate headings, table-of-contents detection), and known limitations.

```bash
sgnl structure https://example.com
sgnl structure https://example.com --output json | jq '.structure.xray.text_density_by_region'
sgnl structure https://example.com --save
```

**Requires:** Python 3.8+.

---

### `sgnl performance <url>`

Focused performance audit: Core Web Vitals verdict (PASS/FAIL at p75), Lighthouse category scores for performance/accessibility/best-practices/SEO, lab metrics, CrUX field data with histograms and collection period, resource summary (bytes + request counts), LCP element, CLS elements, render-blocking resources, third-party summary, bootup time, diagnostics, and all optimization opportunities with byte savings. Runs PageSpeed Insights + Chrome UX Report — no Python required. Emits a `{ request, performance }` JSON envelope and writes `performance.md`, `performance.json`, and `psi_debug.md` with `--save`.

See [docs/performance.md](docs/performance.md) for the full per-section field reference, CrUX scope fallback behaviour, CLS scaling explanation, CWV verdict rules, `--strategy both` dual-mode output, and known limitations.

```bash
sgnl performance https://example.com
sgnl performance https://example.com --device desktop
sgnl performance https://example.com --strategy both      # mobile + desktop side-by-side
sgnl performance https://example.com --verbose            # full opportunity list
sgnl performance https://example.com --output json | jq '.performance.cwv_passing'
sgnl performance https://example.com --save               # writes performance.md + .json + psi_debug.md
```

**Requires:** a PSI API key (`sgnl init` or `SGNL_PSI_KEY`). No Python.

---

### `sgnl robots <url>`

Audit a site's `robots.txt`: HTTP metadata, longest-match rule resolution with `*`/`$` wildcards, multi-agent verdict matrix across nine crawlers (Googlebot, Bingbot, GPTBot, CCBot, anthropic-ai, Google-Extended, PerplexityBot, Bytespider, `*`), AI-bot blocking summary, sitemap analysis with index expansion, and validation flags (size limit, content-type, cross-origin redirect, syntax warnings).

```bash
sgnl robots https://github.com
sgnl robots https://github.com --output json | jq '.robots.per_agent_verdict'
sgnl robots https://github.com --save          # writes robots_check.md + robots.json
sgnl robots https://example.org/private --meta-blocked
```

**→ See [docs/robots.md](docs/robots.md) for the full reference**: per-section field documentation, JSON envelope shape, terminal and markdown output examples, wildcard/longest-match rules with worked examples, HTTP status semantics per Google's spec, multi-agent verdict resolution, AI bot detection logic, validation warnings, sitemap index expansion, 8 known limitations, and implementation file map.

---

### `sgnl schema <url>`

Validate JSON-LD structured data on a page. Fetches the page, extracts all `<script type="application/ld+json">` blocks, and validates each against Schema.org + Google Rich Results expectations. Emits a `{ request, schema }` envelope matching the technical / structure / robots / performance shape.

See [docs/schema.md](docs/schema.md) for the full per-block field reference, scoring formula, correctness checks (`@context`, currency, aggregateRating, duplicate types, WebSite+SearchAction, nested completeness, inLanguage, image shape), JSON envelope example, markdown output, and known limitations.

```
sgnl schema <url> [flags]
```

| Flag                | Type    | Default    | Description                                                               |
| ------------------- | ------- | ---------- | ------------------------------------------------------------------------- |
| `--output <format>` | string  | `terminal` | `terminal` or `json` (pipe-friendly envelope)                             |
| `--device <type>`   | string  | `mobile`   | `mobile` or `desktop` — echoed into `request.device`                      |
| `--save`            | boolean | `false`    | Save `schema.md`, `schema.json`, and per-block raw JSON-LD files to runs/ |
| `--verbose`         | boolean | `false`    | In terminal mode, print the raw JSON-LD per block (truncated)             |
| `--timeout <ms>`    | number  | `30000`    | Timeout per analysis step in ms.                                          |

**Examples:**

```bash
# Validate structured data
sgnl schema https://www.nytimes.com

# JSON for CI checks
sgnl schema https://github.com --output json | jq '.schema.summary.rich_results_eligible'

# Save schema.md + schema.json + per-block raw JSON-LD
sgnl schema https://example.com/product/shoes --save

# Show raw JSON-LD per block in the terminal
sgnl schema https://example.com --verbose
```

**Terminal output (with data):**

```
Schema.org Validation — https://example.com/blog/my-post

  Request
    Status: 200
    TTFB: 142 ms
    Content-Type: text/html; charset=utf-8

  Blocks found: 2
  Valid blocks: 2/2
  Overall score: 88/100

  1. Article  [90/100]
     Required:  headline, author, datePublished, image, publisher  (5/5)
     Recommended: dateModified, description  (2/3)
     Rec. missing: inLanguage
     Rich Results: ELIGIBLE (Article rich result)

  2. BreadcrumbList  [85/100]
     Required:  itemListElement  (1/1)
     Rich Results: ELIGIBLE (Breadcrumb trail)

  Recommendations:
    [LOW] Article: Add 'inLanguage' (BCP 47 tag, e.g., 'en-US') for better internationalisation

  Note: Only JSON-LD markup is validated. Microdata and RDFa are not checked.
```

**Terminal output (no data):**

```
Schema.org Validation — https://example.com

  No JSON-LD structured data found on this page.

  Recommendation: Add JSON-LD markup for your primary content type
  (Article, Product, LocalBusiness, etc.) to enable Google rich results.
```

**Covers:** JSON-LD block extraction (`@graph` + arrays flattened), per-block type identification, required/recommended field presence, format errors (URL / ISO 8601 date / ISO 8601 duration / ISO 4217 currency / `@context` scheme), structural warnings (nested author/publisher, aggregateRating bounds, priceCurrency, FAQPage shape), rich results eligibility, per-block + overall 0–100 score, duplicate type detection, WebSite + SearchAction check, inLanguage + ImageObject shape recommendations.

**Errors:**

| Error                             | Meaning                         |
| --------------------------------- | ------------------------------- |
| `Error: Schema validation failed` | Python script returned no data. |

**Requires:** Python 3.8+. Only validates JSON-LD — Microdata and RDFa are not checked.

---

### `sgnl explorer crawl <url>`

Crawl a site starting from `<url>`, build a link graph, compute PageRank and content clusters, and generate an interactive HTML visualization.

```
sgnl explorer crawl <url> [flags]
```

| Flag                       | Type    | Default                   | Description                                                                                                 |
| -------------------------- | ------- | ------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `--max-pages <n>`          | number  | auto from sitemap, or 300 | Maximum pages to crawl. If omitted, uses sitemap URL count.                                                 |
| `--delay <ms>`             | number  | `500`                     | Delay between HTTP requests in milliseconds.                                                                |
| `--depth <n>`              | number  | `10`                      | Maximum crawl depth from the start URL.                                                                     |
| `--quiet`                  | boolean | `false`                   | Suppress progress output to stderr.                                                                         |
| `--sitemap-url <url>`      | string  | —                         | Use this sitemap directly instead of discovering via `robots.txt`.                                          |
| `--crawl-sitemap`          | boolean | `false`                   | Seed the crawl queue with all URLs from the sitemap. Without this, only the start URL is seeded.            |
| `--exclude-el <selectors>` | string  | —                         | Comma-separated CSS selectors — links inside matching elements are ignored. Example: `"header>nav,footer"`. |
| `--googlebot`              | boolean | `false`                   | Use Googlebot mobile User-Agent and respect `robots.txt` Disallow and Crawl-delay directives.               |
| `--resume`                 | boolean | `false`                   | Resume an interrupted crawl from the last checkpoint.                                                       |

**Crawl features:** priority queue (depth + inlinks + sitemap freshness scoring), adaptive rate limiting, 429/503 backpressure (Retry-After, exponential backoff), soft 404 fingerprinting (djb2 hash + trigram similarity), checkpoint/resume (every 50 pages), streaming JSONL, tracking parameter stripping.

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

# Use a specific sitemap, shallow crawl
sgnl explorer crawl https://example.com --sitemap-url https://example.com/blog-sitemap.xml --depth 3

# Quiet mode for scripting
sgnl explorer crawl https://example.com --quiet
```

**Output:**

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

**Files written:**

| File                  | Contents                                                                     |
| --------------------- | ---------------------------------------------------------------------------- |
| `crawl.jsonl`         | Raw crawl data (one JSON object per line per page)                           |
| `metadata.json`       | Crawl metadata: base URL, timestamp, sitemap URLs, errors, uncrawled reasons |
| `compact.json`        | Compressed link graph with PageRank, communities, and node metadata          |
| `explorer/index.html` | Interactive visualization (multi-file, with assets)                          |

All files are saved to `runs/{hostname}/{timestamp}/` under the configured runs path.

**Errors:**

| Error                       | Meaning                                                                                              |
| --------------------------- | ---------------------------------------------------------------------------------------------------- |
| `Error: Invalid URL "..."`  | URL doesn't parse as http/https. Exit code 2.                                                        |
| `Error: Python 3 required`  | `graph_analysis.py` needs Python. Crawl data is saved to `crawl.jsonl` even on failure. Exit code 1. |
| `Link explorer failed: ...` | General crawl failure (network, filesystem). Exit code 1.                                            |

**Requires:** Python 3.8+ (for graph analysis). GSC data is automatically included if authenticated.

---

### `sgnl explorer inspect <url>`

Show all stored data for a specific page from a previous crawl.

```
sgnl explorer inspect <url> [flags]
```

| Flag                | Type    | Default | Description                                                 |
| ------------------- | ------- | ------- | ----------------------------------------------------------- |
| `--run-dir <path>`  | string  | —       | Path to a specific run directory containing `compact.json`. |
| `--domain <domain>` | string  | —       | Find the latest run for this domain.                        |
| `--json`            | boolean | `false` | Output as JSON instead of formatted text.                   |

If neither `--run-dir` nor `--domain` is provided, the most recent run across all domains is used.

**Examples:**

```bash
# Inspect a page from the latest crawl
sgnl explorer inspect https://example.com/blog/my-post

# Inspect from a specific domain's latest run
sgnl explorer inspect https://example.com/about --domain example.com

# JSON output
sgnl explorer inspect https://example.com/ --json
```

**Terminal output:**

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

**Errors:**

| Error                          | Meaning                                                    |
| ------------------------------ | ---------------------------------------------------------- |
| `Node not found: ...`          | URL not in the crawl data. Suggests similar URLs if found. |
| `Error: No explorer run found` | No `compact.json` found. Run `sgnl explorer crawl` first.  |

---

### `sgnl explorer links <url>`

Show all inbound and outbound internal links for a page from a previous crawl.

```
sgnl explorer links <url> [flags]
```

Accepts `--run-dir`, `--domain`, and `--json` (same as `inspect`).

**Examples:**

```bash
# See link relationships for a page
sgnl explorer links https://example.com/blog/my-post

# JSON for analysis
sgnl explorer links https://example.com/ --json
```

**Terminal output:**

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

| Flag                | Type    | Default | Description                                                                                       |
| ------------------- | ------- | ------- | ------------------------------------------------------------------------------------------------- |
| `--type <type>`     | string  | —       | Filter by issue type. Values: `orphans`, `dead-ends`, `deep`, `errors`, `no-sitemap`, `external`. |
| `--run-dir <path>`  | string  | —       | Path to a specific run directory.                                                                 |
| `--domain <domain>` | string  | —       | Find the latest run for this domain.                                                              |
| `--json`            | boolean | `false` | Output as JSON.                                                                                   |

**Examples:**

```bash
# Show all issues
sgnl explorer list-issues

# Only orphan pages (no internal links pointing to them)
sgnl explorer list-issues --type orphans

# Only HTTP errors
sgnl explorer list-issues --type errors

# JSON for a specific domain
sgnl explorer list-issues --domain example.com --json
```

**Terminal output:**

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

| Type         | Meaning                                          |
| ------------ | ------------------------------------------------ |
| `orphans`    | Pages with zero inbound internal links           |
| `dead-ends`  | Pages with zero outbound internal links          |
| `deep`       | Pages more than 3 clicks from the start URL      |
| `errors`     | Pages returning 4xx or 5xx status codes          |
| `no-sitemap` | Crawled pages not found in the sitemap           |
| `external`   | Pages with an excessive number of external links |

---

### `sgnl explorer top-pages`

Show the highest-authority pages by PageRank from a previous crawl.

```
sgnl explorer top-pages [flags]
```

| Flag                              | Type   | Default | Description                            |
| --------------------------------- | ------ | ------- | -------------------------------------- |
| `-l, --limit <n>`                 | number | `10`    | Number of pages to show.               |
| `--run-dir`, `--domain`, `--json` | —      | —       | Same as other explorer query commands. |

**Examples:**

```bash
# Top 10 by PageRank
sgnl explorer top-pages

# Top 25
sgnl explorer top-pages --limit 25

# JSON output
sgnl explorer top-pages --json
```

**Terminal output:**

```
#   PageRank  Inlinks  URL
──────────────────────────────────────────────────────────────────────
  1     0.1247       48  https://example.com/
  2     0.0534       23  https://example.com/blog
  3     0.0312       18  https://example.com/products
```

---

### `sgnl explorer clusters`

List detected content clusters (communities) with page counts from a previous crawl.

```
sgnl explorer clusters [flags]
```

Accepts `--run-dir`, `--domain`, and `--json`.

**Examples:**

```bash
sgnl explorer clusters
sgnl explorer clusters --domain example.com --json
```

**Terminal output:**

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

List all pages in a specific content cluster.

```
sgnl explorer cluster <segment> [flags]
```

| Argument    | Required | Description                                                               |
| ----------- | -------- | ------------------------------------------------------------------------- |
| `<segment>` | Yes      | Cluster segment name, e.g. `/blog` or `blog` (leading slash is optional). |

Accepts `--run-dir`, `--domain`, and `--json`.

**Examples:**

```bash
# List pages in the /blog cluster
sgnl explorer cluster /blog

# Without leading slash also works
sgnl explorer cluster blog

# JSON output
sgnl explorer cluster /docs --json
```

**Terminal output:**

```
Cluster: /blog (48 pages)
  https://example.com/blog/post-1   PR:0.0312  In:12  Out:8
  https://example.com/blog/post-2   PR:0.0287  In:10  Out:6
  ...
```

**Errors:**

| Error                    | Meaning                                                 |
| ------------------------ | ------------------------------------------------------- |
| `Cluster not found: ...` | No cluster with that segment. Lists available clusters. |

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

**Terminal output:**

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

| Flag                              | Type   | Default | Description                            |
| --------------------------------- | ------ | ------- | -------------------------------------- |
| `-l, --limit <n>`                 | number | `10`    | Number of external domains to show.    |
| `--run-dir`, `--domain`, `--json` | —      | —       | Same as other explorer query commands. |

**Examples:**

```bash
sgnl explorer external
sgnl explorer external --limit 20 --json
```

**Terminal output:**

```
#   Domain                     Links  Pages linking out
──────────────────────────────────────────────────────────────────────
  1   fonts.googleapis.com          34  /, /blog, /about +31
  2   analytics.google.com          28  /, /blog, /products +25
  3   cdn.example.com               12  /blog/post-1, /blog/post-2 +10
```

---

### `sgnl explorer unranked`

Show pages that are not ranking in Google Search Console. Requires GSC data in the crawl run (authenticate with `sgnl gsc login` and re-crawl).

```
sgnl explorer unranked [flags]
```

Accepts `--run-dir`, `--domain`, and `--json`.

**Examples:**

```bash
sgnl explorer unranked
sgnl explorer unranked --domain example.com --json
```

**Terminal output:**

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

**Errors:**

| Error                           | Meaning                                                                      |
| ------------------------------- | ---------------------------------------------------------------------------- |
| `No GSC data found in this run` | The crawl doesn't contain ranking data. Run `sgnl gsc login`, then re-crawl. |

---

### `sgnl explorer canonicals`

Show pages where the canonical URL differs from the page URL, or where the canonical tag is missing.

```
sgnl explorer canonicals [flags]
```

Accepts `--run-dir`, `--domain`, and `--json`.

**Examples:**

```bash
sgnl explorer canonicals
sgnl explorer canonicals --domain example.com --json
```

**Terminal output:**

```
Canonical Mismatch (4):
  Page URL                                                    Canonical URL
  https://example.com/blog/old-slug                           https://example.com/blog/new-slug

Missing Canonical (2):
  https://example.com/landing/promo

Summary: 290 match, 4 mismatch, 2 missing
```

---

### `sgnl explorer robots-blocked`

Show pages blocked by robots.txt during the crawl. Only populated when `--googlebot` was used.

```
sgnl explorer robots-blocked [flags]
```

Accepts `--run-dir`, `--domain`, and `--json`.

**Examples:**

```bash
sgnl explorer robots-blocked
sgnl explorer robots-blocked --domain example.com --json
```

---

### `sgnl explorer compare`

Diff two crawl runs to see new/lost pages, PageRank movers, depth changes, and status changes.

```
sgnl explorer compare [flags]
```

| Flag                | Type    | Default | Description                                            |
| ------------------- | ------- | ------- | ------------------------------------------------------ |
| `--with <path>`     | string  | —       | Path to the second run directory to compare against.   |
| `--domain <domain>` | string  | —       | Auto-compare the two most recent runs for this domain. |
| `--json`            | boolean | `false` | Output as JSON.                                        |

**Examples:**

```bash
# Auto-compare two most recent runs
sgnl explorer compare --domain example.com

# Compare specific runs
sgnl explorer compare --run-dir runs/example_com/2026-04-01 --with runs/example_com/2026-03-15
```

See [`docs/explorer.md`](docs/explorer.md) for the full explorer command reference.

---

### `sgnl gsc login`

Authenticate with Google Search Console via OAuth2. Prompts for OAuth Client ID and Secret if not already stored, opens a browser for consent, then saves tokens and fetches verified properties.

```
sgnl gsc login
```

No flags. Interactive.

**Examples:**

```bash
# First-time authentication
sgnl gsc login

# Re-authenticate (credentials already stored, just refreshes tokens)
sgnl gsc login
```

**Output:**

```
Google Search Console requires OAuth2 credentials.
Create them at: https://console.cloud.google.com/apis/credentials
  1. Create an OAuth 2.0 Client ID (type: Desktop app)
  2. Enable the "Google Search Console API"

? OAuth Client ID: 123456789-abc.apps.googleusercontent.com
? OAuth Client Secret: GOCSPX-...

Opening browser for Google authorization...

Authentication successful!

Verified properties (2):
  sc-domain:example.com
  https://www.example.com/

Done. GSC data will be included in sgnl analyze for verified properties.
```

**Side effects:** Writes `~/.sgnl/config.json` (credentials + properties) and `~/.sgnl/gsc-tokens.json` (OAuth tokens). Opens a browser window. Starts a temporary local HTTP server for the OAuth callback (auto-selects a free port, times out after 2 minutes).

**Errors:**

| Error                                      | Meaning                                                                   |
| ------------------------------------------ | ------------------------------------------------------------------------- |
| `Error: Client ID and Secret are required` | Empty input for credentials.                                              |
| `Authentication failed: ...`               | OAuth flow failed — invalid credentials, user denied consent, or timeout. |

---

### `sgnl gsc logout`

Remove stored Google Search Console tokens and clear the properties list from config.

```
sgnl gsc logout
```

No flags.

**Examples:**

```bash
sgnl gsc logout
```

**Output:**

```
GSC tokens removed.
```

---

### `sgnl gsc status`

Show current GSC authentication state and list verified properties. Refreshes the property list if authenticated.

```
sgnl gsc status
```

No flags.

**Examples:**

```bash
sgnl gsc status
```

**Output (authenticated):**

```
GSC Configuration:
  Client ID: 123456789-ab...
  Auth: Active

  Properties (2):
    sc-domain:example.com
    https://www.example.com/
```

**Output (not configured):**

```
GSC: Not configured. Run `sgnl gsc login` to set up.
```

**Note:** This command refreshes and saves the property list to config as a side effect.

---

### `sgnl gsc pages [siteUrl]`

List ranked pages for a Search Console property over a date range, sorted by clicks. Pagination past 25k rows is handled transparently.

```
sgnl gsc pages [siteUrl] [flags]
```

| Argument/Flag               | Type              | Default               | Description                                                                             |
| --------------------------- | ----------------- | --------------------- | --------------------------------------------------------------------------------------- |
| `[siteUrl]`                 | string (optional) | first stored property | Site URL or domain to query. If omitted, uses the first property from `sgnl gsc login`. |
| `-l, --limit <n>`           | number            | `50`                  | Max pages to return. Paginated past 25k transparently.                                  |
| `--output <format>`         | string            | `terminal`            | `terminal`, `json`, or `csv`.                                                           |
| `--json`                    | boolean           | `false`               | Alias for `--output json`.                                                              |
| `--save`                    | boolean           | `false`               | Write `gsc.md`, `gsc.json`, and `gsc.csv` to the runs dir.                              |
| `--verbose`                 | boolean           | `false`               | Include raw API response in JSON output.                                                |
| `--days <n>`                | number            | `28`                  | Window size in days.                                                                    |
| `--start-date <YYYY-MM-DD>` | string            | —                     | Explicit start (overrides `--days`).                                                    |
| `--end-date <YYYY-MM-DD>`   | string            | —                     | Explicit end (pair with `--start-date`).                                                |
| `--search-type <type>`      | string            | `web`                 | `web`, `image`, `video`, `news`, or `discover`.                                         |
| `--country <iso>`           | string            | —                     | ISO-3 country code (e.g. `usa`, `deu`).                                                 |
| `--device <type>`           | string            | —                     | `desktop`, `mobile`, or `tablet`.                                                       |
| `--compare`                 | boolean           | `false`               | Fetch the previous equal-length window and emit deltas.                                 |

**Examples:**

```bash
# List top 50 ranked pages for your default property
sgnl gsc pages

# Specific property, CSV for spreadsheet workflows
sgnl gsc pages sc-domain:example.com --output csv > pages.csv

# Last 7 days, USA mobile traffic only
sgnl gsc pages --days 7 --country usa --device mobile

# Compare last 28d vs prior 28d
sgnl gsc pages --compare --days 28

# Save full report (md + json + csv)
sgnl gsc pages --save --limit 500
```

**Errors:**

| Error                             | Meaning                                                                           |
| --------------------------------- | --------------------------------------------------------------------------------- |
| `GSC not configured`              | Run `sgnl gsc login` first.                                                       |
| `Auth failed`                     | Token expired. Run `sgnl gsc login` to re-authenticate.                           |
| `No GSC property found for "..."` | The provided URL doesn't match any verified property. Lists available properties. |

---

### `sgnl gsc queries [siteUrl]`

List ranked search queries/keywords for a Search Console property. Same flag contract as `gsc pages`; dimensions the data by query instead of page.

```
sgnl gsc queries [siteUrl] [flags]
```

Accepts all flags from `gsc pages` (`--output`, `--json`, `--save`, `--verbose`, `-l/--limit`, `--days`, `--start-date`, `--end-date`, `--search-type`, `--country`, `--device`, `--compare`).

**Examples:**

```bash
# Top 50 queries (last 28d)
sgnl gsc queries

# Top 100, JSON envelope
sgnl gsc queries sc-domain:example.com --limit 100 --output json

# Image search traffic from Germany, CSV
sgnl gsc queries --search-type image --country deu --output csv
```

---

### `sgnl gsc url <url>`

Per-URL Search Analytics: page-level totals (clicks, impressions, CTR, position) plus the top 25 queries driving traffic to that URL.

```
sgnl gsc url <url> [flags]
```

Accepts the same flags as `gsc pages` except `-l/--limit` (the top-queries list is fixed at 25).

**Examples:**

```bash
# Quick look at a post
sgnl gsc url https://example.com/blog/seo-guide

# 90-day window, JSON envelope piped into jq
sgnl gsc url https://example.com/post --days 90 --output json | jq '.gsc.totals'

# Compare last 28 days vs previous 28
sgnl gsc url https://example.com/post --compare --days 28
```

**Note:** The top-queries list often sums to less than the page totals because GSC applies a privacy threshold to rare queries. The page-dimension totals are authoritative.

---

### `sgnl gsc inspect <url>`

Runs the URL Inspection API for a URL. Returns Google's live verdict: index state, coverage state, Google canonical, user canonical, crawl timestamp, robots/indexing/page-fetch state, rich results, mobile usability verdict and issues.

```
sgnl gsc inspect <url> [flags]
```

| Flag                | Default    | Description                                    |
| ------------------- | ---------- | ---------------------------------------------- |
| `--output <format>` | `terminal` | `terminal`, `json`, or `csv`.                  |
| `--json`            | `false`    | Alias for `--output json`.                     |
| `--save`            | `false`    | Write `gsc.md` and `gsc.json` to the runs dir. |
| `--verbose`         | `false`    | Include raw API response in JSON output.       |

**Examples:**

```bash
sgnl gsc inspect https://example.com/blog/post
sgnl gsc inspect https://example.com/post --output json --verbose
sgnl gsc inspect https://example.com/post --save
```

**Quota note:** Google enforces a per-property daily URL-inspection quota (~2000/day at time of writing). Batch carefully.

---

### `sgnl gsc sitemaps [siteUrl]`

List submitted sitemaps for a property with error/warning counts and per-content-type submitted/indexed splits.

```
sgnl gsc sitemaps [siteUrl] [flags]
```

| Flag                | Default    | Description                                                |
| ------------------- | ---------- | ---------------------------------------------------------- |
| `--output <format>` | `terminal` | `terminal`, `json`, or `csv`.                              |
| `--json`            | `false`    | Alias for `--output json`.                                 |
| `--save`            | `false`    | Write `gsc.md`, `gsc.json`, and `gsc.csv` to the runs dir. |
| `--verbose`         | `false`    | Include raw API response in JSON output.                   |

**Examples:**

```bash
sgnl gsc sitemaps
sgnl gsc sitemaps sc-domain:example.com --output json
sgnl gsc sitemaps --output csv > sitemaps.csv
```

See [docs/gsc.md](docs/gsc.md) for the full subcommand reference, envelope shape, CSV column contracts, comparison-window semantics, pagination behaviour, and known limitations.

---

### Shared flag reference

**Flags common to `technical`, `content`, `structure`, `performance`, `schema`:**

| Flag                | Type    | Default    | Description                                                        |
| ------------------- | ------- | ---------- | ------------------------------------------------------------------ |
| `--output <format>` | string  | `terminal` | `terminal` for formatted text, `json` for machine-readable output. |
| `--device <type>`   | string  | `mobile`   | `mobile` or `desktop`. Sets the User-Agent for the HTTP fetch.     |
| `--save`            | boolean | `false`    | Save report files to `runs/{domain}/{path}/{timestamp}/`.          |

Exception: `robots` does not accept `--device` (robots.txt is device-independent).

**Flags common to all explorer query subcommands** (`inspect`, `links`, `list-issues`, `top-pages`, `clusters`, `cluster`, `depth-map`, `external`, `unranked`):

| Flag                | Type    | Default | Description                                                 |
| ------------------- | ------- | ------- | ----------------------------------------------------------- |
| `--run-dir <path>`  | string  | —       | Path to a specific run directory containing `compact.json`. |
| `--domain <domain>` | string  | —       | Find the latest run for this domain (e.g. `example.com`).   |
| `--json`            | boolean | `false` | Output as JSON instead of formatted text.                   |

If neither `--run-dir` nor `--domain` is provided, the most recent run across all domains is used automatically.

### Custom HTTP headers

Some sites block automated requests. You can add custom headers (cookies, auth tokens, etc.) either persistently or per-command.

**Persistent headers** (stored in `~/.sgnl/config.json`):

```bash
# Global — sent with every request
sgnl headers set Cookie "session=abc123"

# Per-domain — sent only when analyzing this domain
sgnl headers set Authorization "Bearer tok_xxx" --domain staging.example.com

# List stored headers (sensitive values are masked)
sgnl headers list

# Remove a header
sgnl headers remove Cookie
sgnl headers remove Authorization --domain staging.example.com

# Clear all
sgnl headers clear
```

**Per-command override** (one-off, not persisted):

```bash
sgnl technical https://example.com -H "Cookie: session=abc" -H "Authorization: Bearer tok"
sgnl content https://example.com -H "X-Custom: value"
sgnl explorer crawl https://example.com -H "Cookie: auth=xyz"
```

**Precedence** (lowest to highest): device User-Agent → config global headers → config domain headers → `-H` CLI flags.

The `-H` flag is supported on `analyze`, `technical`, `content`, `structure`, `schema`, `robots`, and `explorer crawl`.

### Exit codes

| Code | Meaning                                                  |
| ---- | -------------------------------------------------------- |
| `0`  | Success                                                  |
| `1`  | Runtime error (network failure, Python crash, API error) |
| `2`  | Invalid input (malformed URL)                            |

---

## Architecture

For a detailed walkthrough of the codebase — project structure, data flow diagrams, design patterns, and how to add new commands — see [docs/HOW-IT-WORKS.md](docs/HOW-IT-WORKS.md).

---

## Troubleshooting

**"Python not found in PATH"**
Install Python 3.8+ and run `pnpm run setup-python`. SGNL auto-detects Python in `.venv/`, Homebrew, and system locations.

**`lxml` fails to install**
`lxml` requires a C compiler. On macOS: `xcode-select --install`. On Ubuntu: `apt install python3-dev libxml2-dev libxslt-dev`.

**PageSpeed data missing or rate-limited**
Get a free API key: [Google PSI API setup](https://developers.google.com/speed/docs/insights/v5/get-started#APIKey). Then run `sgnl init` to configure it, or set `SGNL_PSI_KEY` env var.

**Analysis returns empty data**
If Python features return empty results, check that dependencies are installed: `python3 -c "import bs4, html2text, lxml"`. If that fails, reinstall: `pip install -r python/requirements.txt`.

---

## Testing

```bash
# Run all tests
pnpm test

# Watch mode
pnpm run test:watch
```

**428 TypeScript tests across 21 suites + 238 Python tests** covering:

- HTTP fetch (safe fetch, redirects, timeouts, CDN/compression detection)
- PSI parsing (field data, lab data, opportunities)
- Python bridge (script execution, error handling)
- Merger (report assembly, null handling)
- Orchestrator (full pipeline, degraded mode)
- Explorer (crawler, PageRank, visualization)
- Report generation (markdown, terminal output)
- Integration (end-to-end CLI scenarios)
- Error handling (SgnlError hierarchy, formatErrorForUser)
- Retry utility (withRetry, exponential backoff)
- Process registry (child process tracking, cleanup)
- Logger (level filtering, output routing)

---

## Roadmap

Phase 2 ideas (contributions welcome):

- **Caching** — TTL-based result cache to avoid redundant fetches
- **Webhooks** — POST results to a URL on completion
- **API server** — Expose SGNL as an HTTP API for dashboard integrations
- **Diff mode** — Compare two snapshots and highlight regressions

---

## Contributing

PRs and issues welcome at [github.com/stoyan-koychev/sgnl-cli](https://github.com/stoyan-koychev/sgnl-cli).

1. Fork the repo
2. Create a branch: `git checkout -b feat/your-feature`
3. Make changes with tests
4. Submit a PR

---

## License

MIT © STOYAN — see [LICENSE](LICENSE) for details.
