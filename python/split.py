#!/usr/bin/env python3
"""
split.py — HTML → Markdown + Skeleton

Strips HTML into two layers for analysis:
- Markdown: clean readable text with structure
- Skeleton: bare tag structure with attributes, no text content

Accepts an optional argv[1] with the page URL for absolutizing relative links.
"""

import sys
import json
import re
from urllib.parse import urljoin, urlparse

try:
    from bs4 import BeautifulSoup
    import html2text
except ImportError:
    sys.stderr.write("Error: BeautifulSoup4 and html2text required. Install with: pip install beautifulsoup4 html2text\n")
    sys.exit(1)


# ── Selectors to strip when extracting main content ────────────────────────
# Common non-content elements to strip for clean main-content extraction.
REMOVE_TAGS = ['script', 'style', 'noscript', 'meta', 'link', 'head']

REMOVE_SELECTORS = [
    # Navigation & menus
    'nav', 'header', 'footer',
    '.header', '.top', '.navbar', '#header',
    '.footer', '.bottom', '#footer',
    '.menu', '.navigation', '#nav',
    '.breadcrumbs', '#breadcrumbs',
    # Sidebars
    '.sidebar', '.side', '.aside', '#sidebar',
    'aside',
    # Ads
    '.ad', '.ads', '.advert', '#ad',
    '.advertisement',
    # Modals & overlays
    '.modal', '.popup', '#modal', '.overlay',
    # Social & sharing
    '.social', '.social-media', '.social-links', '#social',
    '.share', '#share',
    # Widgets & misc
    '.widget', '#widget',
    '.cookie', '#cookie',
    '.lang-selector', '.language', '#language-selector',
]

# "Skip to content" link pattern in rendered markdown
SKIP_LINK_RE = re.compile(
    r'\[skip\s+to\s+(?:main\s+)?content\]\([^)]*\)\s*\n?',
    re.IGNORECASE,
)


def absolutize_urls(soup: BeautifulSoup, base_url: str) -> None:
    """Resolve all relative href and src attributes to absolute URLs."""
    # Check for <base href="..."> first
    base_tag = soup.find('base', href=True)
    if base_tag:
        base_url = urljoin(base_url, base_tag['href'])

    for tag in soup.find_all(href=True):
        href = tag['href']
        if href and not href.startswith(('data:', 'javascript:', 'mailto:', 'tel:', '#')):
            tag['href'] = urljoin(base_url, href)

    for tag in soup.find_all(src=True):
        src = tag['src']
        if src and not src.startswith(('data:', 'javascript:')):
            tag['src'] = urljoin(base_url, src)

    for tag in soup.find_all(srcset=True):
        srcset = tag['srcset']
        parts = []
        for entry in srcset.split(','):
            entry = entry.strip()
            if not entry:
                continue
            tokens = entry.split()
            if tokens:
                tokens[0] = urljoin(base_url, tokens[0])
            parts.append(' '.join(tokens))
        tag['srcset'] = ', '.join(parts)


def extract_markdown(html: str, base_url: str = '') -> str:
    """Convert HTML to clean readable markdown, removing non-content elements."""
    try:
        soup = BeautifulSoup(html, 'html.parser')

        # Remove unwanted tags entirely
        for tag in soup(REMOVE_TAGS):
            tag.decompose()

        # Remove non-content containers by CSS selector
        for selector in REMOVE_SELECTORS:
            for tag in soup.select(selector):
                tag.decompose()

        # Remove "Skip to content" anchor links
        for a in soup.find_all('a', href=True):
            text = a.get_text(strip=True).lower()
            if re.match(r'skip\s+to\s+(main\s+)?content', text):
                a.decompose()

        # Absolutize URLs when a base URL is provided
        if base_url:
            absolutize_urls(soup, base_url)

        # Convert to markdown
        h2t = html2text.HTML2Text()
        h2t.ignore_links = False
        h2t.ignore_images = False
        h2t.ignore_emphasis = False
        h2t.body_width = 0  # No wrapping
        h2t.protect_links = True
        h2t.wrap_links = False
        h2t.unicode_snob = True  # Use unicode chars instead of HTML entities

        markdown = h2t.handle(str(soup))

        # Remove "Skip to content" links
        markdown = SKIP_LINK_RE.sub('', markdown)

        # Post-process whitespace
        # 1. Strip trailing spaces per line
        lines = [line.rstrip() for line in markdown.split('\n')]
        markdown = '\n'.join(lines)
        # 2. Collapse 3+ consecutive newlines to 2 (one blank line)
        markdown = re.sub(r'\n{3,}', '\n\n', markdown)
        # 3. Trim leading/trailing whitespace
        markdown = markdown.strip()

        return markdown
    except Exception as e:
        sys.stderr.write(f"Error extracting markdown: {e}\n")
        return ""


def extract_skeleton(html: str) -> str:
    """
    Create skeleton: bare tag structure with attributes, no text content.
    Clear all text nodes and script/style/noscript blocks.
    """
    try:
        soup = BeautifulSoup(html, 'html.parser')

        # Clear script, style, noscript, and SVG blocks completely
        for tag in soup(['script', 'style', 'noscript', 'svg']):
            tag.decompose()

        # Remove all text nodes, keeping structure
        for element in soup.find_all(string=True):
            if element.strip():
                element.replace_with("")

        # Rebuild clean skeleton
        skeleton = str(soup)

        # Minimize the skeleton by removing empty text nodes
        skeleton_soup = BeautifulSoup(skeleton, 'html.parser')
        skeleton = str(skeleton_soup)

        return skeleton
    except Exception as e:
        sys.stderr.write(f"Error extracting skeleton: {e}\n")
        return ""


def main() -> None:
    """Read HTML from stdin, output JSON with markdown and skeleton.

    Optional argv[1]: page URL for absolutizing relative links.
    """
    try:
        base_url = sys.argv[1] if len(sys.argv) > 1 else ''
        html = sys.stdin.read()

        if not html.strip():
            result = {
                "markdown": "",
                "skeleton": ""
            }
        else:
            result = {
                "markdown": extract_markdown(html, base_url),
                "skeleton": extract_skeleton(html)
            }

        # Output valid JSON to stdout
        json.dump(result, sys.stdout, ensure_ascii=False, separators=(',', ':'))
        sys.stdout.write('\n')

    except Exception as e:
        sys.stderr.write(f"Fatal error: {e}\n")
        error_result = {"error": str(e), "markdown": "", "skeleton": ""}
        json.dump(error_result, sys.stdout, ensure_ascii=False, separators=(',', ':'))
        sys.exit(1)


if __name__ == "__main__":
    main()
