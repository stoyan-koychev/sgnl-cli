#!/usr/bin/env python3
"""
Tests for technical_seo.py — Technical SEO Analysis
"""

import pytest
import sys
import json
from pathlib import Path

# Add python directory to path
sys.path.insert(0, str(Path(__file__).parent.parent.parent / 'python'))

from technical_seo import analyze_technical_seo


class TestMetaTags:
    """Test meta tag extraction and validation."""
    
    def test_title_extracted(self):
        """Test title tag extraction."""
        html = "<head><title>Test Page Title</title></head>"
        result = analyze_technical_seo(html)
        
        assert result['meta']['title']['present'] == True
        assert result['meta']['title']['content'] == "Test Page Title"
    
    def test_title_length_validation(self):
        """Test title length validation."""
        html = "<head><title>This is a properly sized title that should pass validation</title></head>"
        result = analyze_technical_seo(html)
        
        assert 'status' in result['meta']['title']
    
    def test_missing_description(self):
        """Test detection of missing description."""
        html = "<head><title>Title</title></head>"
        result = analyze_technical_seo(html)
        
        assert result['meta']['description']['present'] == False
    
    def test_description_extracted(self):
        """Test description meta tag extraction."""
        html = '<head><meta name="description" content="Page description here"></head>'
        result = analyze_technical_seo(html)
        
        assert result['meta']['description']['present'] == True
        assert 'Page description' in result['meta']['description']['content']
    
    def test_robots_tag(self):
        """Test robots meta tag extraction."""
        html = '<head><meta name="robots" content="index, follow"></head>'
        result = analyze_technical_seo(html)
        
        assert result['meta']['robots']['index'] == True
        assert result['meta']['robots']['follow'] == True
    
    def test_robots_noindex(self):
        """Test noindex detection."""
        html = '<head><meta name="robots" content="noindex"></head>'
        result = analyze_technical_seo(html)
        
        assert result['meta']['robots']['index'] == False


class TestCanonical:
    """Test canonical link validation."""
    
    def test_canonical_present(self):
        """Test canonical link detection."""
        html = '<head><link rel="canonical" href="https://example.com/page"></head>'
        result = analyze_technical_seo(html)
        
        assert result['canonical']['present'] == True
        assert result['canonical']['href'] == "https://example.com/page"
    
    def test_canonical_missing(self):
        """Test missing canonical link."""
        html = "<head></head>"
        result = analyze_technical_seo(html)

        assert result['canonical']['present'] == False

    def test_canonical_self_referencing_true(self):
        """Canonical href equals page URL → self_referencing True."""
        html = '<head><link rel="canonical" href="https://example.com/page"></head>'
        result = analyze_technical_seo(html, url='https://example.com/page')
        assert result['canonical']['self_referencing'] is True

    def test_canonical_self_referencing_false(self):
        """Canonical href points elsewhere → self_referencing False."""
        html = '<head><link rel="canonical" href="https://example.com/other"></head>'
        result = analyze_technical_seo(html, url='https://example.com/page')
        assert result['canonical']['self_referencing'] is False

    def test_canonical_relative_href_resolved(self):
        """Relative canonical href resolved against page URL."""
        html = '<head><link rel="canonical" href="/page"></head>'
        result = analyze_technical_seo(html, url='https://example.com/page')
        assert result['canonical']['self_referencing'] is True

        html2 = '<head><link rel="canonical" href="/other"></head>'
        result2 = analyze_technical_seo(html2, url='https://example.com/page')
        assert result2['canonical']['self_referencing'] is False

    def test_canonical_trailing_slash_normalized(self):
        """Trailing slash difference should still count as self-referencing."""
        html = '<head><link rel="canonical" href="https://example.com/page/"></head>'
        result = analyze_technical_seo(html, url='https://example.com/page')
        assert result['canonical']['self_referencing'] is True

    def test_canonical_case_insensitive_host(self):
        """Host case differences should not matter."""
        html = '<head><link rel="canonical" href="https://EXAMPLE.com/page"></head>'
        result = analyze_technical_seo(html, url='https://example.com/page')
        assert result['canonical']['self_referencing'] is True

    def test_canonical_no_url_argument(self):
        """When URL is not passed, self_referencing is None (unknown)."""
        html = '<head><link rel="canonical" href="https://example.com/page"></head>'
        result = analyze_technical_seo(html)
        assert result['canonical']['self_referencing'] is None

    def test_canonical_missing_tag_self_ref_none(self):
        """Missing canonical tag → self_referencing None (unchanged)."""
        html = "<head></head>"
        result = analyze_technical_seo(html, url='https://example.com/page')
        assert result['canonical']['self_referencing'] is None


class TestOpenGraph:
    """Test Open Graph tag detection."""
    
    def test_og_title(self):
        """Test OG:title tag."""
        html = '<head><meta property="og:title" content="OG Title"></head>'
        result = analyze_technical_seo(html)
        
        assert result['open_graph']['title'] == True
    
    def test_og_description(self):
        """Test OG:description tag."""
        html = '<head><meta property="og:description" content="OG Desc"></head>'
        result = analyze_technical_seo(html)
        
        assert result['open_graph']['description'] == True
    
    def test_og_image(self):
        """Test OG:image tag."""
        html = '<head><meta property="og:image" content="https://example.com/image.jpg"></head>'
        result = analyze_technical_seo(html)
        
        assert result['open_graph']['image'] == True
    
    def test_missing_og_tags(self):
        """Test detection of missing OG tags."""
        html = "<head></head>"
        result = analyze_technical_seo(html)
        
        og = result['open_graph']
        assert og['title'] == False
        assert og['description'] == False


class TestIndexability:
    """Test indexability signal detection."""
    
    def test_not_blocked(self):
        """Test non-blocked page."""
        html = "<head></head>"
        result = analyze_technical_seo(html)
        
        assert result['indexability']['blocked'] == False
    
    def test_noindex_signal(self):
        """Test noindex signal detection."""
        html = '<head><meta name="robots" content="noindex"></head>'
        result = analyze_technical_seo(html)
        
        assert result['indexability']['blocked'] == True


class TestLinks:
    """Test link analysis."""
    
    def test_internal_links_counted(self):
        """Test counting of internal links."""
        html = '<a href="/page1">Link 1</a><a href="/page2">Link 2</a>'
        result = analyze_technical_seo(html)
        
        assert result['links']['internal_total'] == 2
    
    def test_external_links_counted(self):
        """Test counting of external links."""
        html = '<a href="https://example.com">External</a>'
        result = analyze_technical_seo(html)
        
        assert result['links']['external_total'] == 1
    
    def test_generic_anchor_text(self):
        """Test detection of generic anchor text."""
        html = '<a href="/page">click here</a>'
        result = analyze_technical_seo(html)
        
        assert result['links']['internal_generic_anchor'] >= 1


class TestTechnicalSeoIntegration:
    """Integration tests for technical SEO."""
    
    def test_empty_html(self):
        """Test with empty HTML."""
        html = ""
        result = analyze_technical_seo(html)
        
        assert 'meta' in result
        assert 'canonical' in result
    
    def test_complete_page(self):
        """Test with complete page."""
        html = '''
        <html>
        <head>
            <title>Test Page</title>
            <meta name="description" content="Test description here">
            <meta name="robots" content="index, follow">
            <link rel="canonical" href="https://example.com/page">
            <meta property="og:title" content="OG Title">
            <meta property="og:image" content="https://example.com/img.jpg">
            <script type="application/ld+json">
            {"@type": "WebPage", "name": "Test"}
            </script>
        </head>
        <body>
            <a href="/internal">Internal Link</a>
            <a href="https://external.com">External</a>
        </body>
        </html>
        '''
        result = analyze_technical_seo(html)
        
        assert result['meta']['title']['present'] == True
        assert result['meta']['description']['present'] == True
        assert result['canonical']['present'] == True
        assert result['links']['internal_total'] >= 1
        assert result['links']['external_total'] >= 1
    
    def test_headers_parameter(self):
        """Test with headers parameter."""
        html = "<head><title>Test</title></head>"
        headers = {
            "X-Robots-Tag": "noindex",
            "Content-Type": "text/html"
        }
        result = analyze_technical_seo(html, headers)
        
        assert result['indexability']['blocked'] == True
    
    def test_valid_json_output(self):
        """Test that output is valid JSON."""
        html = "<head><title>Test</title></head>"
        result = analyze_technical_seo(html)
        
        # Serialize to verify JSON compatibility
        json_str = json.dumps(result)
        assert len(json_str) > 0


class TestConflictDetection:
    """Test conflict detection."""
    
    def test_conflicting_robots_tags(self):
        """Test detection of conflicting robots signals."""
        html = '''
        <head>
            <meta name="robots" content="index">
        </head>
        '''
        headers = {"X-Robots-Tag": "noindex"}
        result = analyze_technical_seo(html, headers)
        
        # Should detect conflict
        assert 'conflicts' in result['indexability']


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
