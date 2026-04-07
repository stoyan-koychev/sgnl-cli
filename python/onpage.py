#!/usr/bin/env python3
"""
onpage.py — On-Page SEO Analysis

Analyzes markdown content for on-page SEO factors:
- H1 validation
- Heading hierarchy
- Content analysis (word count, paragraphs)
- Keyword signals
- Image alt text
- Crawlability
"""

import sys
import json
import re
from typing import Dict, Any, List, Tuple, Optional
from collections import Counter

try:
    from bs4 import BeautifulSoup
except ImportError:
    sys.stderr.write("Error: BeautifulSoup4 required. Install with: pip install beautifulsoup4\n")
    sys.exit(1)


def analyze_onpage(markdown: str, html: str = "", headers: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
    """Analyze markdown and raw HTML for on-page SEO factors."""
    try:
        soup = BeautifulSoup(html, 'html.parser') if html else BeautifulSoup("", 'html.parser')
        headers = headers or {}
        
        # Content analysis
        content = _analyze_content(markdown)
        
        # Heading analysis
        headings = _analyze_headings(soup)
        
        # Link analysis
        links = _analyze_onpage_links(soup)
        
        # Image analysis
        images = _analyze_images(soup)

        # Image density (images per 1000 words)
        word_count = content.get('word_count', 0)
        if word_count > 0 and images['total'] > 0:
            images['density_per_1000_words'] = round(images['total'] / word_count * 1000, 1)
        else:
            images['density_per_1000_words'] = 0.0

        # Crawlability
        crawlability = _analyze_crawlability(headers)

        return {
            "content": content,
            "headings": headings,
            "links": links,
            "images": images,
            "crawlability": crawlability
        }
    except Exception as e:
        sys.stderr.write(f"Error analyzing on-page SEO: {e}\n")
        return {}


def _analyze_content(markdown: str) -> Dict[str, Any]:
    """Analyze content metrics (word count, paragraphs, etc.)"""
    # Split by lines/paragraphs
    paragraphs = [p.strip() for p in markdown.split('\n') if p.strip()]
    
    # Count words
    words = markdown.split()
    word_count = len(words)
    
    # Average paragraph length
    avg_para = word_count / len(paragraphs) if paragraphs else 0
    
    return {
        'word_count': word_count,
        'paragraph_count': len(paragraphs),
        'avg_paragraph_length': round(avg_para, 1)
    }


def _analyze_headings(soup: BeautifulSoup) -> Dict[str, Any]:
    """Analyze heading structure with tree, violations, score, and grade."""
    h_tags = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']
    h_counts = {tag: len(soup.find_all(tag)) for tag in h_tags}

    h1 = soup.find('h1')
    h1_content = h1.get_text(strip=True) if h1 else ""

    headings = soup.find_all(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'])
    heading_levels = [int(h.name[1]) for h in headings]
    heading_texts = [h.get_text(strip=True) for h in headings]

    empty_headings = sum(1 for t in heading_texts if not t)

    # Detect violations
    violations: list = []
    issues: list = []

    if not heading_levels:
        violations.append({'from_level': 0, 'to_level': 0, 'heading': '', 'issue_type': 'no_headings'})
        issues.append('No headings found on page')
    else:
        if heading_levels.count(1) == 0:
            violations.append({'from_level': 0, 'to_level': 0, 'heading': '', 'issue_type': 'missing_h1'})
            issues.append('Missing H1 tag')
        elif heading_levels.count(1) > 1:
            for idx, lvl in enumerate(heading_levels):
                if lvl == 1 and idx > 0:
                    violations.append({'from_level': 1, 'to_level': 1, 'heading': heading_texts[idx], 'issue_type': 'multiple_h1'})
            issues.append(f'{heading_levels.count(1)} H1 tags found (should be exactly 1)')

        for i in range(len(heading_levels) - 1):
            if heading_levels[i + 1] > heading_levels[i] + 1:
                violations.append({
                    'from_level': heading_levels[i],
                    'to_level': heading_levels[i + 1],
                    'heading': heading_texts[i + 1],
                    'issue_type': 'skipped_level',
                })
                issues.append(f'Heading level skip: H{heading_levels[i]} → H{heading_levels[i + 1]} (\'{heading_texts[i + 1][:50]}\')')

    if empty_headings > 0:
        issues.append(f'{empty_headings} empty heading(s) found')

    hierarchy_valid = len(violations) == 0 and len(heading_levels) > 0

    # Build tree
    tree = _build_heading_tree(heading_levels, heading_texts)

    # Table of contents heuristic: 3+ anchor links whose targets match h2/h3 ids.
    toc_detected = _detect_table_of_contents(soup)

    return {
        'h1_count': h_counts['h1'],
        'h1_content': h1_content,
        'h2_count': h_counts['h2'],
        'h3_count': h_counts['h3'],
        'h4_count': h_counts.get('h4', 0),
        'h5_count': h_counts.get('h5', 0),
        'h6_count': h_counts.get('h6', 0),
        'hierarchy_valid': hierarchy_valid,
        'empty_headings': empty_headings,
        'total_headings': len(headings),
        'violations': violations,
        'issues': issues,
        'tree': tree,
        'table_of_contents_detected': toc_detected,
    }


def _detect_table_of_contents(soup: BeautifulSoup) -> bool:
    """Detect a page-internal TOC: 3+ anchor links whose hash targets match h2/h3 ids."""
    target_ids = set()
    for h in soup.find_all(['h2', 'h3']):
        hid = h.get('id')
        if hid:
            target_ids.add(hid)
    if not target_ids:
        return False
    matches = 0
    for a in soup.find_all('a', href=True):
        href = a.get('href', '')
        if href.startswith('#'):
            target = href[1:]
            if target and target in target_ids:
                matches += 1
                if matches >= 3:
                    return True
    return False


def _build_heading_tree(levels: list, texts: list) -> list:
    """Build a nested heading tree from flat heading lists."""
    if not levels:
        return []

    tree: list = []
    stack: list = []  # (level, node) pairs

    for level, text in zip(levels, texts):
        node = {'level': level, 'text': text, 'children': []}

        # Pop stack until we find a parent (lower level)
        while stack and stack[-1][0] >= level:
            stack.pop()

        if stack:
            stack[-1][1]['children'].append(node)
        else:
            tree.append(node)

        stack.append((level, node))

    return tree


def _validate_hierarchy(levels: List[int]) -> bool:
    """Validate heading hierarchy (legacy — used by other callers)."""
    if not levels:
        return False
    if levels.count(1) != 1:
        return False
    for i in range(len(levels) - 1):
        if levels[i + 1] > levels[i] + 1:
            return False
    return True


def _analyze_onpage_links(soup: BeautifulSoup) -> Dict[str, int]:
    """Analyze internal and external links in content."""
    internal_total = 0
    internal_generic = 0
    external_total = 0
    external_broken = 0
    
    generic_anchors = ['click here', 'read more', 'learn more', 'more', 'link', 'here', 'go']
    
    for link in soup.find_all('a', href=True):
        href = link.get('href', '')
        anchor = (link.get_text(strip=True) or '').lower()
        
        is_internal = href.startswith('/') or href.startswith('#') or 'http' not in href.lower()
        
        if is_internal:
            internal_total += 1
            if anchor in generic_anchors or not anchor:
                internal_generic += 1
        else:
            external_total += 1
            if not href.startswith('http'):
                external_broken += 1
    
    return {
        'internal_total': internal_total,
        'internal_generic_anchor': internal_generic,
        'external_total': external_total,
        'external_broken': external_broken
    }


_POOR_ALT_PATTERNS = re.compile(
    r'^(?:image|photo|img|picture|pic|screenshot|banner|logo|icon|thumbnail|graphic|'
    r'untitled|dsc\d*|img\d*|photo\d*|pic\d*|p\d{4,}|[a-z0-9_-]+\.(?:jpg|jpeg|png|gif|webp|avif|svg))$',
    re.IGNORECASE,
)
_MODERN_FORMAT_RE = re.compile(r'\.(?:webp|avif)(?:[?#]|$)', re.IGNORECASE)


def _analyze_images(soup: BeautifulSoup) -> Dict[str, Any]:
    """Analyze image alt text and attributes."""
    images = soup.find_all('img')
    total = len(images)
    missing_alt = 0
    empty_alt = 0
    too_short = 0
    too_long = 0
    decorative_empty = 0
    poor_quality_alt = 0
    lazy_loading = 0
    modern_format = 0
    explicit_dimensions = 0

    for img in images:
        alt = img.get('alt', None)
        src = img.get('src', '') or img.get('data-src', '') or ''

        if alt is None:
            missing_alt += 1
        elif alt == '':
            empty_alt += 1
            decorative_empty += 1
        else:
            if len(alt) < 3:
                too_short += 1
            elif len(alt) > 125:
                too_long += 1
            # Poor quality: generic word or looks like a filename
            if _POOR_ALT_PATTERNS.match(alt.strip()):
                poor_quality_alt += 1

        # Lazy loading
        if img.get('loading', '').lower() == 'lazy':
            lazy_loading += 1

        # Modern format
        if _MODERN_FORMAT_RE.search(src):
            modern_format += 1

        # Explicit dimensions
        if img.get('width') and img.get('height'):
            explicit_dimensions += 1

    return {
        'total': total,
        'missing_alt': missing_alt,
        'empty_alt_decorative': decorative_empty,
        'too_short': too_short,
        'too_long': too_long,
        'poor_quality_alt': poor_quality_alt,
        'lazy_loading': lazy_loading,
        'modern_format': modern_format,
        'explicit_dimensions': explicit_dimensions,
    }


def _analyze_crawlability(headers: Dict[str, str]) -> Dict[str, Any]:
    """Analyze crawlability factors."""
    status_code = int(headers.get('status_code', 200))
    redirect_count = int(headers.get('redirect_count', 0))
    robots_blocked = headers.get('robots_blocked', 'false').lower() == 'true'
    sitemap_found = headers.get('sitemap_found', 'false').lower() == 'true'
    https_enforced = headers.get('https', 'true').lower() == 'true'
    mixed_content = headers.get('mixed_content', 'false').lower() == 'true'
    
    return {
        'status_code': status_code,
        'redirect_count': redirect_count,
        'robots_blocked': robots_blocked,
        'sitemap_found': sitemap_found,
        'https_enforced': https_enforced,
        'mixed_content': mixed_content
    }


def main() -> None:
    """
    Read from stdin:
    {
      "markdown": "...",
      "html": "...",
      "headers": { ... }
    }
    
    Output on-page SEO analysis JSON.
    """
    try:
        input_data = json.load(sys.stdin)
        markdown = input_data.get('markdown', '')
        html = input_data.get('html', '')
        headers = input_data.get('headers', {})
        
        if not markdown.strip() and not html.strip():
            result = {
                "content": {"word_count": 0, "paragraph_count": 0, "avg_paragraph_length": 0},
                "headings": {},
                "links": {},
                "images": {},
                "crawlability": {}
            }
        else:
            result = analyze_onpage(markdown, html, headers)
        
        json.dump(result, sys.stdout, ensure_ascii=False, separators=(',', ':'))
        sys.stdout.write('\n')
        
    except json.JSONDecodeError as e:
        sys.stderr.write(f"Invalid JSON input: {e}\n")
        sys.exit(1)
    except Exception as e:
        sys.stderr.write(f"Fatal error: {e}\n")
        json.dump({"error": str(e)}, sys.stdout)
        sys.exit(1)


if __name__ == "__main__":
    main()
