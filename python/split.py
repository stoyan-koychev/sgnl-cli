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


def _resolve_srcset_to_best(soup: BeautifulSoup, base_url: str) -> None:
    """Pick the largest image from srcset and set it as src.

    Sorts srcset candidates by size descriptor (w or x) descending and
    replaces src with the biggest variant so the markdown converter sees
    a single, high-quality image URL.
    """
    for img in soup.find_all('img', srcset=True):
        srcset = img.get('srcset', '')
        if not srcset:
            continue

        candidates = []
        for entry in srcset.split(','):
            entry = entry.strip()
            if not entry:
                continue
            tokens = entry.split()
            if len(tokens) < 1:
                continue
            url = tokens[0]
            descriptor = tokens[1] if len(tokens) > 1 else '1x'
            is_x = descriptor.endswith('x')
            is_w = descriptor.endswith('w')
            try:
                size = float(descriptor[:-1]) if (is_x or is_w) else 1.0
            except ValueError:
                size = 1.0
            if base_url:
                url = urljoin(base_url, url)
            candidates.append({'url': url, 'size': size, 'is_x': is_x})

        # If all candidates are x-descriptors, include the existing src as 1x
        if candidates and all(c['is_x'] for c in candidates):
            existing_src = img.get('src', '')
            if existing_src:
                resolved = urljoin(base_url, existing_src) if base_url else existing_src
                candidates.append({'url': resolved, 'size': 1.0, 'is_x': True})

        # Sort descending by size — pick the biggest
        candidates.sort(key=lambda c: c['size'], reverse=True)
        if candidates:
            img['src'] = candidates[0]['url']

        # Remove srcset so html2text doesn't emit it as raw text
        del img['srcset']


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

    # srcset is handled by _resolve_srcset_to_best — no need to absolutize here


def _escape_multiline_links(md: str) -> str:
    """Escape newlines inside markdown link text.

    When an <a> tag spans multiple lines, the resulting markdown link text
    contains literal newlines which break most markdown parsers.  Insert a
    backslash before each newline inside ``[...]`` to preserve the link as
    a single token.
    """
    link_open_count = 0
    out: list[str] = []
    for ch in md:
        if ch == '[':
            link_open_count += 1
        elif ch == ']':
            link_open_count = max(0, link_open_count - 1)
        if link_open_count > 0 and ch == '\n':
            out.append('\\\n')
        else:
            out.append(ch)
    return ''.join(out)


def extract_markdown(
    html: str,
    base_url: str = '',
    *,
    only_main_content: bool = True,
    include_tags: list[str] | None = None,
    exclude_tags: list[str] | None = None,
) -> str:
    """Convert HTML to clean readable markdown.

    Args:
        html:               Raw HTML string.
        base_url:           Base URL for absolutizing relative links.
        only_main_content:  Strip nav/header/footer/sidebar/ads (default True).
                            Set False to keep all page content.
        include_tags:       CSS selectors — keep *only* matching elements.
        exclude_tags:       CSS selectors — remove these elements (applied after
                            include_tags and after the default REMOVE_SELECTORS).
    """
    try:
        soup = BeautifulSoup(html, 'html.parser')

        # If include_tags is set, extract only those elements
        if include_tags:
            new_soup = BeautifulSoup('<div></div>', 'html.parser')
            root = new_soup.find('div')
            for selector in include_tags:
                for el in soup.select(selector):
                    root.append(el.extract())
            soup = new_soup

        # Remove unwanted tags entirely (always: script, style, etc.)
        for tag in soup(REMOVE_TAGS):
            tag.decompose()

        # Remove non-content containers by CSS selector (only when onlyMainContent)
        if only_main_content:
            for selector in REMOVE_SELECTORS:
                for tag in soup.select(selector):
                    tag.decompose()

        # Apply custom exclude_tags
        if exclude_tags:
            for selector in exclude_tags:
                for tag in soup.select(selector):
                    tag.decompose()

        # Remove "Skip to content" anchor links
        for a in soup.find_all('a', href=True):
            text = a.get_text(strip=True).lower()
            if re.match(r'skip\s+to\s+(main\s+)?content', text):
                a.decompose()

        # Flatten <br> inside table cells so html2text keeps rows intact.
        # Turndown/Go converter preserves <br> as literal "<br>" in table
        # cells; html2text would break them into newlines, destroying the
        # pipe-table structure.
        from bs4 import NavigableString
        for cell in soup.find_all(['td', 'th']):
            for br in cell.find_all('br'):
                br.replace_with(NavigableString('<br>'))

        # Resolve srcset to best image (before absolutize, handles its own URLs)
        _resolve_srcset_to_best(soup, base_url)

        # Absolutize URLs when a base URL is provided
        if base_url:
            absolutize_urls(soup, base_url)

        # Convert to markdown
        h2t = html2text.HTML2Text()
        h2t.ignore_links = False
        h2t.ignore_images = False
        h2t.ignore_emphasis = False
        h2t.body_width = 0          # No wrapping
        h2t.protect_links = False   # No <angle brackets> around URLs
        h2t.wrap_links = False
        h2t.unicode_snob = True     # Use unicode chars instead of HTML entities
        h2t.bypass_tables = False   # Render HTML tables as GFM pipe tables
        h2t.mark_code = True        # Wrap code blocks with backticks
        h2t.ul_item_mark = '-'      # Use - for unordered lists (Turndown default)

        markdown = h2t.handle(str(soup))

        # Remove "Skip to content" links
        markdown = SKIP_LINK_RE.sub('', markdown)

        # Escape newlines inside link text
        markdown = _escape_multiline_links(markdown)

        # Normalize horizontal rules: html2text emits "* * *", Turndown uses "---"
        markdown = re.sub(r'^\* \* \*$', '---', markdown, flags=re.MULTILINE)

        # Fix table rows missing leading pipe.
        # html2text renders colspan headers as plain text + "---" on the
        # next line, followed by data rows with "|" but no leading pipe.
        # We detect table blocks, pull in the header lines above, and
        # wrap every row with "| ... |" to produce valid GFM pipe tables.
        lines = markdown.split('\n')
        def _has_pipe(s: str) -> bool:
            stripped = s.strip()
            return bool(stripped) and '|' in stripped

        i = 0
        while i < len(lines):
            if _has_pipe(lines[i]):
                block_start = i
                while i < len(lines) and _has_pipe(lines[i]):
                    i += 1
                block_end = i  # exclusive
                if block_end - block_start < 2:
                    continue

                # Look backwards: if preceded by "---" and a header line,
                # pull them into the table block (colspan header pattern).
                if (block_start >= 2
                        and lines[block_start - 1].strip() == '---'
                        and lines[block_start - 2].strip()):
                    block_start -= 2

                for j in range(block_start, block_end):
                    stripped = lines[j].strip()
                    if not stripped:
                        continue
                    if stripped == '---':
                        # Separator row for colspan header
                        lines[j] = '| --- |'
                    elif not stripped.startswith('|'):
                        lines[j] = '| ' + stripped + ' |'
                    elif not stripped.endswith('|'):
                        lines[j] = stripped + ' |'
            else:
                i += 1
        markdown = '\n'.join(lines)

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

    argv[1]: page URL for absolutizing relative links (optional).
    argv[2]: JSON options string (optional):
        {
            "onlyMainContent": true,   // strip nav/header/footer (default true)
            "includeTags": [],          // CSS selectors — keep only these
            "excludeTags": []           // CSS selectors — also remove these
        }
    """
    try:
        base_url = sys.argv[1] if len(sys.argv) > 1 else ''

        # Parse options from argv[2] if provided
        opts: dict = {}
        if len(sys.argv) > 2 and sys.argv[2]:
            try:
                opts = json.loads(sys.argv[2])
            except (json.JSONDecodeError, ValueError):
                pass

        only_main_content = opts.get('onlyMainContent', True)
        include_tags = opts.get('includeTags') or None
        exclude_tags = opts.get('excludeTags') or None

        html = sys.stdin.read()

        if not html.strip():
            result = {
                "markdown": "",
                "skeleton": ""
            }
        else:
            result = {
                "markdown": extract_markdown(
                    html,
                    base_url,
                    only_main_content=only_main_content,
                    include_tags=include_tags,
                    exclude_tags=exclude_tags,
                ),
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
