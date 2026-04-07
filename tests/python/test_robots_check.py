#!/usr/bin/env python3
"""
Tests for robots_check.py — rule resolution, parsing, sitemap expansion,
and HTTP metadata handling.
"""

import sys
from pathlib import Path
from unittest.mock import patch, MagicMock

# Add python directory to path
sys.path.insert(0, str(Path(__file__).parent.parent.parent / 'python'))

from robots_check import (  # noqa: E402
    is_path_disallowed,
    path_matches_rule,
    parse_robots_txt,
    compute_agent_verdicts,
    compute_ai_bot_summary,
    resolve_agent_block,
    _rule_specificity,
    _analyze_single_sitemap,
    analyze_robots,
)


class TestLongestMatch:
    """Google's longest-match Allow vs Disallow resolution."""

    def test_google_classic_example(self):
        # Disallow: /folder/ + Allow: /folder/page.html → page.html allowed
        assert is_path_disallowed('/folder/page.html', ['/folder/'], ['/folder/page.html']) is False

    def test_non_matching_allow_does_not_override(self):
        assert is_path_disallowed('/folder/other.html', ['/folder/'], ['/folder/page.html']) is True

    def test_longer_disallow_wins(self):
        assert is_path_disallowed('/a/b/c', ['/a/b/c'], ['/a/']) is True

    def test_tie_goes_to_allow(self):
        # Same specificity → Allow wins per Google's spec
        assert is_path_disallowed('/foo', ['/foo'], ['/foo']) is False

    def test_no_matches_allowed(self):
        assert is_path_disallowed('/unrelated', ['/admin'], []) is False

    def test_empty_disallow_is_noop(self):
        # "Disallow:" with empty value means allow everything
        assert is_path_disallowed('/anything', [''], []) is False


class TestWildcards:
    """`*` and `$` support per Google's spec."""

    def test_star_matches_any_sequence(self):
        assert path_matches_rule('/foo/bar.pdf', '/*.pdf') is True
        assert path_matches_rule('/x/y/z.pdf', '/*.pdf') is True

    def test_end_anchor(self):
        assert path_matches_rule('/foo/bar.pdf', '/*.pdf$') is True
        assert path_matches_rule('/foo/bar.pdfx', '/*.pdf$') is False

    def test_query_wildcard(self):
        assert path_matches_rule('/search?q=test', '/search?*') is True
        assert path_matches_rule('/search', '/search?*') is False

    def test_literal_chars_escaped(self):
        # `?` is a literal in robots.txt rules, not a regex metachar
        assert path_matches_rule('/a?b', '/a?b') is True
        assert path_matches_rule('/axb', '/a?b') is False

    def test_specificity_strips_anchor(self):
        assert _rule_specificity('/foo.pdf$') == len('/foo.pdf')
        assert _rule_specificity('/foo') == 4


class TestPerAgentParsing:
    """Per-user-agent rule parsing and resolution."""

    def test_per_agent_blocks_parsed(self):
        content = (
            "User-agent: *\n"
            "Disallow: /admin\n"
            "\n"
            "User-agent: Googlebot\n"
            "Disallow: /\n"
        )
        parsed = parse_robots_txt(content)
        assert '*' in parsed['per_agent_rules']
        assert 'googlebot' in parsed['per_agent_rules']
        assert parsed['per_agent_rules']['googlebot']['disallow'] == ['/']
        assert parsed['per_agent_rules']['*']['disallow'] == ['/admin']

    def test_consecutive_user_agents_share_block(self):
        content = (
            "User-agent: GPTBot\n"
            "User-agent: CCBot\n"
            "Disallow: /\n"
        )
        parsed = parse_robots_txt(content)
        assert parsed['per_agent_rules']['gptbot']['disallow'] == ['/']
        assert parsed['per_agent_rules']['ccbot']['disallow'] == ['/']

    def test_resolve_most_specific_wins(self):
        content = (
            "User-agent: *\n"
            "Disallow: /admin\n"
            "\n"
            "User-agent: Googlebot\n"
            "Disallow: /\n"
        )
        parsed = parse_robots_txt(content)
        block = resolve_agent_block(parsed['per_agent_rules'], 'Googlebot')
        assert block['disallow'] == ['/']

    def test_resolve_fallback_to_star(self):
        content = (
            "User-agent: *\n"
            "Disallow: /admin\n"
        )
        parsed = parse_robots_txt(content)
        block = resolve_agent_block(parsed['per_agent_rules'], 'Bingbot')
        assert block['disallow'] == ['/admin']

    def test_verdict_matrix(self):
        content = (
            "User-agent: *\n"
            "Disallow: /private/\n"
            "\n"
            "User-agent: Googlebot\n"
            "Disallow: /\n"
        )
        parsed = parse_robots_txt(content)
        verdicts = compute_agent_verdicts('/public', parsed['per_agent_rules'])
        assert verdicts['*'] == 'allowed'
        assert verdicts['googlebot'] == 'disallowed'
        # Bingbot falls through to `*`
        assert verdicts['bingbot'] == 'allowed'


class TestAIBotDetection:
    """AI bot summary — counts explicit blocks, not `*` inheritance."""

    def test_explicit_gptbot_block(self):
        content = (
            "User-agent: GPTBot\n"
            "Disallow: /\n"
        )
        parsed = parse_robots_txt(content)
        summary = compute_ai_bot_summary(parsed['per_agent_rules'])
        assert summary['blocked_count'] == 1
        assert 'gptbot' in summary['blocked_agents']
        assert summary['total_checked'] == 6

    def test_multiple_ai_bots(self):
        content = (
            "User-agent: GPTBot\nDisallow: /\n\n"
            "User-agent: CCBot\nDisallow: /\n\n"
            "User-agent: anthropic-ai\nDisallow: /\n"
        )
        parsed = parse_robots_txt(content)
        summary = compute_ai_bot_summary(parsed['per_agent_rules'])
        assert summary['blocked_count'] == 3

    def test_inheriting_from_star_does_not_count(self):
        content = "User-agent: *\nDisallow: /\n"
        parsed = parse_robots_txt(content)
        summary = compute_ai_bot_summary(parsed['per_agent_rules'])
        assert summary['blocked_count'] == 0


class TestSyntaxWarnings:
    def test_missing_colon(self):
        parsed = parse_robots_txt("User-agent *\nDisallow: /\n")
        assert any('missing colon' in w for w in parsed['syntax_warnings'])

    def test_misspelled_directive(self):
        parsed = parse_robots_txt("User-agent: *\nDisallows: /\n")
        assert any('typo' in w for w in parsed['syntax_warnings'])

    def test_rule_before_user_agent(self):
        parsed = parse_robots_txt("Disallow: /admin\n")
        assert any('before any User-agent' in w for w in parsed['syntax_warnings'])

    def test_known_nonstandard_not_warned(self):
        parsed = parse_robots_txt(
            "User-agent: *\nDisallow: /\nHost: example.com\nClean-param: ref\n"
        )
        assert parsed['syntax_warnings'] == []


class TestSitemapExpansion:
    def test_index_expansion_returns_child_counts(self):
        index_xml = (
            '<?xml version="1.0"?>'
            '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
            '<sitemap><loc>https://example.com/sitemap-1.xml</loc></sitemap>'
            '<sitemap><loc>https://example.com/sitemap-2.xml</loc></sitemap>'
            '</sitemapindex>'
        )
        child_xml = (
            '<?xml version="1.0"?>'
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
            '<url><loc>https://example.com/a</loc></url>'
            '<url><loc>https://example.com/b</loc></url>'
            '</urlset>'
        )

        call_count = {'n': 0}

        def fake_urlopen(req, timeout=10):
            call_count['n'] += 1
            cm = MagicMock()
            # First call = index; subsequent = children
            if call_count['n'] == 1:
                cm.__enter__.return_value.read.return_value = index_xml.encode('utf-8')
            else:
                cm.__enter__.return_value.read.return_value = child_xml.encode('utf-8')
            return cm

        with patch('robots_check.urlopen', side_effect=fake_urlopen):
            result = _analyze_single_sitemap(
                'https://example.com/sitemap.xml',
                timeout_s=5.0,
                expand_index=True,
            )

        assert result['is_index'] is True
        assert result['children_fetched'] == 2
        assert result['total_urls_across_children'] == 4

    def test_regular_sitemap_has_no_children(self):
        xml = (
            '<?xml version="1.0"?>'
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
            '<url><loc>https://example.com/a</loc><lastmod>2024-01-01</lastmod></url>'
            '</urlset>'
        )

        def fake_urlopen(req, timeout=10):
            cm = MagicMock()
            cm.__enter__.return_value.read.return_value = xml.encode('utf-8')
            return cm

        with patch('robots_check.urlopen', side_effect=fake_urlopen):
            result = _analyze_single_sitemap(
                'https://example.com/sitemap.xml',
                timeout_s=5.0,
                expand_index=True,
            )

        assert result['is_index'] is False
        assert result['url_count'] == 1
        assert result['has_lastmod'] is True
        assert 'children_fetched' not in result


class TestHTTPMetadata:
    """Validation flags — size, content-type, cross-origin redirect."""

    def _make_fake(self, body=b'User-agent: *\nDisallow:\n', status=200,
                   content_type='text/plain', final_url=None):
        fake_resp = MagicMock()
        fake_resp.status = status
        fake_resp.read.return_value = body
        fake_resp.headers = {'Content-Type': content_type, 'Content-Length': str(len(body))}
        fake_resp.geturl.return_value = final_url or 'https://example.com/robots.txt'
        cm = MagicMock()
        cm.__enter__.return_value = fake_resp
        return cm

    def test_size_limit_flag(self):
        big = b'User-agent: *\nDisallow:\n' + b'# ' + b'x' * (600 * 1024) + b'\n'

        def _fake_open(req, timeout=10):
            return self._make_fake(body=big, content_type='text/plain')

        fake_opener = MagicMock()
        fake_opener.open.side_effect = _fake_open
        with patch('robots_check.build_opener', return_value=fake_opener):
            result = analyze_robots('https://example.com/x', timeout_ms=5000)

        assert result['size_exceeds_google_limit'] is True
        assert 'robots_txt_too_large' in result['issues']

    def test_cross_origin_redirect_detection(self):
        def _fake_open(req, timeout=10):
            return self._make_fake(final_url='https://other.com/robots.txt')

        fake_opener = MagicMock()
        fake_opener.open.side_effect = _fake_open
        with patch('robots_check.build_opener', return_value=fake_opener):
            result = analyze_robots('https://example.com/x', timeout_ms=5000)

        assert result['cross_origin_redirect'] is True
        assert 'robots_txt_cross_origin_redirect' in result['issues']

    def test_backward_compat_sitemap_analysis_alias(self):
        # When sitemaps exist, sitemap_analysis (singular) must equal sitemap_analyses[0].
        body = (
            b'User-agent: *\n'
            b'Disallow:\n'
            b'Sitemap: https://example.com/sitemap.xml\n'
        )
        xml = (
            b'<?xml version="1.0"?>'
            b'<urlset><url><loc>https://example.com/a</loc></url></urlset>'
        )

        def _fake_open(req, timeout=10):
            url = req.full_url if hasattr(req, 'full_url') else req.get_full_url()
            if 'robots.txt' in url:
                return self._make_fake(body=body)
            return self._make_fake(body=xml)

        fake_opener = MagicMock()
        fake_opener.open.side_effect = _fake_open
        with patch('robots_check.build_opener', return_value=fake_opener), \
             patch('robots_check.urlopen', side_effect=_fake_open):
            result = analyze_robots('https://example.com/x', timeout_ms=5000)

        assert result['sitemap_analyses'], 'expected sitemap_analyses to be populated'
        assert result['sitemap_analysis'] is not None
        assert result['sitemap_analysis'] == result['sitemap_analyses'][0]
