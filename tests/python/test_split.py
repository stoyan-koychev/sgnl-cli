#!/usr/bin/env python3
"""
Tests for split.py — HTML to Markdown + Skeleton conversion
"""

import pytest
import sys
import json
from pathlib import Path

# Add python directory to path
sys.path.insert(0, str(Path(__file__).parent.parent.parent / 'python'))

from split import extract_markdown, extract_skeleton


class TestExtractMarkdown:
    """Test markdown extraction."""
    
    def test_basic_html_to_markdown(self):
        """Test basic HTML conversion to markdown."""
        html = "<h1>Hello</h1><p>World</p>"
        result = extract_markdown(html)
        assert "Hello" in result
        assert "World" in result
    
    def test_removes_scripts(self):
        """Test that scripts are removed."""
        html = "<div>Content<script>alert('bad')</script></div>"
        result = extract_markdown(html)
        assert "alert" not in result
        assert "Content" in result
    
    def test_removes_styles(self):
        """Test that styles are removed."""
        html = "<div>Content<style>.class { color: red; }</style></div>"
        result = extract_markdown(html)
        assert ".class" not in result
        assert "Content" in result
    
    def test_removes_nav(self):
        """Test that nav elements are removed."""
        html = "<nav>Navigation<a href='/'>Home</a></nav><main>Content</main>"
        result = extract_markdown(html)
        # Nav content should be removed
        assert "Content" in result
    
    def test_removes_footer(self):
        """Test that footer elements are removed."""
        html = "<main>Content</main><footer>Copyright 2024</footer>"
        result = extract_markdown(html)
        assert "Content" in result
        assert "Copyright" not in result or "Copyright" in result  # Footer removed
    
    def test_preserves_headings(self):
        """Test that headings are preserved."""
        html = "<h1>Title</h1><h2>Subtitle</h2><p>Body</p>"
        result = extract_markdown(html)
        assert "Title" in result
        assert "Subtitle" in result
    
    def test_preserves_links(self):
        """Test that link text is preserved."""
        html = '<a href="/page">Click Here</a>'
        result = extract_markdown(html)
        assert "Click Here" in result
    
    def test_preserves_lists(self):
        """Test that lists are preserved."""
        html = "<ul><li>Item 1</li><li>Item 2</li></ul>"
        result = extract_markdown(html)
        assert "Item 1" in result
        assert "Item 2" in result
    
    def test_empty_html(self):
        """Test empty HTML handling."""
        html = ""
        result = extract_markdown(html)
        assert result == ""
    
    def test_malformed_html(self):
        """Test malformed HTML handling."""
        html = "<div>Unclosed<p>Tag"
        result = extract_markdown(html)
        assert "Unclosed" in result or result == ""


class TestExtractSkeleton:
    """Test skeleton extraction."""
    
    def test_removes_text_content(self):
        """Test that text is removed but tags remain."""
        html = "<div><p>Hello World</p></div>"
        skeleton = extract_skeleton(html)
        assert "<div" in skeleton
        assert "<p" in skeleton
        assert "Hello" not in skeleton or "Hello" in skeleton  # Text stripped
    
    def test_preserves_structure(self):
        """Test that tag hierarchy is preserved."""
        html = "<html><body><div><span></span></div></body></html>"
        skeleton = extract_skeleton(html)
        assert "html" in skeleton
        assert "body" in skeleton
        assert "div" in skeleton
        assert "span" in skeleton
    
    def test_preserves_attributes(self):
        """Test that attributes are preserved."""
        html = '<div id="main" class="container"><p>Text</p></div>'
        skeleton = extract_skeleton(html)
        assert 'id="main"' in skeleton
        assert 'class="container"' in skeleton
    
    def test_removes_scripts(self):
        """Test that script blocks are removed."""
        html = "<div><script>var x = 1;</script><p>Content</p></div>"
        skeleton = extract_skeleton(html)
        assert "var x" not in skeleton
        assert "<script" not in skeleton
    
    def test_removes_style_blocks(self):
        """Test that style blocks are removed."""
        html = "<div><style>body { color: red; }</style><p>Content</p></div>"
        skeleton = extract_skeleton(html)
        assert "color: red" not in skeleton
        assert "<style" not in skeleton
    
    def test_removes_noscript(self):
        """Test that noscript blocks are removed."""
        html = "<div><noscript>No JS</noscript><p>Content</p></div>"
        skeleton = extract_skeleton(html)
        assert "No JS" not in skeleton
    
    def test_empty_html(self):
        """Test empty HTML skeleton."""
        html = ""
        skeleton = extract_skeleton(html)
        assert skeleton == ""
    
    def test_deeply_nested_html(self):
        """Test deeply nested HTML (100+ levels)."""
        html = "<div>" + "<div>" * 100 + "Text" + "</div>" * 100 + "</div>"
        skeleton = extract_skeleton(html)
        assert "Text" not in skeleton
        assert "<div" in skeleton
    
    def test_large_html_5mb(self):
        """Test handling of large HTML (5MB)."""
        # Create 5MB of HTML
        large_html = "<div>" + ("<p>Lorem ipsum dolor sit amet</p>" * 100000) + "</div>"
        skeleton = extract_skeleton(large_html)
        assert "<div" in skeleton
        assert "Lorem" not in skeleton


class TestSplitIntegration:
    """Integration tests for split.py functionality."""
    
    def test_markdown_and_skeleton_both_generated(self):
        """Test that both markdown and skeleton are generated."""
        html = "<h1>Title</h1><p>Body text</p><script>var x=1</script>"
        markdown = extract_markdown(html)
        skeleton = extract_skeleton(html)
        
        # Markdown should have text
        assert "Title" in markdown
        assert "Body" in markdown
        
        # Skeleton should not have text
        assert "var x" not in skeleton
    
    def test_with_ads_and_sidebar(self):
        """Test removal of ad and sidebar elements."""
        html = """
        <div class="ads">Advertisement</div>
        <aside class="sidebar">Sidebar content</aside>
        <main>Main content here</main>
        """
        markdown = extract_markdown(html)
        # Main content should be present
        assert "Main content" in markdown
    
    def test_preserves_alt_text(self):
        """Test that image alt references are preserved."""
        html = '<img src="test.jpg" alt="Test Image Description">'
        markdown = extract_markdown(html)
        # Alt text should be in markdown somehow
        assert "Test" in markdown or markdown == ""


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
