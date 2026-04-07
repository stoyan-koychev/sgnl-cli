# `sgnl schema` — Schema.org Validation Command

Focused, fast audit of a page's JSON-LD structured data. Runs only the HTTP fetch + `python/schema_validator.py` — no PSI, no CrUX, no DOM X-ray. Typically sub-second per URL.

Unlike `sgnl analyze`, this command bypasses the orchestrator/merger pipeline for its terminal and JSON outputs. It validates every `<script type="application/ld+json">` block against Schema.org expectations, checks Google Rich Results eligibility, scores each block, and emits a compact `{ request, schema }` envelope matching the `sgnl technical`, `sgnl structure`, `sgnl robots`, and `sgnl performance` shape. (The same expanded output also reaches `report.schema_validation` on the `AnalysisReport` via `merger.ts`, so library consumers see every field too.)

---

## Contents

- [When to use it](#when-to-use-it)
- [Usage](#usage)
- [Pipeline](#pipeline)
- [Terminal output](#terminal-output)
- [Sections reference](#sections-reference)
- [JSON output](#json-output)
- [Markdown output](#markdown-output)
- [Scoring](#scoring)
- [Correctness checks](#correctness-checks)
- [Known limitations](#known-limitations)
- [Implementation](#implementation)
- [See also](#see-also)

---

## When to use it

Use `sgnl schema` when:

- You want a **quick structured-data snapshot** — per-block required/recommended fields, format errors, structural warnings, rich results verdict — in under a second.
- You're **debugging why a page isn't earning a rich result** and need the exact `missing_for_eligibility` list Google would apply.
- You want to **score** your markup and track regressions over time (per-block 0–100 + overall average).
- You want to **validate nested author/publisher completeness**, currency format (ISO 4217), `aggregateRating` bounds, `@context` correctness, duplicate types, and WebSite + SearchAction (sitelinks search box) presence.
- You're **batching** structured-data checks across many URLs in CI where each URL should emit a `{ request, schema }` envelope.

Use `sgnl analyze` instead when you want the full pipeline — schema + content + technical + performance — merged into one `AnalysisReport` with issues and scoring.

---

## Usage

```
sgnl schema <url> [flags]
```

### Flags

| Flag | Type | Default | Description |
|---|---|---|---|
| `--output <format>` | string | `terminal` | `terminal` (human-readable) or `json` (pipe-friendly envelope) |
| `--device <type>` | string | `mobile` | `mobile` or `desktop` — sets the User-Agent on the initial fetch and is echoed into `request.device`. |
| `--save` | boolean | `false` | Write `schema.md`, `schema.json`, and one raw JSON-LD file per block to the runs directory. |
| `--verbose` | boolean | `false` | In terminal mode, print the raw JSON-LD per block (truncated to ~600 chars). |
| `--timeout <ms>` | number | `30000` | Per-step timeout in milliseconds. |

### Examples

```bash
# Human-readable terminal output
sgnl schema https://www.nytimes.com

# JSON envelope — pipe into jq for CI checks
sgnl schema https://github.com --output json | jq '.schema.summary.rich_results_eligible'

# Save schema.md + schema.json + per-block raw JSON-LD
sgnl schema https://example.com/blog/post --save

# Print the raw JSON-LD per block in the terminal
sgnl schema https://example.com --verbose
```

### Requirements

- Python 3.8+ with `beautifulsoup4` installed. The CLI forwards the HTML to `python/schema_validator.py` via stdin.
- No PSI / CrUX API key required.

---

## Pipeline

```
  sgnl schema <url>
        │
        ├─ safeFetch(url, {device, timeout}) ──── HTTP
        │     │ TTFB, status, headers, redirect_chain, content-type/length
        │     ▼
        └─ runSchemaValidation(html) ──────────── python/schema_validator.py
              │ _extract_jsonld_blocks (with @graph + array flattening)
              │ _validate_block per block
              │   ├─ required / recommended fields per @type
              │   ├─ format validation (URL, ISO 8601 date, ISO 8601 duration,
              │   │   ISO 4217 currency, @context = https://schema.org)
              │   └─ _check_structural_warnings
              │       ├─ nested author/publisher completeness (name + logo)
              │       ├─ offers.price / offers.priceCurrency
              │       ├─ FAQPage Question + acceptedAnswer
              │       ├─ reviewRating.ratingValue
              │       └─ aggregateRating ratingValue in [worstRating, bestRating]
              │ _check_rich_results per block
              │   └─ Google rich result rules (Product offers, Breadcrumb 2+, Video URL...)
              │ _compute_block_score (100 − 20*req − 5*rec − 10*fmt − 5*warn, floor 0)
              │ _detect_duplicate_types (same @type without distinguishing @id)
              │ _check_website_searchaction (sitelinks search box)
              │ inLanguage / ImageObject recommendations
              ▼
        { request, schema }
              │
              ▼
  Terminal printer  OR  JSON envelope  OR  --save to runs/
```

There is no orchestrator step and no mapper squeeze on Path B — the Python output is wrapped in a `{ request, schema }` envelope and returned almost verbatim.

---

## Terminal output

A run with JSON-LD present produces sections in this order:

1. **Request** — status, TTFB, content-type.
2. **Summary line** — `Blocks found: N`, `Valid blocks: X/N`, `Overall score: S/100`, and any `Rich results ineligible` or `Duplicate types` call-outs.
3. **Per-block entries** (numbered) — `<type> [score/100]`, required present/total, missing required, recommended present/missing, format errors, warnings, rich results verdict.
4. **Recommendations** — prioritised HIGH / MED / LOW list. HIGH = missing required + format errors; MED = structural warnings + duplicate types; LOW = missing recommended + sitelinks search box + inLanguage + ImageObject shape hints.
5. **Note** — only JSON-LD is validated; Microdata and RDFa are not.

With `--verbose`, each block additionally prints its raw JSON-LD source (truncated).

---

## Sections reference

### Request

| Field | Type | Source | Meaning |
|---|---|---|---|
| `url` | string | input | The analyzed URL. |
| `final_url` | string | safeFetch | Last URL after the redirect chain. Equals `url` when no redirects. |
| `status` | number | safeFetch | Final HTTP status. |
| `ttfb_ms` | number | safeFetch | Time-to-first-byte on the final fetch. |
| `content_type` | string \| undefined | response headers | The `Content-Type` header value. |
| `content_length` | number \| undefined | response headers | The `Content-Length` header parsed to int. |
| `redirect_chain` | string[] | safeFetch | Each intermediate URL traversed. Empty on direct fetches. |
| `device` | `mobile` \| `desktop` | input | Echoed from the `--device` flag. |

### Schema

| Field | Type | Meaning |
|---|---|---|
| `blocks_found` | number | Count of JSON-LD blocks found (including `@graph` entries and invalid-JSON blocks). |
| `blocks[]` | `SchemaBlock[]` | Per-block detail. |
| `blocks[].type` | string | Primary `@type`. |
| `blocks[].raw_json` | object | The parsed JSON-LD. |
| `blocks[].score` | number | 0–100 block quality score (see [Scoring](#scoring)). |
| `blocks[].validation.required` | `{ fields, present, missing }` | Required fields for the block's `@type`. |
| `blocks[].validation.recommended` | `{ fields, present, missing }` | Recommended fields for the block's `@type`. |
| `blocks[].validation.format_errors[]` | `{ field, value, expected, message }` | URL / date / duration / currency / `@context` format failures. |
| `blocks[].validation.warnings[]` | `{ field, message }` | Structural warnings (nested shapes, aggregateRating bounds, priceCurrency ISO 4217, `@context` scheme). |
| `blocks[].rich_results.eligible` | boolean | Whether all required + extra fields are present for a Google rich result. |
| `blocks[].rich_results.types` | string[] | Rich result names the block satisfies. |
| `blocks[].rich_results.missing_for_eligibility` | string[] | Fields that still need to be present. |
| `overall_score` | number | Average of per-block scores (rounded). |
| `recommendations[]` | `{ priority, type, message }` | Prioritised recommendation list, deduped across blocks. `high` / `medium` / `low`. |
| `summary.total_blocks` | number | Mirrors `blocks_found`. |
| `summary.valid_blocks` | number | Blocks that parsed successfully (no JSON parse error). |
| `summary.types_found` | string[] | All `@type` values seen on the page. |
| `summary.rich_results_eligible` | string[] | Rich result names the page qualifies for. |
| `summary.rich_results_ineligible` | string[] | Types that have a rich-result rule but failed eligibility. |
| `summary.duplicate_types` | string[] | Types that appear more than once without a distinguishing `@id`. |

---

## JSON output

`sgnl schema <url> --output json` emits a two-level envelope that matches the `sgnl technical`, `sgnl structure`, `sgnl robots`, and `sgnl performance` shape:

```json
{
  "request": {
    "url": "https://www.nytimes.com",
    "final_url": "https://www.nytimes.com",
    "status": 200,
    "ttfb_ms": 317,
    "content_type": "text/html; charset=utf-8",
    "content_length": 261308,
    "redirect_chain": [],
    "device": "mobile"
  },
  "schema": {
    "blocks_found": 2,
    "blocks": [
      {
        "raw_json": { "@context": "https://schema.org", "@type": "WebSite", "name": "The New York Times", "url": "https://www.nytimes.com" },
        "type": "WebSite",
        "validation": {
          "required": { "fields": ["name", "url"], "present": ["name", "url"], "missing": [] },
          "recommended": { "fields": ["potentialAction"], "present": [], "missing": ["potentialAction"] },
          "format_errors": [],
          "warnings": []
        },
        "rich_results": { "eligible": false, "types": [], "missing_for_eligibility": [] },
        "score": 95
      }
    ],
    "overall_score": 90,
    "recommendations": [
      { "priority": "low", "type": "WebSite", "message": "Add 'potentialAction' of type 'SearchAction' to enable sitelinks search box" }
    ],
    "summary": {
      "total_blocks": 2,
      "valid_blocks": 2,
      "types_found": ["WebSite", "NewsMediaOrganization"],
      "rich_results_eligible": [],
      "rich_results_ineligible": [],
      "duplicate_types": []
    }
  }
}
```

---

## Markdown output

`--save` writes three kinds of files to the runs directory (configured in `~/.sgnl/config.json` or `runs/` in the current working directory):

- **`schema.md`** — unified human-readable report. Sections: Summary (blocks, valid count, overall score, types, rich-results eligible/ineligible, duplicate types), per-block detail (score, rich-results verdict, required/recommended breakdowns, format error table, warnings bullets), and a prioritised Recommendations table.
- **`schema.json`** — the same envelope shape as `--output json`, pretty-printed.
- **`<n>_<Type>.json`** — one file per block containing the raw JSON-LD source (preserved from the original `--save` behaviour).

The same `buildSchemaValidationMd` function is also used by `sgnl analyze --save` to produce `schema_validation.md` inside the full analyze run directory.

---

## Scoring

Each block is assigned a 0–100 quality score:

```
score = 100
      − 20 × (count of missing required fields)
      −  5 × (count of missing recommended fields)
      − 10 × (count of format errors)
      −  5 × (count of structural warnings)
```

The score is floored at 0. `overall_score` is the rounded arithmetic mean of per-block scores. A fully compliant block with no recommended fields missing scores 100. A typical real-world page with complete required fields and 2–3 missing recommended fields lands in the 80–95 range.

---

## Correctness checks

Beyond the standard required/recommended field presence check, the validator enforces:

- **`@context` scheme.** Must reference `https://schema.org` (or an array including it). `http://schema.org` is flagged as a warning (works but is legacy). A missing or unrelated `@context` is a format error.
- **ISO 4217 currency format.** `priceCurrency` must match `^[A-Z]{3}$`. The validator does not maintain the full ISO 4217 list — just the format shape — so exotic valid codes pass and common typos (`usd`, `DOLLARS`, `$`) are flagged.
- **`aggregateRating` sanity.** `ratingValue` must be present. If it parses as a number, it must fall within `[worstRating, bestRating]` (defaults 1 and 5). At least one of `reviewCount` / `ratingCount` should be present.
- **Duplicate type detection.** If the same `@type` (e.g. two `Organization` blocks) appears more than once on a page without a distinguishing `@id`, the type is listed in `summary.duplicate_types` and a medium-priority recommendation is emitted.
- **WebSite + SearchAction.** If a `WebSite` block exists without a `potentialAction` of type `SearchAction`, a low-priority recommendation prompts the author to add one (Google sitelinks search box).
- **Nested author/publisher completeness.** An `author` or `publisher` that's an object must have `name`. An Organization `publisher` must additionally have `logo`. Plain-string values are still flagged as warnings.
- **`inLanguage` recommendation.** For `Article`, `NewsArticle`, `BlogPosting`, and `WebPage` types that don't declare `inLanguage` (BCP 47), a low-priority recommendation is emitted.
- **Image shape hint.** If a bare-string `image` is used (instead of an `ImageObject` with `width` and `height`), a low-priority recommendation suggests upgrading. Pages already using `ImageObject` with dimensions do not trigger the hint.

---

## Known limitations

1. **JSON-LD only.** Microdata (`itemscope`/`itemprop`) and RDFa are not parsed or validated. Many CMSs still emit structured data via Microdata — those won't show up here.
2. **Required-field list is Google-rich-results-driven.** The validator intentionally tracks the fields Google says are required for a specific rich result, not the full Schema.org spec. A valid Schema.org block can still show `missing` entries when Google needs more than schema.org mandates (e.g. `image` for Article).
3. **Currency format shape only.** `priceCurrency` is checked for `^[A-Z]{3}$` — not against a full ISO 4217 list. Real exotic codes pass; so would the hypothetical `ZZZ`.
4. **`@graph` flattening is shallow.** Blocks nested inside a top-level `@graph` array are hoisted once. Deeply nested references via `@id` are not resolved; each block is validated in isolation.
5. **Score weights are heuristic.** The 20/5/10/5 weighting is a rule of thumb, not a Google-published metric. Treat the number as a tracking signal, not an absolute truth.
6. **No localisation validation.** `inLanguage` presence is checked but the value is not validated against BCP 47.
7. **Rendered JSON-LD is not captured.** The validator only sees the initial HTML response. Structured data injected by JavaScript after page load is invisible to this command. Use `sgnl analyze` with headless rendering if you need client-side markup.

---

## Implementation

| File | Role |
|---|---|
| `src/commands/schema.ts` | CLI entry, flag parsing, terminal printer, JSON envelope, `--save` orchestration. Calls `safeFetch` + `runSchemaValidation` and builds the `{ request, schema }` envelope. |
| `src/analysis/schema.ts` | `runSchemaValidation` spawns `python/schema_validator.py` via `runPythonScriptSafe`. Exports `SchemaReport`, `SchemaBlock`, `SchemaBlockValidation`, `SchemaRichResults`, `SchemaSummary`, `SchemaRecommendation` types. |
| `python/schema_validator.py` | Core validator. Extracts JSON-LD, validates required/recommended fields, performs format checks, detects duplicate types + WebSite/SearchAction, computes per-block + overall scores, generates prioritised recommendations. |
| `src/analysis/run-reporter.ts` | `buildSchemaValidationMd` renders the unified markdown report consumed by `--save` (focused path) and `sgnl analyze --save`. |
| `src/analysis/merger.ts` | Spreads the raw Python schema output into `SchemaValidationInfo` so new fields flow through without hand-mapping. |
| `src/analysis/scoring.ts` | `SchemaValidationInfo` and `SchemaValidationBlock` type definitions consumed by the merger + report. |
| `tests/unit/schema-validator-correctness.test.ts` | Spawns the real Python validator against fixture HTML to lock down `@context`, currency, aggregateRating, duplicate types, WebSite+SearchAction, nested completeness, inLanguage, image shape, and scoring. |
| `tests/unit/schema-envelope.test.ts` | Drives `registerSchemaCommand` with mocked `safeFetch` + `runSchemaValidation` to assert the `{ request, schema }` envelope shape and `--device` plumbing. |
| `tests/unit/schema.test.ts` | Covers `runSchemaValidation` success / failure / undefined-data branches. |
| `tests/unit/merger-detail.test.ts` | Asserts the spread merge path carries `duplicate_types`, `overall_score`, and per-block `score` into `report.schema_validation`. |

---

## See also

- [`docs/technical-seo.md`](./technical-seo.md) — the `sgnl technical` command reference.
- [`docs/structure.md`](./structure.md) — the `sgnl structure` command reference.
- [`docs/robots.md`](./robots.md) — the `sgnl robots` command reference.
- [`docs/performance.md`](./performance.md) — the `sgnl performance` command reference.
- [`docs/content.md`](./content.md) — the `sgnl content` command reference.
- [`docs/gsc.md`](./gsc.md) — the `sgnl gsc` command reference.
- [`docs/explorer.md`](./explorer.md) — site crawler, link graph visualization, and structural analysis.
- [Google — Structured data guidelines](https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data)
- [Google — Rich Results Test](https://search.google.com/test/rich-results)
- [Schema.org](https://schema.org/)
