# `sgnl robots` — Robots.txt Audit Command

Focused, fast audit of a site's `robots.txt` file. Runs only `python/robots_check.py` — no page fetch, no PSI, no DOM analysis. Typically sub-second per URL.

Unlike `sgnl analyze`, this command bypasses the orchestrator/merger pipeline entirely. It talks directly to the Python script and formats its raw output, so **you always see the full fidelity** of what `robots_check.py` produces — no mapper squeeze, no cherry-picking. (The same Python output also reaches `report.robots` on the `AnalysisReport` via `merger.ts`, so library consumers see every field too.)

---

## Contents

- [When to use it](#when-to-use-it)
- [Usage](#usage)
- [Pipeline](#pipeline)
- [Terminal output](#terminal-output)
- [Sections reference](#sections-reference)
- [JSON output](#json-output)
- [Markdown output](#markdown-output)
- [Wildcard and longest-match rules](#wildcard-and-longest-match-rules)
- [HTTP status semantics](#http-status-semantics)
- [Multi-agent verdict resolution](#multi-agent-verdict-resolution)
- [AI bot detection](#ai-bot-detection)
- [Validation warnings](#validation-warnings)
- [Sitemap analysis](#sitemap-analysis)
- [Known limitations](#known-limitations)
- [Implementation](#implementation)
- [See also](#see-also)

---

## When to use it

Use `sgnl robots` when:

- You want a **quick robots.txt snapshot** — size, content-type, elapsed ms, rules, verdicts — in under a second.
- You're **debugging why Google / Bing / an AI crawler can or can't reach a URL** and need the multi-agent verdict matrix.
- You're auditing **AI bot access policy** (GPTBot, CCBot, anthropic-ai, Google-Extended, PerplexityBot, Bytespider).
- You need **longest-match Allow/Disallow resolution** applied correctly — most naive parsers fail Google's classic `Disallow: /folder/ + Allow: /folder/page.html` example.
- You want to **verify `robots.txt` health** — size under 500 KiB, Content-Type is `text/plain`, no cross-origin redirects, no syntax warnings.
- You're **batching** across many URLs in a script where per-URL latency matters (robots fetch is typically 50–400 ms).

Use `sgnl analyze` instead when you want the full pipeline — robots + content + technical + PSI + CrUX — merged into one `AnalysisReport`.

---

## Usage

```
sgnl robots <url> [flags]
```

### Flags

| Flag | Type | Default | Description |
|---|---|---|---|
| `--output <format>` | string | `terminal` | `terminal` (human-readable) or `json` (pipe-friendly, structured) |
| `--save` | boolean | `false` | Also write `robots_check.md` and `robots.json` to the runs directory. |
| `--timeout <ms>` | number | `30000` | Per-step timeout in milliseconds. Honored by both the robots fetch and each sitemap fetch (capped at 5 s per sitemap). |
| `--meta-blocked` | boolean | `false` | Tell the script that the page's `<meta name="robots">` says noindex. Enables `conflict_with_meta` detection when robots.txt disallows a page that meta allows, or vice versa. |

Note: no `--device` flag — `robots.txt` is device-independent.

### Examples

```bash
# Human-readable terminal output
sgnl robots https://github.com

# JSON envelope for piping into jq
sgnl robots https://github.com --output json | jq '.robots.per_agent_verdict'

# Save both robots_check.md and robots.json to the runs directory
sgnl robots https://github.com --save

# Pass a tighter timeout for CI batches
sgnl robots https://github.com --timeout 10000

# Analyze a page you already know is meta-blocked, to check for conflicts
sgnl robots https://example.org/private --meta-blocked
```

### Requirements

Python 3.8+. No third-party Python packages required — `robots_check.py` uses only `urllib` from the standard library. Without Python, the command fails immediately.

---

## Pipeline

```
  sgnl robots <url>
        │
        ▼
  python/robots_check.py
    ├─ fetch_robots_txt({origin}/robots.txt) ─── urllib + redirect tracker
    │      │ captures status, final_url, content_type, content_length,
    │      │ elapsed_ms, redirect_chain
    │      ▼
    ├─ parse_robots_txt  ── per-user-agent rules, sitemaps, syntax warnings
    │      ▼
    ├─ is_path_disallowed  ── longest-match Allow vs Disallow
    │      ▼
    ├─ compute_agent_verdicts  ── verdict matrix across 9 agents
    │      ▼
    ├─ compute_ai_bot_summary  ── explicit-block count for 6 AI crawlers
    │      ▼
    ├─ _analyze_single_sitemap × N  ── up to 5 sitemaps, 1 level of index expansion
    │      ▼
    └─ validation flags + issues
           │
           ▼
   { request, robots: { ...everything } }
           │
           ▼
  Terminal printer  OR  JSON envelope  OR  --save to runs/
```

Unlike the `sgnl analyze` path, **there is no orchestrator step and no mapper squeeze**. The Python output is returned almost verbatim, wrapped in a small `{ request, robots }` envelope.

---

## Terminal output

A run produces sections in this order:

1. **Request** — robots.txt URL, final URL (if redirected), HTTP status, content-type, size in bytes, elapsed milliseconds.
2. **Redirects** — annotated redirect chain (only shown when the chain has at least one hop). Uses the shared `annotateRedirectChain` helper with the same labels as the `technical` and `structure` commands (`HTTP→HTTPS`, `www → apex`, `trailing-slash`).
3. **Path Disallowed / Crawl Delay / Blocks entire site / Conflict** — the headline verdict for the analyzed URL, plus crawl-delay and site-wide block detection. `Blocks entire site: YES (Disallow: /)` is only shown when the `*` block contains a literal `Disallow: /` rule.
4. **No rules for User-agent: \*** — informational line when robots.txt exists but has no `*` group.
5. **Sitemaps** — list of `Sitemap:` directives found, or "none found".
6. **Sitemap Analysis** — one block per sitemap (up to 5), with URL count, lastmod presence, index-or-not, children fetched (if index), URLs across children, and any fetch error. Sitemaps discovered via the `/sitemap.xml` / `/sitemap_index.xml` fallback probe are flagged `discovered via fallback`.
7. **Multi-agent Verdict** — compact table of the nine standard agents showing `allowed` or `disallowed` for the analyzed URL path.
8. **AI Bots** — X/6 AI crawlers explicitly blocked, plus the list of blocked agents if any.
9. **Disallow Rules** — first 10 rules from the `*` group, with `... and N more` for overflow.
10. **Allow Rules** — first 10 rules from the `*` group, with overflow. **This section was previously dropped** before the v1.1 expansion — the parser extracted allow rules but the printer never rendered them.
11. **Validation** — shown when any of: size exceeds 500 KiB, content-type is not `text/plain`, redirected cross-origin, or `syntax_warnings` is non-empty. UTF-8 BOM is silently tolerated.
12. **Issues** — summary issue list assembled from the fields above.

---

## Sections reference

### Request

| Field | Type | Source | Meaning |
|---|---|---|---|
| `robots_url` | string | `fetch_robots_txt` | The `{origin}/robots.txt` URL. |
| `final_url` | string | `resp.geturl()` | URL after redirects. Differs from `robots_url` only when the server redirected. |
| `status_code` | number | HTTP status | 0 on transport failure, otherwise the HTTP status (2xx/3xx/4xx/5xx — see [HTTP status semantics](#http-status-semantics)). |
| `content_type` | string \| null | HTTP header | The `Content-Type` response header, e.g. `text/plain`. |
| `content_length` | number \| null | HTTP header \| body length | `Content-Length` if present, otherwise the actual body length in bytes. |
| `elapsed_ms` | number | `time.perf_counter()` | Wall-clock ms for the robots fetch. |
| `redirect_chain` | string[] | custom redirect handler | List of intermediate Location values during the robots fetch. |

### Rules (`*` block)

| Field | Type | Meaning |
|---|---|---|
| `disallow_rules` | string[] | First 20 Disallow rules under `User-agent: *`. |
| `allow_rules` | string[] | First 20 Allow rules under `User-agent: *`. |
| `crawl_delay` | number \| null | `Crawl-delay:` value (seconds), or `null` if absent. |
| `has_wildcard_disallow` | boolean | `true` if `/` or `*` appears in disallow rules. |

### Per-agent data

| Field | Type | Meaning |
|---|---|---|
| `per_agent_rules` | object | Keyed by lowercase user-agent. Each value is `{ disallow: string[], allow: string[], crawl_delay: number \| null }`. Includes every agent that had a rule group in the file. |
| `per_agent_verdict` | object | Keyed by the nine standard agents. Value is `'allowed'` or `'disallowed'` for the analyzed URL path, using most-specific-agent resolution. |
| `ai_bot_summary` | object | `{ blocked_count, blocked_agents, total_checked }`. Counts AI crawlers with explicit blocking rules of their own, NOT inherited from `*`. |

### Sitemap data

| Field | Type | Meaning |
|---|---|---|
| `sitemaps` | string[] | List of `Sitemap:` URLs from robots.txt, or fallback-discovered URLs. |
| `sitemap_analyses` | `SitemapAnalysis[]` | One entry per sitemap (cap 5), with URL count, lastmod flag, is_index flag, children_fetched, total_urls_across_children, discovered_via_fallback. |
| `sitemap_analysis` | `SitemapAnalysis \| null` | **Backward-compat alias** equal to `sitemap_analyses[0]`. |

### Validation

| Field | Type | Meaning |
|---|---|---|
| `size_exceeds_google_limit` | boolean | `true` when body is > 500 KiB (Google's published limit). |
| `content_type_is_text_plain` | boolean | `true` when `Content-Type` starts with `text/plain`. |
| `cross_origin_redirect` | boolean | `true` when the final URL's host (normalised for `www.`) differs from the origin. |
| `syntax_warnings` | string[] | Lines with missing colons, misspelled directives (`Disallows:`, `User-Agents:`), rules before any `User-agent`, unknown directives, invalid `crawl-delay`. UTF-8 BOM and known non-standard directives (`Host`, `Clean-param`, `Noindex`, `Request-rate`, `Visit-time`) are tolerated silently. |
| `issues` | string[] | Assembled issue codes. See [below](#issue-codes). |

### Issue codes

| Code | Meaning |
|---|---|
| `robots_txt_unreachable` | Transport error (DNS, TCP, TLS). `status_code` is 0. |
| `no_robots_txt` | HTTP 404 — treated as "fully allowed". |
| `robots_txt_4xx_treated_as_allowed` | Any 4xx other than 404 — per Google's spec, "fully allowed". |
| `robots_txt_5xx_treated_as_disallowed` | 5xx — per Google's spec, "fully disallowed". Sets `path_disallowed: true` and `reason: 'server_error_treated_as_disallow'`. |
| `path_disallowed_by_robots_txt` | The analyzed URL is disallowed under `*`. |
| `wildcard_disallow_found` | `/` or `*` appears in the disallow list. |
| `high_crawl_delay` | `crawl_delay > 10` seconds. |
| `no_sitemap_in_robots_txt` | No `Sitemap:` directive (and no fallback discovery success). |
| `conflict_robots_txt_vs_meta_robots` | Page is disallowed by robots.txt but NOT by meta robots (requires `--meta-blocked=false`), or vice versa. |
| `robots_txt_too_large` | Exceeds Google's 500 KiB limit. |
| `robots_txt_not_text_plain` | `Content-Type` is not `text/plain`. |
| `robots_txt_cross_origin_redirect` | robots.txt redirected cross-origin (potential misconfiguration). |
| `no_rules_for_user_agent_star` | No `*` group in the file (not an error, just informational). |

---

## JSON output

`sgnl robots <url> --output json` emits a two-level envelope:

```json
{
  "request": {
    "robots_url": "https://github.com/robots.txt",
    "final_url": "https://github.com/robots.txt",
    "status_code": 200,
    "content_type": "text/plain; charset=utf-8",
    "content_length": 2274,
    "elapsed_ms": 208,
    "redirect_chain": []
  },
  "robots": {
    "fetched": true,
    "status_code": 200,
    "path_disallowed": false,
    "disallow_rules": ["/*/*/pulse", "/*/*/projects", "..."],
    "allow_rules": ["/*?tab=achievements&achievement=*"],
    "sitemaps": [],
    "sitemap_analyses": [],
    "sitemap_analysis": null,
    "per_agent_rules": { "*": { "disallow": [...], "allow": [...], "crawl_delay": null }, ... },
    "per_agent_verdict": { "googlebot": "allowed", "gptbot": "allowed", ... },
    "ai_bot_summary": { "blocked_count": 0, "blocked_agents": [], "total_checked": 6 },
    "syntax_warnings": [],
    "size_exceeds_google_limit": false,
    "content_type_is_text_plain": true,
    "cross_origin_redirect": false,
    "issues": ["no_sitemap_in_robots_txt"]
  }
}
```

The envelope shape mirrors `sgnl technical` (`{ request, technical }`) and `sgnl structure` (`{ request, structure }`) for pipe-friendly consistency.

---

## Markdown output

`--save` writes two files to the runs directory (configured in `~/.sgnl/config.json` or the current working directory's `runs/`):

- **`robots_check.md`** — human-readable markdown report. Starts with a Request table, then Redirects (if any), Summary, Multi-agent Verdict, AI Bots, Sitemaps, Disallow Rules, Allow Rules, per-sitemap analysis blocks, Validation Warnings, and Issues.
- **`robots.json`** — the same envelope shape as `--output json`, pretty-printed.

The same `buildRobotsCheckMd` function is reused by `sgnl analyze --save`, so the two commands produce an identical `robots_check.md` shape. The main `report.md` Crawlability section also renders the new signals (allow rules, multi-agent verdict table, AI bot summary, validation warnings).

---

## Wildcard and longest-match rules

`robots_check.py` implements Google's specified rule-matching semantics:

**Wildcards:**
- `*` matches any sequence of characters (zero or more).
- `$` at the end of a rule anchors the match to the end of the URL path.
- All other regex metacharacters (`.`, `+`, `?`, `(`, `)`, `[`, `]`, etc.) are escaped literally — they match themselves, not regex specials. This is critical for rules like `/a?b` which means "the literal path `/a?b`", NOT "`/a` followed by an optional `b`".

**Longest match:**
When both an Allow rule and a Disallow rule match a URL path, the rule with the **longest `path` value** wins (counted in literal characters, with `*` counted as 1 and the `$` anchor not counted). This is the single most important difference from naive parsers.

**Google's classic example:**

```
User-agent: *
Disallow: /folder/
Allow: /folder/page.html
```

Path `/folder/page.html` → matches both rules. Allow is 18 chars, Disallow is 8 chars → **Allow wins**, page is allowed.
Path `/folder/other.html` → only matches Disallow → **Disallowed**.

**Ties go to Allow** per the specification.

**Empty `Disallow:`** (no value after the colon) is a no-op — it means "allow everything in this group" rather than "disallow everything". This is also tested.

---

## HTTP status semantics

Per Google's [robots.txt specification](https://developers.google.com/search/docs/crawling-indexing/robots/robots_txt), HTTP status codes are handled as:

| Status | Interpretation | `path_disallowed` |
|---|---|---|
| 2xx | Parse normally | depends on rules |
| 3xx | Follow redirect (captured in `redirect_chain`); if cross-origin, set `cross_origin_redirect: true` | depends on rules after following |
| 4xx (404) | No robots.txt — treated as fully allowed | `false` |
| 4xx (other) | Fully allowed per spec. Issue: `robots_txt_4xx_treated_as_allowed` | `false` |
| 5xx | Fully disallowed per spec. Issue: `robots_txt_5xx_treated_as_disallowed`, `reason: 'server_error_treated_as_disallow'` | `true` |
| Transport error (DNS/TCP/TLS) | Unreachable. Issue: `robots_txt_unreachable` | `false` (but no crawl signal) |

---

## Multi-agent verdict resolution

For each of the nine standard agents (`*`, `googlebot`, `bingbot`, `gptbot`, `ccbot`, `anthropic-ai`, `google-extended`, `perplexitybot`, `bytespider`), the verdict is computed by:

1. Look for a rule group with an **exact case-insensitive match** on the agent name.
2. If none exists, fall back to the `*` group.
3. Apply longest-match Allow vs Disallow resolution to the analyzed URL path against the chosen group's rules.

This mirrors Google's published behaviour for resolving conflicting user-agent groups — Googlebot-News, for instance, would match `googlebot-news` exactly, then `*`, but never `googlebot` (which is a different token).

---

## AI bot detection

The AI bot summary is intentionally strict: a bot is counted as "blocked" only if it has an **explicit group of its own** with at least one disallow or allow rule. Inheritance from `User-agent: *` does NOT count, because:

1. Most webmasters who intend to allow AI crawlers leave their `*` group open but don't list the AI bots explicitly.
2. Most webmasters who intend to block AI crawlers add dedicated `User-agent: GPTBot` groups rather than hoping the bot honours the `*` group.

So this field measures **intent**, not outcome. Use `per_agent_verdict` if you want the actual crawl verdict for a specific path.

The six tracked AI bots are: `GPTBot` (OpenAI), `CCBot` (Common Crawl), `anthropic-ai` (Anthropic), `Google-Extended` (Google's generative AI opt-out), `PerplexityBot` (Perplexity), `Bytespider` (ByteDance).

---

## Validation warnings

`syntax_warnings` surfaces problems that a conforming parser would normally still tolerate:

- **`missing colon`** — a non-blank, non-comment line without `:`.
- **`typo for "<directive>"`** — plural forms like `Disallows:`, `User-Agents:`, `Sitemaps:`, `Allows:`, `Crawl-delays:`.
- **`appears before any User-agent`** — a rule line with no preceding `User-agent:` block.
- **`unknown directive`** — any directive not in `{user-agent, disallow, allow, crawl-delay, sitemap}` AND not in the known non-standard whitelist (`host`, `clean-param`, `noindex`, `request-rate`, `visit-time`).
- **`invalid crawl-delay`** — value that fails `float()` parsing.
- **`empty user-agent`** — `User-agent:` with nothing after the colon.

The UTF-8 BOM at line 1 is silently stripped and never warned.

The HTTP-level validation flags (`size_exceeds_google_limit`, `content_type_is_text_plain`, `cross_origin_redirect`) surface separately as their own boolean fields and also emit issue codes.

---

## Sitemap analysis

For each `Sitemap:` URL listed (capped at 5), `robots_check.py`:

1. Fetches it with the per-sitemap timeout (capped at 5 s).
2. Detects `<sitemapindex>` vs `<urlset>`.
3. Counts `<url>` elements (or `<sitemap>` for indexes) and checks for `<lastmod>`.
4. If it's an index and `expand_index=True`, fetches up to 3 child sitemaps and sums their URL counts into `total_urls_across_children`, reporting `children_fetched`.

If the robots.txt has **no** `Sitemap:` directive, a fallback HEAD probe checks `{origin}/sitemap.xml` and `{origin}/sitemap_index.xml`. Discovered sitemaps are added to the list with `discovered_via_fallback: true`.

`sitemap_analysis` (singular) remains populated as a backward-compat alias for `sitemap_analyses[0]`, so callers written against the pre-v1.1 shape keep working.

---

## Known limitations

1. **Single origin only.** Multi-host sites (e.g. `www` vs apex vs `m.`) are not crawled together. Point the command at each origin separately.
2. **No live Googlebot rendering.** `path_disallowed` is based on rule matching, not Google's live crawl verdict as shown in Search Console URL Inspection. Usually they agree; they can diverge on edge cases like overlapping rule tokens the ordering of which Google's implementation handles differently.
3. **Sitemap index expansion is one level deep.** Deeply nested indexes (index → index → urlset) only report the first-level child URL counts.
4. **Cross-origin redirect detection ignores scheme.** `http://example.com/robots.txt` → `https://example.com/robots.txt` does NOT trip `cross_origin_redirect` even though the spec is ambiguous about whether this is a valid origin. www/apex normalisation is applied, so `www.example.com` ↔ `example.com` is NOT cross-origin either.
5. **AI bot list is fixed at six.** GPTBot, CCBot, anthropic-ai, Google-Extended, PerplexityBot, Bytespider. If you need to add an agent, edit `AI_BOTS` in `python/robots_check.py`.
6. **`conflict_with_meta` requires an external signal.** The robots command doesn't fetch the page itself, so it can't read meta robots — you pass `--meta-blocked` to mark the page as blocked by meta, which enables the conflict check.
7. **No `request-rate` / `visit-time` interpretation.** These are recognised to avoid false-positive warnings, but their values are not parsed or reported.
8. **Redirect tracker uses urllib's default handler behaviour.** It follows 301/302/303/307/308 transparently and records each Location header in order. Infinite loops would be short-circuited by urllib's own max-redirects guard.

---

## Implementation

| File | Role |
|---|---|
| `python/robots_check.py` | Fetch, parse, resolve, validate. Uses only stdlib urllib. |
| `src/commands/robots.ts` | CLI entry, flag parsing, terminal printer, JSON envelope, `--save` orchestration. |
| `src/analysis/redirects.ts` | Shared `annotateRedirectChain` helper (also used by `technical` and `structure`). |
| `src/analysis/scoring.ts` | `RobotsInfo`, `SitemapAnalysis`, `AgentVerdict`, `AIBotSummary` TypeScript interfaces. |
| `src/analysis/orchestrator.ts` | In the analyze pipeline, runs `robots_check.py` in parallel with `split.py`, `technical_seo.py`, `schema_validator.py` and forwards `timeout_ms`. |
| `src/analysis/merger.ts` | Spreads the Python output onto `report.robots` on the final `AnalysisReport`. |
| `src/analysis/run-reporter.ts` | `buildRobotsCheckMd` renders the markdown report (Request, Redirects, Summary, Multi-agent Verdict, AI Bots, Sitemaps, Rules, per-sitemap analyses, Validation Warnings, Issues). |
| `src/analysis/report-md.ts` | Main report.md Crawlability section — renders the expanded robots fields inline with hreflang/pagination/AMP. |
| `tests/python/test_robots_check.py` | 28 unit tests covering longest-match, wildcards, per-agent parsing, AI bot detection, syntax warnings, sitemap index expansion, HTTP metadata handling. |
| `tests/unit/merger-detail.test.ts` | Verifies the expanded RobotsInfo fields reach `report.robots`. |

---

## See also

- [`docs/technical-seo.md`](./technical-seo.md) — the `sgnl technical` command reference.
- [`docs/structure.md`](./structure.md) — the `sgnl structure` command reference.
- [`docs/performance.md`](./performance.md) — the `sgnl performance` command reference.
- [`docs/schema.md`](./schema.md) — the `sgnl schema` command reference.
- [`docs/content.md`](./content.md) — the `sgnl content` command reference.
- [`docs/gsc.md`](./gsc.md) — the `sgnl gsc` command reference.
- [`docs/explorer.md`](./explorer.md) — site crawler, link graph visualization, and structural analysis.
- [Google's robots.txt specification](https://developers.google.com/search/docs/crawling-indexing/robots/robots_txt) — the authoritative source for all semantics implemented here.
