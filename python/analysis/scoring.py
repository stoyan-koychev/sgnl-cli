def calculate_score(results: dict) -> int:
    """Calculate overall content quality score (0–100)."""
    try:
        score = 100

        # Content depth
        depth = results.get('content_depth', {}).get('depth_label', 'thin')
        if depth == 'thin':
            score -= 15
        elif depth == 'short':
            score -= 7

        # Content relevance
        relevance = results.get('content_relevance', {})
        if not relevance.get('title_in_h1', False):
            score -= 10
        if not relevance.get('title_in_intro', False):
            score -= 5
        if relevance.get('heading_alignment_score', 1.0) < 0.5:
            score -= 5
        if relevance.get('keyword_stuffing_detected', False):
            score -= 15

        # E-E-A-T
        eeat_count = results.get('eeat_signals', {}).get('eeat_signals_count', 0)
        if eeat_count == 0:
            score -= 20
        elif eeat_count == 1:
            score -= 12
        elif eeat_count == 2:
            score -= 6

        # Freshness
        freshness = results.get('content_freshness', {}).get('freshness_status', 'undated')
        if freshness == 'very_stale':
            score -= 10
        elif freshness == 'stale':
            score -= 5

        # Thin content
        thin = results.get('thin_content', {}).get('thin_content_risk', 'none')
        if thin == 'high':
            score -= 20
        elif thin == 'medium':
            score -= 10
        elif thin == 'low':
            score -= 5

        # Anchor text
        anchor = results.get('anchor_text_quality', {}).get('anchor_quality_score', 'excellent')
        if anchor == 'poor':
            score -= 10
        elif anchor == 'fair':
            score -= 5

        # Readability
        reading_level = results.get('readability', {}).get('reading_level', 'moderate')
        if reading_level == 'academic':
            score -= 10
        elif reading_level == 'difficult':
            score -= 5

        return max(0, min(100, score))
    except Exception:
        return 0


def get_score_label(score: int) -> str:
    """Return human-readable label for score."""
    if score >= 80:
        return 'excellent'
    elif score >= 60:
        return 'good'
    elif score >= 40:
        return 'needs_work'
    else:
        return 'poor'


def collect_all_issues(results: dict) -> list:
    """Collect human-readable issue strings from all categories."""
    issues = []
    try:
        # Depth
        depth_issues = results.get('content_depth', {}).get('issues', [])
        issues.extend(depth_issues)

        depth_label = results.get('content_depth', {}).get('depth_label', '')
        if depth_label == 'thin':
            issues.append('Thin content: page has fewer than 100 words')
        elif depth_label == 'short':
            issues.append('Short content: page has fewer than 300 words')

        # Relevance
        relevance = results.get('content_relevance', {})
        if not relevance.get('title_in_h1', True):
            issues.append('Title keywords not found in H1 heading')
        if not relevance.get('title_in_intro', True):
            issues.append('Title keywords not found in page introduction')
        if relevance.get('heading_alignment_score', 1.0) < 0.5:
            issues.append('Low heading alignment: headings do not reflect content below them')
        if relevance.get('keyword_stuffing_detected', False):
            issues.append('Keyword stuffing detected: a single term exceeds 5% of all words')

        # E-E-A-T
        eeat_label = results.get('eeat_signals', {}).get('eeat_label', 'strong')
        if eeat_label == 'weak':
            issues.append('Weak E-E-A-T signals: add first-person experience, statistics, or citations')

        eeat = results.get('eeat_signals', {})
        if eeat.get('time_sensitive_without_date', False):
            issues.append('Time-sensitive phrases found without a nearby date reference')

        # Freshness
        freshness = results.get('content_freshness', {}).get('freshness_status', '')
        if freshness == 'very_stale':
            issues.append('Content appears very outdated: most recent year is 3+ years ago')
        elif freshness == 'stale':
            issues.append('Content may be stale: most recent year is 2 years ago')

        # Thin content
        thin = results.get('thin_content', {})
        if thin.get('boilerplate_present', False):
            issues.append(f"Boilerplate text detected: {', '.join(thin.get('boilerplate_detected', []))}")
        if thin.get('high_repetition', False):
            issues.append('High sentence repetition detected: possible auto-generated content')
        if thin.get('skeleton_page_detected', False):
            issues.append('Skeleton page: more headings than paragraphs — add substantive content')

        # Anchor quality
        anchor_score = results.get('anchor_text_quality', {}).get('anchor_quality_score', 'excellent')
        if anchor_score == 'poor':
            issues.append('Poor anchor text quality: most links use generic phrases like "click here"')
        elif anchor_score == 'fair':
            issues.append('Fair anchor text quality: consider using more descriptive link text')

        # Readability
        readability = results.get('readability', {})
        reading_level = readability.get('reading_level', 'moderate')
        if reading_level == 'academic':
            issues.append(f'Academic reading level (score: {readability.get("flesch_reading_ease", "n/a")}): content may be too complex for a general audience')
        elif reading_level == 'difficult':
            issues.append(f'Difficult reading level (score: {readability.get("flesch_reading_ease", "n/a")}): consider simplifying sentences')
        long_s = readability.get('long_sentences_count', 0)
        if long_s > 3:
            issues.append(f'{long_s} sentences over 30 words — consider breaking them up')

        # TOC recommendation
        toc = results.get('toc', {})
        if toc.get('toc_recommended', False):
            issues.append('Long-form content (>1500 words) has no table of contents — consider adding one')

        # Heading hierarchy
        hierarchy = results.get('heading_hierarchy', {})
        if not hierarchy.get('hierarchy_valid', True):
            violations = hierarchy.get('violations', [])
            issues.append(f'Heading hierarchy violations: {len(violations)} level skip(s) detected')

        # Meta description
        meta_desc = results.get('meta_description', {})
        meta_status = meta_desc.get('meta_description_status', '')
        if meta_status == 'missing':
            issues.append('Meta description is missing')
        elif meta_status == 'too_short':
            issues.append(f'Meta description is too short ({meta_desc.get("meta_description_length")} chars, min 120)')
        elif meta_status == 'too_long':
            issues.append(f'Meta description is too long ({meta_desc.get("meta_description_length")} chars, max 160)')

        # Image alt text
        img = results.get('image_alt_text', {})
        if img.get('images_missing_alt', 0) > 0:
            issues.append(f'{img["images_missing_alt"]} image(s) missing alt text')

        # Transition words
        tw = results.get('transition_words', {})
        if tw.get('transition_label') == 'low':
            issues.append('Low transition word usage: consider adding more connective phrases')

    except Exception:
        pass

    return issues
