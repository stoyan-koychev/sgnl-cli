#!/usr/bin/env python3
"""
split.py — HTML → Markdown + Skeleton

Strips HTML into two layers for analysis:
- Markdown: clean readable text with structure
- Skeleton: bare tag structure with attributes, no text content
"""

import sys
import json
from typing import Dict, Any
from html.parser import HTMLParser
from io import StringIO

try:
    from bs4 import BeautifulSoup
    import html2text
except ImportError:
    sys.stderr.write("Error: BeautifulSoup4 and html2text required. Install with: pip install beautifulsoup4 html2text\n")
    sys.exit(1)


def extract_markdown(html: str) -> str:
    """Convert HTML to clean readable markdown, removing nav, footer, scripts, styles, ads."""
    try:
        soup = BeautifulSoup(html, 'html.parser')
        
        # Remove script, style, noscript, and common ad containers
        for tag in soup(['script', 'style', 'noscript', 'meta', 'link']):
            tag.decompose()
        
        # Remove common ad/nav containers by class/id
        for selector in ['nav', 'footer', '.ads', '.advertisement', '.sidebar', 'aside']:
            for tag in soup.select(selector):
                tag.decompose()
        
        # Extract text and convert to markdown
        h2t = html2text.HTML2Text()
        h2t.ignore_links = False
        h2t.ignore_images = False
        h2t.ignore_emphasis = False
        h2t.body_width = 0  # No wrapping
        
        markdown = h2t.handle(str(soup))
        
        # Clean up excessive whitespace
        lines = [line.rstrip() for line in markdown.split('\n')]
        markdown = '\n'.join(line for line in lines if line)
        
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
    """Read HTML from stdin, output JSON with markdown and skeleton."""
    try:
        # Read HTML from stdin
        html = sys.stdin.read()
        
        if not html.strip():
            result = {
                "markdown": "",
                "skeleton": ""
            }
        else:
            result = {
                "markdown": extract_markdown(html),
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
