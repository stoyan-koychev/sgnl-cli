# `sgnl performance` — Page Performance Command

Focused, fast audit of a page's performance signals. Runs Google PageSpeed Insights (Lighthouse + loadingExperience) plus the standalone Chrome UX Report (CrUX) API in parallel — no Python, no DOM extraction, no merger. Typically 1–6 seconds per URL depending on upstream latency.

Unlike `sgnl analyze`, this command bypasses the orchestrator/merger pipeline for its terminal and JSON outputs. It talks directly to the PSI and CrUX APIs and formats the result, so you always see the full fidelity of what Lighthouse returned — no mapper squeeze, no cherry-picking. (The same expanded PSI shape also reaches `report.performance` on the `AnalysisReport` via `merger.ts`, so library consumers see every field too.)

---

## Contents

- [When to use it](#when-to-use-it)
- [Usage](#usage)
- [Pipeline](#pipeline)
- [Terminal output](#terminal-output)
- [Sections reference](#sections-reference)
- [JSON output](#json-output)
- [Markdown output](#markdown-output)
- [CrUX scope fallback](#crux-scope-fallback)
- [CLS scaling](#cls-scaling)
- [Core Web Vitals verdict](#core-web-vitals-verdict)
- [Known limitations](#known-limitations)
- [Implementation](#implementation)
- [See also](#see-also)

---

## When to use it

Use `sgnl performance` when:

- You want a **quick performance snapshot** — Core Web Vitals verdict, lab metrics, top opportunities — in a few seconds.
- You're **debugging slow pages** and need the Lighthouse audit list plus the specific LCP element, layout-shift elements, render-blocking resources, and third-party entities that are costing you.
- You're **comparing mobile vs desktop** on the same URL with `--strategy both`.
- You need **real-user field data** from CrUX with the 28-day collection period and p75 distributions — not just the Lighthouse lab synthetic run.
- You want the **CWV PASS / FAIL verdict** at p75 for the three weighted metrics (LCP ≤ 2500, CLS ≤ 0.1, INP ≤ 200).
- You're **batching** performance checks across many URLs in a CI pipeline where each URL should emit a `{ request, performance }` envelope.

Use `sgnl analyze` instead when you want the full pipeline — performance + content + technical + robots — merged into one `AnalysisReport` with issues and scoring.

---

## Usage

```
sgnl performance <url> [flags]
```

### Flags

| Flag | Type | Default | Description |
|---|---|---|---|
| `--output <format>` | string | `terminal` | `terminal` (human-readable) or `json` (pipe-friendly envelope) |
| `--device <type>` | string | `mobile` | `mobile` or `desktop`. Ignored when `--strategy both` is passed. |
| `--strategy <type>` | string | — | `mobile`, `desktop`, or `both`. When `both` is passed, PSI is called twice in parallel and the output shows both strategies side-by-side. Mutually exclusive with `--device`. |
| `--save` | boolean | `false` | Write `performance.md`, `performance.json`, and `psi_debug.md` to the runs directory. |
| `--verbose` | boolean | `false` | Show the full opportunity list. Default is top 5. |
| `--timeout <ms>` | number | `30000` | Per-step timeout in milliseconds. |

### Examples

```bash
# Human-readable terminal output (mobile)
sgnl performance https://github.com

# Desktop strategy
sgnl performance https://github.com --device desktop

# Dual-strategy: mobile + desktop side-by-side
sgnl performance https://github.com --strategy both

# JSON envelope for piping into jq — grab the CWV verdict
sgnl performance https://github.com --output json | jq '.performance.cwv_passing'

# Grab every opportunity with its savings_bytes
sgnl performance https://github.com --verbose --output json | jq '.performance.opportunities'

# Save performance.md + performance.json + psi_debug.md
sgnl performance https://github.com --save
```

### Requirements

- A PSI API key (required). Run `sgnl init` or set `SGNL_PSI_KEY`. Without a key, both PSI and CrUX calls fail.
- The CrUX API uses the same key. No separate setup.
- No Python required for this command.

---

## Pipeline

```
  sgnl performance <url>
        │
        ├─ callPSI(url, strategy) ─────────────── PSI API
        │     │ extractLabData
        │     │ extractFieldDataFromLighthouse   (CLS÷100 scaling fix)
        │     │ extractResourceSummary            (bytes + request counts)
        │     │ extractCategoryScores             (perf+a11y+BP+SEO)
        │     │ extractOpportunities              (+ savings_bytes)
        │     │ extractAuditDetails
        │     │   ├─ largest-contentful-paint-element
        │     │   ├─ layout-shift-elements (top 5)
        │     │   ├─ render-blocking-resources (top 5)
        │     │   ├─ third-party-summary (top 5)
        │     │   ├─ bootup-time (top 5 + total)
        │     │   ├─ server-response-time
        │     │   ├─ network-requests (count)
        │     │   └─ diagnostics
        │     ▼
        └─ fetchCrUXData(url, {formFactor}) ───── CrUX API
              │ URL-level lookup
              │   │ if 404 → origin-level fallback
              │   ▼
              │ parseCrUXMetric (NO scaling — raw CLS)
              │ collectionPeriod (28-day window)
              │ scope: 'url' | 'origin'
              ▼
        buildPerformanceReport(psi, crux)
              │ CWV verdict at p75
              │ prefer CrUX over PSI loadingExperience
              ▼
        { request, performance }
              │
              ▼
  Terminal printer  OR  JSON envelope  OR  --save to runs/
```

Unlike the `sgnl analyze` path, **there is no orchestrator step and no mapper squeeze**. The PSI + CrUX output is wrapped in a small `{ request, performance }` envelope and returned almost verbatim.

---

## Terminal output

A single-strategy run produces sections in this order:

1. **Core Web Vitals verdict headline** — `PASSING` / `FAILING` / `Insufficient data`, computed at p75 from field data.
2. **Lighthouse Scores** — the four Lighthouse category scores (performance / accessibility / best-practices / SEO), 0–100 each. Falls back to a single Performance score line if the other categories are unavailable.
3. **Lab Metrics** — Speed Index, TTI, TBT, CLS from the Lighthouse synthetic run, plus server response time and network request count when present.
4. **Field Data (CrUX)** — real-user p75 values for LCP, FCP, CLS, INP, and FID. Shows the scope label `(origin-level data)` when the URL-level query fell back. Shows the `Collection period: YYYY-MM-DD → YYYY-MM-DD` line when CrUX returned it. Each metric line is followed by its histogram distribution (good / needs-improvement / poor proportions).
5. **Resource Summary** — total bytes + per-type bytes (scripts, styles, images, fonts) with parenthesised request counts.
6. **LCP Element** — the selector, node label, and snippet of the largest contentful paint element, extracted from the `largest-contentful-paint-element` audit.
7. **CLS Elements** — top 5 layout-shift contributors with their selectors and scores (from the `layout-shift-elements` audit).
8. **Render-Blocking Resources** — top 5 render-blocking URLs with wasted-ms estimates.
9. **Third-Party Summary** — top 5 third-party entities with blocking time and transfer size.
10. **Bootup Time** — total JS bootup ms + top 5 scripts with scripting and parse/compile ms.
11. **Diagnostics** — DOM size, network RTT, server latency, main-thread tasks, main document transfer size.
12. **Opportunities** — top 5 by default, or the full list when `--verbose` is passed. Each entry shows the audit ID, fix description, estimated ms savings, and estimated byte savings (from `overallSavingsBytes`) when present.

With `--strategy both`, the mobile and desktop sections are printed back-to-back with a per-strategy heading.

---

## Sections reference

### Request

| Field | Type | Source | Meaning |
|---|---|---|---|
| `url` | string | input | The analyzed URL. |
| `strategy` | `mobile` \| `desktop` \| `both` | input | The PSI/CrUX strategy used. |
| `elapsed_ms` | number | wall clock | Total time spent calling PSI + CrUX. |
| `crux_api_available` | boolean | CrUX response | `true` when CrUX returned data (URL- or origin-level). `false` when both levels had no data or no API key. |
| `crux_scope` | `'url'` \| `'origin'` | CrUX response | The scope that produced the returned data. Omitted when CrUX has no data. |
| `crux_collection_period` | `{ firstDate, lastDate }` | CrUX response | ISO-formatted dates for the 28-day CrUX collection window. |

### Performance (single-strategy)

| Field | Type | Meaning |
|---|---|---|
| `url` | string | Mirror of `request.url`. |
| `strategy` | `mobile` \| `desktop` | The strategy that produced this block. |
| `cwv_passing` | `boolean` \| `null` | CWV verdict at p75. `null` means insufficient data. |
| `field_data` | `FieldData` | LCP / CLS / INP / FCP / FID p75 values, each with `distribution` when CrUX or PSI loadingExperience returned buckets. |
| `field_data_scope` | `'url'` \| `'origin'` | Which CrUX scope resolved the field data. |
| `field_data_collection_period` | `{ firstDate, lastDate }` | CrUX 28-day window. |
| `lab_data` | `LabData` | Speed Index, TTI, TBT, CLS, performance score from Lighthouse. |
| `category_scores` | `{ performance, accessibility, best_practices, seo }` | All four Lighthouse category scores (0–100). |
| `resource_summary` | `ResourceSummary` | Bytes **and** request counts per resource type. |
| `opportunities` | `Opportunity[]` | Every opportunity audit with `savings_ms` and optional `savings_bytes`. |
| `lcp_element` | `{ selector, snippet, nodeLabel }` | Largest contentful paint element identifier. |
| `cls_elements` | `Array<{ selector, score }>` | Top 5 layout-shift contributors. |
| `render_blocking` | `Array<{ url, wastedMs }>` | Top 5 render-blocking resources. |
| `third_party` | `Array<{ entity, blockingTime, transferSize }>` | Top 5 third-party entities. |
| `bootup` | `{ total_ms, items }` | Total JS bootup time plus top 5 scripts. |
| `server_response_time_ms` | number | From the `server-response-time` audit. |
| `request_count` | number | Count of entries in the `network-requests` audit. |
| `diagnostics` | `{ dom_size, network_rtt, network_server_latency, total_tasks, main_document_transfer_size }` | From the `diagnostics` audit. |

### Performance (both-strategy)

When `--strategy both` is passed, `performance` is `{ mobile: PerformanceReport, desktop: PerformanceReport }` instead of a single block.

---

## JSON output

`sgnl performance <url> --output json` emits a two-level envelope that matches the `sgnl technical`, `sgnl structure`, and `sgnl robots` shape:

```json
{
  "request": {
    "url": "https://github.com",
    "strategy": "mobile",
    "elapsed_ms": 3412,
    "crux_api_available": true,
    "crux_scope": "url",
    "crux_collection_period": { "firstDate": "2026-03-01", "lastDate": "2026-03-28" }
  },
  "performance": {
    "url": "https://github.com",
    "strategy": "mobile",
    "cwv_passing": false,
    "field_data": {
      "lcp": { "value": 2869, "unit": "ms", "status": "warn", "target": 2500, "distribution": [...] },
      "cls": { "value": 0.26, "unit": "score", "status": "fail", "target": 0.1, "distribution": [...] },
      "inp": { "value": 283, "unit": "ms", "status": "warn", "target": 200, "distribution": [...] },
      "fcp": { "value": 2010, "unit": "ms", "status": "warn", "target": 1800 },
      "fid": { "value": 0, "unit": "ms", "status": "fail", "target": 100 }
    },
    "field_data_scope": "url",
    "field_data_collection_period": { "firstDate": "2026-03-01", "lastDate": "2026-03-28" },
    "lab_data": { "performance_score": 55, "speed_index_s": 8.21, "tti_s": 23.61, "tbt_ms": 281, "cls": 0 },
    "category_scores": { "performance": 55, "accessibility": 92, "best_practices": 83, "seo": 100 },
    "resource_summary": {
      "total_bytes": 16743000, "script_bytes": 1832000, "stylesheet_bytes": 289000,
      "image_bytes": 1288000, "font_bytes": 258000, "other_bytes": 13076000,
      "total_requests": 438, "script_requests": 96, "stylesheet_requests": 19,
      "image_requests": 18, "font_requests": 2, "other_requests": 303
    },
    "opportunities": [
      { "id": "unused-javascript", "priority": 1450, "savings_ms": 1450, "savings_bytes": 720000, "status": "fail", "fix": "Reduce unused JavaScript" }
    ],
    "lcp_element": { "selector": ".hero h1", "nodeLabel": "Welcome" },
    "cls_elements": [{ "selector": ".banner", "score": 0.18 }],
    "render_blocking": [{ "url": "https://cdn/app.css", "wastedMs": 420 }],
    "third_party": [{ "entity": "Google Analytics", "blockingTime": 150, "transferSize": 52000 }],
    "bootup": { "total_ms": 1003, "items": [...] },
    "server_response_time_ms": 246,
    "request_count": 146,
    "diagnostics": { "dom_size": 1450, "network_rtt": 45, "network_server_latency": 246, "total_tasks": 920 }
  }
}
```

With `--strategy both`, the `performance` field is `{ mobile, desktop }` instead of a single report.

---

## Markdown output

`--save` writes three files to the runs directory (configured in `~/.sgnl/config.json` or `runs/` in the current working directory):

- **`performance.md`** — unified human-readable report. Sections in order: Request, per-strategy Performance block containing CWV verdict, Lighthouse Scores, Lab Metrics, Field Data (with histograms + collection period + scope), Resource Summary, LCP Element, CLS Elements, Render-Blocking Resources, Third-Party Summary, Bootup Time, Diagnostics, and the full Opportunities list.
- **`performance.json`** — the same envelope shape as `--output json`, pretty-printed.
- **`psi_debug.md`** — the legacy raw PSI response dump (kept for backward compatibility with `sgnl analyze --save`).

The same `buildPerformanceMd` function is **not yet** reused by `sgnl analyze --save` — the analyze pipeline continues to render the Performance section inside the main `report.md` via `buildPerformanceSection` in `report-md.ts`. Both code paths now emit the same expanded fields (CWV verdict, category scores, LCP element, CLS elements, render-blocking, third-party, bootup, diagnostics).

---

## CrUX scope fallback

Google's CrUX API accepts queries either by exact URL or by origin. The URL-level lookup is the most specific and is what you want on a page with enough traffic to have its own CrUX record. When the URL has too little traffic, CrUX returns 404.

`fetchCrUXData` handles this automatically:

1. First, query with `{ url }`. If CrUX returns data, use it with `scope: 'url'`.
2. On 404 (or 400), retry with `{ origin: <origin> }` and the same `formFactor`. If origin-level data exists, use it with `scope: 'origin'`. The UI surfaces this as `(origin-level data)` so you know you're not seeing URL-specific numbers.
3. If both queries 404, return `{ data: null, scope: undefined }`.

`formFactor` is forwarded to both queries. Previously the CrUX query didn't pass `formFactor`, which silently mixed phone + desktop + tablet buckets into one distribution — that's now fixed (Phase 2.2).

---

## CLS scaling

CLS scaling differs between the two CrUX sources and this is the single most common source of "CLS looks wrong" bugs:

- **Standalone CrUX API** (`crux.ts`) returns CLS as the raw score: `percentiles.p75 = 0.05` means CLS=0.05. The code does NOT divide.
- **PSI `loadingExperience`** (`extractFieldDataFromLighthouse` in `psi.ts`) returns CLS as score×100: `CUMULATIVE_LAYOUT_SHIFT_SCORE.percentile = 5` means CLS=0.05. The code DOES divide by 100.

Both paths normalise to the same actual CLS score before status thresholds are applied. This is tested by `tests/unit/crux-cls-scaling.test.ts` as a lockdown — if you touch either extractor, that test must still pass.

See Google's [CrUX API reference](https://developer.chrome.com/docs/crux/api) for the raw scheme and [PageSpeed Insights API reference](https://developers.google.com/speed/docs/insights/v5/reference/pagespeedapi/runpagespeed) for the PSI quirk.

---

## Core Web Vitals verdict

The `cwv_passing` field is a boolean computed at p75:

- **`true`** — LCP ≤ 2500 ms AND CLS ≤ 0.1 AND INP ≤ 200 ms.
- **`false`** — any of the three above its threshold.
- **`null`** — LCP or INP is missing (value is 0, treated as insufficient data).

This matches Google's published CWV pass criteria. FID is intentionally NOT part of the verdict — Google replaced FID with INP in the CWV definition as of March 2024. FID is still surfaced in `field_data.fid` for historical comparison.

Boundary values (LCP=2500, CLS=0.1, INP=200) are inclusive — exactly at the threshold counts as passing.

---

## Known limitations

1. **Single origin only.** CrUX records are per URL or per origin; this command does not aggregate across `www` vs apex vs other variants.
2. **PSI API quota.** The default PSI quota is 25,000 queries per day. Heavy batching needs a billing-enabled project. `429` responses are retried twice with backoff before surfacing as an error.
3. **Lab data is synthetic.** `lab_data` is a single simulated run from a Google data center, not a real user. Use `field_data` for real-user numbers and reserve `lab_data` for diagnostics.
4. **CrUX 28-day window.** The collection period is a rolling 28-day window updated daily. New content will not show up immediately.
5. **`--strategy both` doubles API cost.** It issues two PSI calls and either one or two CrUX calls (formFactor differs).
6. **LCP element extraction is best-effort.** Some pages don't report an LCP node in the audit detail (e.g. text-only pages with a video LCP). In that case `lcp_element` is omitted.
7. **Diagnostics audit shape varies by Lighthouse version.** Field names are extracted defensively — missing fields are omitted rather than set to 0.
8. **`category_scores.accessibility/best_practices/seo` can be 0 for some pages.** When PSI returns a null score for a category (common on heavily dynamic pages), the score is reported as 0. Cross-check with `dist/cli.js performance ... --output json | jq '.performance.category_scores'` against a run of Lighthouse CLI directly if a score looks suspicious.

---

## Implementation

| File | Role |
|---|---|
| `src/commands/performance.ts` | CLI entry, flag parsing, terminal printer, JSON envelope, `--save` orchestration, CWV verdict assembly. |
| `src/analysis/psi.ts` | `callPSI`, Lighthouse extractors (category scores, lab data, resource summary with request counts, opportunities with `savings_bytes`, and all the audit detail extractors: LCP element, CLS elements, render-blocking, third-party, bootup, diagnostics). Houses the CLS÷100 scaling fix for PSI loadingExperience. |
| `src/analysis/crux.ts` | `fetchCrUXData` with URL→origin fallback, `formFactor` forwarding, collection-period extraction, histogram distribution parsing. Does NOT divide CLS (CrUX returns the raw score). |
| `src/analysis/run-reporter.ts` | `buildPerformanceMd` renders the unified markdown report consumed by `--save`. `PerformanceReport` and `PerformanceEnvelope` types are exported here. |
| `src/analysis/merger.ts` | Widens `AnalysisReport.performance` with the new fields and spreads them from `bestPsi` + CrUX metadata. Computes `cwv_passing` on the same contract as the focused command. |
| `src/analysis/orchestrator.ts` | Forwards `formFactor` to `fetchCrUXData`, captures `scope` + `collectionPeriod`, threads them into `mergeAnalysis`. |
| `src/analysis/report-md.ts` | Main `report.md` Performance section — renders the expanded signals (CWV verdict headline, Lighthouse category scores, LCP element, CLS elements, render-blocking, third-party, bootup, diagnostics). |
| `tests/unit/psi-extraction.test.ts` | Covers category scores, `savings_bytes`, resource request counts, LCP element, CLS elements, render-blocking, third-party, bootup, server response, request count, diagnostics. |
| `tests/unit/crux-fallback.test.ts` | Covers URL→origin fallback, `formFactor` forwarding, collection period surfacing. |
| `tests/unit/crux-cls-scaling.test.ts` | Lockdown test for the CLS scaling asymmetry between CrUX and PSI loadingExperience. |
| `tests/unit/cwv-verdict.test.ts` | PASS / FAIL / null verdict at each boundary. |
| `tests/unit/merger-detail.test.ts` | Verifies expanded performance fields reach `report.performance` via `mergeAnalysis`. |

---

## See also

- [`docs/technical-seo.md`](./technical-seo.md) — the `sgnl technical` command reference.
- [`docs/structure.md`](./structure.md) — the `sgnl structure` command reference.
- [`docs/robots.md`](./robots.md) — the `sgnl robots` command reference.
- [`docs/schema.md`](./schema.md) — the `sgnl schema` command reference.
- [`docs/content.md`](./content.md) — the `sgnl content` command reference.
- [`docs/gsc.md`](./gsc.md) — the `sgnl gsc` command reference.
- [`docs/explorer.md`](./explorer.md) — site crawler, link graph visualization, and structural analysis.
- [Google's CrUX API reference](https://developer.chrome.com/docs/crux/api)
- [PageSpeed Insights API reference](https://developers.google.com/speed/docs/insights/v5/reference/pagespeedapi/runpagespeed)
- [web.dev — Core Web Vitals](https://web.dev/articles/vitals)
