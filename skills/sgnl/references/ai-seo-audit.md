---
name: ai-seo-audit
description: >
  7-step AI-era SEO audit combining on-page keyword placement, AI citation
  readiness, search intent analysis, topical coverage, content structure for
  LLM quoting, authority signals, and AI search query matching. Use this skill
  when a user wants a comprehensive SEO audit optimized for both traditional
  search and AI search engines (ChatGPT, Perplexity, Google AI Overviews).
  Triggers include: "SEO audit", "AI SEO check", "is my page AI ready",
  "will AI recommend this", "Pareto SEO check", "full page audit", "AI
  citation check", "content audit for AI", or any request to evaluate a page
  for modern search visibility.
---

# AI-Era SEO Audit — 7-Step Pipeline

A sequential analysis that evaluates a page for both traditional SEO and
AI search engine visibility. Combines the Pareto SEO principle (focus on the
20% that drives 80% of results) with AI-readiness optimization.

---

## Before you start

> **CLI reference:** If you need command details, flags, or JSON field paths
> beyond what's listed here, see [SKILL.md](../SKILL.md).

### Collect inputs

1. **URL** (required)
2. **Target keyword** (required) — the primary keyword this page should rank for
3. **Page intent** (optional) — is this a blog post, product page, landing page, etc.?

### Extract data

Run these two commands:

```bash
sgnl content <url> --output json
sgnl technical <url> --output json
```

You need:
- `content.body` — the cleaned markdown (your primary analysis input)
- `content.metadata` — title, meta description, H1, canonical
- `content.stats` — structure, volume, media, links
- `content.outline` — heading tree
- `technical.meta` — title tag, meta description
- `technical.canonical` — canonical URL
- `request.final_url` — the resolved URL (for slug analysis)

---

## Step 1 — Keyword Placement Check

**Goal:** Verify the target keyword appears in the 5 critical on-page locations.
These 5 placements cover ~70% of on-page SEO signal.

**Instructions:**

Check if the target keyword (or a close semantic variant) appears in:

| # | Location | Source field | How to check |
|---|---|---|---|
| 1 | Title tag | `technical.meta.title` or `content.metadata.title` | Exact or close match |
| 2 | Meta description | `technical.meta.description` or `content.metadata.meta_description` | Exact or close match |
| 3 | URL slug | `request.final_url` | Check the path segment |
| 4 | H1 | `content.metadata.h1` | Exact or close match |
| 5 | First sentence | First sentence of `content.body` | Exact or close match |

**Output format:**

```
Keyword Placement: [target keyword]

| Location         | Present | Exact text                          |
|------------------|---------|-------------------------------------|
| Title tag        | YES/NO  | "quoted element or MISSING"         |
| Meta description | YES/NO  | "quoted element or MISSING"         |
| URL slug         | YES/NO  | /the/url/slug                       |
| H1               | YES/NO  | "quoted element or MISSING"         |
| First sentence   | YES/NO  | "quoted sentence or MISSING"        |

Score: X/5
Missing: [list what needs to be added]
```

**Rules:**
- A close semantic variant counts (e.g., "collaboration tools" matches
  "collaboration software") — but note it as a variant, not an exact match.
- If the keyword is missing from title or H1, flag as **critical**.
- If missing from meta description or first sentence, flag as **high priority**.
- If missing from URL slug, flag as **medium** (harder to change post-publish).

---

## Step 2 — AI Citation Simulation

**Goal:** Determine if an AI search engine would cite this page and what it
would actually say when quoting it.

**Instructions:**

Read `content.body` and answer:

1. **Citation test:** If an LLM received this page as a source while answering
   a user question about [target keyword], what 2-3 sentences would it quote?
   Copy the exact passages it would use.

2. **Brand recommendation test:** Does the content contain enough branded,
   positive, and authoritative language that an AI would **recommend** this
   brand/product/author — not just cite a fact from the page?

3. **Citation blockers:** What would make an AI skip this page in favor of a
   competitor? Common reasons:
   - Too generic / says what every other page says
   - No unique data, examples, or firsthand experience
   - Wishy-washy language ("might", "could", "it depends") without clear answers
   - Missing author/brand identity
   - Content reads as AI-generated filler

**Output format:**

```
AI Citation Verdict: WOULD CITE / PARTIAL / WOULD SKIP

What an AI would quote:
1. "exact passage..."
2. "exact passage..."

Would AI recommend the brand? YES / NO
Reason: [specific explanation]

Citation blockers found:
- [list specific issues]

What's missing for a strong citation:
- [list specific additions]
```

---

## Step 3 — Search Intent & Keyword Strategy

**Goal:** Classify the page's keyword intent and identify higher-converting
keyword variants. Bottom-of-funnel keywords convert far more and are often
easier to rank for than top-of-funnel informational queries.

**Instructions:**

1. **Classify the target keyword:**
   - **Top-of-funnel (ToFu):** Informational / awareness ("What is X", "X guide",
     "how does X work")
   - **Middle-of-funnel (MoFu):** Consideration / comparison ("X vs Y", "best X
     for Y", "X reviews")
   - **Bottom-of-funnel (BoFu):** Solution / buying intent ("X with [specific
     feature]", "X for [specific use case]", "X pricing", "buy X")

2. **If the keyword is ToFu:** Suggest 3 BoFu variants the page could also
   target. These should be solution-oriented, specific, and higher-converting.

   Example: "What is collaboration software" → suggest:
   - "collaboration software with intuitive onboarding"
   - "collaboration software for remote engineering teams"
   - "collaboration software that integrates with Slack"

3. **If the keyword is already BoFu:** Suggest 3 adjacent BoFu keywords that
   the page content could support with minor additions.

4. **Evaluate keyword-content alignment:** Does the page content actually match
   the intent of the target keyword? A page targeting a BoFu keyword but
   reading like a generic guide has an intent mismatch.

**Output format:**

```
Target keyword: [keyword]
Intent classification: ToFu / MoFu / BoFu
Content-intent alignment: ALIGNED / MISMATCHED

Suggested keyword variants (BoFu-oriented):
1. "[keyword variant]" — why it's better converting
2. "[keyword variant]" — why it's better converting
3. "[keyword variant]" — why it's better converting

Intent mismatch issues (if any):
- [specific issues]
```

---

## Step 4 — Topical Authority & Entity Coverage

**Goal:** Identify topic entities and subtopics covered, and what's missing
for comprehensive topical authority. Search engines rank pages from sites that
demonstrate deep expertise on a topic cluster — not just a single keyword.

**Instructions:**

1. Read `content.body` and `content.outline` (heading tree).

2. **List main topic entities** — the core concepts, products, people, or
   things the page covers. Think of these as what a knowledge graph would
   extract.

3. **List subtopics covered** — specific aspects of the main topic that the
   page addresses (map these to headings from the outline where possible).

4. **Identify missing entities and subtopics** — what would a comprehensive,
   authoritative page on this topic also cover? Consider:
   - Questions a reader would naturally ask next
   - Related concepts that competitors likely cover
   - Specific examples, data points, or case studies
   - Comparison angles (vs alternatives)
   - Practical how-to steps

5. **Rank missing items by importance** — which gaps hurt the most?

**Output format:**

```
Main entities: [entity1], [entity2], [entity3]...

Subtopics covered:
- [subtopic] (H2: "heading text")
- [subtopic] (H3: "heading text")
- [subtopic] (mentioned in body, no heading)

Missing subtopics (ranked by importance):
1. [CRITICAL] [subtopic] — why it matters
2. [HIGH] [subtopic] — why it matters
3. [MEDIUM] [subtopic] — why it matters
...

Topic coverage score: X/10
```

---

## Step 5 — AI-Readiness Structure Score

**Goal:** Rate how likely an LLM is to quote this page based on its structure
and formatting. AI engines prefer content they can cleanly extract and
attribute — short paragraphs, clear Q&A patterns, bullet points, and
unambiguous subheadings.

**Instructions:**

Use both `content.body` (for reading) and `content.stats` (for numbers).

Score each factor 0-10:

| Factor | What to check | Data source |
|---|---|---|
| Paragraph brevity | Are paragraphs short (< 4 sentences)? | `stats.distribution.paragraph_length` + read body |
| Bullet/list usage | Does it use bullets for key points? | `stats.structure.list_items_total` |
| Clear subheadings | Are H2/H3s descriptive (not clever/vague)? | `content.outline` |
| Q&A format | Are there direct question-answer pairs? | Read body for Q&A patterns |
| Direct answers | Does it give clear answers (not "it depends")? | Read body |
| Quotable passages | Are there self-contained 1-2 sentence takeaways? | Read body |

**Output format:**

```
AI-Readiness Score: X/10

| Factor             | Score | Notes                              |
|--------------------|-------|------------------------------------|
| Paragraph brevity  | X/10  | [specific observation]             |
| Bullet/list usage  | X/10  | [specific observation]             |
| Clear subheadings  | X/10  | [specific observation]             |
| Q&A format         | X/10  | [specific observation]             |
| Direct answers     | X/10  | [specific observation]             |
| Quotable passages  | X/10  | [specific observation]             |

Top structural fixes:
1. [specific fix with example from the content]
2. [specific fix with example from the content]
3. [specific fix with example from the content]
```

**Scoring guide:**
- 1-3: AI would struggle to extract useful quotes — wall of text, vague headings
- 4-6: AI could use some parts but would prefer a better-structured competitor
- 7-8: AI-friendly — clear structure, quotable sections exist
- 9-10: Optimized for AI extraction — direct Q&A, clean structure, standalone takeaways

---

## Step 6 — Authority & Trust Signals (EEAT)

**Goal:** Check for signals that tell both Google and AI engines "this source
is trustworthy." Google's ranking systems evaluate who said something, not
just what was said. AI engines preferentially cite sources with clear authority.

**Instructions:**

Read `content.body` and look for these specific signals:

| Signal | What to look for | Impact |
|---|---|---|
| Author name | Named author in body or byline | High |
| Author bio/credentials | Degrees, certifications, years of experience, role | High |
| Brand name mentions | The company/brand is named (not just "we") | High |
| Firsthand experience | "We tested", "In our experience", "Our data shows" | High |
| Original data/stats | Unique numbers, studies, surveys, results | Very high |
| External validation | Media mentions, awards, "as seen in", partnerships | High |
| Testimonials/reviews | Customer quotes, case studies, ratings | Medium |
| Citations/sources | Links to studies, references to research | Medium |
| Publish/update dates | Content freshness signals | Medium |
| Social proof | User counts, download numbers, customer logos | Medium |

**Output format:**

```
Authority Signals Found:
- [signal]: "exact quote or description"
- [signal]: "exact quote or description"

Authority Signals Missing:
- [signal] — [why it matters and how to add it]
- [signal] — [why it matters and how to add it]

EEAT Assessment:
  Experience:  X/10 — [one line reason]
  Expertise:   X/10 — [one line reason]
  Authority:   X/10 — [one line reason]
  Trust:       X/10 — [one line reason]
  Overall:     X/10

Biggest authority gap: [the single most impactful missing signal]
```

---

## Step 7 — AI Search Query Matching

**Goal:** Predict what search queries an AI would run when a user asks about
this topic, then check if this page's titles and headings would match.

**Instructions:**

1. **Predict 3 AI search queries.** If a user asked ChatGPT/Perplexity about
   [target keyword], what 2-3 web searches would the AI run to gather sources?
   These are typically:
   - A direct query matching the user's question
   - A more specific or technical variant
   - A comparison or "best" query

2. **For each predicted query**, check if the page would surface:
   - Does the `title` tag match or contain the query?
   - Does the `H1` match?
   - Do any `H2`/`H3` headings (from `content.outline`) match?
   - Does the `meta description` address it?

3. **Report gaps** — queries the AI would run that this page's headings and
   meta tags don't address.

**Output format:**

```
Predicted AI searches for "[target keyword]":

1. "[predicted query]"
   Title match:  YES/NO — "quoted title"
   H1 match:     YES/NO — "quoted H1"
   H2/H3 match:  YES/NO — "quoted heading" or NONE
   Meta match:    YES/NO
   Verdict:       WOULD SURFACE / MIGHT MISS / WOULD MISS

2. "[predicted query]"
   ...

3. "[predicted query]"
   ...

Heading gaps — add these H2s or H3s to capture AI searches:
- "[suggested heading]" — matches query "[query]"
- "[suggested heading]" — matches query "[query]"
```

---

## Final Synthesis — Pareto SEO Verdict

After completing all 7 steps, produce a combined summary.

**Structure:**

### Dashboard

| Dimension | Score | Priority |
|---|---|---|
| Keyword Placement (Step 1) | X/5 | Critical if < 4 |
| AI Citation Readiness (Step 2) | CITE/PARTIAL/SKIP | Critical if SKIP |
| Search Intent Alignment (Step 3) | ALIGNED/MISMATCHED | Critical if mismatched |
| Topical Coverage (Step 4) | X/10 | High if < 6 |
| AI-Readiness Structure (Step 5) | X/10 | High if < 6 |
| Authority Signals (Step 6) | X/10 | High if < 5 |
| AI Query Matching (Step 7) | X/3 queries matched | Medium |

### The 20% That Drives 80% of Results

List the **top 5 highest-impact fixes** across all steps. Order by:
1. Effort required (low effort first)
2. Expected impact (high impact first)

For each fix:
- What to do (specific, not generic)
- Which step identified it
- Estimated effort: 5 min / 30 min / 1 hour / half day
- Expected impact on rankings and AI visibility

### One-Sentence Verdict

A single sentence summarizing the page's readiness, e.g.:
"This page has strong topical coverage but AI engines will skip it because
it lacks direct answers, author credentials, and quotable takeaway sections."

### What This Page Does Well

List 2-3 genuine strengths — don't make it all negative.

---

## Notes

- **Do not fabricate data.** If a field is null or missing from the sgnl
  output, say so rather than guessing.
- **Be specific, not generic.** "Add more content" is useless. "Add a section
  comparing X to Y with a comparison table" is actionable.
- **Quote the actual content** when pointing out issues or strengths.
- **If the target keyword is ToFu**, strongly recommend the user also create
  or optimize BoFu pages — informational content alone rarely converts.
- **Scores should be strict.** Most pages score 4-6. Reserve 8+ for pages
  that genuinely excel in a dimension.
