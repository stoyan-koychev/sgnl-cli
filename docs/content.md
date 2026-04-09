# sgnl content — language-neutral content extraction for AI

`sgnl content <url>` fetches a page, converts it to clean markdown, and
returns every objective number it can compute **without claiming to
understand meaning**: volume, structure, distribution, media, links,
patterns, outline, link inventory, image inventory, and the cleaned body.

It is designed to be piped into an LLM. Anything subjective — quality,
tone, authority, relevance, EEAT, keyword stuffing, readability — is
the LLM's job, not the CLI's.

## What it does

- Fetches the URL (respecting `--device`).
- Runs `python/split.py` to convert HTML into clean markdown.
- Runs `python/content_extract.py` to compute:
  - Metadata: detected language, title, meta description, H1, canonical.
  - Volume: words, chars, sentences, paragraphs.
  - Distribution: paragraph length and sentence length min/p50/p90/max.
  - Derived: reading time, lexical diversity, content-to-chrome ratio.
  - Structure: heading counts, hierarchy validity, skipped levels,
    lists, tables, code blocks, blockquotes.
  - Media: image count and alt coverage.
  - Links: internal/external split, naked URL count.
  - Duplication: duplicate paragraphs and sentences.
  - Patterns: year mentions, percentage count, naked-URL count.
  - Outline: nested heading tree.
  - Link inventory: every link with anchor and internal flag (cap 200).
  - Image inventory: every image with src and alt (cap 100).
  - Body: the cleaned markdown itself.

## When to use

- You need a clean, AI-ready representation of a page.
- You want objective content metrics without Python-side English heuristics.
- You want to feed the result to an LLM for subjective judgment (EEAT,
  tone, quality, fitness-for-purpose).
- You want a structural inventory (links, images, outline) for audits.

## Why it changed (2026-04-05)

The previous `content` command ran `content_analysis.py`, which tried to
judge subjective qualities (EEAT, passive voice, transition words, CTAs,
thin-content risk, keyword stuffing, Flesch/Fog readability, top
keywords) using English-centric regex and stopword lists. Those
heuristics are brittle across languages and duplicate work an LLM does
better.

The rewrite drops every subjective heuristic and emits only
language-neutral stats. The `analyze` pipeline still uses
`content_analysis.py` — it has not been touched — but the `content`
command is now independent, AI-feed oriented, and works on any
language.

## Usage

```bash
sgnl content <url> [flags]
```

## Flags

| Flag | Type | Default | Description |
| --- | --- | --- | --- |
| `--output <terminal\|json>` | string | `terminal` | Output format |
| `--device <mobile\|desktop>` | string | `mobile` | Device to emulate during fetch |
| `--stats-only` | boolean | `false` | Omit `body`, `outline`, `link_inventory`, `image_inventory` |
| `--body-only` | boolean | `false` | Emit only `metadata` + `body` |
| `--max-body-chars <n>` | integer | unlimited | Truncate body to N chars; sets `body_truncated: true` |
| `--verbose` | boolean | `false` | In terminal mode, append raw JSON payload |
| `--save` | boolean | `false` | Write `content.md`, `content.json`, `content_stats.md` to runs dir |
| `--timeout <ms>` | integer | `30000` | Timeout per step |
| `--full-content` | boolean | `false` | Keep nav/header/footer — disable main-content extraction |
| `--exclude-tags <selectors...>` | string[] | — | CSS selectors to exclude from extraction |
| `--include-tags <selectors...>` | string[] | — | CSS selectors to include (extract only these elements) |

## Content extraction options

By default, `split.py` strips non-content elements (nav, header, footer,
sidebar, ads, modals, cookie banners, etc.) to produce a clean main-content
markdown. This matches `onlyMainContent: true` behavior.

### `--full-content`

Keeps everything — navigation, header, footer, sidebars. Useful when you
need the complete page structure or want to compare chrome-to-content ratio
with real page output.

```bash
sgnl content https://example.com --full-content
```

### `--include-tags`

Extract only specific elements by CSS selector. Everything else is dropped.

```bash
sgnl content https://example.com --include-tags article main
```

### `--exclude-tags`

Remove specific elements by CSS selector, in addition to the default
non-content selectors (when `--full-content` is not set) or as the only
filter (when `--full-content` is set).

```bash
sgnl content https://example.com --exclude-tags ".cookie-banner" ".promo"
```

## Pipeline

1. `safeFetch` the URL (captures status, TTFB, headers, redirect chain).
2. Cheap raw-HTML word count (strip tags + split) — used for
   `content_to_chrome_ratio`.
3. `python/split.py` → clean markdown.
4. `python/content_extract.py` with `{ url, title, meta_description,
   canonical, raw_html_word_count }` as meta argv.
5. Build `{ request, content }` envelope.

## Terminal output

```
Content — https://example.com/post
  Language: en  |  Title: The Ultimate SEO Guide

  Volume
    Words: 1,234  |  Sentences: 87  |  Paragraphs: 22
    Reading time: 6.2 min  |  Lexical diversity: 0.42 (medium)  |  Content/chrome: 0.58
    Paragraph length: min 5  p50 48  p90 120  max 180
    Sentence length:  min 3  p50 16  p90 30  max 48

  Structure
    H1: 1  H2: 5  H3: 12  H4+: 0  (hierarchy: valid)
    Lists: 3 (17 items)  Tables: 1  Code blocks: 4  Quotes: 0

  Media
    Images: 8 (alt coverage 0.75)
    Links: 42 internal, 15 external, 2 naked URLs

  Patterns
    Years: 2023, 2024, 2025  |  Percentages: 5
    Duplicate paragraphs: 0  |  Duplicate sentences: 1

  Outline
    # The Ultimate SEO Guide
      ## What is SEO
      ## Common mistakes
        ### Keyword stuffing

  (use --save or --output json to get cleaned body + inventories for AI)
```

`--verbose` appends a truncated raw JSON dump.
`--stats-only` omits the Outline section.
`--body-only` prints a note telling you to use `--save` or `--output json`.

## JSON envelope

```json
{
  "request": {
    "url": "https://example.com/post",
    "final_url": "https://example.com/post",
    "status": 200,
    "ttfb_ms": 214,
    "content_type": "text/html; charset=utf-8",
    "content_length": 42183,
    "redirect_chain": [],
    "device": "mobile"
  },
  "content": {
    "metadata": {
      "detected_language": "en",
      "title": "The Ultimate SEO Guide",
      "meta_description": "A complete guide to SEO in 2026.",
      "h1": "The Ultimate SEO Guide",
      "url": "https://example.com/post",
      "canonical": "https://example.com/post",
      "published": null,
      "modified": null
    },
    "stats": {
      "volume": { "word_count": 1234, "char_count": 7800, "char_count_no_spaces": 6420, "sentence_count": 87, "paragraph_count": 22 },
      "distribution": {
        "paragraph_length": { "min": 5, "max": 180, "p50": 48, "p90": 120 },
        "sentence_length": { "min": 3, "max": 48, "p50": 16, "p90": 30 }
      },
      "derived": {
        "reading_time_minutes": 6.2,
        "lexical_diversity": 0.42,
        "lexical_diversity_label": "medium",
        "content_to_chrome_ratio": 0.58
      },
      "structure": {
        "h1_count": 1, "h2_count": 5, "h3_count": 12, "h4plus_count": 0,
        "heading_hierarchy_valid": true, "skipped_levels": [],
        "lists_ordered": 0, "lists_unordered": 3, "list_items_total": 17,
        "tables": 1, "table_details": [{"rows": 6, "cols": 3}],
        "code_blocks": 4, "inline_code": 12, "blockquotes": 0
      },
      "media": { "image_count": 8, "images_with_alt": 6, "images_missing_alt": 2, "alt_coverage": 0.75 },
      "links": { "total": 57, "internal": 42, "external": 15, "naked_urls": 2 },
      "duplication": { "duplicate_paragraphs": 0, "duplicate_sentences": 1 },
      "patterns": { "year_mentions": [2023, 2024, 2025], "percentage_count": 5, "url_in_body_count": 2 }
    },
    "outline": [{ "level": 1, "text": "The Ultimate SEO Guide", "children": [] }],
    "link_inventory": [{ "url": "https://example.com/other", "anchor": "other post", "internal": true }],
    "image_inventory": [{ "src": "/chart.png", "alt": "Growth chart" }],
    "body": "# The Ultimate SEO Guide\n\n..."
  }
}
```

## `--save` files

| File | Contents |
| --- | --- |
| `content.md` | YAML frontmatter (url, title, description, lang, fetched_at) followed by the cleaned markdown body |
| `content.json` | The full `{ request, content }` envelope |
| `content_stats.md` | Pretty markdown tables of volume/distribution/structure/media/patterns + outline (no body) |

## Stats reference

### volume

| Field | Meaning |
| --- | --- |
| `word_count` | Language-aware word count. Whitespace-tokenised for non-CJK; `chars / 1.5` approximation for CJK (ja/zh/ko). |
| `char_count` | Character count of the plain text |
| `char_count_no_spaces` | Character count with whitespace removed |
| `sentence_count` | Language-aware sentence split. `[.!?]+\s+` for non-CJK; `[。！？.!?]` for CJK. |
| `paragraph_count` | Number of non-empty paragraphs (split on blank lines) |

### distribution

| Field | Meaning |
| --- | --- |
| `paragraph_length` | `{min, p50, p90, max}` word counts per paragraph |
| `sentence_length` | `{min, p50, p90, max}` word counts per sentence |

### derived

| Field | Meaning |
| --- | --- |
| `reading_time_minutes` | `word_count / 200` for non-CJK; `char_count_no_spaces / 400` for CJK |
| `lexical_diversity` | `unique_tokens / total_tokens`, rounded to 3 decimals |
| `lexical_diversity_label` | `low` (<0.3), `medium` (0.3–0.5), `high` (>0.5) |
| `content_to_chrome_ratio` | `markdown word count / raw HTML word count`. Present only when `raw_html_word_count` is passed in. |

### structure

| Field | Meaning |
| --- | --- |
| `h1_count`, `h2_count`, `h3_count`, `h4plus_count` | Heading counts by level |
| `heading_hierarchy_valid` | True if no heading level is skipped |
| `skipped_levels` | Array of skip descriptions e.g. `["H2→H4"]` |
| `lists_ordered`, `lists_unordered`, `list_items_total` | List block and item counts |
| `tables`, `table_details` | Table count and per-table `{rows, cols}` |
| `code_blocks`, `inline_code`, `blockquotes` | Counts of each |

### media

| Field | Meaning |
| --- | --- |
| `image_count` | Total markdown images |
| `images_with_alt`, `images_missing_alt` | Alt-text coverage counts |
| `alt_coverage` | `images_with_alt / image_count`, 0 when no images |

### links

| Field | Meaning |
| --- | --- |
| `total`, `internal`, `external` | Based on hostname match against the supplied URL |
| `naked_urls` | Unlinked URLs in the body text |
| `_truncated` | Present and `true` if the inventory was capped at 200 |
| `note` | Present when no base URL is supplied |

### duplication

| Field | Meaning |
| --- | --- |
| `duplicate_paragraphs` | Paragraphs whose normalized text appears more than once |
| `duplicate_sentences` | Sentences whose normalized text appears more than once (sentences <15 chars ignored) |

### patterns

| Field | Meaning |
| --- | --- |
| `year_mentions` | Sorted unique 4-digit years, 1900..current+1 |
| `percentage_count` | Matches of `\d+(?:\.\d+)?%` |
| `url_in_body_count` | Naked URL count (same as `links.naked_urls`) |

## Outline, link inventory, image inventory

- `outline` is a nested tree of `{level, text, children}` built by
  walking headings in order.
- `link_inventory` caps at 200 entries. Each entry is
  `{url, anchor, internal}`.
- `image_inventory` caps at 100 entries. Each entry is `{src, alt}`.

## Feeding this to an AI

The JSON envelope is designed to drop directly into an LLM prompt. A
few examples:

**Quality audit**

```
Here is a content stats envelope for <url>. Based only on these numbers
and the body, assess the content quality. Flag anything you'd change.

{pasted JSON envelope}
```

**Authority and EEAT**

```
Read the body below and evaluate E-E-A-T signals (experience, expertise,
authoritativeness, trustworthiness). Use the stats only as supporting
evidence.

Body:
{content.body}

Stats (for reference):
{content.stats}
```

**Topical coverage**

```
Given this outline and body, identify topical gaps for the query
"<target query>". The heading outline is the skeleton of the page.

Outline:
{content.outline}

Body:
{content.body}
```

## Known limitations

- **CJK approximations**: word count for ja/zh/ko is a character-count
  approximation (`chars / 1.5`); reading time uses 400 chars/minute.
  These are conventional but imperfect. For per-language accuracy,
  bring your own tokenizer.
- **`content_to_chrome_ratio`** requires `raw_html_word_count` to be
  supplied. The CLI computes it automatically; callers using the
  Python script directly must pass it in meta.
- **`detected_language`** is based on stopword heuristics in
  `python/analysis/languages.py` (en/de/es) plus a CJK character-block
  check. Anything else falls back to `en`.
- **Link internal/external split** relies on hostname comparison against
  the URL passed in meta. If absent, all links are treated as external.

## Implementation

- `python/content_extract.py` — language-neutral extractor.
- `src/commands/content.ts` — standalone command wrapper.

Neither touches the analyze pipeline: `python/content_analysis.py`,
`src/analysis/orchestrator.ts`, `src/analysis/merger.ts`,
`src/analysis/scoring.ts`, and `buildContentAnalysisMd` in
`src/analysis/run-reporter.ts` are deliberately untouched and continue
to feed `sgnl analyze`.

## See also

- [docs/performance.md](performance.md) — PageSpeed and CrUX metrics
- [docs/technical-seo.md](technical-seo.md) — on-page SEO signals
- [docs/structure.md](structure.md) — DOM and structural analysis
- [docs/schema.md](schema.md) — JSON-LD / structured data validation
- [docs/robots.md](robots.md) — robots.txt resolver
- [docs/gsc.md](gsc.md) — Google Search Console focused command
- [docs/explorer.md](explorer.md) — site crawler, link graph visualization, and structural analysis
