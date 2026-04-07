# `sgnl structure` — Page Structure Command

Focused audit of a page's DOM, headings, content, images, forms, scripts, and accessibility signals. Runs the HTTP fetch layer plus `python/split.py`, `python/xray.py`, and `python/onpage.py` — no PageSpeed Insights, no Chrome UX Report. Typically 2–4 seconds per URL.

Unlike `sgnl analyze`, this command bypasses the orchestrator/merger pipeline entirely. It talks directly to the Python scripts and formats their raw output, so **you always see the full fidelity** of what `xray.py` and `onpage.py` produce — no mapper squeeze, no cherry-picking.

---

## Contents

- [When to use it](#when-to-use-it)
- [Usage](#usage)
- [Pipeline](#pipeline)
- [Terminal output](#terminal-output)
- [Sections reference](#sections-reference)
- [JSON output](#json-output)
- [Markdown output](#markdown-output)
- [Webflow-tier signals](#webflow-tier-signals)
- [Known limitations](#known-limitations)
- [Implementation](#implementation)
- [See also](#see-also)

---

## When to use it

Use `sgnl structure` when:

- You want a **quick DOM + heading + accessibility snapshot** without waiting for PSI (which can take 10–30s).
- You're **debugging heading hierarchy or outline issues** and want the heading tree rendered visually.
- You need **structured-data signals** (forms, scripts, images, links) faster than `sgnl analyze` can produce them.
- You're running **CI smoke tests** across many URLs and only need the HTML-layer analysis.
- You want the **ground-truth output of `xray.py` / `onpage.py`** without going through the merger's field subset.

Use `sgnl analyze` instead when you want Core Web Vitals, content quality scoring, and a merged issues list alongside the structure signals.

---

## Usage

```
sgnl structure <url> [flags]
```

### Flags

| Flag | Type | Default | Description |
|---|---|---|---|
| `--output <format>` | string | `terminal` | `terminal` (human-readable) or `json` (pipe-friendly, structured) |
| `--device <type>` | string | `mobile` | `mobile` or `desktop`. Affects the User-Agent used on the fetch. |
| `--save` | boolean | `false` | Also write `xray.md`, `onpage.md`, `assets.md`, `structure.md`, and `structure.json` to the runs directory. |
| `--timeout <ms>` | number | `30000` | Per-step timeout in milliseconds (applies to fetch and each Python script). |

### Examples

```bash
# Human-readable terminal output
sgnl structure https://nextjs.org

# JSON envelope for piping into jq or CI
sgnl structure https://nextjs.org --output json | jq '.structure.xray.text_density_by_region'

# Save a full set of markdown + JSON reports
sgnl structure https://nextjs.org --save

# Tighter timeout for batch scripts
sgnl structure https://nextjs.org --timeout 15000 --output json
```

### Requirements

Python 3.8+ with `beautifulsoup4` installed. Without Python, the command fails immediately — unlike `sgnl analyze`, there is no degraded-mode fallback since the Python scripts are the only data sources.

---

## Pipeline

```
  sgnl structure <url>
        │
        ▼
  safeFetch(url, { device, timeout })
        │
        │  (html, headers, status, ttfb_ms, redirect_chain, content_type, content_length)
        ▼
  python/split.py  (skeleton + markdown extraction)
        │
        ▼
  python/xray.py  ────┐          python/onpage.py  (in parallel)
  (DOM structure)     │          (headings, content, links, images, crawlability)
                      ▼
              { request, structure: { xray, onpage } }
                      │
                      ▼
            Terminal printer  OR  JSON envelope  OR  --save to runs/
```

Unlike the `sgnl analyze` path, **there is no merger and no orchestrator**. The Python outputs are returned almost verbatim, with only a small envelope wrapping `request` metadata from the fetch layer.

---

## Terminal output

A representative run against a modern site produces output with the following sections, in order:

1. **Request** — final URL, HTTP status, TTFB, content type, content length.
2. **Redirects** — annotated redirect chain (only if `redirect_chain.length > 0`).
3. **DOM** — element count, unique tags, max/avg depth, deepest-path tail, top 5 element frequencies.
4. **Structure** — semantic score, div ratio, heading hierarchy validity, H1/H2/H3 counts.
5. **Heading Tree** — indented outline (up to 4 levels, with `(+N more)` for deeper), H1 content highlighted.
6. **Headings** — totals, empty headings, H4/H5/H6 counts, issue bullets, TOC-detected flag.
7. **Content** — word count (from `onpage.py`, authoritative), paragraph count, avg paragraph length, HTML size, text ratio.
8. **Red Flags** — empty elements, duplicate IDs, inline handlers, deprecated tags, iframes (+ first 3 domains).
9. **Head** — charset, viewport, favicon, preload count.
10. **Accessibility** — missing lang on `<html>`, images missing alt, inputs without label, buttons/links with no text, ARIA attribute count, positive tabindex count.
11. **Links (x-ray)** — totals, internal/external, `target=_blank` missing `rel`.
12. **Links (on-page)** — internal total + generic anchor, external total + broken.
13. **Forms** — form count, input count, button count, inputs without labels, forms missing `action`.
14. **Images** — total, missing/decorative/short/long/poor-quality alt, explicit dimensions, density per 1000 words.
15. **Scripts** — total, inline/external, defer/async, third-party count + category breakdown.
16. **Inline styles** — count.
17. **Text density by region** — word counts in `header`, `main`, `aside`, `footer`.
18. **Largest image candidate** — first `<img>` in `<main>`/`<body>` with biggest declared dimensions (static LCP heuristic).
19. **Duplicate headings** — top 5 heading texts appearing 2+ times.
20. **Crawlability** — status code, redirect count, robots blocked, sitemap found, HTTPS enforced, mixed content.

---

## Sections reference

All fields below are additive; any field not emitted by the Python layer renders as `n/a`.

### Request

| Field | Source | Notes |
|---|---|---|
| `final_url` | `fetch.redirect_chain` last hop or original URL | Reflects redirects followed |
| `status` | `fetch.status` | HTTP response code |
| `ttfb_ms` | `fetch.ttfb_ms` | Server time-to-first-byte |
| `content_type` | response headers | `Content-Type` |
| `content_length` | response headers | `Content-Length`, numeric if parseable |
| `redirect_chain` | `fetch.redirect_chain` | Array of Location-header URLs in order |

### DOM

Source: `xray.py → dom`, `xray.py → element_map`.

| Field | Type | Notes |
|---|---|---|
| `total_elements` | int | All non-head-only tags in the skeleton |
| `unique_tags` | int | Distinct tag names in use |
| `depth_max` | int | Maximum nesting depth |
| `depth_avg` | float | Average depth across all elements |
| `deepest_path` | string[] | Tag chain to the deepest element (last 5 shown) |
| `element_map` | object | Tag → count, sorted descending |

### Structure

Source: `xray.py → structure`.

| Field | Type | Notes |
|---|---|---|
| `semantic_score` | int 0–7 | Factual count of `main header footer nav article section aside` present |
| `div_ratio` | float 0–1 | `div` count / total elements |
| `heading_hierarchy_valid` | bool | true iff exactly one H1 and no skipped levels |
| `h1_count`, `h2_count`, `h3_count` | int | From the element map |
| `empty_elements` | int | Elements with no children or text |
| `duplicate_ids` | int | Count of IDs appearing 2+ times |
| `deprecated_tags` | string[] | `font`, `center`, `marquee`, etc. found |
| `inline_event_handlers` | int | Count of `onclick`, `onload`, etc. attributes |
| `iframes` | `{ count, domains[] }` | iframe count + unique src domains |

### Heading Tree

Source: `onpage.py → headings.tree`. Nested nodes with `{ level, text, children }`. Rendered as an indented outline in the terminal, max depth 4.

Also available:

| Field | Type | Notes |
|---|---|---|
| `h1_content` | string | Text of the first H1 |
| `total_headings` | int | All H1–H6 combined |
| `empty_headings` | int | Headings with no visible text |
| `h4_count`, `h5_count`, `h6_count` | int | Extended counts |
| `violations[]` | array | `{ from_level, to_level, heading, issue_type }` |
| `issues[]` | string[] | Human-readable descriptions |
| `table_of_contents_detected` | bool | True if 3+ anchor links target H2/H3 ids |

### Content

Source: `onpage.py → content` (authoritative word count) and `xray.py → content_ratios` (size metrics).

| Field | Type | Notes |
|---|---|---|
| `word_count` | int | From `onpage.py`, more accurate than `xray.py` approximation |
| `paragraph_count` | int | Non-empty lines in the extracted markdown |
| `avg_paragraph_length` | float | Words per paragraph |
| `html_size_kb` | float | Raw HTML byte size |
| `html_text_ratio` | float | Visible text length / total HTML length |

### Forms

Source: `xray.py → forms`.

| Field | Type | Notes |
|---|---|---|
| `form_count` | int | `<form>` tags |
| `input_count` | int | `<input>` tags |
| `button_count` | int | `<button>` tags |
| `inputs_without_labels` | int | Inputs with no `<label for>` or parent `<label>` (excludes type=hidden) |
| `forms_missing_action` | int | Forms without an `action` attribute |

### Images

Source: `onpage.py → images`. All fields are rich image-alt-quality signals in addition to the shallow `total`/`missing_alt`.

| Field | Type | Notes |
|---|---|---|
| `total` | int | All `<img>` tags |
| `missing_alt` | int | No `alt` attribute present |
| `empty_alt_decorative` | int | `alt=""` (valid decorative pattern) |
| `too_short` | int | `alt` < 3 chars |
| `too_long` | int | `alt` > 125 chars |
| `poor_quality_alt` | int | Matches generic patterns (`image`, `photo`, `img123.jpg`, etc.) |
| `explicit_dimensions` | int | Images with both `width` and `height` set |
| `density_per_1000_words` | float | `total` / (word_count / 1000) |

### Accessibility

Source: `xray.py → accessibility` plus `xray.py → tabindex_audit`.

| Field | Type | Notes |
|---|---|---|
| `html_missing_lang` | bool | `<html>` tag without `lang` |
| `images_missing_alt` | int | (same xray count; onpage's richer version is above) |
| `inputs_without_label` | int | Same detection as forms.inputs_without_labels |
| `buttons_links_no_text` | int | `<button>` or `<a>` with no visible text and no `aria-label` |
| `aria_attribute_count` | int | Total `aria-*` attributes across all tags |
| `positive_tabindex_count` | int | Elements with `tabindex > 0` (accessibility smell) |

### Scripts

Source: `xray.py → scripts` and nested `scripts.third_party`.

| Field | Type | Notes |
|---|---|---|
| `total`, `inline`, `external` | int | Totals and split |
| `defer_count`, `async_count` | int | Script loading attributes |
| `third_party.count` | int | Scripts from non-first-party domains |
| `third_party.domains` | string[] | Unique third-party domains |
| `third_party.categories` | object | `{ analytics, ads, cdn, social, other }` → domain[] |
| `third_party.tag_manager_detected` | bool | Google Tag Manager, Tealium, Adobe DTM, OneTrust |

### Crawlability

Source: `onpage.py → crawlability`. Some overlap with `sgnl technical`, but the structure command renders what it has.

| Field | Type | Notes |
|---|---|---|
| `status_code` | int | From input headers |
| `redirect_count` | int | From input headers |
| `robots_blocked` | bool | From input headers |
| `sitemap_found` | bool | From input headers |
| `https_enforced` | bool | From input headers |
| `mixed_content` | bool | From input headers |

---

## JSON output

`--output json` emits the envelope:

```json
{
  "request": {
    "final_url": "https://example.com/",
    "status": 200,
    "ttfb_ms": 342,
    "content_type": "text/html; charset=utf-8",
    "content_length": 12345,
    "redirect_chain": []
  },
  "structure": {
    "xray":   { /* full xray.py output */ },
    "onpage": { /* full onpage.py output */ }
  }
}
```

This matches the `{ request, technical }` envelope emitted by `sgnl technical --output json`, for consistency.

---

## Markdown output

When `--save` is passed, the runs directory receives:

| File | Builder | Contents |
|---|---|---|
| `xray.md` | `buildXrayMd` | Raw xray.py output as tables (DOM, structure, element distribution, head, accessibility, forms, links, inline styles, text density, largest image candidate, duplicate headings) |
| `onpage.md` | `buildOnpageMd` | Raw onpage.py output (content, headings + tree, violations, links, images, crawlability) |
| `assets.md` | `buildAssetsMd` | Parsed assets from raw HTML (images, scripts, stylesheets, preloads) |
| `structure.md` | `buildStructureMd` | **Unified summary** — the same sections as the terminal output, rendered as markdown with request + redirects header |
| `structure.json` | — | Full JSON envelope (same as `--output json`) |

---

## Webflow-tier signals

Phase 4 adds several high-signal metrics that aren't redundant with the existing xray audits:

- **`tabindex_audit.positive_tabindex_count`** — elements with `tabindex > 0` are an accessibility smell; the natural tab order should be preserved.
- **`largest_image_candidate`** — the first `<img>` in `<main>` or `<body>` with the biggest declared `width × height`, used as a static LCP (Largest Contentful Paint) heuristic. Returns `{ src, width, height }` or `null` when no sized images exist.
- **`text_density_by_region`** — word counts per semantic region (`main`, `aside`, `footer`, `header`), useful for spotting thin `<main>` content on otherwise wordy pages.
- **`duplicate_headings`** — up to 5 heading texts (case-insensitive) that appear 2+ times on the page; an outline quality signal.
- **`table_of_contents_detected`** — `true` when the page has 3+ anchor links whose `href="#..."` targets match actual H2 or H3 element ids; marks long-form content with navigation.

All five flow through the analyze pipeline to `report.structure` / `report.seo.content` via the merger's `Partial<DOMAnalysis>` / `Partial<OnPageSEO>` intersection.

---

## Known limitations

1. **No PSI signals.** This command does not call PageSpeed Insights. Use `sgnl analyze` for Core Web Vitals, Lighthouse score, and render-blocking opportunities.
2. **Skeleton-only xray.** `xray.py` runs against the splitter's skeleton HTML by default, which has all text stripped. Some metrics that need original text (word count, title check, script inventory) fall back to the full HTML passed in the Python input.
3. **Largest-image heuristic is declared dimensions only.** It does not fetch images or measure their natural size; `<img>` tags without `width`/`height` attributes are ignored even if they're visually dominant.
4. **TOC detection is conservative.** The heuristic requires 3+ anchor links whose hash targets match actual H2/H3 ids, so TOCs built with JavaScript or linking to H4 only are missed.
5. **Crawlability input is header-driven.** `onpage.py`'s crawlability section reads `headers['robots_blocked']`, `headers['sitemap_found']`, etc. — which the `sgnl structure` flow doesn't populate. Use `sgnl technical` or `sgnl analyze` for authoritative crawlability signals.
6. **Duplicate headings capped at 5.** Sites with many repeated heading patterns will only see the top 5 by frequency.
7. **Text-density regions are naive.** Nested semantic regions (e.g. `<main>` inside `<article>`) are counted per top-level region found by `soup.find()`. Multi-column layouts or nested `<main>` blocks may produce surprising counts.
8. **No content scoring.** Unlike `sgnl analyze`, this command does not emit a readability score, E-E-A-T signals, or thin-content risk. Use `sgnl content` or `sgnl analyze` for those.
9. **JSON envelope is not the AnalysisReport.** `sgnl structure --output json` wraps raw Python output. For the merged `AnalysisReport` shape used by the library API, use `sgnl analyze` or `SgnlClient.analyze()`.

---

## Implementation

| File | Purpose |
|---|---|
| `src/commands/structure.ts` | Command registration, fetch + Python orchestration, terminal printer, JSON envelope |
| `python/split.py` | HTML → skeleton + markdown extractor |
| `python/xray.py` | DOM + structure + audits (incl. Phase 4 webflow-tier signals) |
| `python/onpage.py` | Headings, content, links, images, crawlability, TOC detection |
| `src/analysis/run-reporter.ts` | `buildXrayMd`, `buildOnpageMd`, `buildStructureMd` helpers |
| `src/analysis/scoring.ts` | `DOMAnalysis` and `OnPageSEO` typed interfaces |
| `src/analysis/orchestrator.ts` | `mapXrayToDOMAnalysis` and `mapOnpageToOnPageSEO` mappers (used by the analyze pipeline, not by this command) |
| `src/analysis/merger.ts` | Spreads mapped source objects into `report.structure` / `report.seo.content` so new fields reach `AnalysisReport` |
| `src/analysis/redirects.ts` | `annotateRedirectChain` — shared helper used by the terminal printer |

Tests:

- `tests/python/test_xray.py` — 90 tests covering all audits + Phase 4 additions.
- `tests/python/test_onpage.py` — 36 tests covering content, headings, links, images, crawlability, and TOC detection.
- `tests/unit/mappers.test.ts` — TypeScript mapper coverage for Phase 4 DOMAnalysis fields and `table_of_contents_detected`.

---

## See also

- [`sgnl technical`](./technical-seo.md) — Focused technical SEO command (meta, canonical, security headers, hreflang, caching, pagination).
- [`sgnl performance`](./performance.md) — Focused performance command (Core Web Vitals verdict, CrUX field data, Lighthouse audits, opportunities).
- [`sgnl robots`](./robots.md) — Focused robots.txt audit (longest-match rules, multi-agent verdicts, AI bot blocking).
- [`sgnl schema`](./schema.md) — Focused JSON-LD validator (per-block scoring, rich results eligibility, correctness checks).
- [`sgnl analyze`](../README.md#sgnl-analyze) — Full pipeline with PSI, CrUX, and the merged `AnalysisReport`.
- [`docs/content.md`](./content.md) — Content quality scoring (readability, E-E-A-T, thin-content risk, first-paragraph hook, passive voice).
- [`docs/gsc.md`](./gsc.md) — Google Search Console focused command (pages, queries, URL inspection, sitemaps, compare windows).
- [`docs/explorer.md`](./explorer.md) — site crawler, link graph visualization, and structural analysis.
