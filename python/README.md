# SGNL Python Layer — HTML Analysis Tools

Phase 4 of the SGNL CLI: Four specialized Python scripts for deep HTML analysis and SEO evaluation.

## Scripts Overview

### 1. **split.py** — HTML → Markdown + Skeleton
Decomposes raw HTML into two analysis-ready layers:

**Input:** Raw HTML via stdin
**Output:** JSON with markdown and skeleton

```bash
cat page.html | python3 split.py
```

**Output structure:**
```json
{
  "markdown": "# Clean readable markdown\n\n...",
  "skeleton": "<html><body><div>...</div></body></html>"
}
```

**Features:**
- Markdown layer: Clean readable text with structure (headings, lists, links)
- Skeleton layer: Empty tag structure preserving hierarchy and attributes
- Removes: scripts, styles, nav, footer, ads
- Handles: malformed HTML, deeply nested (100+ levels), large files (5MB+)

---

### 2. **xray.py** — DOM X-Ray Analysis
Analyzes HTML skeleton and outputs comprehensive DOM structure metrics.

**Input:** HTML skeleton (typically from split.py) via stdin
**Output:** JSON with DOM metrics

```bash
echo '<html><body><div id="main"><p>Text</p></div></body></html>' | python3 xray.py
```

**Output structure:**
```json
{
  "dom": {
    "total_elements": 387,
    "unique_tags": 24,
    "depth_max": 18,
    "depth_avg": 7.2
  },
  "element_map": {
    "div": 142,
    "p": 38,
    "span": 31,
    "a": 28,
    "img": 24
  },
  "structure": {
    "div_ratio": 0.37,
    "semantic_score": 4,
    "h1_count": 1,
    "heading_hierarchy_valid": true,
    "empty_elements": 6,
    "duplicate_ids": 0,
    "deprecated_tags": ["font"],
    "inline_event_handlers": 2,
    "iframes": { "count": 2, "domains": ["youtube.com"] }
  },
  "head": {
    "charset_present": true,
    "viewport_present": true,
    "favicon_present": true,
    "preload_count": 3
  },
  "content_ratios": {
    "html_size_kb": 84,
    "text_size_kb": 12,
    "html_text_ratio": 0.14,
    "word_count_approx": 620
  }
}
```

**Features:**
- Element frequency mapping (all tags sorted by count)
- DOM depth analysis (max, average, deepest path)
- Semantic coverage scoring (main, header, footer, nav, article, section, aside)
- Heading hierarchy validation (exactly 1 H1? no skipped levels?)
- Empty element detection
- Duplicate ID detection
- Deprecated tag detection (font, center, marquee, etc.)
- Inline event handler detection (onclick, onload, etc.)
- iframe domain extraction
- Head section audit (charset, viewport, favicon, preloads)
- Content ratios (HTML size, text size, word count)

---

### 3. **technical_seo.py** — Technical SEO Analysis
Analyzes HTML and response headers for technical SEO factors.

**Input:** JSON with html and optional headers
**Output:** JSON with technical SEO analysis

```bash
echo '{"html": "...", "headers": {"status_code": "200"}}' | python3 technical_seo.py
```

**Output structure:**
```json
{
  "meta": {
    "title": {
      "present": true,
      "content": "My Site | Home",
      "length": 42,
      "status": "pass"
    },
    "description": {
      "present": false,
      "status": "fail"
    },
    "robots": {
      "index": true,
      "follow": true,
      "status": "pass"
    }
  },
  "canonical": {
    "present": true,
    "self_referencing": true,
    "status": "pass"
  },
  "open_graph": {
    "title": true,
    "description": true,
    "image": true,
    "url": true
  },
  "schema": {
    "blocks_found": 2,
    "types": ["Organisation", "WebPage"],
    "errors": [],
    "rich_result_eligible": ["knowledge_panel"]
  },
  "indexability": {
    "blocked": false,
    "signals": [],
    "conflicts": []
  },
  "links": {
    "internal_total": 28,
    "internal_generic_anchor": 2,
    "external_total": 4,
    "external_broken": 0
  }
}
```

**Features:**
- Meta tag extraction (title, description, robots)
- Canonical link validation
- Open Graph tags detection
- Twitter Card tags
- JSON-LD schema detection and validation
- Indexability signals (noindex, X-Robots-Tag conflicts)
- URL quality checks
- Internal/external link analysis
- HTTP status handling
- HTTPS enforcement checking
- Conflict detection

---

### 4. **onpage.py** — On-Page SEO Analysis
Analyzes markdown and HTML for on-page SEO factors.

**Input:** JSON with markdown, html, and optional headers
**Output:** JSON with on-page SEO metrics

```bash
echo '{"markdown": "# Title\n\nContent", "html": "..."}' | python3 onpage.py
```

**Output structure:**
```json
{
  "content": {
    "word_count": 620,
    "paragraph_count": 38,
    "avg_paragraph_length": 16
  },
  "headings": {
    "h1_count": 1,
    "h1_content": "Welcome to Example",
    "h2_count": 6,
    "h3_count": 4,
    "hierarchy_valid": true,
    "empty_headings": 0
  },
  "links": {
    "internal_total": 28,
    "internal_generic_anchor": 2,
    "external_total": 4,
    "external_broken": 0
  },
  "images": {
    "total": 24,
    "missing_alt": 3,
    "empty_alt_decorative": 4,
    "too_short": 1,
    "too_long": 2
  },
  "crawlability": {
    "status_code": 200,
    "redirect_count": 0,
    "robots_blocked": false,
    "sitemap_found": false,
    "https_enforced": true,
    "mixed_content": false
  }
}
```

**Features:**
- H1 validation (exactly 1? content quality?)
- H2–H6 hierarchy validation
- Content analysis (word count, paragraphs)
- Keyword signal detection
- Keyword stuffing detection
- Link analysis (generic anchor text, redirects)
- Image alt text analysis (missing, empty, length)
- Crawlability checking
- Redirect chain detection
- HTTPS enforcement
- Mixed content detection

---

## Installation

### Requirements
- Python 3.8+
- BeautifulSoup4
- html2text
- pytest (for tests)

### Setup
```bash
# Install dependencies
pip install -r python/requirements.txt

# Make scripts executable
chmod +x python/*.py
```

---

## Usage Examples

### Complete Pipeline
```bash
# Fetch a page and analyze it completely
curl -s https://example.com | python3 python/split.py > /tmp/split.json

# Extract skeleton and analyze DOM structure
jq -r '.skeleton' /tmp/split.json | python3 python/xray.py > /tmp/xray.json

# Extract markdown for on-page analysis
jq -r '.markdown' /tmp/split.json | \
  python3 python/onpage.py > /tmp/onpage.json

# Technical SEO analysis (requires HTML and headers)
echo '{"html": "..."}' | python3 python/technical_seo.py > /tmp/technical.json
```

### Standalone Usage
```bash
# Just split HTML
cat raw.html | python3 python/split.py

# Just DOM analysis
cat skeleton.html | python3 python/xray.py

# Just technical SEO
echo '{"html": "<h1>Test</h1>"}' | python3 python/technical_seo.py

# Just on-page analysis
echo '{"markdown": "# Title\n\nContent"}' | python3 python/onpage.py
```

---

## Testing

All scripts include comprehensive pytest test suites:

```bash
# Run all tests
pytest tests/python/ -v

# Run specific test file
pytest tests/python/test_split.py -v

# Run with coverage
pytest tests/python/ --cov=python --cov-report=html
```

### Test Coverage
- **test_split.py**: 10+ tests (text removal, script clearing, empty/malformed HTML, large files, attributes)
- **test_xray.py**: 25+ tests (element counting, depth calculation, div ratio, heading hierarchy, empty elements, duplicate IDs, deprecated tags, events, iframes, head audit, content ratios)
- **test_technical_seo.py**: 18+ tests (meta tags, canonical, OG tags, schema, indexability, links, headers)
- **test_onpage.py**: 23+ tests (content analysis, headings, links, images, crawlability)

All tests passing ✓

---

## Error Handling

All scripts:
- Handle UTF-8 decoding gracefully
- Parse malformed HTML without crashing
- Return partial results on errors
- Log errors to stderr
- Output valid JSON even on partial failures
- Never execute arbitrary code or path traversal

---

## Architecture

```
python/
├── split.py              # HTML → Markdown + Skeleton
├── xray.py              # DOM X-Ray Analysis
├── technical_seo.py     # Technical SEO Analysis
├── onpage.py            # On-Page SEO Analysis
├── requirements.txt     # Dependencies
├── __init__.py          # Module marker
└── README.md            # This file

tests/python/
├── test_split.py        # Split tests
├── test_xray.py        # Xray tests
├── test_technical_seo.py # Technical SEO tests
├── test_onpage.py      # On-page tests
└── __init__.py         # Test module marker
```

---

## Integration with SGNL CLI

These scripts are part of the SGNL CLI full-stack build:

- **Phase 1–3**: TypeScript/Node.js CLI, fetching, PSI integration
- **Phase 4**: Python layer (this) — HTML analysis and SEO evaluation
- **Phase 5**: Full integration, API endpoints, batch processing

The Python layer sits between the fetching/crawling layer and higher-level analysis, providing:
1. **Split** — decomposes raw HTML into usable formats
2. **Xray** — understands DOM structure
3. **Technical SEO** — validates markup and headers
4. **Onpage** — evaluates content quality

---

## Performance Notes

- **split.py**: Handles 5MB+ HTML efficiently
- **xray.py**: Analyzes 100+ levels deep without stack overflow
- **technical_seo.py**: Parses malformed JSON-LD gracefully
- **onpage.py**: Processes large markdown without memory issues

All scripts use streaming stdin/stdout for pipeline efficiency.

---

## License

Part of SGNL CLI project.
