---
name: sgnl
description: >
  SEO and content analysis CLI tool. Use this skill to run sgnl commands for
  page analysis, technical SEO audits, performance checks, content extraction,
  and structured data validation. This is the entry point — it contains the
  full command reference and routes to specialized skills for audits,
  comparisons, and content quality pipelines.
---

# sgnl — AI Agent Skill

You have access to `sgnl`, a command-line SEO and content analysis tool.
This file is your entry point. It contains everything you need to run
commands and routes you to the right skill for the task.

---

## Setup

- Install: `npm install -g sgnl-cli`
- Requires: Node.js 18+, Python 3.8+ (most commands)
- Optional: `sgnl init` (PSI API key), `sgnl gsc login` (Search Console)
- Check: `sgnl --version`

---

## Core Principle

The CLI extracts **objective data**. Your job as the AI agent is to **interpret
that data and produce actionable recommendations**. The CLI does not judge
content quality — you do.

**Always use `--output json` for programmatic use.** Terminal output is for humans.

---

## Commands

| Command | What it does | ~Speed |
|---|---|---|
| `sgnl content <url>` | Cleaned markdown + content stats (volume, structure, media, links, outline) | 2s |
| `sgnl technical <url>` | Technical SEO (meta tags, canonical, robots, headers, redirects, hreflang) | 2s |
| `sgnl structure <url>` | DOM analysis, accessibility, scripts, semantic score | 3s |
| `sgnl performance <url>` | Core Web Vitals, Lighthouse scores, opportunities | 5s |
| `sgnl schema <url>` | JSON-LD validation, rich results eligibility | 3s |
| `sgnl robots <url>` | robots.txt rules, AI bot blocking, sitemaps | 2s |
| `sgnl analyze <url>` | **All of the above in one call** | 15s |

### Common flags

| Flag | Works with | Purpose |
|---|---|---|
| `--output json` | All | Machine-readable output (use this) |
| `--device <mobile\|desktop>` | Most | Device emulation (default: mobile) |
| `--save` | All | Save markdown + JSON reports to `~/.sgnl/runs/` |
| `--timeout <ms>` | All | Timeout per step (default: 30000) |
| `--strategy both` | `performance` | Run both mobile + desktop |
| `--skip-python` | `analyze` | Skip Python-dependent analysis |
| `--stats-only` | `content` | Numbers only, no body/outline/inventories |
| `--max-body-chars <n>` | `content` | Truncate body (useful for token limits) |

### GSC commands (requires `sgnl gsc login`)

| Command | What it does |
|---|---|
| `sgnl gsc pages <property>` | Top pages by clicks/impressions |
| `sgnl gsc queries <property>` | Top search queries |
| `sgnl gsc url <url>` | Per-URL performance + top queries |
| `sgnl gsc inspect <url>` | Google index status for a URL |
| `sgnl gsc sitemaps <property>` | Submitted sitemaps + error counts |

GSC flags: `--json`, `--limit <n>`, `--days <n>`, `--country <code>`, `--device <type>`, `--compare`

---

## Key JSON Paths

These are the fields you'll use most often across skills:

### From `sgnl content`
- `content.body` — cleaned markdown (feed to LLM analysis)
- `content.metadata.title` / `.meta_description` / `.h1` — page meta
- `content.stats.volume.word_count` — content depth
- `content.stats.structure.*` — heading counts, hierarchy validity
- `content.stats.derived.lexical_diversity` — vocabulary richness
- `content.stats.media.alt_coverage` — image accessibility
- `content.stats.links.internal` / `.external` — link profile
- `content.stats.duplication.*` — duplicate content flags
- `content.outline` — heading tree
- `content.stats.distribution.paragraph_length` / `.sentence_length` — readability

### From `sgnl technical`
- `request.status` / `.ttfb_ms` / `.final_url` — request health
- `technical.meta.title` / `.description` — meta tags
- `technical.canonical` — canonical URL
- `technical.indexability` — robots directives
- `technical.redirect_chain` — redirect hops
- `technical.security_headers` — HSTS, CSP, etc.

### From `sgnl performance`
- `performance.cwv_passing` — Core Web Vitals verdict
- `performance.lighthouse_scores.performance` — 0-100 score
- `performance.opportunities` — ranked fixes with savings

### From `sgnl schema`
- `schema.blocks[]` — JSON-LD blocks with validation results
- `schema.blocks[].rich_results_eligible` — rich snippet eligibility

---

## Error Handling

| Error | Fix |
|---|---|
| `ECONNREFUSED` / `ETIMEDOUT` | Check URL, try `--timeout 60000` |
| `Python not found` | Use `--skip-python` or install Python 3.8+ |
| `GSC not authenticated` | Run `sgnl gsc login` |
| `PSI API error` | Run `sgnl init` to set API key |
| Status 403/401 | Try `--device desktop` |

---

## References

Load the reference that matches your task. Each one assumes you've read
this file and know how to run the commands above.

### [sgnl-cli-guide](references/sgnl-cli-guide.md) — Full CLI Operating Guide

**When to use:** You need detailed guidance on running sgnl commands,
interpreting output fields, combining commands, or handling edge cases.
This is the comprehensive reference — use it when the quick reference
above isn't enough.

**Triggers:** "how do I use sgnl", "what commands are available", "help with sgnl"

---

### [ai-seo-audit](references/ai-seo-audit.md) — 7-Step AI-Era SEO Audit

**When to use:** Audit a single page for both traditional SEO and AI search
engine visibility. Covers keyword placement, AI citation readiness, search
intent, topical coverage, content structure, authority signals, and AI query
matching.

**Triggers:** "SEO audit", "AI SEO check", "is my page AI ready", "will AI
recommend this", "content audit", "full page audit"

**Commands needed:** `sgnl content <url> --output json` + `sgnl technical <url> --output json`

**Inputs required:** URL + target keyword

---

### [url-comparison](references/url-comparison.md) — Compare Two URLs

**When to use:** Compare two pages side by side across all SEO and content
dimensions. Produces a scored verdict per dimension with "what to steal" list
and prioritized fixes for each URL.

**Triggers:** "compare these pages", "which page is better", "benchmark against
competitor", "A vs B"

**Commands needed:** `sgnl analyze <url_a> --output json` + `sgnl analyze <url_b> --output json`

**Inputs required:** URL A + URL B, optional target keyword

---

### [seo-content-analyzer](references/seo-content-analyzer.md) — 5-Step Content Quality Pipeline

**When to use:** Deep content quality analysis using LLM prompts — question
generation, coverage analysis, AI extractability, EEAT evaluation, and AI
citation simulation. Use this when you have the page content already (HTML or
markdown) and want a structured multi-step quality assessment.

**Triggers:** "analyze this content", "check my content quality", "EEAT check",
"will AI cite this", "content gap analysis"

**Commands needed:** `sgnl content <url> --output json` (to extract the body, then feed to the 5-step pipeline)

**Inputs required:** URL or raw HTML/page content

---

## Choosing the Right Reference

| User wants... | Load this |
|---|---|
| Quick SEO check of a page | No reference needed — use commands above |
| Full audit for AI + traditional SEO | [ai-seo-audit](references/ai-seo-audit.md) |
| Compare two pages | [url-comparison](references/url-comparison.md) |
| Deep content quality analysis | [seo-content-analyzer](references/seo-content-analyzer.md) |
| Learn how to use the CLI | [sgnl-cli-guide](references/sgnl-cli-guide.md) |
| Multiple pages on same site | Run commands in a loop, no special reference |
