#!/usr/bin/env python3
"""
Tests for xray.py — DOM X-Ray Analysis
"""

import pytest
import sys
import json
from pathlib import Path

# Add python directory to path
sys.path.insert(0, str(Path(__file__).parent.parent.parent / 'python'))

from xray import analyze_dom


class TestElementCounting:
    """Test element frequency counting."""

    def test_count_basic_elements(self):
        """Test counting of basic HTML elements."""
        html = "<html><body><div><p>Text</p></div></body></html>"
        result = analyze_dom(html)

        assert result['dom']['total_elements'] > 0
        assert 'element_map' in result
        assert result['element_map']['div'] >= 1
        assert result['element_map']['p'] >= 1

    def test_element_map_sorted(self):
        """Test that element_map is sorted by frequency."""
        html = "<div></div>" * 10 + "<p></p>" * 5 + "<span></span>" * 3
        result = analyze_dom(html)

        element_map = result['element_map']
        # Get values in order
        values = list(element_map.values())
        # Check if descending
        assert values == sorted(values, reverse=True)


class TestDOMDepth:
    """Test DOM depth calculations."""

    def test_max_depth_calculation(self):
        """Test maximum depth calculation."""
        html = "<html><body><div><div><div><p>Deep</p></div></div></div></body></html>"
        result = analyze_dom(html)

        assert result['dom']['depth_max'] > 0

    def test_average_depth(self):
        """Test average depth calculation."""
        html = "<html><body><div><p>A</p></div><div><p>B</p></div></body></html>"
        result = analyze_dom(html)

        assert 'depth_avg' in result['dom']
        assert result['dom']['depth_avg'] >= 0


class TestDeepestPath:
    """Test deepest path tracking in DOM depth analysis."""

    def test_deepest_path_present(self):
        """Test that deepest_path is present and is a list."""
        html = "<html><body><div><p>Text</p></div></body></html>"
        result = analyze_dom(html)

        assert 'deepest_path' in result['dom']
        assert isinstance(result['dom']['deepest_path'], list)

    def test_deepest_path_values(self):
        """Test deepest path contains expected tag names."""
        html = "<html><body><div><span><em>Deep</em></span></div></body></html>"
        result = analyze_dom(html)

        path = result['dom']['deepest_path']
        assert 'body' in path
        assert 'div' in path
        assert 'span' in path


class TestDivRatio:
    """Test div ratio calculation."""

    def test_div_ratio_calculated(self):
        """Test div ratio is calculated."""
        html = "<div></div><div></div><p></p>"
        result = analyze_dom(html)

        div_ratio = result['structure']['div_ratio']
        assert 0 <= div_ratio <= 1

    def test_all_divs(self):
        """Test with all div elements."""
        html = "<div>" + "<div></div>" * 10 + "</div>"
        result = analyze_dom(html)

        div_ratio = result['structure']['div_ratio']
        assert div_ratio > 0.5  # Most elements are divs


class TestHeadingHierarchy:
    """Test heading hierarchy validation."""

    def test_valid_hierarchy(self):
        """Test valid heading hierarchy."""
        html = "<h1>Title</h1><h2>Sub</h2><h3>SubSub</h3>"
        result = analyze_dom(html)

        assert result['structure']['heading_hierarchy_valid'] == True

    def test_invalid_hierarchy_multiple_h1(self):
        """Test invalid hierarchy with multiple H1s."""
        html = "<h1>Title 1</h1><h1>Title 2</h1>"
        result = analyze_dom(html)

        assert result['structure']['heading_hierarchy_valid'] == False

    def test_h1_count(self):
        """Test H1 counting."""
        html = "<h1>Only H1</h1><h2>Sub</h2>"
        result = analyze_dom(html)

        assert result['structure']['h1_count'] == 1


class TestSemanticScore:
    """Test semantic tag scoring."""

    def test_semantic_tags_detected(self):
        """Test detection of semantic tags."""
        html = "<header></header><main></main><footer></footer><nav></nav>"
        result = analyze_dom(html)

        semantic_score = result['structure']['semantic_score']
        assert semantic_score >= 2  # At least 2 semantic tags

    def test_max_semantic_score(self):
        """Test maximum semantic score."""
        html = "<main></main><header></header><footer></footer><nav></nav><article></article><section></section><aside></aside>"
        result = analyze_dom(html)

        semantic_score = result['structure']['semantic_score']
        assert semantic_score <= 7


class TestEmptyElements:
    """Test empty element detection."""

    def test_count_empty_elements(self):
        """Test counting of empty elements."""
        html = "<div></div><p></p><span>Text</span>"
        result = analyze_dom(html)

        empty_count = result['structure']['empty_elements']
        assert empty_count >= 2


class TestDuplicateIds:
    """Test duplicate ID detection."""

    def test_no_duplicate_ids(self):
        """Test with unique IDs."""
        html = '<div id="one"></div><div id="two"></div>'
        result = analyze_dom(html)

        assert result['structure']['duplicate_ids'] == 0

    def test_duplicate_ids_detected(self):
        """Test duplicate ID detection."""
        html = '<div id="same"></div><div id="same"></div>'
        result = analyze_dom(html)

        assert result['structure']['duplicate_ids'] > 0


class TestDeprecatedTags:
    """Test deprecated tag detection."""

    def test_deprecated_font_tag(self):
        """Test detection of font tag."""
        html = '<font color="red">Text</font>'
        result = analyze_dom(html)

        deprecated = result['structure']['deprecated_tags']
        assert 'font' in deprecated

    def test_deprecated_center_tag(self):
        """Test detection of center tag."""
        html = '<center>Centered text</center>'
        result = analyze_dom(html)

        deprecated = result['structure']['deprecated_tags']
        assert 'center' in deprecated

    def test_no_deprecated_tags(self):
        """Test with no deprecated tags."""
        html = '<div>Valid HTML</div>'
        result = analyze_dom(html)

        assert result['structure']['deprecated_tags'] == []


class TestInlineEventHandlers:
    """Test inline event handler detection."""

    def test_count_onclick(self):
        """Test detection of onclick handler."""
        html = '<div onclick="alert()">Click</div>'
        result = analyze_dom(html)

        event_count = result['structure']['inline_event_handlers']
        assert event_count >= 1

    def test_count_multiple_events(self):
        """Test multiple event handlers."""
        html = '<div onclick="fn1()" onload="fn2()"></div>'
        result = analyze_dom(html)

        event_count = result['structure']['inline_event_handlers']
        assert event_count >= 2


class TestIframeAnalysis:
    """Test iframe detection and domain extraction."""

    def test_count_iframes(self):
        """Test iframe counting."""
        html = '<iframe src="https://youtube.com/embed/vid1"></iframe><iframe src="https://vimeo.com/123"></iframe>'
        result = analyze_dom(html)

        iframes = result['structure']['iframes']
        assert iframes['count'] == 2

    def test_iframe_domains(self):
        """Test iframe domain extraction."""
        html = '<iframe src="https://youtube.com/embed/vid1"></iframe>'
        result = analyze_dom(html)

        iframes = result['structure']['iframes']
        assert 'youtube.com' in iframes['domains']


class TestHeadAudit:
    """Test head section auditing."""

    def test_charset_detection(self):
        """Test charset meta tag detection."""
        html = '<head><meta charset="utf-8"></head>'
        result = analyze_dom(html)

        assert result['head']['charset_present'] == True

    def test_viewport_detection(self):
        """Test viewport meta tag detection."""
        html = '<head><meta name="viewport" content="width=device-width"></head>'
        result = analyze_dom(html)

        assert result['head']['viewport_present'] == True

    def test_favicon_detection(self):
        """Test favicon link detection."""
        html = '<head><link rel="icon" href="favicon.ico"></head>'
        result = analyze_dom(html)

        assert result['head']['favicon_present'] == True


class TestContentRatios:
    """Test content ratio calculations."""

    def test_html_size_calculated(self):
        """Test HTML size calculation."""
        html = "<div>Some content here</div>"
        result = analyze_dom(html)

        assert result['content_ratios']['html_size_kb'] >= 0

    def test_word_count(self):
        """Test word count approximation."""
        html = "<p>One two three four five</p>"
        result = analyze_dom(html)

        # Should count some words
        assert result['content_ratios']['word_count_approx'] >= 0

    def test_html_text_ratio(self):
        """Test HTML to text ratio."""
        html = "<div>Content</div>"
        result = analyze_dom(html)

        ratio = result['content_ratios']['html_text_ratio']
        assert 0 <= ratio <= 1


class TestAccessibility:
    """Test accessibility audit."""

    def test_images_missing_alt(self):
        """Test detection of images without alt attribute."""
        html = '<img src="a.jpg"><img src="b.jpg">'
        result = analyze_dom(html)

        assert result['accessibility']['images_missing_alt'] == 2

    def test_images_with_alt_not_counted(self):
        """Test images with alt are not counted as missing."""
        html = '<img src="a.jpg" alt="Photo"><img src="b.jpg" alt="Logo">'
        result = analyze_dom(html)

        assert result['accessibility']['images_missing_alt'] == 0

    def test_inputs_without_label(self):
        """Test detection of inputs with no associated label."""
        html = '<input type="text" id="name">'
        result = analyze_dom(html)

        assert result['accessibility']['inputs_without_label'] == 1

    def test_inputs_with_label_for(self):
        """Test input with matching label for attribute."""
        html = '<label for="name">Name</label><input type="text" id="name">'
        result = analyze_dom(html)

        assert result['accessibility']['inputs_without_label'] == 0

    def test_input_inside_label(self):
        """Test input nested inside label element."""
        html = '<label>Name <input type="text"></label>'
        result = analyze_dom(html)

        assert result['accessibility']['inputs_without_label'] == 0

    def test_buttons_links_no_text(self):
        """Test detection of buttons and links with no text."""
        html = '<button></button><a href="#"></a>'
        result = analyze_dom(html)

        assert result['accessibility']['buttons_links_no_text'] == 2

    def test_buttons_links_with_text(self):
        """Test buttons and links with text are not counted."""
        html = '<button>Submit</button><a href="#">Click here</a>'
        result = analyze_dom(html)

        assert result['accessibility']['buttons_links_no_text'] == 0

    def test_button_with_aria_label(self):
        """Test button with aria-label is not counted as missing text."""
        html = '<button aria-label="Close"></button>'
        result = analyze_dom(html)

        assert result['accessibility']['buttons_links_no_text'] == 0

    def test_html_missing_lang(self):
        """Test detection of missing lang attribute on html."""
        html = '<html><body><p>Text</p></body></html>'
        result = analyze_dom(html)

        assert result['accessibility']['html_missing_lang'] == True

    def test_html_has_lang(self):
        """Test html with lang attribute."""
        html = '<html lang="en"><body><p>Text</p></body></html>'
        result = analyze_dom(html)

        assert result['accessibility']['html_missing_lang'] == False

    def test_aria_attribute_count(self):
        """Test counting of ARIA attributes."""
        html = '<div aria-label="Main" aria-hidden="true"><button aria-pressed="false">X</button></div>'
        result = analyze_dom(html)

        assert result['accessibility']['aria_attribute_count'] == 3



class TestLinksAudit:
    """Test links audit."""

    def test_total_links(self):
        """Test total link counting."""
        html = '<a href="/about">About</a><a href="/contact">Contact</a><a href="https://ext.com">Ext</a>'
        result = analyze_dom(html)

        assert result['links']['total'] == 3

    def test_internal_vs_external(self):
        """Test internal and external link classification."""
        html = '<a href="/about">About</a><a href="https://external.com">Ext</a><a href="#top">Top</a>'
        result = analyze_dom(html)

        assert result['links']['internal'] == 2
        assert result['links']['external'] == 1

    def test_target_blank_missing_rel(self):
        """Test detection of target=_blank without proper rel."""
        html = '<a href="https://ext.com" target="_blank">Unsafe</a>'
        result = analyze_dom(html)

        assert result['links']['target_blank_missing_rel'] == 1

    def test_target_blank_with_rel(self):
        """Test target=_blank with proper rel is not flagged."""
        html = '<a href="https://ext.com" target="_blank" rel="noopener noreferrer">Safe</a>'
        result = analyze_dom(html)

        assert result['links']['target_blank_missing_rel'] == 0

    def test_no_links(self):
        """Test with no links."""
        html = '<div>No links here</div>'
        result = analyze_dom(html)

        assert result['links']['total'] == 0


class TestImagesAudit:
    """Test images audit."""

    def test_total_images(self):
        """Test total image counting."""
        html = '<img src="a.jpg"><img src="b.jpg"><img src="c.jpg">'
        result = analyze_dom(html)

        assert result['images']['total'] == 3

    def test_missing_alt(self):
        """Test missing alt attribute detection."""
        html = '<img src="a.jpg"><img src="b.jpg" alt="Photo">'
        result = analyze_dom(html)

        assert result['images']['missing_alt'] == 1

    def test_missing_dimensions(self):
        """Test missing width/height detection."""
        html = '<img src="a.jpg"><img src="b.jpg" width="100" height="50">'
        result = analyze_dom(html)

        assert result['images']['missing_dimensions'] == 1

    def test_lazy_loaded(self):
        """Test lazy loading detection."""
        html = '<img src="a.jpg" loading="lazy"><img src="b.jpg">'
        result = analyze_dom(html)

        assert result['images']['lazy_loaded'] == 1

    def test_no_images(self):
        """Test with no images."""
        html = '<div>No images</div>'
        result = analyze_dom(html)

        assert result['images']['total'] == 0


class TestFormsAudit:
    """Test forms audit."""

    def test_form_count(self):
        """Test form counting."""
        html = '<form action="/submit"><input type="text"></form><form action="/search"><input type="text"></form>'
        result = analyze_dom(html)

        assert result['forms']['form_count'] == 2

    def test_input_and_button_count(self):
        """Test input and button counting."""
        html = '<form><input type="text"><input type="email"><button>Submit</button></form>'
        result = analyze_dom(html)

        assert result['forms']['input_count'] == 2
        assert result['forms']['button_count'] == 1

    def test_inputs_without_labels(self):
        """Test inputs without associated labels."""
        html = '<input type="text" id="name"><input type="email">'
        result = analyze_dom(html)

        assert result['forms']['inputs_without_labels'] == 2

    def test_inputs_with_labels(self):
        """Test inputs with labels are not counted."""
        html = '<label for="name">Name</label><input type="text" id="name">'
        result = analyze_dom(html)

        assert result['forms']['inputs_without_labels'] == 0

    def test_forms_missing_action(self):
        """Test forms without action attribute."""
        html = '<form><input type="text"></form>'
        result = analyze_dom(html)

        assert result['forms']['forms_missing_action'] == 1

    def test_forms_with_action(self):
        """Test forms with action are not flagged."""
        html = '<form action="/submit"><input type="text"></form>'
        result = analyze_dom(html)

        assert result['forms']['forms_missing_action'] == 0


class TestScriptsAudit:
    """Test scripts audit."""

    def test_inline_vs_external(self):
        """Test inline and external script classification."""
        html = '<script>var x = 1;</script><script src="app.js"></script><script src="lib.js"></script>'
        result = analyze_dom(html)

        assert result['scripts']['total'] == 3
        assert result['scripts']['inline'] == 1
        assert result['scripts']['external'] == 2

    def test_defer_count(self):
        """Test defer attribute counting."""
        html = '<script defer src="a.js"></script><script defer src="b.js"></script><script src="c.js"></script>'
        result = analyze_dom(html)

        assert result['scripts']['defer_count'] == 2

    def test_async_count(self):
        """Test async attribute counting."""
        html = '<script async src="analytics.js"></script><script src="app.js"></script>'
        result = analyze_dom(html)

        assert result['scripts']['async_count'] == 1

    def test_no_scripts(self):
        """Test with no scripts."""
        html = '<div>No scripts</div>'
        result = analyze_dom(html)

        assert result['scripts']['total'] == 0


class TestInlineStylesAudit:
    """Test inline styles audit."""

    def test_count_inline_styles(self):
        """Test counting of elements with style attributes."""
        html = '<div style="color:red">Red</div><p style="font-size:12px">Small</p><span>Normal</span>'
        result = analyze_dom(html)

        assert result['inline_styles']['count'] == 2

    def test_no_inline_styles(self):
        """Test with no inline styles."""
        html = '<div>Clean</div><p>HTML</p>'
        result = analyze_dom(html)

        assert result['inline_styles']['count'] == 0


class TestXrayIntegration:
    """Integration tests for xray functionality."""

    def test_empty_skeleton(self):
        """Test with empty skeleton."""
        html = ""
        result = analyze_dom(html)

        assert result['dom']['total_elements'] == 0

    def test_complex_page(self):
        """Test with complex HTML structure."""
        html = """
        <html lang="en">
        <head>
            <meta charset="utf-8">
            <meta name="viewport">
            <meta name="description" content="A test page">
            <meta property="og:title" content="Test">
            <title>Test Page</title>
            <link rel="canonical" href="https://example.com/test">
        </head>
        <body>
            <header>
                <nav><a href="/">Home</a></nav>
            </header>
            <main>
                <h1>Title</h1>
                <h2>Subtitle</h2>
                <div id="content">
                    <p>Paragraph 1</p>
                    <p>Paragraph 2</p>
                    <img alt="Test" src="test.jpg" width="100" height="50">
                </div>
                <form action="/submit">
                    <label for="email">Email</label>
                    <input type="email" id="email">
                    <button>Submit</button>
                </form>
            </main>
            <footer>Copyright</footer>
            <script src="app.js" defer></script>
        </body>
        </html>
        """
        result = analyze_dom(html)

        # Check all top-level keys exist
        assert 'dom' in result
        assert 'element_map' in result
        assert 'structure' in result
        assert 'head' in result
        assert 'content_ratios' in result
        assert 'accessibility' in result
        assert 'links' in result
        assert 'images' in result
        assert 'forms' in result
        assert 'scripts' in result
        assert 'inline_styles' in result

        assert result['dom']['total_elements'] > 0
        assert 'deepest_path' in result['dom']
        assert result['accessibility']['html_missing_lang'] == False

    def test_valid_json_output(self):
        """Test that output is valid JSON."""
        html = "<div><p>Test</p></div>"
        result = analyze_dom(html)

        # Try to serialize to JSON
        json_str = json.dumps(result)
        assert len(json_str) > 0


class TestTabindexAudit:
    """Test positive tabindex detection (a11y smell)."""

    def test_positive_tabindex_counted(self):
        html = '<div tabindex="1">a</div><button tabindex="2">b</button><input tabindex="0">'
        result = analyze_dom(html)
        assert result['tabindex_audit']['positive_tabindex_count'] == 2

    def test_no_positive_tabindex(self):
        html = '<div tabindex="0">a</div><div tabindex="-1">b</div><div>c</div>'
        result = analyze_dom(html)
        assert result['tabindex_audit']['positive_tabindex_count'] == 0


class TestLargestImageCandidate:
    """Test static LCP heuristic."""

    def test_finds_largest_in_main(self):
        html = '<html><body><main><img src="small.jpg" width="50" height="50"><img src="big.jpg" width="800" height="600"></main></body></html>'
        result = analyze_dom(html)
        cand = result['largest_image_candidate']
        assert cand is not None
        assert cand['src'] == 'big.jpg'
        assert cand['width'] == 800
        assert cand['height'] == 600

    def test_returns_none_when_no_sized_image(self):
        html = '<html><body><main><img src="x.jpg"></main></body></html>'
        result = analyze_dom(html)
        assert result['largest_image_candidate'] is None


class TestTextDensityByRegion:
    """Test per-region word counts."""

    def test_counts_words_in_regions(self):
        html = '<html><body><header>One two</header><main>Alpha beta gamma delta</main><footer>End note</footer></body></html>'
        result = analyze_dom(html)
        density = result['text_density_by_region']
        assert density['header'] == 2
        assert density['main'] == 4
        assert density['footer'] == 2
        assert density['aside'] == 0

    def test_all_zero_when_regions_missing(self):
        html = '<html><body><div>just a div</div></body></html>'
        result = analyze_dom(html)
        density = result['text_density_by_region']
        assert density['main'] == 0
        assert density['aside'] == 0
        assert density['footer'] == 0
        assert density['header'] == 0


class TestDuplicateHeadings:
    """Test duplicate heading detection."""

    def test_detects_duplicates(self):
        html = '<h2>Overview</h2><h2>Details</h2><h2>Overview</h2><h3>Details</h3>'
        result = analyze_dom(html)
        dupes = result['duplicate_headings']
        assert 'Overview' in dupes
        assert 'Details' in dupes

    def test_no_duplicates(self):
        html = '<h1>Title</h1><h2>Section A</h2><h2>Section B</h2>'
        result = analyze_dom(html)
        assert result['duplicate_headings'] == []


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
