#!/usr/bin/env python3
"""
Tests for onpage.py — On-Page SEO Analysis
"""

import pytest
import sys
import json
from pathlib import Path

# Add python directory to path
sys.path.insert(0, str(Path(__file__).parent.parent.parent / 'python'))

from onpage import analyze_onpage


class TestContentAnalysis:
    """Test content metrics analysis."""
    
    def test_word_count(self):
        """Test word count calculation."""
        markdown = "One two three four five"
        result = analyze_onpage(markdown)
        
        assert result['content']['word_count'] >= 5
    
    def test_paragraph_count(self):
        """Test paragraph counting."""
        markdown = "Line one\n\nLine two\n\nLine three"
        result = analyze_onpage(markdown)
        
        assert result['content']['paragraph_count'] >= 3
    
    def test_average_paragraph_length(self):
        """Test average paragraph length calculation."""
        markdown = "Word1 Word2 Word3\n\nWord4 Word5"
        result = analyze_onpage(markdown)
        
        assert result['content']['avg_paragraph_length'] > 0
    
    def test_empty_content(self):
        """Test with empty content."""
        markdown = ""
        result = analyze_onpage(markdown)
        
        assert result['content']['word_count'] == 0


class TestHeadingAnalysis:
    """Test heading structure analysis."""
    
    def test_h1_detection(self):
        """Test H1 tag detection."""
        html = "<h1>Main Heading</h1>"
        result = analyze_onpage("", html)
        
        assert result['headings']['h1_count'] == 1
        assert result['headings']['h1_content'] == "Main Heading"
    
    def test_h2_counting(self):
        """Test H2 counting."""
        html = "<h2>Sub 1</h2><h2>Sub 2</h2>"
        result = analyze_onpage("", html)
        
        assert result['headings']['h2_count'] == 2
    
    def test_h3_counting(self):
        """Test H3 counting."""
        html = "<h3>Deep 1</h3><h3>Deep 2</h3><h3>Deep 3</h3>"
        result = analyze_onpage("", html)
        
        assert result['headings']['h3_count'] == 3
    
    def test_valid_hierarchy(self):
        """Test valid heading hierarchy."""
        html = "<h1>Title</h1><h2>Sub</h2><h3>SubSub</h3>"
        result = analyze_onpage("", html)
        
        assert result['headings']['hierarchy_valid'] == True
    
    def test_invalid_hierarchy(self):
        """Test invalid heading hierarchy (multiple H1)."""
        html = "<h1>Title 1</h1><h1>Title 2</h1>"
        result = analyze_onpage("", html)
        
        assert result['headings']['hierarchy_valid'] == False
    
    def test_empty_headings(self):
        """Test detection of empty headings."""
        html = "<h1></h1><h2>Content</h2>"
        result = analyze_onpage("", html)
        
        assert result['headings']['empty_headings'] >= 1


class TestLinkAnalysis:
    """Test on-page link analysis."""
    
    def test_internal_link_count(self):
        """Test counting of internal links."""
        html = '<a href="/page1">Link 1</a><a href="/page2">Link 2</a>'
        result = analyze_onpage("", html)
        
        assert result['links']['internal_total'] >= 2
    
    def test_external_link_count(self):
        """Test counting of external links."""
        html = '<a href="https://example.com">External</a>'
        result = analyze_onpage("", html)
        
        assert result['links']['external_total'] >= 1
    
    def test_generic_anchor_detection(self):
        """Test detection of generic anchor text."""
        html = '<a href="/page">click here</a><a href="/other">more</a>'
        result = analyze_onpage("", html)
        
        assert result['links']['internal_generic_anchor'] >= 1
    
    def test_no_links(self):
        """Test with no links."""
        html = "<div>No links here</div>"
        result = analyze_onpage("", html)
        
        assert result['links']['internal_total'] == 0
        assert result['links']['external_total'] == 0


class TestImageAnalysis:
    """Test image alt text analysis."""
    
    def test_total_images(self):
        """Test counting of total images."""
        html = '<img src="1.jpg"><img src="2.jpg"><img src="3.jpg">'
        result = analyze_onpage("", html)
        
        assert result['images']['total'] == 3
    
    def test_missing_alt_text(self):
        """Test detection of missing alt text."""
        html = '<img src="image.jpg">'
        result = analyze_onpage("", html)
        
        assert result['images']['missing_alt'] >= 1
    
    def test_empty_alt_text(self):
        """Test detection of empty alt text."""
        html = '<img src="image.jpg" alt="">'
        result = analyze_onpage("", html)
        
        assert result['images']['empty_alt_decorative'] >= 1
    
    def test_valid_alt_text(self):
        """Test with valid alt text."""
        html = '<img src="image.jpg" alt="Descriptive alt text">'
        result = analyze_onpage("", html)
        
        # Should not count as missing or empty
        assert result['images']['missing_alt'] == 0
        assert result['images']['empty_alt_decorative'] == 0
    
    def test_alt_text_too_short(self):
        """Test detection of alt text that's too short."""
        html = '<img src="image.jpg" alt="xy">'
        result = analyze_onpage("", html)
        
        assert result['images']['too_short'] >= 1
    
    def test_alt_text_too_long(self):
        """Test detection of alt text that's too long."""
        html = '<img src="image.jpg" alt="' + ('a' * 150) + '">'
        result = analyze_onpage("", html)
        
        assert result['images']['too_long'] >= 1


class TestCrawlability:
    """Test crawlability analysis."""
    
    def test_status_code(self):
        """Test status code handling."""
        headers = {"status_code": "200"}
        result = analyze_onpage("", "", headers)
        
        assert result['crawlability']['status_code'] == 200
    
    def test_redirect_count(self):
        """Test redirect count."""
        headers = {"redirect_count": "2"}
        result = analyze_onpage("", "", headers)
        
        assert result['crawlability']['redirect_count'] == 2
    
    def test_robots_blocked(self):
        """Test robots.txt blocking detection."""
        headers = {"robots_blocked": "true"}
        result = analyze_onpage("", "", headers)
        
        assert result['crawlability']['robots_blocked'] == True
    
    def test_https_enforcement(self):
        """Test HTTPS enforcement detection."""
        headers = {"https": "true"}
        result = analyze_onpage("", "", headers)
        
        assert result['crawlability']['https_enforced'] == True
    
    def test_mixed_content(self):
        """Test mixed content detection."""
        headers = {"mixed_content": "true"}
        result = analyze_onpage("", "", headers)
        
        assert result['crawlability']['mixed_content'] == True
    
    def test_sitemap_found(self):
        """Test sitemap detection."""
        headers = {"sitemap_found": "true"}
        result = analyze_onpage("", "", headers)
        
        assert result['crawlability']['sitemap_found'] == True


class TestOnpageIntegration:
    """Integration tests for on-page SEO."""
    
    def test_complete_page_analysis(self):
        """Test analysis of complete page."""
        markdown = """
        # Main Heading
        
        This is the first paragraph with some content for analysis.
        
        ## Subheading
        
        Another paragraph here with more text content.
        """
        
        html = """
        <h1>Main Heading</h1>
        <h2>Subheading</h2>
        <p>Content</p>
        <img src="test.jpg" alt="Test Image">
        <a href="/internal">Internal Link</a>
        <a href="https://external.com">External</a>
        """
        
        headers = {
            "status_code": "200",
            "https": "true"
        }
        
        result = analyze_onpage(markdown, html, headers)
        
        assert result['content']['word_count'] > 0
        assert result['headings']['h1_count'] == 1
        assert result['headings']['h2_count'] == 1
        assert result['images']['total'] == 1
        assert result['links']['internal_total'] >= 1
        assert result['links']['external_total'] >= 1
        assert result['crawlability']['status_code'] == 200
    
    def test_empty_analysis(self):
        """Test with empty markdown and HTML."""
        result = analyze_onpage("", "")
        
        assert result['content']['word_count'] == 0
        assert 'headings' in result
        assert 'links' in result
    
    def test_markdown_only(self):
        """Test with markdown only (no HTML)."""
        markdown = "# Title\n\nParagraph content here."
        result = analyze_onpage(markdown)
        
        assert result['content']['word_count'] >= 3
    
    def test_html_only(self):
        """Test with HTML only (no markdown)."""
        html = "<h1>Title</h1><p>Content</p><img src='test.jpg' alt='Test'>"
        result = analyze_onpage("", html)
        
        assert result['headings']['h1_count'] == 1
        assert result['images']['total'] == 1
    
    def test_valid_json_output(self):
        """Test that output is valid JSON."""
        markdown = "Test content"
        result = analyze_onpage(markdown)
        
        # Serialize to verify JSON compatibility
        json_str = json.dumps(result)
        assert len(json_str) > 0
    
    def test_seo_quality_page(self):
        """Test with SEO-optimized page."""
        markdown = """
        # Your Main Keyword Here
        
        This is a well-written paragraph that contains the main keyword and provides value.
        
        ## Secondary Keyword Heading
        
        More detailed content with proper structure and formatting.
        
        ### Tertiary Section
        
        Additional information supporting the main topic.
        """
        
        html = """
        <h1>Your Main Keyword Here</h1>
        <h2>Secondary Keyword Heading</h2>
        <h3>Tertiary Section</h3>
        <img src="image1.jpg" alt="Relevant image description">
        <img src="image2.jpg" alt="Another relevant image">
        <a href="/related-article">Related Article</a>
        <a href="/guide">Complete Guide</a>
        """
        
        headers = {"status_code": "200", "https": "true"}
        
        result = analyze_onpage(markdown, html, headers)
        
        # Should have good structure
        assert result['headings']['h1_count'] == 1
        assert result['headings']['h2_count'] == 1
        assert result['headings']['hierarchy_valid'] == True
        assert result['images']['total'] == 2
        assert result['images']['missing_alt'] == 0
        assert result['links']['internal_total'] == 2


class TestTableOfContentsDetection:
    """Test TOC heuristic based on anchor links matching h2/h3 ids."""

    def test_toc_detected_with_three_matching_anchors(self):
        html = """
            <nav>
              <a href="#intro">Intro</a>
              <a href="#details">Details</a>
              <a href="#conclusion">Conclusion</a>
            </nav>
            <h2 id="intro">Intro</h2>
            <h2 id="details">Details</h2>
            <h3 id="conclusion">Conclusion</h3>
        """
        result = analyze_onpage("", html)
        assert result['headings']['table_of_contents_detected'] is True

    def test_toc_not_detected_when_anchors_do_not_match(self):
        html = """
            <a href="#foo">Foo</a>
            <a href="#bar">Bar</a>
            <a href="#baz">Baz</a>
            <h2 id="intro">Intro</h2>
            <h2 id="details">Details</h2>
        """
        result = analyze_onpage("", html)
        assert result['headings']['table_of_contents_detected'] is False

    def test_toc_not_detected_with_fewer_than_three_anchors(self):
        html = """
            <a href="#a">A</a>
            <a href="#b">B</a>
            <h2 id="a">A</h2>
            <h2 id="b">B</h2>
        """
        result = analyze_onpage("", html)
        assert result['headings']['table_of_contents_detected'] is False


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
