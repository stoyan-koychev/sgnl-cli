# SGNL Usage Walkthrough

A step-by-step guide to running SGNL and understanding the output.

---

## 1. Install

```bash
pnpm add -g sgnl
```

Verify it's available:

```bash
sgnl --help
# Usage: sgnl [options] [command]
# SGNL — Signal Intelligence CLI: analyze any URL ...
```

---

## 2. Commands

| Command | Description |
|---------|-------------|
| `sgnl init` | Set up API keys and output path |
| `sgnl analyze <url>` | Analyze a URL for performance, SEO, and structure |
| `sgnl schema <url>` | Validate Schema.org JSON-LD structured data |
| `sgnl explorer <url>` | Crawl a site and generate an interactive link map |

---

## 3. Run a basic analysis

```bash
sgnl analyze https://example.com
```

SGNL will:
1. Fetch the URL with a mobile User-Agent (records TTFB, detects CDN/compression, follows redirects)
2. Run Python analysis: split HTML, DOM X-ray, technical SEO, on-page SEO, content analysis, schema validation, robots.txt check
3. Call Google PageSpeed Insights API (mobile by default, `--device desktop` to override)
4. Fetch CrUX field data
5. Calculate weighted scores
6. Merge everything into a single report
7. Render the terminal UI

The whole thing typically takes **3-8 seconds**.

---

## 4. Terminal output — annotated

```
 OVERALL SCORE
 ████████████████████████████████░░░░░░░░  78/100
 ┌──────────────────────────────────────────────────────────────────────────┐
 │  Performance   ████████████████████████████████░░░░░░░░  82/100        │
 │  SEO           ████████████████████████████░░░░░░░░░░░░  74/100        │
 │  Structure     ████████████████████████████░░░░░░░░░░░░  72/100        │
 └──────────────────────────────────────────────────────────────────────────┘
```

```
 CORE WEB VITALS
 LCP     2100 ms   Good     (target: < 2500 ms)
 CLS     0.08      Good     (target: < 0.10)
 INP     180 ms    Good     (target: < 200 ms)

 SPEED METRICS
 TTFB    210 ms                CDN: cloudflare
 SI      1.8 s                 Compression: gzip
 TTI     3.2 s
```

- **LCP** (Largest Contentful Paint) — how fast the main content loads
- **CLS** (Cumulative Layout Shift) — how stable the layout is
- **INP** (Interaction to Next Paint) — responsiveness to user input
- **TTFB** — time from request to first byte received

```
 ISSUES
 [CRITICAL] ...
 [WARNING]  1 image(s) missing alt text: accessibility and SEO issue
 [WARNING]  Render-blocking resources detected: ~650ms potential savings
 [INFO]     2 image(s) missing width/height dimensions: may cause layout shifts
```

---

## 5. JSON output

```bash
sgnl analyze https://example.com --output json
```

Outputs the full `AnalysisReport` as pretty-printed JSON. Pipe it anywhere:

```bash
sgnl analyze https://example.com --output json | jq '.scores.overall_score'
# 78

sgnl analyze https://example.com --output json | jq '.schema_validation'
sgnl analyze https://example.com --output json | jq '.robots'
sgnl analyze https://example.com --output json | jq '.issues'
```

See [sample-report.json](sample-report.json) for the complete structure and [report-schema.json](report-schema.json) for the JSON Schema.

---

## 6. Schema validation

```bash
sgnl schema https://example.com
```

Validates all JSON-LD structured data on the page:
- Required/recommended field checks per schema type
- Google Rich Results eligibility
- Format validation (dates, URLs, durations)
- Scoring (0-100) and actionable recommendations

```bash
sgnl schema https://example.com --output json | jq '.summary'
```

Raw JSON-LD blocks and the full report are saved to the `runs/` directory.

---

## 7. Device mode

By default, SGNL fetches pages with a **mobile** User-Agent and runs PSI for mobile. Override with:

```bash
sgnl analyze https://example.com --device desktop
sgnl schema https://example.com --device desktop
```

This affects the fetched HTML (servers may return different content for mobile vs desktop) and the PSI strategy.

---

## 8. Analyze flags

| Flag | Description |
|------|-------------|
| `--output <format>` | `terminal` (default) or `json` |
| `--device <type>` | `mobile` (default) or `desktop` |
| `--debug` | Include raw analysis data in output |
| `--skip-python` | Skip Python analysis layer (faster, no DOM/SEO scores) |
| `--python-only` | Skip PageSpeed Insights, run Python analysis only |
| `--stream` | Enable streaming output (partial then complete report) |
| `--follow` | Crawl internal links and build link tree |
| `--depth <n>` | Max crawl depth for `--follow` (default: 3) |
| `--max-pages <n>` | Max pages to crawl for `--follow` (default: 100) |
| `--include <pattern>` | Only crawl paths matching pattern |
| `--exclude <pattern>` | Skip paths matching pattern |

---

## 9. Using an API key

By default SGNL calls the PageSpeed Insights API without a key (rate-limited to ~2 req/min). For CI or repeated use, set your key:

```bash
export SGNL_PSI_KEY=AIza...your_key_here
sgnl analyze https://example.com
```

Or configure via `sgnl init`.

---

## 10. CI usage example

```bash
#!/bin/bash
# Run analysis and fail if overall score < 70

SCORE=$(sgnl analyze https://mysite.com --output json | jq '.scores.overall_score')

if [ "$SCORE" -lt 70 ]; then
  echo "SGNL score $SCORE < 70 — failing build"
  exit 1
fi

echo "SGNL score $SCORE — OK"
```

---

## Report Schema Reference

See [sample-report.json](sample-report.json) for a full annotated example.

Key top-level fields:

| Field | Type | Description |
|---|---|---|
| `scores.overall_score` | number | Weighted composite 0-100 |
| `scores.performance.cwv` | number | Core Web Vitals sub-score |
| `scores.seo.technical` | number | Technical SEO sub-score |
| `performance.core_web_vitals.lcp_ms` | number | LCP in milliseconds |
| `performance.resource_summary` | object | Page weight by resource type (JS/CSS/image/font) |
| `issues.critical` | string[] | Critical issues (fix first) |
| `robots` | object | Robots.txt analysis (disallow rules, sitemaps, crawl-delay) |
| `schema_validation` | object | Schema.org JSON-LD validation (score, rich results, recommendations) |
| `content_analysis` | object | Content quality (depth, E-E-A-T, freshness, readability) |
| `analysis_detail` | object | Full raw Python script outputs for deep analysis |
