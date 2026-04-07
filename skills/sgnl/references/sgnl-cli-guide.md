---
name: sgnl-cli-guide
description: >
  Teaches AI agents how to use the sgnl CLI for SEO analysis, content auditing,
  and site health recommendations. Use this skill when an agent needs to run sgnl
  commands, interpret their output, and produce actionable SEO or content
  recommendations. Triggers include: "analyze this site", "run an SEO audit",
  "check this URL", "use sgnl to", "crawl this site", "get content stats",
  "check my pages", "site audit", or any request involving the sgnl CLI tool.
---

# sgnl CLI — AI Agent Operating Guide

You have access to `sgnl`, a command-line SEO and content analysis tool.
This guide teaches you how to use it effectively to perform content analysis
and deliver SEO recommendations.

---

## Prerequisites

- `sgnl` is installed and available in PATH (`npm install -g sgnl-cli`)
- Node.js 18+
- Python 3.8+ (required for most commands except `performance` and `schema`)
- Optional: Google PSI API key (`sgnl init` or `SGNL_PSI_KEY` env var)
- Optional: Google Search Console credentials (`sgnl gsc login`)

Check readiness:

```bash
sgnl --version
```

---

## Core Principle

The CLI extracts **objective data**. Your job as the AI agent is to **interpret
that data and produce actionable recommendations**. The CLI does not judge
content quality — you do.

---

## Command Quick Reference

| Command | Purpose | Speed | Requires Python |
|---|---|---|---|
| `sgnl content <url>` | Clean markdown + content stats | ~2s | Yes |
| `sgnl technical <url>` | Technical SEO audit | ~2s | Yes |
| `sgnl structure <url>` | DOM, accessibility, scripts | ~3s | Yes |
| `sgnl performance <url>` | Core Web Vitals, Lighthouse | ~5s | No |
| `sgnl schema <url>` | JSON-LD validation | ~3s | No |
| `sgnl robots <url>` | robots.txt rules + AI bot blocking | ~2s | Yes |
| `sgnl analyze <url>` | Full pipeline (all of the above) | ~15s | Yes |

**Always use `--output json`** when running commands programmatically.
Terminal output is for humans; JSON output is for you.

---

## Workflow 1: Single Page Content Analysis

Use this when asked to analyze a page's content quality, SEO readiness, or
AI-search fitness.

### Step 1 — Extract content

```bash
sgnl content <url> --output json
```

This returns:
- `content.body` — cleaned markdown of the page (feed this to your analysis)
- `content.stats.volume` — word count, sentences, paragraphs, reading time
- `content.stats.structure` — heading counts, hierarchy validity, lists, tables
- `content.stats.media` — image count, alt coverage
- `content.stats.links` — internal/external split
- `content.stats.derived` — lexical diversity, content-to-chrome ratio
- `content.stats.duplication` — duplicate paragraphs/sentences
- `content.outline` — nested heading tree
- `content.metadata` — title, meta description, H1, language, canonical

**Flags you should use:**
- `--max-body-chars 15000` — truncate body if you have token limits
- `--stats-only` — skip body/outline/inventories if you only need numbers

### Step 2 — Interpret and recommend

Using the extracted data, evaluate:

1. **Content depth**: Is word count appropriate for the topic? (Compare: blog post 800-2000, pillar page 2000-5000, product page 300-800)
2. **Structure quality**: Is `heading_hierarchy_valid` true? Are there skipped levels? Is there exactly 1 H1?
3. **Readability signals**: Check `lexical_diversity` (low < 0.3 = repetitive), paragraph/sentence length distribution (p90 sentence > 35 words = hard to read)
4. **Media usage**: Is `alt_coverage` below 1.0? Flag missing alt text.
5. **Internal linking**: Are there enough internal links? (< 3 internal links on a page is usually too few)
6. **Duplication**: Any `duplicate_paragraphs` > 0 is a concern.
7. **Content freshness**: Check `patterns.year_mentions` — outdated years may signal stale content.

### Step 3 — Deep content quality (optional)

Read `content.body` and assess:
- Topical completeness for the target query
- EEAT signals (experience, expertise, authority, trust)
- AI extractability (can an AI quote clear answers from this?)
- Content gaps compared to what a searcher would expect

---

## Workflow 2: Technical SEO Audit

Use when asked to check a page's technical health.

### Step 1 — Run technical + robots checks

```bash
sgnl technical <url> --output json
sgnl robots <url> --output json
```

### Step 2 — Interpret technical signals

From `sgnl technical` output, check:

| Check | Where in JSON | Issue if... |
|---|---|---|
| Status code | `request.status` | Not 200 |
| TTFB | `request.ttfb_ms` | > 800ms |
| Redirect chain | `technical.redirect_chain` | > 1 hop or HTTP→HTTPS missing |
| Title | `technical.meta.title` | Missing, too long (>60 chars), or too short (<30) |
| Meta description | `technical.meta.description` | Missing, >160 chars, or duplicate |
| Canonical | `technical.canonical.href` | Missing or not self-referencing when expected |
| Robots directives | `technical.indexability` | `noindex` or `nofollow` when page should be indexed |
| Hreflang | `technical.hreflang` | Missing for multi-language sites |
| Security headers | `technical.security_headers` | Missing HSTS, CSP, or X-Frame-Options |

From `sgnl robots` output, check:
- Is the URL blocked by robots.txt?
- Are AI bots (ChatGPT-User, GPTBot, anthropic-ai) explicitly blocked?
- Are sitemaps declared and accessible?

---

## Workflow 3: Performance Audit

```bash
sgnl performance <url> --output json --strategy both
```

Check:
- `performance.cwv_passing` — are Core Web Vitals passing?
- LCP > 2500ms, CLS > 0.1, INP > 200ms — flag any failures
- `performance.lighthouse_scores.performance` — score < 50 is critical, < 90 needs work
- `performance.opportunities` — list specific fixes with estimated savings
- `performance.render_blocking_resources` — flag these for removal/deferral

---

## Workflow 4: Schema / Structured Data

```bash
sgnl schema <url> --output json
```

Check:
- Are JSON-LD blocks present? (none = missed opportunity)
- `schema.blocks[].validation.required_missing` — critical fixes
- `schema.blocks[].rich_results_eligible` — false means no rich snippets
- Common types to look for: Article, Product, LocalBusiness, FAQ, HowTo, BreadcrumbList

---

## Workflow 5: Full Single-Page Audit

Run everything at once:

```bash
sgnl analyze <url> --output json
```

This combines all focused commands into one report. Use this when the user
wants a comprehensive audit. The JSON contains all sections: `technical`,
`content`, `structure`, `performance`, `schema`, etc.

For a verbose saved report:

```bash
sgnl analyze <url> --save --verbose
```

---

## Workflow 6: Google Search Console Analysis

If GSC is configured (`sgnl gsc status` shows authenticated):

```bash
# Top pages by clicks
sgnl gsc pages <property> --json --limit 50

# Top queries
sgnl gsc queries <property> --json --limit 50

# Specific page performance + queries
sgnl gsc url <url> --json

# Index status
sgnl gsc inspect <url> --json

# Sitemap health
sgnl gsc sitemaps <property> --json
```

Key analyses:
- Pages with high impressions but low CTR (< 2%) — title/description needs improvement
- Pages with position 5-20 — "striking distance" keywords, optimize these first
- Pages in GSC but not linked internally — potential orphan pages

---

## Combining Commands for Maximum Insight

### Quick content audit (< 30 seconds)

```bash
sgnl content <url> --output json
sgnl technical <url> --output json
```

Use content stats + technical signals to produce a focused recommendation.

### Comprehensive page audit (< 60 seconds)

```bash
sgnl analyze <url> --output json
```

One command, all data. Parse each section and produce prioritized recommendations.

### Content gap analysis with GSC

```bash
sgnl gsc pages <property> --json --limit 100
sgnl content <top-page-url> --output json
```

Compare what's ranking (GSC) with what's on the page (content extraction)
to find gaps.

---

## Output Interpretation Rules

1. **All commands return a `request` envelope** with `url`, `status`, `ttfb_ms`, `redirect_chain`. Always check status first — if it's not 200, most analysis is unreliable.

2. **JSON is the source of truth.** Terminal output is a summary. If a field seems missing, re-run with `--output json`.

3. **Combine signals, don't rely on one.** A page can have perfect technical SEO but terrible content, or great content behind a noindex tag.

4. **Prioritize recommendations by impact:**
   - Critical: noindex on important pages, 4xx/5xx errors, missing canonical, blocked by robots
   - High: missing title/description, no H1, Core Web Vitals failing
   - Medium: alt text gaps, thin content, missing schema
   - Low: security headers, sentence length, lexical diversity

5. **Don't parrot numbers.** Translate data into actionable advice. Instead of "word count is 234", say "This page has only 234 words — too thin for a topic that typically requires 1500+ words to rank competitively."

---

## Error Handling

| Error | Cause | Action |
|---|---|---|
| `ECONNREFUSED` / `ETIMEDOUT` | Site unreachable | Check URL, try with `--timeout 60000` |
| `Python not found` | Python 3.8+ not installed | Use `--skip-python` or install Python |
| `GSC not authenticated` | No OAuth tokens | Run `sgnl gsc login` |
| `PSI API error` | Missing or invalid API key | Run `sgnl init` to set key, or skip with `--skip-python` |
| Status 403/401 | Site blocks automated requests | Try `--device desktop` or `--googlebot` |

---

## Example: Complete Content Analysis Session

Here is a complete example of how to analyze a page and produce recommendations:

```bash
# 1. Get content data
sgnl content https://example.com/blog/seo-guide --output json > content.json

# 2. Get technical health
sgnl technical https://example.com/blog/seo-guide --output json > technical.json

# 3. Check schema markup
sgnl schema https://example.com/blog/seo-guide --output json > schema.json
```

Then analyze the combined JSON outputs to produce a report covering:
1. Content quality score with specific issues
2. Technical SEO checklist (pass/fail per signal)
3. Structured data recommendations
4. Prioritized action items (critical → low)
5. Quick wins the author can fix in < 30 minutes

