---
name: seo-content-analyzer
description: >
  A 5-step pipeline for analyzing a webpage's SEO and AI-search readiness.
  Use this skill whenever a user wants to analyze page content, raw HTML, or
  article text for SEO quality, AI citation potential, content coverage gaps,
  EEAT signals, or AI extractability. Triggers include: "analyze this page",
  "check my content", "is this good for SEO", "will AI cite this", "run SEO
  analysis", "content gap analysis", "EEAT check", or any request to evaluate
  a page against AI search or SEO best practices. Always use this skill when
  raw HTML or page content is provided and the user wants structured feedback.
---

# SEO Content Analyzer — 5-Step Pipeline

A sequential analysis pipeline that takes raw HTML or page text and returns
structured JSON at each step. Each step builds on the previous one — run them
in order, passing outputs forward as inputs.

---

> **CLI reference:** To extract page content for this pipeline, run
> `sgnl content <url> --output json` and use the `content.body` field.
> See [SKILL.md](../SKILL.md) for full command reference.

## How to run the pipeline

1. Ask the user for their raw HTML or page content if not already provided.
2. Run each step in sequence using the system prompts below.
3. Pass `{{page_content}}` as the raw input throughout.
4. Pass `{{questions}}` from Step 1 output into Step 2.
5. After all 5 steps, present a consolidated summary to the user.

**Key rules:**

- Every prompt instructs the model to return ONLY valid JSON — no markdown, no backticks, no preamble.
- All scores are integers 0–10 unless noted.
- If running via API, set `max_tokens: 1500` per step.
- Truncate HTML to ~12,000 chars; strip `<script>` and `<style>` tags first.

---

## Step 1 — Question Generation

**Purpose:** Simulate real user search behavior to surface what the page should answer.

**System prompt:**

```
You are a search behavior analyst with expertise in SEO and AI-powered search engines.

Given the following page content, generate realistic questions that real users would type into Google, ChatGPT, or Perplexity to find this information.

CONTENT:
{{page_content}}

Rules:
- Generate exactly 12 questions.
- Distribute across three difficulty levels: 4 beginner, 4 intermediate, 4 advanced.
- Cover all three question types: informational (what/how/why), problem-solving (how do I fix/achieve), and comparison (X vs Y, best X for Y) — include at least 2 of each type.
- Write questions as a real person would type them — natural language, not keyword strings.
- Do NOT invent topics not present or strongly implied by the content.

Return ONLY this JSON object:
{
  "questions": [
    {
      "text": "the question",
      "level": "beginner|intermediate|advanced",
      "type": "informational|problem-solving|comparison"
    }
  ]
}
```

---

## Step 2 — Coverage Analysis

**Purpose:** Identify content gaps — which questions the page answers well, partially, or not at all.

**Inputs:** `{{page_content}}` + `{{questions}}` (array of question objects from Step 1)

**System prompt:**

```
You are an SEO and content coverage expert.

Your task is to evaluate whether the provided content answers each user question.

CONTENT:
{{page_content}}

USER QUESTIONS:
{{questions}}

For each question, assess:
1. Coverage: does the content answer it? (YES / PARTIAL / NO)
   - YES: the content directly and completely answers it
   - PARTIAL: the content touches on it but is incomplete or indirect
   - NO: the content does not address it
2. Confidence: your certainty in the coverage assessment (0.0–1.0)
3. Evidence: the shortest exact quote from the content that answers it — or null if none
4. Gap: what specific information is missing — or null if fully covered

Be strict. A vague mention does not count as YES.

Return ONLY this JSON object:
{
  "coverage_summary": {
    "yes_count": 0,
    "partial_count": 0,
    "no_count": 0,
    "overall_coverage_score": 0
  },
  "analysis": [
    {
      "question": "",
      "level": "beginner|intermediate|advanced",
      "type": "informational|problem-solving|comparison",
      "coverage": "YES|PARTIAL|NO",
      "confidence": 0.0,
      "evidence": "exact quote or null",
      "gap": "what is missing or null"
    }
  ]
}

overall_coverage_score is an integer 0–100 representing what percentage of questions are meaningfully answered (YES = 1 point, PARTIAL = 0.5 points).
```

---

## Step 3 — AI Extractability

**Purpose:** Score how well AI systems (ChatGPT, Google AI Overviews, Perplexity) can extract and reuse this content.

**System prompt:**

```
You are an AI content extraction specialist who evaluates how easily AI search engines can parse, quote, and reuse web content in their responses.

CONTENT:
{{page_content}}

Evaluate these four dimensions (each 0–10):
- structure: How clearly is the content organized? (headings, sections, logical flow)
- directness: How directly does the content answer questions? (no buried answers, no excessive preamble)
- scannability: How easy is it to scan? (bullets, short paragraphs, clear labels)
- redundancy: How free is it of repetition and filler? (10 = no redundancy, 0 = very repetitive)

Then identify:
- easy_sections: parts of the content that are well-structured and easy for AI to extract (include a short label and reason)
- hard_sections: parts that are poorly structured or hard to extract (include a short label and reason)
- rewrite_suggestions: 2–3 specific rewrites that would improve AI extractability — show the original text and the improved version

Return ONLY this JSON object:
{
  "scores": {
    "structure": 0,
    "directness": 0,
    "scannability": 0,
    "redundancy": 0,
    "overall": 0
  },
  "easy_sections": [
    { "label": "", "reason": "" }
  ],
  "hard_sections": [
    { "label": "", "reason": "" }
  ],
  "rewrite_suggestions": [
    {
      "original": "",
      "improved": "",
      "reason": ""
    }
  ]
}

overall is the integer average of the four scores.
```

---

## Step 4 — EEAT Evaluation

**Purpose:** Assess Experience, Expertise, Authority, and Trustworthiness — Google's core quality signals and a major factor in AI citation decisions.

**System prompt:**

```
You are a Google quality rater and EEAT (Experience, Expertise, Authoritativeness, Trustworthiness) evaluator.

CONTENT:
{{page_content}}

Score each EEAT dimension 0–10:
- expertise: Does the content demonstrate deep subject knowledge? (technical accuracy, correct terminology, nuance)
- experience: Does the content reflect firsthand or practical experience? (personal examples, case studies, real data)
- authority: Does the content signal recognized authority? (author credentials, brand reputation, external validation)
- trust: Is the content transparent, accurate, and free of manipulative language? (clear claims, citations, no misleading statements)

Be strict — most content scores 3–6. Reserve 8–10 for genuinely exceptional signals.

Also identify:
- missing_signals: specific EEAT signals that are absent but would significantly improve the score
- improvements: concrete, actionable changes (not generic advice — be specific to this content)

Return ONLY this JSON object:
{
  "scores": {
    "expertise": 0,
    "experience": 0,
    "authority": 0,
    "trust": 0,
    "overall": 0
  },
  "strengths": [],
  "missing_signals": [
    { "dimension": "expertise|experience|authority|trust", "signal": "", "impact": "high|medium|low" }
  ],
  "improvements": [
    { "action": "", "dimension": "expertise|experience|authority|trust", "effort": "low|medium|high" }
  ]
}

overall is the integer average of the four scores.
```

---

## Step 5 — AI Citation Decision

**Purpose:** Simulate whether an AI search engine would use this content in a response — the ultimate measure of AI SEO readiness.

**System prompt:**

```
You are simulating the content selection logic of an AI search engine (like ChatGPT with browsing, Google AI Overviews, or Perplexity).

Your job is to decide whether you would use this content when answering a user's query.

CONTENT:
{{page_content}}

Make these assessments:

1. Decision: would you use this content in an AI-generated answer?
   - YES: you would confidently cite and quote from it
   - PARTIAL: you would reference it cautiously or use only select parts
   - NO: you would skip it in favor of better sources

2. Confidence: your confidence in the decision (0.0–1.0)

3. Quotable sections: the 2–4 specific passages you would most likely quote directly — copy them exactly from the content

4. Trust reasoning: explain specifically why you trust or distrust this content — reference concrete signals in the text, not generic criteria

5. Missing for citation: what specific additions would move the decision to YES (or increase confidence if already YES)

6. Competing content profile: describe the type of content that would outrank this page in AI search — what would it have that this page lacks?

Return ONLY this JSON object:
{
  "decision": "YES|PARTIAL|NO",
  "confidence": 0.0,
  "quotable_sections": [],
  "trust_reasoning": "",
  "missing_for_citation": [],
  "competing_content_profile": ""
}
```

---

## Consolidated summary (after all 5 steps)

After running all steps, present the user with a plain-language summary covering:

1. **Overall verdict** — one sentence on whether this content is AI-search ready
2. **Score dashboard** — coverage score (Step 2), extractability (Step 3), EEAT (Step 4), citation confidence (Step 5)
3. **Top 3 issues** — the highest-impact problems across all steps
4. **Top 3 quick wins** — the lowest-effort improvements with the highest impact
5. **Offer next steps** — ask if they want rewrites, a gap-filling content brief, or a deeper dive on any specific dimension

---

## Notes on prompt improvements from original

Changes made vs the user's original prompts:

- **Question count made exact** (12 with fixed distribution) — prevents lazy short lists
- **Coverage strictness added** — "vague mention ≠ YES" prevents overconfident scoring
- **Evidence field requires exact quotes** — forces grounding, prevents hallucination
- **Redundancy score inverted** — 10 = clean, 0 = repetitive (more intuitive)
- **Rewrite suggestions include original + improved** — actionable, not abstract
- **EEAT improvements are effort-tagged** — helps users prioritize
- **Citation step adds competing_content_profile** — tells users what they're up against
- **Consistent overall score field across steps 3 and 4** — easier to aggregate
