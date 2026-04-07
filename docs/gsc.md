# `sgnl gsc` — Google Search Console command

Focused, account-level audit surface for Google Search Console. Unlike the
other Path-B commands (`technical`, `structure`, `robots`, `performance`,
`schema`, `content`) which are strictly URL-oriented, **GSC is a
property-level tool**: most of its interesting data lives on a verified
site as a whole, not on a single URL fetch.

The `gsc` command group wraps three GSC API surfaces:

1. **Search Analytics** — `pages`, `queries`, `url` (clicks, impressions,
   CTR, position over a date range, optionally filtered by country,
   device, search type).
2. **URL Inspection** — `inspect` (Google's live index verdict, canonical,
   crawl timestamp, rich results, mobile usability).
3. **Sitemaps** — `sitemaps` (submitted sitemaps with error/warning counts
   and per-content-type submitted/indexed splits).

Plus the existing auth subcommands: `login`, `logout`, `status`.

All data-fetching subcommands emit the standard `{ request, gsc }`
envelope when `--output json` is used, matching the shape of every other
focused command.

---

## Contents

- [When to use it](#when-to-use-it)
- [Authentication](#authentication)
- [Subcommands](#subcommands)
- [Flag reference](#flag-reference)
- [Envelope shape](#envelope-shape)
- [Output formats](#output-formats)
- [`--save` layout](#--save-layout)
- [Comparison windows](#comparison-windows)
- [Pagination](#pagination)
- [Known limitations](#known-limitations)
- [Implementation](#implementation)
- [See also](#see-also)

---

## When to use it

Use `sgnl gsc` when:

- You need **real traffic data** (clicks, impressions, CTR, position) —
  Lighthouse and PSI don't measure real visitor behaviour; GSC does.
- You want Google's **authoritative index verdict** for a URL — is it
  indexed, what's the Google canonical, is there a rich result, what
  mobile usability issues exist.
- You need to audit **submitted sitemaps** for errors or warnings
  without logging into the GSC web UI.
- You want to **compare two date windows** (last 7 days vs the 7 before
  that) as a one-shot delta.
- You need **CSV output** for piping ranked pages or queries into a
  spreadsheet / BI tool.
- You want a scripted, pipeable way to check GSC data without the web UI
  session cost.

Use `sgnl analyze` instead when you want GSC data merged into a full
URL-level SEO report (technical + content + schema + performance + GSC).

---

## Authentication

GSC access requires OAuth2 credentials tied to your Google account and
the verified properties inside it.

1. Create an **OAuth 2.0 Client ID** in
   [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials)
   (type: Desktop app).
2. Enable the **Google Search Console API** on the same project.
3. Run:

```bash
sgnl gsc login
```

On first run the CLI prompts for the Client ID and Secret, stores them
in `~/.sgnl/config.json`, opens a browser for Google's OAuth consent
page, and writes tokens to `~/.sgnl/gsc-tokens.json`. Verified
properties are auto-populated in the config on success.

```bash
# Check current state
sgnl gsc status

# Remove stored tokens (credentials stay in config)
sgnl gsc logout
```

Tokens are automatically refreshed on every data-fetching call.

---

## Subcommands

### `sgnl gsc pages [siteUrl]`

List ranked pages for a property, sorted by clicks, over a date range.

```bash
sgnl gsc pages                                  # default property, 28 days
sgnl gsc pages sc-domain:example.com --limit 200
sgnl gsc pages --days 7 --country usa --device mobile
sgnl gsc pages --start-date 2026-03-01 --end-date 2026-03-31 --output csv > march.csv
sgnl gsc pages --compare --days 7              # last 7d vs previous 7d
sgnl gsc pages --save                          # writes gsc.md/json/csv
```

Pagination is transparent: pass `--limit 60000` and the command will
issue three 25k API calls under the hood.

### `sgnl gsc queries [siteUrl]`

Same shape as `pages`, but dimensioned by query instead of page. This is
site-wide query data, not per-URL.

```bash
sgnl gsc queries --limit 100
sgnl gsc queries --search-type image --days 14
sgnl gsc queries --country deu --output csv
sgnl gsc queries --compare --days 28
```

### `sgnl gsc url <url>`

Per-URL Search Analytics: page-level totals (clicks, impressions, CTR,
position) plus the top 25 queries driving traffic to that URL. Makes two
parallel API calls under the hood — one with `dimensions: ['page']` for
accurate totals (no query-privacy loss) and one with
`dimensions: ['query']` for the breakdown.

```bash
sgnl gsc url https://example.com/blog/post
sgnl gsc url https://example.com/post --days 90 --country usa
sgnl gsc url https://example.com/post --compare --days 28
sgnl gsc url https://example.com/post --output json | jq '.gsc.totals'
```

**Note:** The top-queries list may sum to less than the page totals
because GSC applies a privacy threshold to rare queries. Totals from the
page-dimension call are the authoritative numbers.

### `sgnl gsc inspect <url>`

Runs the URL Inspection API and returns Google's live verdict for the
URL. This is the single highest-signal GSC call for debugging indexing
issues.

```bash
sgnl gsc inspect https://example.com/blog/post
sgnl gsc inspect https://example.com/post --output json --verbose
sgnl gsc inspect https://example.com/post --save
```

Payload includes `verdict`, `coverage_state`, `is_page_indexed`,
`google_canonical`, `user_canonical`, `crawl_timestamp`,
`robots_txt_state`, `indexing_state`, `page_fetch_state`,
`rich_results[]`, `mobile_usability_verdict`, `mobile_usability_issues[]`
and — when Google exposes them — `referring_urls[]` and `sitemap[]`.

**Quota note:** Google applies a per-property daily inspection quota
(~2000/day at time of writing). Batch inspections carefully.

### `sgnl gsc sitemaps [siteUrl]`

Lists every sitemap submitted for the property with its path, type,
submission/download timestamps, error/warning counts, and (when
applicable) per-content-type submitted/indexed splits.

```bash
sgnl gsc sitemaps
sgnl gsc sitemaps sc-domain:example.com --output json
sgnl gsc sitemaps --output csv > sitemaps.csv
sgnl gsc sitemaps --save
```

### `sgnl gsc login` / `logout` / `status`

Auth management. See [Authentication](#authentication) above.

---

## Flag reference

All data-fetching subcommands share a common flag contract. Flags that
don't apply to a specific subcommand are silently ignored (e.g.
`--country` on `inspect` and `sitemaps`).

| Flag | Default | Applies to | Description |
|---|---|---|---|
| `--output <format>` | `terminal` | all data | `terminal`, `json`, or `csv`. |
| `--json` | — | all data | Alias for `--output json`. Kept for back-compat. |
| `--save` | `false` | all data | Write `gsc.md`, `gsc.json`, and (where tabular) `gsc.csv` to the runs dir. |
| `--verbose` | `false` | all data | In JSON output, include the raw API response under `gsc.raw`. |
| `-l, --limit <n>` | `50` | `pages`, `queries` | Max rows. Paginated transparently past 25k. |
| `--days <n>` | `28` | `pages`, `queries`, `url` | Window size in days (max ~480 / 16 months). |
| `--start-date <YYYY-MM-DD>` | — | `pages`, `queries`, `url` | Explicit window start (pair with `--end-date`). |
| `--end-date <YYYY-MM-DD>` | — | `pages`, `queries`, `url` | Explicit window end. |
| `--search-type <type>` | `web` | `pages`, `queries`, `url` | `web`, `image`, `video`, `news`, or `discover`. |
| `--country <iso>` | — | `pages`, `queries`, `url` | ISO-3166-1 alpha-3 country code (`usa`, `deu`, `gbr`…). Lowercased for the API. |
| `--device <type>` | — | `pages`, `queries`, `url` | `desktop`, `mobile`, or `tablet`. |
| `--compare` | `false` | `pages`, `queries`, `url` | Fetch the previous equal-length window and emit period-over-period deltas. |

Date precedence: `--start-date` + `--end-date` > `--days` > default 28.

---

## Envelope shape

All data subcommands emit this two-level envelope when `--output json`
is set:

```json
{
  "request": {
    "property": "sc-domain:example.com",
    "date_range": {
      "start_date": "2026-03-09",
      "end_date": "2026-04-05",
      "days": 28
    },
    "search_type": "web",
    "filters": {
      "country": "usa",
      "device": "mobile"
    },
    "dimensions": ["page"],
    "compare": true,
    "previous_range": {
      "start_date": "2026-02-09",
      "end_date": "2026-03-08",
      "days": 28
    },
    "url": "https://example.com/blog"
  },
  "gsc": { /* per-subcommand payload */ }
}
```

The `gsc` payload shape depends on the subcommand:

| Subcommand | `gsc` payload |
|---|---|
| `pages` | `{ pages: GSCPageRow[], totals: { clicks, impressions }, previous?, delta? }` |
| `queries` | `{ queries: GSCQuery[], totals: { clicks, impressions }, previous?, delta? }` |
| `url` | `{ url, totals: { clicks, impressions, ctr, position }, top_queries: GSCQuery[], previous?, delta? }` |
| `inspect` | `{ url, inspection: GSCIndexStatus }` |
| `sitemaps` | `{ sitemaps: GSCSitemap[] }` |

The `request.url` field is only present on subcommands that take a URL
argument (`url`, `inspect`). `request.dimensions` reflects the GSC API
dimension list used for the query (empty array on `inspect` and
`sitemaps`).

---

## Output formats

- **`terminal`** (default) — human-readable table / summary. Uses
  stderr-only logger for progress, stdout for data, so piping works.
- **`json`** — pretty-printed `{ request, gsc }` envelope on stdout.
- **`csv`** — spreadsheet-friendly rows:
  - `pages`: `page, clicks, impressions, ctr, position`.
  - `queries`: `query, clicks, impressions, ctr, position`.
  - `url`: the top-queries list as a CSV.
  - `sitemaps`: `path, type, last_submitted, last_downloaded, errors, warnings, is_pending`.
  - `inspect`: degenerate — emits key/value pairs for the inspection
    fields.

---

## `--save` layout

`--save` writes to the runs directory (configured in
`~/.sgnl/config.json` or `runs/` in the current working directory) under
a subdirectory named `<timestamp>-<host>-<path>-gsc-<subcommand>/`.

Each subcommand writes:

- `gsc.json` — the full envelope (pretty-printed).
- `gsc.md` — a human-readable markdown report.
- `gsc.csv` — when the subcommand has tabular data (`pages`, `queries`,
  `url` top-queries, `sitemaps`).

For account-level subcommands (`pages`, `queries`, `sitemaps`) the
synthetic URL `https://gsc/<encoded-property>` is used as the run-dir
seed — the directory still lands under your configured runs root, it
just groups by property.

---

## Comparison windows

`--compare` fetches the previous equal-length window immediately before
the requested range and emits period-over-period deltas.

```
pages/queries/url --days 7 --compare
   current  = today-7 → today
   previous = today-14 → today-8
```

The envelope gains `request.previous_range`, `gsc.previous`, and
`gsc.delta` fields. Terminal mode prints a compact `vs previous` block
at the end of the output.

---

## Pagination

The GSC API caps any single Search Analytics call at 25,000 rows. For
`pages` and `queries`, `fetchAllRankedPages` and `fetchAllRankedQueries`
paginate transparently by incrementing the API `startRow` parameter in
25k batches until either `--limit` is reached or the API returns fewer
rows than the batch size.

This is the fix for a prior bug where `startRow` was initialised to 0
and never incremented, silently dropping everything past the first 25k
rows on very large properties. See
`tests/unit/gsc-pagination.test.ts` for the regression lockdown.

---

## Known limitations

1. **GSC data lag.** Search Analytics data is typically 2–3 days behind.
   Queries for `--days 1` may return empty.
2. **URL Inspection quota.** Google enforces a per-property daily cap on
   inspections (~2000/day). `sgnl gsc inspect` will return an error
   message on quota exhaustion.
3. **Query privacy.** GSC anonymises rare queries, so the `top_queries`
   list on `gsc url` often sums to less than the page-level totals.
   The page-dimension call (used for totals) is unaffected.
4. **Date window cap.** GSC allows up to 16 months of historical data.
   Ranges beyond that silently return empty results.
5. **OAuth token refresh.** Tokens are auto-refreshed from the file
   config path. The programmatic `SgnlClient` / `fetchGSCData` path with
   injected tokens does **not** auto-refresh — callers must refresh
   before invocation.
6. **Multiple property resolution.** When no `siteUrl` is passed, the
   first property in config is used. Pass an explicit site URL (or the
   `sc-domain:` form) to pick a specific property.

---

## Implementation

| File | Role |
|---|---|
| `src/commands/gsc.ts` | CLI entry: flag parsing, subcommand registration, `{ request, gsc }` envelope, terminal/JSON/CSV output, `--save`, `--compare`, promise-flush stdout. Shared `printGSCTable` helper dedupes the pages/queries table renderer. |
| `src/analysis/gsc.ts` | Library: `fetchSearchAnalytics`, `fetchURLInspection`, `fetchSitemaps`, `fetchAllRankedPages`, `fetchAllRankedQueries`, `resolveGSCProperty`, `computeDateRange`, `computePreviousRange`, `buildDimensionFilterGroups`, and the analyze-pipeline `fetchGSCData` (unchanged behaviour). |
| `src/auth/google-oauth.ts` | OAuth2 device flow, token storage under `~/.sgnl/gsc-tokens.json`, `getAccessToken` auto-refresh. |
| `src/analysis/orchestrator.ts` | Calls `fetchGSCData(url, resolved)` during `sgnl analyze`. This path is **unchanged** — all new flags are optional with safe defaults. |
| `src/commands/explorer.ts` | Uses `fetchAllRankedPages(property, token, { limit })` to enrich crawl nodes with ranking data. Signature preserved. |
| `tests/unit/gsc-pagination.test.ts` | Regression tests for the `startRow` pagination fix. Mocked axios returns 25k+ rows across multiple pages. |
| `tests/unit/gsc-flags.test.ts` | Date range, previous-range math, dimension filter translation, and flag plumbing into the API request body. |
| `tests/unit/gsc-envelope.test.ts` | Drives `registerGSCCommand` through commander with mocked fetchers to assert the `{ request, gsc }` envelope shape on `url`, `inspect`, `sitemaps`, `pages`, `queries`. |

---

## See also

- [`docs/technical-seo.md`](./technical-seo.md) — the `sgnl technical` command reference.
- [`docs/structure.md`](./structure.md) — the `sgnl structure` command reference.
- [`docs/robots.md`](./robots.md) — the `sgnl robots` command reference.
- [`docs/performance.md`](./performance.md) — the `sgnl performance` command reference.
- [`docs/schema.md`](./schema.md) — the `sgnl schema` command reference.
- [`docs/content.md`](./content.md) — the `sgnl content` command reference.
- [`docs/explorer.md`](./explorer.md) — site crawler, link graph visualization, and structural analysis.
- [Google — Search Console API](https://developers.google.com/webmaster-tools/v1/api_reference_index)
- [Google — URL Inspection API](https://developers.google.com/webmaster-tools/v1/urlInspection.index)
- [Google — Search Analytics query parameters](https://developers.google.com/webmaster-tools/v1/searchanalytics/query)
