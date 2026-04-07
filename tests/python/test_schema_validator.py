"""Tests for schema_validator.py"""
import sys
import os
import json

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'python'))

from schema_validator import (
    _extract_jsonld_blocks,
    _resolve_type,
    _validate_block,
    _check_rich_results,
    _score_block,
    _generate_recommendations,
    _is_valid_url,
    _is_valid_iso_date,
    _is_valid_duration,
    _check_structural_warnings,
)


# ── Extraction ────────────────────────────────────────────────────────────

class TestExtractJsonLd:
    def test_no_jsonld(self):
        html = '<html><body><p>Hello</p></body></html>'
        blocks = _extract_jsonld_blocks(html)
        assert blocks == []

    def test_single_block(self):
        html = '''<html><head>
        <script type="application/ld+json">{"@type": "Article", "headline": "Test"}</script>
        </head></html>'''
        blocks = _extract_jsonld_blocks(html)
        assert len(blocks) == 1
        assert blocks[0]['@type'] == 'Article'
        assert blocks[0]['headline'] == 'Test'

    def test_multiple_blocks(self):
        html = '''<html><head>
        <script type="application/ld+json">{"@type": "Article", "headline": "A"}</script>
        <script type="application/ld+json">{"@type": "BreadcrumbList", "itemListElement": []}</script>
        </head></html>'''
        blocks = _extract_jsonld_blocks(html)
        assert len(blocks) == 2

    def test_graph_array(self):
        html = '''<html><head>
        <script type="application/ld+json">{"@graph": [
            {"@type": "WebPage", "name": "Home"},
            {"@type": "Organization", "name": "Acme", "url": "https://acme.com"}
        ]}</script>
        </head></html>'''
        blocks = _extract_jsonld_blocks(html)
        assert len(blocks) == 2
        assert blocks[0]['@type'] == 'WebPage'
        assert blocks[1]['@type'] == 'Organization'

    def test_top_level_array(self):
        html = '''<html><head>
        <script type="application/ld+json">[
            {"@type": "Person", "name": "Alice"},
            {"@type": "Person", "name": "Bob"}
        ]</script>
        </head></html>'''
        blocks = _extract_jsonld_blocks(html)
        assert len(blocks) == 2

    def test_invalid_json(self):
        html = '''<html><head>
        <script type="application/ld+json">{invalid json}</script>
        </head></html>'''
        blocks = _extract_jsonld_blocks(html)
        assert len(blocks) == 1
        assert blocks[0]['_parse_error'] is True

    def test_empty_script(self):
        html = '''<html><head>
        <script type="application/ld+json"></script>
        </head></html>'''
        blocks = _extract_jsonld_blocks(html)
        # Empty string parses to {}
        assert len(blocks) == 1


# ── Type resolution ───────────────────────────────────────────────────────

class TestResolveType:
    def test_single_type(self):
        assert _resolve_type({'@type': 'Article'}) == ['Article']

    def test_array_type(self):
        assert _resolve_type({'@type': ['Article', 'NewsArticle']}) == ['Article', 'NewsArticle']

    def test_missing_type(self):
        assert _resolve_type({}) == ['Unknown']


# ── Validation ────────────────────────────────────────────────────────────

class TestValidateBlock:
    def test_complete_article(self):
        data = {
            '@type': 'Article',
            'headline': 'Test Article',
            'image': 'https://example.com/img.jpg',
            'author': {'@type': 'Person', 'name': 'Alice'},
            'datePublished': '2024-03-21',
            'publisher': {'@type': 'Organization', 'name': 'Acme'},
            'dateModified': '2024-03-22',
            'mainEntityOfPage': 'https://example.com/article',
            'description': 'A test article',
        }
        result = _validate_block(data, 'Article')
        assert result['required']['missing'] == []
        assert result['recommended']['missing'] == []
        assert result['format_errors'] == []

    def test_incomplete_article(self):
        data = {
            '@type': 'Article',
            'headline': 'Test',
            'datePublished': '2024-03-21',
        }
        result = _validate_block(data, 'Article')
        assert 'image' in result['required']['missing']
        assert 'author' in result['required']['missing']
        assert 'publisher' in result['required']['missing']
        assert 'headline' in result['required']['present']

    def test_invalid_date_format(self):
        data = {
            '@type': 'Article',
            'headline': 'Test',
            'datePublished': 'March 21, 2024',
        }
        result = _validate_block(data, 'Article')
        format_fields = [e['field'] for e in result['format_errors']]
        assert 'datePublished' in format_fields

    def test_valid_date_format(self):
        data = {
            '@type': 'Article',
            'headline': 'Test',
            'datePublished': '2024-03-21T10:00:00Z',
        }
        result = _validate_block(data, 'Article')
        format_fields = [e['field'] for e in result['format_errors']]
        assert 'datePublished' not in format_fields

    def test_unknown_type(self):
        data = {'@type': 'CustomThing', 'name': 'Foo'}
        result = _validate_block(data, 'CustomThing')
        assert result['required']['fields'] == []
        assert result['recommended']['fields'] == []

    def test_multi_type_merges_fields(self):
        data = {'@type': ['Article', 'NewsArticle'], 'headline': 'News'}
        result = _validate_block(data, 'Article')
        # Should have union of required fields
        assert 'headline' in result['required']['fields']
        assert 'publisher' in result['required']['fields']


# ── Format validators ─────────────────────────────────────────────────────

class TestFormatValidators:
    def test_valid_url(self):
        assert _is_valid_url('https://example.com') is True
        assert _is_valid_url('http://example.com') is True

    def test_invalid_url(self):
        assert _is_valid_url('/relative/path') is False
        assert _is_valid_url('not-a-url') is False

    def test_url_as_object(self):
        assert _is_valid_url({'@id': 'https://example.com'}) is True

    def test_url_as_list(self):
        assert _is_valid_url(['https://a.com', 'https://b.com']) is True

    def test_valid_date(self):
        assert _is_valid_iso_date('2024-03-21') is True
        assert _is_valid_iso_date('2024-03-21T10:00:00Z') is True

    def test_invalid_date(self):
        assert _is_valid_iso_date('March 21, 2024') is False
        assert _is_valid_iso_date('21/03/2024') is False

    def test_valid_duration(self):
        assert _is_valid_duration('PT30M') is True
        assert _is_valid_duration('PT1H30M') is True

    def test_invalid_duration(self):
        assert _is_valid_duration('30 minutes') is False
        assert _is_valid_duration('1.5 hours') is False


# ── Structural warnings ──────────────────────────────────────────────────

class TestStructuralWarnings:
    def test_author_string_warns(self):
        data = {'author': 'John Doe'}
        warnings = _check_structural_warnings(data)
        assert len(warnings) == 1
        assert 'author' in warnings[0]['field']

    def test_author_object_ok(self):
        data = {'author': {'@type': 'Person', 'name': 'John'}}
        warnings = _check_structural_warnings(data)
        assert len([w for w in warnings if w['field'] == 'author']) == 0

    def test_publisher_string_warns(self):
        data = {'publisher': 'Acme Inc'}
        warnings = _check_structural_warnings(data)
        assert any(w['field'] == 'publisher' for w in warnings)

    def test_offers_missing_price(self):
        data = {'offers': {'@type': 'Offer', 'availability': 'InStock'}}
        warnings = _check_structural_warnings(data)
        assert any('price' in w['message'] for w in warnings)

    def test_faq_missing_accepted_answer(self):
        data = {
            '@type': 'FAQPage',
            'mainEntity': [
                {'@type': 'Question', 'name': 'Q1'},
            ],
        }
        warnings = _check_structural_warnings(data)
        assert any('acceptedAnswer' in w['message'] for w in warnings)


# ── Rich Results ──────────────────────────────────────────────────────────

class TestRichResults:
    def test_complete_article_eligible(self):
        data = {
            '@type': 'Article',
            'headline': 'Test',
            'image': 'https://example.com/img.jpg',
            'author': {'@type': 'Person', 'name': 'Alice'},
            'datePublished': '2024-03-21',
            'publisher': {'@type': 'Organization', 'name': 'Acme'},
        }
        result = _check_rich_results(data, 'Article')
        assert result['eligible'] is True
        assert 'Article rich result' in result['types']

    def test_incomplete_article_not_eligible(self):
        data = {'@type': 'Article', 'headline': 'Test'}
        result = _check_rich_results(data, 'Article')
        assert result['eligible'] is False
        assert len(result['missing_for_eligibility']) > 0

    def test_product_with_rating_eligible(self):
        data = {
            '@type': 'Product',
            'name': 'Widget',
            'image': 'https://example.com/widget.jpg',
            'offers': {'@type': 'Offer', 'price': '9.99', 'priceCurrency': 'USD'},
            'aggregateRating': {'ratingValue': '4.5'},
        }
        result = _check_rich_results(data, 'Product')
        assert result['eligible'] is True

    def test_breadcrumb_needs_2_items(self):
        data = {
            '@type': 'BreadcrumbList',
            'itemListElement': [{'item': '/'}],
        }
        result = _check_rich_results(data, 'BreadcrumbList')
        assert result['eligible'] is False

    def test_breadcrumb_with_2_items(self):
        data = {
            '@type': 'BreadcrumbList',
            'itemListElement': [
                {'@type': 'ListItem', 'position': 1, 'item': '/', 'name': 'Home'},
                {'@type': 'ListItem', 'position': 2, 'item': '/about', 'name': 'About'},
            ],
        }
        result = _check_rich_results(data, 'BreadcrumbList')
        assert result['eligible'] is True

    def test_unknown_type_not_eligible(self):
        data = {'@type': 'CustomWidget', 'name': 'Foo'}
        result = _check_rich_results(data, 'CustomWidget')
        assert result['eligible'] is False
        assert result['types'] == []

    def test_video_needs_content_or_embed_url(self):
        data = {
            '@type': 'VideoObject',
            'name': 'Video',
            'description': 'A video',
            'thumbnailUrl': 'https://example.com/thumb.jpg',
            'uploadDate': '2024-03-21',
        }
        result = _check_rich_results(data, 'VideoObject')
        assert result['eligible'] is False
        assert any('contentUrl' in m for m in result['missing_for_eligibility'])


# ── Scoring ───────────────────────────────────────────────────────────────

class TestScoring:
    def test_perfect_score(self):
        validation = {
            'required': {'fields': ['a'], 'present': ['a'], 'missing': []},
            'recommended': {'fields': ['b'], 'present': ['b'], 'missing': []},
            'format_errors': [],
            'warnings': [],
        }
        rich = {'eligible': True, 'types': ['X'], 'missing_for_eligibility': []}
        assert _score_block(validation, rich) == 100  # 100 + 10 bonus, capped at 100

    def test_missing_required_deducts_15(self):
        validation = {
            'required': {'fields': ['a', 'b'], 'present': ['a'], 'missing': ['b']},
            'recommended': {'fields': [], 'present': [], 'missing': []},
            'format_errors': [],
            'warnings': [],
        }
        rich = {'eligible': False, 'types': [], 'missing_for_eligibility': ['b']}
        assert _score_block(validation, rich) == 85  # 100 - 15

    def test_missing_recommended_deducts_5(self):
        validation = {
            'required': {'fields': [], 'present': [], 'missing': []},
            'recommended': {'fields': ['x', 'y'], 'present': [], 'missing': ['x', 'y']},
            'format_errors': [],
            'warnings': [],
        }
        rich = {'eligible': True, 'types': ['X'], 'missing_for_eligibility': []}
        assert _score_block(validation, rich) == 100  # 100 - 10 + 10 bonus

    def test_format_error_deducts_10(self):
        validation = {
            'required': {'fields': [], 'present': [], 'missing': []},
            'recommended': {'fields': [], 'present': [], 'missing': []},
            'format_errors': [{'field': 'date', 'value': 'bad', 'expected': 'ISO', 'message': 'bad date'}],
            'warnings': [],
        }
        rich = {'eligible': False, 'types': [], 'missing_for_eligibility': []}
        assert _score_block(validation, rich) == 90

    def test_score_floors_at_zero(self):
        validation = {
            'required': {'fields': list('abcdefgh'), 'present': [], 'missing': list('abcdefgh')},
            'recommended': {'fields': [], 'present': [], 'missing': []},
            'format_errors': [],
            'warnings': [],
        }
        rich = {'eligible': False, 'types': [], 'missing_for_eligibility': []}
        assert _score_block(validation, rich) == 0  # 100 - 120 = -20 → 0


# ── Recommendations ───────────────────────────────────────────────────────

class TestRecommendations:
    def test_missing_required_is_high_priority(self):
        blocks = [{
            'type': 'Article',
            'validation': {
                'required': {'fields': ['headline', 'publisher'], 'present': ['headline'], 'missing': ['publisher']},
                'recommended': {'fields': [], 'present': [], 'missing': []},
                'format_errors': [],
                'warnings': [],
            },
        }]
        recs = _generate_recommendations(blocks)
        assert len(recs) == 1
        assert recs[0]['priority'] == 'high'
        assert 'publisher' in recs[0]['message']

    def test_missing_recommended_is_low_priority(self):
        blocks = [{
            'type': 'Article',
            'validation': {
                'required': {'fields': [], 'present': [], 'missing': []},
                'recommended': {'fields': ['description'], 'present': [], 'missing': ['description']},
                'format_errors': [],
                'warnings': [],
            },
        }]
        recs = _generate_recommendations(blocks)
        assert len(recs) == 1
        assert recs[0]['priority'] == 'low'

    def test_warnings_are_medium_priority(self):
        blocks = [{
            'type': 'Article',
            'validation': {
                'required': {'fields': [], 'present': [], 'missing': []},
                'recommended': {'fields': [], 'present': [], 'missing': []},
                'format_errors': [],
                'warnings': [{'field': 'author', 'message': 'should be object'}],
            },
        }]
        recs = _generate_recommendations(blocks)
        assert len(recs) == 1
        assert recs[0]['priority'] == 'medium'
