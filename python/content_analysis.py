#!/usr/bin/env python3
"""
content_analysis.py — Section 5: Content Analysis
Reads clean Markdown from stdin, receives title/meta as JSON in argv[1].
Outputs structured JSON to stdout. Never raises unhandled exceptions.
"""

import sys
import json

sys.setrecursionlimit(2000)

from analysis import *
from analysis import (
    LANGUAGE_PROFILES, detect_language, strip_markdown,
    analyse_content_depth, analyse_content_relevance, analyse_eeat,
    analyse_freshness, analyse_snippet_eligibility, analyse_thin_content,
    analyse_anchor_quality, analyse_readability, analyse_cta, analyse_toc,
    analyse_author_bio, analyse_passive_voice, analyse_link_types,
    analyse_image_alt_text, analyse_heading_hierarchy, analyse_transition_words,
    analyse_meta_description, analyse_top_keywords, analyse_top_phrases,
    analyse_first_paragraph,
    collect_all_issues,
)


def main() -> None:
    try:
        markdown = sys.stdin.read()
        meta = {}
        if len(sys.argv) > 1:
            try:
                meta = json.loads(sys.argv[1])
            except (json.JSONDecodeError, ValueError):
                meta = {}

        title = meta.get('title', '')

        # Resolve language profile
        lang = meta.get('lang')
        if lang and lang in LANGUAGE_PROFILES:
            profile = LANGUAGE_PROFILES[lang]
        else:
            plain_for_detect = strip_markdown(markdown)
            lang = detect_language(plain_for_detect, LANGUAGE_PROFILES)
            profile = LANGUAGE_PROFILES.get(lang, LANGUAGE_PROFILES['en'])

        content_depth = analyse_content_depth(markdown)
        anchor_quality = analyse_anchor_quality(markdown)

        # Internal link density (links per 1000 words)
        word_count = content_depth.get('word_count', 0)
        total_links = anchor_quality.get('total_internal_links', 0)
        if word_count > 0:
            link_density = round(total_links / word_count * 1000, 1)
        else:
            link_density = 0.0

        link_density_issues = []
        if total_links == 0 and word_count > 0:
            link_density_issues.append('no_internal_links')
        if link_density > 20:
            link_density_issues.append('over_linked')

        content_relevance = analyse_content_relevance(markdown, title, profile)
        eeat_signals = analyse_eeat(markdown, profile)
        content_freshness = analyse_freshness(markdown, meta, profile)
        thin_content = analyse_thin_content(markdown, profile)
        readability = analyse_readability(markdown, profile)
        cta = analyse_cta(markdown, profile)
        toc = analyse_toc(markdown)
        author_bio = analyse_author_bio(markdown, profile)

        # New analyses
        passive_voice = analyse_passive_voice(markdown)
        image_alt_text = analyse_image_alt_text(markdown)
        heading_hierarchy = analyse_heading_hierarchy(markdown)
        transition_words = analyse_transition_words(markdown, profile)
        meta_description = analyse_meta_description(meta)
        top_keywords = analyse_top_keywords(markdown, profile)
        top_phrases = analyse_top_phrases(markdown, profile)
        first_paragraph = analyse_first_paragraph(markdown, title)

        results = {
            'section': 'content_analysis',
            'detected_language': lang,
            'content_depth': content_depth,
            'content_relevance': content_relevance,
            'eeat_signals': eeat_signals,
            'content_freshness': content_freshness,
            'featured_snippet': analyse_snippet_eligibility(markdown),
            'thin_content': thin_content,
            'anchor_text_quality': anchor_quality,
            'readability': readability,
            'cta': cta,
            'toc': toc,
            'author_bio': author_bio,
            'link_density': {
                'links_per_1000_words': link_density,
                'total_internal_links': total_links,
                'issues': link_density_issues,
            },
            'passive_voice': passive_voice,
            'image_alt_text': image_alt_text,
            'heading_hierarchy': heading_hierarchy,
            'transition_words': transition_words,
            'meta_description': meta_description,
            'top_keywords': top_keywords,
            'top_phrases': top_phrases,
            'first_paragraph': first_paragraph,
        }

        results['issues'] = collect_all_issues(results)

        print(json.dumps(results, indent=2))
    except Exception as e:
        # Fallback: always output valid JSON
        error_output = {
            'section': 'content_analysis',
            'error': str(e)[:200],
            'issues': ['Content analysis failed'],
        }
        print(json.dumps(error_output))


if __name__ == '__main__':
    main()
