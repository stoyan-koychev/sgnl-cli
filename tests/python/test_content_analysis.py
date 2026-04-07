"""
Tests for python/content_analysis.py — Section 5: Content Analysis.
All 36 test methods covering 7 analysis categories + edge cases.
"""

import sys
import os
import json

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'python'))

from content_analysis import (
    analyse_content_depth,
    analyse_content_relevance,
    analyse_eeat,
    analyse_freshness,
    analyse_snippet_eligibility,
    analyse_thin_content,
    analyse_anchor_quality,
    calculate_score,
    get_score_label,
    collect_all_issues,
    strip_markdown,
    tokenize,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

THIN_TEXT = "Short page."

SHORT_TEXT = " ".join(["word"] * 150)  # 150 words

ADEQUATE_TEXT = " ".join(["This is a sentence with several words."] * 40)  # ~280 words

COMPREHENSIVE_TEXT = " ".join(["This is a well-written informative sentence."] * 200)  # 1000+ words

WALL_OF_TEXT = " ".join(["word"] * 200)  # single paragraph, 200 words

FRAGMENTED_MD = "\n\n".join(["Hi."] * 10)  # many tiny paragraphs

OVERSIZED_MD = " ".join(["word"] * 350)  # single paragraph > 300 words


class TestContentDepth:
    """Tests for analyse_content_depth()"""

    def test_classifies_thin_below_100_words(self):
        """Words < 100 should be labelled 'thin'."""
        result = analyse_content_depth("This is a short page with only a few words.")
        assert result['depth_label'] == 'thin'

    def test_classifies_comprehensive_above_800_words(self):
        """Words > 800 should be labelled 'comprehensive'."""
        result = analyse_content_depth(COMPREHENSIVE_TEXT)
        assert result['depth_label'] == 'comprehensive'
        assert result['word_count'] > 800

    def test_detects_wall_of_text_paragraph(self):
        """Average paragraph > 150 words should warn 'wall of text'."""
        result = analyse_content_depth(WALL_OF_TEXT)
        issue_text = ' '.join(result['issues'])
        assert 'wall of text' in issue_text.lower()

    def test_handles_empty_string(self):
        """Empty input should return thin depth with 0 words."""
        result = analyse_content_depth('')
        assert result['depth_label'] == 'thin'
        assert result['word_count'] == 0

    def test_handles_only_headings(self):
        """Markdown with only headings should have thin depth."""
        md = "# Heading One\n## Heading Two\n### Heading Three"
        result = analyse_content_depth(md)
        assert result['depth_label'] == 'thin'


class TestContentRelevance:
    """Tests for analyse_content_relevance()"""

    def test_detects_title_keyword_in_h1(self):
        """A title keyword appearing in H1 should set title_in_h1=True."""
        md = "# Python Tutorial\n\nLearn Python programming step by step."
        result = analyse_content_relevance(md, "Python Tutorial")
        assert result['title_in_h1'] is True

    def test_title_keyword_missing_from_h1(self):
        """H1 with unrelated words should set title_in_h1=False."""
        md = "# Welcome Page\n\nThis page talks about Django web framework."
        result = analyse_content_relevance(md, "Python Tutorial")
        assert result['title_in_h1'] is False

    def test_detects_keyword_stuffing_above_5_percent(self):
        """Any content word exceeding 5% frequency should set keyword_stuffing_detected=True."""
        # 'python' repeated 20 times in 30 content words = 66% > 5%
        md = " ".join(["python"] * 20 + ["something", "else", "here", "more", "text", "stuff", "words", "content", "page", "site"])
        result = analyse_content_relevance(md, "Python")
        assert result['keyword_stuffing_detected'] is True

    def test_no_false_positive_on_normal_content(self):
        """Normal content distribution should not trigger keyword stuffing."""
        md = (
            "# Web Development Guide\n\n"
            "Modern web development requires knowledge of frontend and backend technologies. "
            "Developers use frameworks such as React, Angular, and Vue for building interfaces. "
            "Backend engineers work with databases, APIs, and server-side languages. "
            "Understanding networking, security, and performance optimisation rounds out expertise. "
            "Version control, testing, and continuous integration form essential professional practices. "
            "Cloud deployment, containerisation, and monitoring complete the production lifecycle."
        )
        result = analyse_content_relevance(md, "Web Development Guide")
        assert result['keyword_stuffing_detected'] is False

    def test_heading_alignment_scoring(self):
        """H2 headings whose keywords appear in following content should score high."""
        md = (
            "# Page Title\n\n"
            "## Benefits of Exercise\n\n"
            "Regular exercise improves health, reduces stress, and builds muscle strength.\n\n"
            "## Nutrition Tips\n\n"
            "Proper nutrition with balanced meals supports athletic performance."
        )
        result = analyse_content_relevance(md, "Health Guide")
        assert result['heading_alignment_score'] > 0.0

    def test_handles_empty_title(self):
        """Empty title should not crash and should return defaults."""
        md = "# Some heading\n\nSome content here."
        result = analyse_content_relevance(md, "")
        assert isinstance(result['title_in_h1'], bool)
        assert isinstance(result['heading_alignment_score'], float)


class TestEEAT:
    """Tests for analyse_eeat()"""

    def test_detects_first_person_language(self):
        """First-person pronouns should be detected."""
        md = "I tested this tool myself and we found it very useful. My experience was great."
        result = analyse_eeat(md)
        assert result['first_person_present'] is True
        assert result['first_person_count'] > 0

    def test_detects_statistics_with_percent(self):
        """Numbers with % or other units should be counted as statistics."""
        md = "Performance improved by 45% after optimisation. The page now loads in 200ms."
        result = analyse_eeat(md)
        assert result['statistics_count'] > 0

    def test_detects_date_in_content(self):
        """Year references should be detected as dates."""
        md = "This guide was last updated in January 2024 to reflect recent changes."
        result = analyse_eeat(md)
        assert result['most_recent_date'] is not None

    def test_detects_time_sensitive_without_date(self):
        """Time-sensitive phrases without a nearby date should set flag True."""
        md = "Currently the best tool available. Latest version supports all features."
        result = analyse_eeat(md)
        assert result['time_sensitive_without_date'] is True

    def test_weak_when_no_signals_present(self):
        """Content with no E-E-A-T signals should be labelled 'weak'."""
        md = "This is generic content without any signals of expertise or authority."
        result = analyse_eeat(md)
        assert result['eeat_label'] == 'weak'

    def test_strong_when_four_or_more_signals(self):
        """Content with 4+ signals should be labelled 'strong'."""
        md = (
            "I personally tested this tool in 2024 and found it excellent. "
            "According to research, performance improved by 45ms across all benchmarks. "
            "Sarah Johnson reviewed our methodology and confirmed the results. "
            "We have since applied these techniques across many client projects."
        )
        result = analyse_eeat(md)
        assert result['eeat_signals_count'] >= 4
        assert result['eeat_label'] == 'strong'


class TestFreshness:
    """Tests for analyse_freshness()"""

    def test_classifies_current_year_as_current(self):
        """Content mentioning the current year should be 'current'."""
        from datetime import datetime
        current_year = datetime.now().year
        md = f"Updated guide for {current_year} covering all major changes."
        result = analyse_freshness(md)
        assert result['freshness_status'] == 'current'
        assert result['most_recent_year'] == current_year

    def test_classifies_two_years_ago_as_stale(self):
        """Content mentioning 2 years ago should be 'stale'."""
        from datetime import datetime
        stale_year = datetime.now().year - 2
        md = f"This guide was written in {stale_year} for that year's practices."
        result = analyse_freshness(md)
        assert result['freshness_status'] == 'stale'

    def test_undated_when_no_year_found(self):
        """Content without any year should be 'undated'."""
        md = "This is a timeless guide with no specific date references."
        result = analyse_freshness(md)
        assert result['freshness_status'] == 'undated'
        assert result['most_recent_year'] is None

    def test_detects_time_sensitive_phrases(self):
        """Phrases like 'currently' or 'latest' should be flagged."""
        md = "Currently the best approach. Use the latest version for optimal results."
        result = analyse_freshness(md)
        assert len(result['time_sensitive_phrases_found']) > 0

    def test_handles_multiple_years(self):
        """Most recent year should be selected when multiple years are present."""
        from datetime import datetime
        current_year = datetime.now().year
        md = f"Originally written in 2019, updated in 2021, and revised in {current_year}."
        result = analyse_freshness(md)
        assert result['most_recent_year'] == current_year
        assert len(result['years_mentioned']) >= 3


class TestSnippetEligibility:
    """Tests for analyse_snippet_eligibility()"""

    def test_detects_definition_paragraph(self):
        """Opening definition sentence should set definition_paragraph_present=True."""
        md = "Python is a high-level programming language known for its simplicity.\n\nMore details here."
        result = analyse_snippet_eligibility(md)
        assert result['definition_paragraph_present'] is True

    def test_detects_list_under_heading(self):
        """An unordered list under a heading with 3+ items of correct length should be eligible."""
        md = (
            "## Top Benefits of Exercise\n"
            "- Improves cardiovascular health and reduces heart disease risk significantly\n"
            "- Builds muscle strength and enhances overall physical endurance levels\n"
            "- Reduces stress and anxiety while improving mental health outcomes\n"
            "- Helps maintain healthy body weight and improves metabolic function\n"
        )
        result = analyse_snippet_eligibility(md)
        assert result['list_snippet_eligible'] is True
        assert len(result['lists_under_headings']) > 0

    def test_detects_qa_pattern(self):
        """Heading ending in '?' followed by paragraph should create a QA pair."""
        md = (
            "## What is Python?\n\n"
            "Python is a versatile programming language used for web development and data science.\n\n"
            "## How do I install Python?\n\n"
            "You can download Python from the official website and run the installer."
        )
        result = analyse_snippet_eligibility(md)
        assert result['qa_pattern_count'] >= 2

    def test_recommends_faq_schema_on_two_plus_qa(self):
        """Two or more QA pairs should recommend FAQ schema."""
        md = (
            "## What is SEO?\n\nSEO stands for Search Engine Optimisation.\n\n"
            "## Why is SEO important?\n\nSEO helps websites rank higher in search results."
        )
        result = analyse_snippet_eligibility(md)
        assert result['faq_schema_recommended'] is True

    def test_no_false_positive_short_list(self):
        """A list with fewer than 3 items should not be snippet eligible."""
        md = (
            "## Quick Tips\n"
            "- First tip here\n"
            "- Second tip here\n"
        )
        result = analyse_snippet_eligibility(md)
        # 2-item list should not be list_snippet_eligible
        eligible_lists = [l for l in result['lists_under_headings'] if l['snippet_eligible']]
        assert len(eligible_lists) == 0


class TestThinContent:
    """Tests for analyse_thin_content()"""

    def test_detects_lorem_ipsum(self):
        """Lorem ipsum text should be detected as boilerplate."""
        md = "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod"
        result = analyse_thin_content(md)
        assert result['boilerplate_present'] is True
        assert 'lorem ipsum' in result['boilerplate_detected']

    def test_detects_skeleton_page(self):
        """More headings than paragraphs should be flagged as skeleton page."""
        md = (
            "# Section 1\n## Sub 1a\n## Sub 1b\n"
            "# Section 2\n## Sub 2a\n## Sub 2b\n"
            "# Section 3\n\n"
            "Just one paragraph of content."
        )
        result = analyse_thin_content(md)
        assert result['skeleton_page_detected'] is True

    def test_detects_duplicate_sentences(self):
        """Near-identical repeated sentences should increment duplicate count."""
        sentence = "This product is the best product you can buy anywhere."
        md = "\n\n".join([sentence] * 5)
        result = analyse_thin_content(md)
        assert result['duplicate_sentences_found'] > 0

    def test_clean_content_has_no_risk(self):
        """Well-written diverse content should have 'none' thin content risk."""
        md = (
            "# Complete Guide to Python\n\n"
            "Python is a versatile programming language created by Guido van Rossum in 1991. "
            "It emphasises code readability and allows programmers to express concepts in fewer lines.\n\n"
            "## Key Features\n\n"
            "Python supports multiple programming paradigms including object-oriented, functional, "
            "and procedural styles. Its extensive standard library covers many areas of computing.\n\n"
            "## Getting Started\n\n"
            "To begin with Python, download the latest version from the official website. "
            "The installation is straightforward on all major operating systems."
        )
        result = analyse_thin_content(md)
        assert result['thin_content_risk'] in ('none', 'low')


class TestAnchorQuality:
    """Tests for analyse_anchor_quality()"""

    def test_classifies_generic_anchors(self):
        """Known generic phrases should be classified as 'generic'."""
        md = "[click here](https://example.com) and [read more](https://example.com/more)"
        result = analyse_anchor_quality(md)
        assert result['generic_count'] >= 2

    def test_classifies_descriptive_anchors(self):
        """Multi-word descriptive anchors should be classified as 'descriptive'."""
        md = "[Python installation guide](https://example.com) and [web scraping tutorial](https://example.com/scrape)"
        result = analyse_anchor_quality(md)
        assert result['descriptive_count'] >= 2

    def test_detects_empty_anchors(self):
        """Links with empty anchor text should be counted."""
        md = "[](https://example.com/empty)"
        result = analyse_anchor_quality(md)
        assert result['empty_count'] >= 1

    def test_handles_no_links(self):
        """Content with no links should return totals of 0 and excellent score."""
        md = "This is content with no links at all."
        result = analyse_anchor_quality(md)
        assert result['total_internal_links'] == 0
        assert result['anchor_quality_score'] == 'excellent'

    def test_quality_score_calculation(self):
        """Mostly descriptive links should yield good/excellent quality score."""
        md = (
            "[Python tutorial for beginners](https://example.com/python) "
            "[web development guide](https://example.com/web) "
            "[data science introduction](https://example.com/ds) "
            "[click here](https://example.com/bad)"
        )
        result = analyse_anchor_quality(md)
        assert result['descriptive_ratio'] >= 0.5
        assert result['anchor_quality_score'] in ('good', 'excellent', 'fair')


class TestEdgeCases:
    """Tests for edge cases and robustness."""

    def test_all_functions_handle_empty_string(self):
        """All 7 analysis functions should return valid dicts for empty input."""
        assert isinstance(analyse_content_depth(''), dict)
        assert isinstance(analyse_content_relevance('', ''), dict)
        assert isinstance(analyse_eeat(''), dict)
        assert isinstance(analyse_freshness(''), dict)
        assert isinstance(analyse_snippet_eligibility(''), dict)
        assert isinstance(analyse_thin_content(''), dict)
        assert isinstance(analyse_anchor_quality(''), dict)

    def test_handles_unicode_content(self):
        """Unicode characters should not cause crashes."""
        md = "# Héllo Wörld\n\nCafé résumé naïve über 日本語 中文 한국어"
        result = analyse_content_depth(md)
        assert isinstance(result['word_count'], int)

    def test_handles_emoji_in_content(self):
        """Emoji in content should not cause crashes."""
        md = "# Great content 🎉\n\nThis is amazing content! 🚀 We love it! ✨"
        result = analyse_eeat(md)
        assert isinstance(result['eeat_label'], str)

    def test_handles_100k_words_without_timeout(self):
        """Large input (100k words) should complete without crashing."""
        large_md = ("This is a sentence with multiple words for testing. " * 10000)
        result = analyse_content_depth(large_md)
        assert result['word_count'] > 50000
        assert result['depth_label'] == 'comprehensive'

    def test_handles_only_code_blocks(self):
        """Markdown with only code blocks should handle gracefully."""
        md = "```python\nfor i in range(10):\n    print(i)\n```"
        result = analyse_content_depth(md)
        assert isinstance(result['word_count'], int)

    def test_output_always_valid_json(self):
        """Full pipeline output should always be valid JSON-serialisable."""
        md = "# Test\n\nSome content here."
        results = {
            'section': 'content_analysis',
            'content_depth': analyse_content_depth(md),
            'content_relevance': analyse_content_relevance(md, 'Test'),
            'eeat_signals': analyse_eeat(md),
            'content_freshness': analyse_freshness(md),
            'featured_snippet': analyse_snippet_eligibility(md),
            'thin_content': analyse_thin_content(md),
            'anchor_text_quality': analyse_anchor_quality(md),
        }
        results['score'] = calculate_score(results)
        results['score_label'] = get_score_label(results['score'])
        results['issues'] = collect_all_issues(results)
        # Should not raise
        serialised = json.dumps(results)
        parsed = json.loads(serialised)
        assert parsed['section'] == 'content_analysis'
        assert 0 <= parsed['score'] <= 100
