---
name: url-comparison
description: >
  Compare two URLs across all SEO and content dimensions using sgnl analyze.
  Use this skill when a user wants to compare two pages, benchmark against a
  competitor, or determine which page is stronger for a target query. Triggers
  include: "compare these pages", "which page is better", "benchmark against",
  "competitor analysis", "compare URLs", "A vs B", or any request to evaluate
  two pages side by side.
---

# URL Comparison — AI Agent Skill

Compare two URLs by running `sgnl analyze` on both and producing a structured
verdict across every SEO and content dimension.

---

> **CLI reference:** If you need command details, flags, or JSON field paths
> beyond what's listed here, see [SKILL.md](../SKILL.md).

## Step 1 — Collect inputs

Ask the user for:
1. **URL A** and **URL B** (required)
2. **Target query** (optional) — the keyword both pages are competing for
3. **Context** (optional) — same site (A/B test, old vs new) or competitor comparison?

---

## Step 2 — Run analysis

Run both in parallel:

```bash
sgnl analyze <url_a> --output json > /tmp/sgnl_a.json
sgnl analyze <url_b> --output json > /tmp/sgnl_b.json
```

If either returns a non-200 status, note it but continue with available data.

---

## Step 3 — Compare dimensions

For each dimension below, extract the relevant fields from both JSON reports
and determine a winner. Use the exact field paths shown.

### 3.1 Content Quality

| Metric | JSON path | Better when |
|---|---|---|
| Word count | `content.stats.volume.word_count` | Higher (if topic warrants depth) |
| Reading time | `content.stats.derived.reading_time_minutes` | Appropriate for topic (not padded) |
| Lexical diversity | `content.stats.derived.lexical_diversity` | Higher (> 0.4 is good) |
| Content/chrome ratio | `content.stats.derived.content_to_chrome_ratio` | Higher (more content vs UI chrome) |
| Duplicate sentences | `content.stats.duplication.duplicate_sentences` | Lower (0 is ideal) |
| Paragraph length p90 | `content.stats.distribution.paragraph_length.p90` | < 150 words (shorter = more scannable) |
| Sentence length p90 | `content.stats.distribution.sentence_length.p90` | < 35 words (shorter = more readable) |

### 3.2 Content Structure

| Metric | JSON path | Better when |
|---|---|---|
| H1 count | `content.stats.structure.h1_count` | Exactly 1 |
| Heading hierarchy valid | `content.stats.structure.heading_hierarchy_valid` | `true` |
| H2 count | `content.stats.structure.h2_count` | More sections = better coverage |
| Lists | `content.stats.structure.list_items_total` | More = better scannability |
| Images | `content.stats.media.image_count` | More (with good alt text) |
| Alt coverage | `content.stats.media.alt_coverage` | 1.0 (100%) |
| Internal links | `content.stats.links.internal` | More = better internal linking |

### 3.3 Technical SEO

| Metric | JSON path | Better when |
|---|---|---|
| Status | `request.status` | 200 |
| TTFB | `request.ttfb_ms` | Lower (< 400ms good, > 800ms bad) |
| Title length | `technical.meta.title` | 30-60 chars |
| Meta description | `technical.meta.description` | 70-160 chars, present |
| Canonical | `technical.canonical` | Present and self-referencing |
| Indexable | `technical.indexability` | No blocking directives |
| HTTPS | `request.final_url` | Starts with `https://` |
| Redirect chain | `technical.redirect_chain` | Shorter (0 hops ideal) |
| Security headers | `technical.security_headers` | More present (HSTS, CSP, X-Frame) |

### 3.4 Performance

| Metric | JSON path | Better when |
|---|---|---|
| CWV passing | `performance.cwv_passing` | `true` |
| LCP | `performance.lab.lcp_ms` | < 2500ms |
| CLS | `performance.lab.cls` | < 0.1 |
| TBT | `performance.lab.tbt_ms` | < 200ms |
| Performance score | `performance.lighthouse_scores.performance` | Higher (> 90 good) |
| Resource count | `performance.resources.total_requests` | Lower |
| Total bytes | `performance.resources.total_bytes` | Lower |

### 3.5 Structured Data

| Metric | JSON path | Better when |
|---|---|---|
| Schema blocks | `schema.blocks` | Present (vs none) |
| Rich results eligible | `schema.blocks[].rich_results_eligible` | `true` |
| Required fields missing | `schema.blocks[].validation.required_missing` | Fewer |
| Schema types | `schema.blocks[].type` | Relevant types present (Article, Product, FAQ, etc.) |

### 3.6 DOM & Accessibility (from structure section)

| Metric | JSON path | Better when |
|---|---|---|
| DOM elements | `structure.xray.dom.element_count` | Lower (leaner page) |
| DOM depth | `structure.xray.dom.depth` | Lower |
| Semantic score | `structure.xray.structure.semantic_score` | Higher |
| Missing alt on images | `structure.xray.accessibility.images_without_alt` | 0 |
| Missing lang attr | `structure.xray.accessibility.missing_lang` | `false` |
| Third-party scripts | `structure.xray.scripts.third_party` | Fewer |

---

## Step 4 — Produce the verdict

Structure your output as:

### Summary table

| Dimension | URL A | URL B | Winner |
|---|---|---|---|
| Content Quality | score/10 | score/10 | A or B |
| Content Structure | score/10 | score/10 | A or B |
| Technical SEO | score/10 | score/10 | A or B |
| Performance | score/10 | score/10 | A or B |
| Structured Data | score/10 | score/10 | A or B |
| Accessibility | score/10 | score/10 | A or B |
| **Overall** | | | **A or B** |

Score each dimension 0-10 based on the metrics above. Be strict — most pages
score 4-7. Reserve 8+ for genuinely strong results.

### Per-dimension breakdown

For each dimension, list:
- The 2-3 metrics where the gap is largest
- Specific numbers from both pages
- What the losing page should fix

### What to steal

List 3-5 specific things the weaker page should copy or adapt from the
stronger page. Be concrete — not "improve content quality" but "add a FAQ
section like URL B's H2 at line 45 covering X, Y, Z questions."

### If a target query was provided

Additionally assess:
- Which page better matches search intent for that query?
- Which page's title and meta description would get more clicks for that query?
- Which page covers more subtopics a searcher would expect?
- Read both `content.body` fields and evaluate topical completeness

---

## Step 5 — Actionable recommendations

Produce a prioritized action list for each URL:

**URL A — Top 5 fixes:**
1. [Critical/High/Medium] Specific action with expected impact
2. ...

**URL B — Top 5 fixes:**
1. [Critical/High/Medium] Specific action with expected impact
2. ...

---

## Notes

- If `sgnl analyze` is too slow or one section fails, fall back to running
  individual commands: `sgnl content`, `sgnl technical`, `sgnl performance`.
- Some fields may be missing if Python is not available — note which
  dimensions are incomplete rather than guessing.
- When pages are on the same site, focus on content and structure differences.
  When pages are competitors, weight technical SEO and performance equally.
- Do not fabricate data. If a field is null or missing, say so.
