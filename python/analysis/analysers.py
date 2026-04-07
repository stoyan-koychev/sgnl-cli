import re
from datetime import datetime
from .languages import LANGUAGE_PROFILES
from .helpers import strip_markdown, extract_headings, tokenize, extract_ngrams, _count_syllables, GENERIC_ANCHORS


def _percentiles(values: list) -> dict:
    """Return min/max/p50/p90 for an int list. Returns zeros on empty input."""
    if not values:
        return {'min': 0, 'max': 0, 'p50': 0, 'p90': 0}
    sorted_vals = sorted(values)
    n = len(sorted_vals)

    def _pct(p: float) -> int:
        # Nearest-rank percentile — simple and stable for small N.
        idx = max(0, min(n - 1, int(round(p * (n - 1)))))
        return int(sorted_vals[idx])

    return {
        'min': int(sorted_vals[0]),
        'max': int(sorted_vals[-1]),
        'p50': _pct(0.5),
        'p90': _pct(0.9),
    }


def analyse_content_depth(markdown: str) -> dict:
    """Measures content length and paragraph quality."""
    try:
        plain = strip_markdown(markdown)
        words = re.findall(r'\b\w+\b', plain)
        word_count = len(words)

        paragraphs = [p.strip() for p in re.split(r'\n\n+', plain) if p.strip()]
        paragraph_count = len(paragraphs)

        para_lengths = []
        issues = []
        for p in paragraphs:
            para_words = re.findall(r'\b\w+\b', p)
            para_lengths.append(len(para_words))
            if len(para_words) > 300:
                issues.append('oversized paragraph detected')

        avg_paragraph_length = sum(para_lengths) / len(para_lengths) if para_lengths else 0.0

        if avg_paragraph_length > 150:
            issues.append('wall of text: average paragraph exceeds 150 words')
        if avg_paragraph_length < 10 and paragraph_count > 0:
            issues.append('fragmented content: average paragraph under 10 words')

        if word_count < 100:
            depth_label = 'thin'
        elif word_count < 300:
            depth_label = 'short'
        elif word_count < 800:
            depth_label = 'adequate'
        else:
            depth_label = 'comprehensive'

        # New phase-2 signals
        # Reading time: assume 200 wpm average adult reading speed.
        reading_time_minutes = round(word_count / 200, 1) if word_count > 0 else 0.0

        # Lexical diversity = unique_words / total_words (type-token ratio).
        lower_words = [w.lower() for w in words]
        unique_words = len(set(lower_words))
        if word_count > 0:
            lexical_diversity = round(unique_words / word_count, 3)
        else:
            lexical_diversity = 0.0
        if lexical_diversity < 0.3:
            lexical_diversity_label = 'low'
        elif lexical_diversity <= 0.5:
            lexical_diversity_label = 'medium'
        else:
            lexical_diversity_label = 'high'

        paragraph_length_distribution = _percentiles(para_lengths)

        return {
            'word_count': word_count,
            'paragraph_count': paragraph_count,
            'avg_paragraph_length': round(avg_paragraph_length, 1),
            'depth_label': depth_label,
            'reading_time_minutes': reading_time_minutes,
            'lexical_diversity': lexical_diversity,
            'lexical_diversity_label': lexical_diversity_label,
            'paragraph_length_distribution': paragraph_length_distribution,
            'issues': issues,
        }
    except Exception:
        return {
            'word_count': 0,
            'paragraph_count': 0,
            'avg_paragraph_length': 0.0,
            'depth_label': 'thin',
            'reading_time_minutes': 0.0,
            'lexical_diversity': 0.0,
            'lexical_diversity_label': 'low',
            'paragraph_length_distribution': {'min': 0, 'max': 0, 'p50': 0, 'p90': 0},
            'issues': [],
        }


def analyse_content_relevance(markdown: str, title: str, profile: dict = None) -> dict:
    """Checks if content matches the page's title tag."""
    if profile is None:
        profile = LANGUAGE_PROFILES['en']
    try:
        plain = strip_markdown(markdown)
        headings = extract_headings(markdown)
        stop_words = profile['stop_words']

        # Extract main terms from title
        title_tokens = tokenize(title, remove_stop_words=True, stop_words=stop_words) if title else []
        title_terms = set(title_tokens)

        # title_in_h1: check if ≥1 main term appears in H1
        h1_texts = [h['text'].lower() for h in headings if h['level'] == 1]
        title_in_h1 = False
        if title_terms:
            for h1 in h1_texts:
                h1_words = set(re.findall(r'\b[a-zA-Z]{2,}\b', h1))
                if title_terms & h1_words:
                    title_in_h1 = True
                    break

        # title_in_intro: does any title term appear in the first 100 words?
        all_words = re.findall(r'\b[a-zA-Z]{2,}\b', plain.lower())
        first_100 = all_words[:100]
        title_in_intro = bool(title_terms and title_terms & set(first_100))

        # Position of first match
        title_in_intro_word_position = None
        if title_terms:
            for i, w in enumerate(first_100):
                if w in title_terms:
                    title_in_intro_word_position = i
                    break

        # Heading alignment score: for each H2, do heading words appear in content below it?
        lines = markdown.split('\n')
        h2_sections = []
        current_h2 = None
        current_body = []
        for line in lines:
            m = re.match(r'^(#{1,6})\s+(.*)', line.strip())
            if m:
                level = len(m.group(1))
                text = m.group(2).strip()
                if level == 2:
                    if current_h2 is not None:
                        h2_sections.append((current_h2, ' '.join(current_body)))
                    current_h2 = text
                    current_body = []
                elif current_h2 is not None:
                    current_body.append(line)
            elif current_h2 is not None:
                current_body.append(line)
        if current_h2 is not None:
            h2_sections.append((current_h2, ' '.join(current_body)))

        aligned = 0
        for heading_text, body in h2_sections:
            heading_words = set(tokenize(heading_text, remove_stop_words=True, stop_words=stop_words))
            body_words = set(tokenize(strip_markdown(body), remove_stop_words=True, stop_words=stop_words))
            if heading_words and heading_words & body_words:
                aligned += 1
        heading_alignment_score = aligned / len(h2_sections) if h2_sections else 1.0

        # Keyword stuffing: any single word > 5% of total words
        all_content_words = tokenize(plain, remove_stop_words=True, stop_words=stop_words)
        total_words = len(all_content_words)
        keyword_stuffing_detected = False
        if total_words > 0:
            freq: dict = {}
            for w in all_content_words:
                freq[w] = freq.get(w, 0) + 1
            for count in freq.values():
                if count / total_words > 0.05:
                    keyword_stuffing_detected = True
                    break

        return {
            'title_in_h1': title_in_h1,
            'title_in_intro': title_in_intro,
            'title_in_intro_word_position': title_in_intro_word_position,
            'heading_alignment_score': round(heading_alignment_score, 2),
            'keyword_stuffing_detected': keyword_stuffing_detected,
        }
    except Exception:
        return {
            'title_in_h1': False,
            'title_in_intro': False,
            'title_in_intro_word_position': None,
            'heading_alignment_score': 0.0,
            'keyword_stuffing_detected': False,
        }


def analyse_eeat(markdown: str, profile: dict = None) -> dict:
    """Detects E-E-A-T proxy signals."""
    if profile is None:
        profile = LANGUAGE_PROFILES['en']
    try:
        plain = strip_markdown(markdown)

        # First-person language
        first_person_matches = re.findall(profile['first_person_pattern'], plain)
        first_person_count = len(first_person_matches)
        first_person_present = first_person_count > 0

        # Statistics: numbers with %, $, or measurement units
        stats_pattern = r'\d+(?:\.\d+)?\s*(?:%|percent|\$|ms|kb|mb|gb|px|em|rem|fps|rpm|mph|kg|lb|oz|cm|mm|km|mi|ft|in)(?=\W|$)'
        statistics_count = len(re.findall(stats_pattern, plain, re.IGNORECASE))

        # Citations
        citation_count = sum(
            len(re.findall(p, plain, re.IGNORECASE))
            for p in profile['citation_patterns']
        )

        # Author mention: two capitalised words in sequence mid-sentence
        author_pattern = r'(?<![.!?]\s)(?<!\n)([A-Z][a-z]+\s+[A-Z][a-z]+)'
        author_matches = re.findall(author_pattern, plain)
        author_mention_detected = len(author_matches) > 0

        # Dates
        date_patterns = [
            r'\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\b',
            r'\b\d{1,2}/\d{1,2}/\d{4}\b',
        ]
        dates_found = []
        for p in date_patterns:
            dates_found.extend(re.findall(p, plain))
        # Also get years in range 1990-2030
        years = re.findall(r'\b((?:19[9][0-9]|20[0-2][0-9]|2030))\b', plain)
        most_recent_date = None
        if years:
            most_recent_date = str(max(int(y) for y in years))
        if dates_found:
            most_recent_date = most_recent_date or dates_found[-1]

        # Time-sensitive without date
        time_sensitive_phrases = profile['time_sensitive_words']
        time_sensitive_without_date = False
        words_list = plain.split()
        for i, word in enumerate(words_list):
            if word.lower().rstrip('.,!?') in time_sensitive_phrases:
                window_start = max(0, i - 50)
                window_end = min(len(words_list), i + 50)
                window = ' '.join(words_list[window_start:window_end])
                has_date_nearby = bool(re.search(r'\b\d{4}\b', window))
                if not has_date_nearby:
                    time_sensitive_without_date = True
                    break

        # Composite
        signals = {
            'first_person': first_person_present,
            'statistics': statistics_count > 0,
            'citations': citation_count > 0,
            'author': author_mention_detected,
            'date': bool(most_recent_date),
        }
        eeat_signals_count = sum(1 for v in signals.values() if v)

        if eeat_signals_count <= 1:
            eeat_label = 'weak'
        elif eeat_signals_count <= 3:
            eeat_label = 'moderate'
        else:
            eeat_label = 'strong'

        return {
            'first_person_count': first_person_count,
            'first_person_present': first_person_present,
            'statistics_count': statistics_count,
            'citation_patterns': citation_count,
            'author_mention_detected': author_mention_detected,
            'dates_found': dates_found,
            'most_recent_date': most_recent_date,
            'time_sensitive_without_date': time_sensitive_without_date,
            'eeat_signals_present': signals,
            'eeat_signals_count': eeat_signals_count,
            'eeat_label': eeat_label,
        }
    except Exception:
        return {
            'first_person_count': 0,
            'first_person_present': False,
            'statistics_count': 0,
            'citation_patterns': 0,
            'author_mention_detected': False,
            'dates_found': [],
            'most_recent_date': None,
            'time_sensitive_without_date': False,
            'eeat_signals_present': {'first_person': False, 'statistics': False, 'citations': False, 'author': False, 'date': False},
            'eeat_signals_count': 0,
            'eeat_label': 'weak',
        }


def analyse_freshness(markdown: str, meta: dict = {}, profile: dict = None) -> dict:
    """Detects content age signals."""
    if profile is None:
        profile = LANGUAGE_PROFILES['en']
    try:
        current_year = datetime.now().year
        meta_date_year = None

        # Prefer explicit meta dates (most reliable signal)
        for key in ('modified_time', 'published_time'):
            val = meta.get(key)
            if val:
                try:
                    # ISO 8601: "2024-03-15T10:00:00Z" or "2024-03-15"
                    meta_date_year = int(str(val)[:4])
                    break
                except (ValueError, TypeError):
                    pass

        plain = strip_markdown(markdown)

        if meta_date_year:
            most_recent_year = meta_date_year
            years_mentioned = [meta_date_year]
        else:
            # Fallback: scan text for year patterns
            years_found = re.findall(r'\b(1990|199[1-9]|200[0-9]|201[0-9]|202[0-9]|2030)\b', plain)
            years_mentioned = sorted(set(int(y) for y in years_found))
            most_recent_year = max(years_mentioned) if years_mentioned else None

        if most_recent_year is None:
            freshness_status = 'undated'
        elif most_recent_year == current_year:
            freshness_status = 'current'
        elif most_recent_year == current_year - 1:
            freshness_status = 'recent'
        elif most_recent_year == current_year - 2:
            freshness_status = 'stale'
        else:
            freshness_status = 'very_stale'

        time_sensitive_phrases_list = profile['time_sensitive_words']
        time_sensitive_phrases_found = []
        for phrase in time_sensitive_phrases_list:
            if re.search(r'\b' + re.escape(phrase) + r'\b', plain, re.IGNORECASE):
                time_sensitive_phrases_found.append(phrase)

        time_sensitive_without_date = bool(time_sensitive_phrases_found) and most_recent_year is None

        return {
            'years_mentioned': years_mentioned,
            'most_recent_year': most_recent_year,
            'current_year': current_year,
            'freshness_status': freshness_status,
            'time_sensitive_phrases_found': time_sensitive_phrases_found,
            'time_sensitive_without_date': time_sensitive_without_date,
        }
    except Exception:
        return {
            'years_mentioned': [],
            'most_recent_year': None,
            'current_year': datetime.now().year,
            'freshness_status': 'undated',
            'time_sensitive_phrases_found': [],
            'time_sensitive_without_date': False,
        }


def analyse_snippet_eligibility(markdown: str) -> dict:
    """Detects content structured to win Google featured snippets."""
    try:
        plain = strip_markdown(markdown)
        headings = extract_headings(markdown)

        # Paragraph snippet: definition-style opening sentence
        definition_paragraph_present = False
        paragraphs = [p.strip() for p in re.split(r'\n\n+', plain) if p.strip()]
        if paragraphs:
            first_para = paragraphs[0]
            first_sentence_match = re.match(r'^(.{0,300}[.!?])', first_para)
            if first_sentence_match:
                first_sentence = first_sentence_match.group(1)
                if re.search(r'\b\w+\s+(?:is|are|refers? to|means?|describes?)\b', first_sentence, re.IGNORECASE):
                    definition_paragraph_present = True

        # List snippet: ordered/unordered list under a heading
        list_under_heading_pattern = re.compile(
            r'^(#{1,6})\s+(.+)\n((?:(?:[-*+]|\d+\.)\s+.+\n?)+)',
            re.MULTILINE
        )
        lists_under_headings = []
        for m in list_under_heading_pattern.finditer(markdown):
            heading_text = m.group(2).strip()
            list_block = m.group(3)
            items = re.findall(r'^(?:[-*+]|\d+\.)\s+(.+)', list_block, re.MULTILINE)
            item_count = len(items)
            if item_count == 0:
                continue
            avg_item_length = sum(len(it) for it in items) / item_count
            list_type = 'ordered' if re.match(r'^\d+\.', list_block.strip()) else 'unordered'
            eligible = item_count >= 3 and 40 <= avg_item_length <= 80
            lists_under_headings.append({
                'heading': heading_text,
                'list_type': list_type,
                'item_count': item_count,
                'avg_item_length': round(avg_item_length, 1),
                'snippet_eligible': eligible,
            })
        list_snippet_eligible = any(l['snippet_eligible'] for l in lists_under_headings)

        # FAQ/Q&A pattern: heading ending in "?" + paragraph
        qa_pairs_found = []
        lines = markdown.split('\n')
        i = 0
        while i < len(lines):
            m = re.match(r'^(#{1,6})\s+(.+\?)\s*$', lines[i].strip())
            if m:
                question = m.group(2).strip()
                answer_lines = []
                j = i + 1
                while j < len(lines) and not re.match(r'^#{1,6}\s+', lines[j].strip()):
                    if lines[j].strip():
                        answer_lines.append(lines[j].strip())
                    j += 1
                if answer_lines:
                    answer_full = ' '.join(answer_lines)
                    qa_pairs_found.append({
                        'question': question,
                        'answer_preview': answer_full[:160],
                        'answer_length': len(answer_full),
                    })
            i += 1
        qa_pattern_count = len(qa_pairs_found)
        faq_schema_recommended = qa_pattern_count >= 2

        # Table snippet
        table_pattern = re.compile(r'^\|.+\|\s*\n\|[-:| ]+\|\s*\n(?:\|.+\|\s*\n)+', re.MULTILINE)
        tables = table_pattern.findall(markdown)
        tables_with_headers = len(tables)
        table_snippet_eligible = tables_with_headers > 0

        # Summary
        snippet_types_eligible = []
        if definition_paragraph_present:
            snippet_types_eligible.append('paragraph')
        if list_snippet_eligible:
            snippet_types_eligible.append('list')
        if faq_schema_recommended:
            snippet_types_eligible.append('faq')
        if table_snippet_eligible:
            snippet_types_eligible.append('table')

        snippet_eligible = bool(snippet_types_eligible)

        return {
            'definition_paragraph_present': definition_paragraph_present,
            'list_snippet_eligible': list_snippet_eligible,
            'lists_under_headings': lists_under_headings,
            'qa_pairs_found': qa_pairs_found,
            'qa_pattern_count': qa_pattern_count,
            'faq_schema_recommended': faq_schema_recommended,
            'tables_with_headers': tables_with_headers,
            'table_snippet_eligible': table_snippet_eligible,
            'snippet_types_eligible': snippet_types_eligible,
            'snippet_eligible': snippet_eligible,
        }
    except Exception:
        return {
            'definition_paragraph_present': False,
            'list_snippet_eligible': False,
            'lists_under_headings': [],
            'qa_pairs_found': [],
            'qa_pattern_count': 0,
            'faq_schema_recommended': False,
            'tables_with_headers': 0,
            'table_snippet_eligible': False,
            'snippet_types_eligible': [],
            'snippet_eligible': False,
        }


def analyse_thin_content(markdown: str, profile: dict = None) -> dict:
    """Detects low-effort content signals."""
    if profile is None:
        profile = LANGUAGE_PROFILES['en']
    try:
        plain = strip_markdown(markdown).lower()

        # Boilerplate detection
        boilerplate_patterns = profile['boilerplate_patterns']
        boilerplate_detected = [p for p in boilerplate_patterns if p in plain]
        boilerplate_present = bool(boilerplate_detected)

        # Repetition: sentences with >80% word overlap
        sentences = re.split(r'[.!?]+', plain)
        sentences = [s.strip() for s in sentences if len(s.strip()) > 20]
        duplicate_sentences_found = 0
        for i in range(len(sentences)):
            for j in range(i + 1, len(sentences)):
                words_i = set(re.findall(r'\b\w+\b', sentences[i]))
                words_j = set(re.findall(r'\b\w+\b', sentences[j]))
                if not words_i or not words_j:
                    continue
                overlap = len(words_i & words_j) / max(len(words_i), len(words_j))
                if overlap > 0.8:
                    duplicate_sentences_found += 1
        high_repetition = duplicate_sentences_found > 3

        # Skeleton page: heading_count > paragraph_count
        headings = extract_headings(markdown)
        heading_count = len(headings)
        paragraphs = [p.strip() for p in re.split(r'\n\n+', strip_markdown(markdown)) if p.strip()]
        paragraph_count = len(paragraphs)
        heading_to_content_ratio = heading_count / max(paragraph_count, 1)
        skeleton_page_detected = heading_to_content_ratio > 0.7

        # Duplicate paragraph detection — normalize (strip, lowercase, collapse whitespace)
        # then count exact duplicates. Separate signal from duplicate_sentences.
        seen_paragraphs: dict = {}
        for p in paragraphs:
            norm = re.sub(r'\s+', ' ', p.strip().lower())
            if len(norm) < 20:
                continue
            seen_paragraphs[norm] = seen_paragraphs.get(norm, 0) + 1
        duplicate_paragraphs_found = sum(c - 1 for c in seen_paragraphs.values() if c > 1)

        # Composite
        word_count = len(re.findall(r'\b\w+\b', plain))
        signals = {
            'word_count_thin': word_count < 100,
            'boilerplate': boilerplate_present,
            'repetition': high_repetition,
            'skeleton': skeleton_page_detected,
        }
        risk_count = sum(1 for v in signals.values() if v)

        if risk_count == 0:
            thin_content_risk = 'none'
        elif risk_count == 1:
            thin_content_risk = 'low'
        elif risk_count == 2:
            thin_content_risk = 'medium'
        else:
            thin_content_risk = 'high'

        return {
            'boilerplate_detected': boilerplate_detected,
            'boilerplate_present': boilerplate_present,
            'duplicate_sentences_found': duplicate_sentences_found,
            'duplicate_paragraphs_found': duplicate_paragraphs_found,
            'high_repetition': high_repetition,
            'heading_count': heading_count,
            'heading_to_content_ratio': round(heading_to_content_ratio, 2),
            'skeleton_page_detected': skeleton_page_detected,
            'thin_content_signals': signals,
            'thin_content_risk': thin_content_risk,
        }
    except Exception:
        return {
            'boilerplate_detected': [],
            'boilerplate_present': False,
            'duplicate_sentences_found': 0,
            'duplicate_paragraphs_found': 0,
            'high_repetition': False,
            'heading_count': 0,
            'heading_to_content_ratio': 0.0,
            'skeleton_page_detected': False,
            'thin_content_signals': {'word_count_thin': False, 'boilerplate': False, 'repetition': False, 'skeleton': False},
            'thin_content_risk': 'none',
        }


def analyse_anchor_quality(markdown: str) -> dict:
    """Classifies link anchor text quality."""
    try:
        link_pattern = re.compile(r'\[([^\]]*)\]\(([^)]*)\)')
        matches = link_pattern.findall(markdown)

        anchor_quality_map = []
        descriptive_count = 0
        generic_count = 0
        naked_url_count = 0
        empty_count = 0
        partial_count = 0

        for anchor_text, url in matches:
            anchor_lower = anchor_text.strip().lower()
            word_count = len(anchor_text.strip().split()) if anchor_text.strip() else 0

            if not anchor_text.strip():
                classification = 'empty'
                empty_count += 1
            elif anchor_lower.startswith('http://') or anchor_lower.startswith('https://'):
                classification = 'naked_url'
                naked_url_count += 1
            elif anchor_lower in GENERIC_ANCHORS:
                classification = 'generic'
                generic_count += 1
            else:
                meaningful_words = tokenize(anchor_text, remove_stop_words=True)
                if len(meaningful_words) >= 2:
                    classification = 'descriptive'
                    descriptive_count += 1
                elif word_count >= 2:
                    classification = 'descriptive'
                    descriptive_count += 1
                else:
                    # Bug fix 1a: single non-generic word is 'partial', not 'descriptive'
                    classification = 'partial'
                    partial_count += 1

            anchor_quality_map.append({
                'text': anchor_text,
                'url': url,
                'classification': classification,
                'word_count': word_count,
            })

        total_internal_links = len(anchor_quality_map)
        descriptive_ratio = descriptive_count / total_internal_links if total_internal_links > 0 else 1.0

        if descriptive_ratio > 0.8:
            anchor_quality_score = 'excellent'
        elif descriptive_ratio >= 0.6:
            anchor_quality_score = 'good'
        elif descriptive_ratio >= 0.4:
            anchor_quality_score = 'fair'
        else:
            anchor_quality_score = 'poor'

        return {
            'anchor_quality_map': anchor_quality_map,
            'total_internal_links': total_internal_links,
            'descriptive_count': descriptive_count,
            'partial_count': partial_count,
            'generic_count': generic_count,
            'naked_url_count': naked_url_count,
            'empty_count': empty_count,
            'descriptive_ratio': round(descriptive_ratio, 2),
            'anchor_quality_score': anchor_quality_score,
        }
    except Exception:
        return {
            'anchor_quality_map': [],
            'total_internal_links': 0,
            'descriptive_count': 0,
            'partial_count': 0,
            'generic_count': 0,
            'naked_url_count': 0,
            'empty_count': 0,
            'descriptive_ratio': 1.0,
            'anchor_quality_score': 'excellent',
        }


def analyse_readability(markdown: str, profile: dict = None) -> dict:
    """Compute readability score using the formula from the language profile."""
    if profile is None:
        profile = LANGUAGE_PROFILES['en']
    try:
        plain = strip_markdown(markdown)

        # Sentences: split on .!? — filter out empties and whitespace fragments
        raw_sentences = re.split(r'[.!?]+', plain)
        sentences = [s.strip() for s in raw_sentences if len(s.strip().split()) >= 3]
        sentence_count = len(sentences)

        if sentence_count == 0:
            return {
                'avg_words_per_sentence': 0,
                'long_sentences_count': 0,
                'short_sentences_count': 0,
                'flesch_reading_ease': 0,
                'gunning_fog_index': 0,
                'reading_level': 'unknown',
                'sentence_count': 0,
                'sentence_length_distribution': {'min': 0, 'max': 0, 'p50': 0, 'p90': 0},
            }

        # Word counts per sentence
        sentence_word_counts = [len(re.findall(r'\b[a-zA-Z]{3,}\b', s)) for s in sentences]
        avg_words_per_sentence = sum(sentence_word_counts) / sentence_count

        long_sentences = sum(1 for c in sentence_word_counts if c > 30)
        short_sentences = sum(1 for c in sentence_word_counts if c < 5)

        # All words for syllable count
        words = re.findall(r'\b[a-zA-Z]+\b', plain)
        total_words = len(words)

        if total_words == 0:
            return {
                'avg_words_per_sentence': 0,
                'long_sentences_count': 0,
                'short_sentences_count': 0,
                'flesch_reading_ease': 0,
                'gunning_fog_index': 0,
                'reading_level': 'unknown',
                'sentence_count': 0,
                'sentence_length_distribution': {'min': 0, 'max': 0, 'p50': 0, 'p90': 0},
            }

        total_syllables = sum(_count_syllables(w) for w in words)
        asl = total_words / sentence_count  # average sentence length

        formula = profile.get('readability_formula', 'flesch')

        if formula == 'wiener':
            # Wiener Sachtextformel (German) — lower = easier, school grade level
            pct_3syl = sum(1 for w in words if _count_syllables(w) >= 3 and not w[0].isupper()) / total_words * 100
            pct_sent = sentence_count / total_words * 100
            wiener = 0.2656 * asl + 0.2744 * pct_3syl - 1.693 * pct_sent - 1.1628
            wiener = round(wiener, 1)
            flesch_reading_ease = wiener  # store under same key for consistency
            # Map grade level to reading labels (lower grade = easier)
            if wiener <= 8:
                reading_level = 'easy'
            elif wiener <= 11:
                reading_level = 'moderate'
            elif wiener <= 14:
                reading_level = 'difficult'
            else:
                reading_level = 'academic'
        elif formula == 'fernandez_huerta':
            # Fernandez Huerta (Spanish) — higher = easier, 0-100
            syl_per_100 = total_syllables / total_words * 100
            fh = 206.84 - 0.60 * syl_per_100 - 1.02 * asl
            fh = round(max(0.0, min(100.0, fh)), 1)
            flesch_reading_ease = fh
            if fh >= 70:
                reading_level = 'easy'
            elif fh >= 50:
                reading_level = 'moderate'
            elif fh >= 30:
                reading_level = 'difficult'
            else:
                reading_level = 'academic'
        else:
            # Flesch Reading Ease (English) — higher = easier, 0-100
            flesch = 206.835 - 1.015 * asl - 84.6 * (total_syllables / total_words)
            flesch = round(max(0.0, min(100.0, flesch)), 1)
            flesch_reading_ease = flesch
            if flesch >= 70:
                reading_level = 'easy'
            elif flesch >= 50:
                reading_level = 'moderate'
            elif flesch >= 30:
                reading_level = 'difficult'
            else:
                reading_level = 'academic'

        # Gunning Fog Index — bug fix 1b: exclude proper nouns (capital first letter)
        complex_words = sum(1 for w in words if _count_syllables(w) >= 3 and not w[0].isupper())
        fog = 0.4 * (asl + 100 * (complex_words / total_words))
        fog = round(fog, 1)

        return {
            'avg_words_per_sentence': round(avg_words_per_sentence, 1),
            'long_sentences_count': long_sentences,
            'short_sentences_count': short_sentences,
            'flesch_reading_ease': flesch_reading_ease,
            'gunning_fog_index': fog,
            'reading_level': reading_level,
            'sentence_count': sentence_count,
            'sentence_length_distribution': _percentiles(sentence_word_counts),
        }
    except Exception:
        return {
            'avg_words_per_sentence': 0,
            'long_sentences_count': 0,
            'short_sentences_count': 0,
            'flesch_reading_ease': 0,
            'gunning_fog_index': 0,
            'reading_level': 'unknown',
            'sentence_count': 0,
            'sentence_length_distribution': {'min': 0, 'max': 0, 'p50': 0, 'p90': 0},
        }


def analyse_cta(markdown: str, profile: dict = None) -> dict:
    """Detect call-to-action patterns in content."""
    if profile is None:
        profile = LANGUAGE_PROFILES['en']
    try:
        plain = strip_markdown(markdown).lower()
        cta_patterns = profile['cta_patterns']
        found_ctas = []
        for pattern in cta_patterns:
            if re.search(r'\b' + re.escape(pattern) + r'\b', plain):
                found_ctas.append(pattern)

        return {
            'cta_present': len(found_ctas) > 0,
            'cta_patterns_found': found_ctas,
            'cta_count': len(found_ctas),
        }
    except Exception:
        return {
            'cta_present': False,
            'cta_patterns_found': [],
            'cta_count': 0,
        }


def analyse_toc(markdown: str) -> dict:
    """Detect a table of contents in the first 20% of the page."""
    try:
        lines = markdown.split('\n')
        first_20pct = '\n'.join(lines[:max(1, len(lines) // 5)])

        # List items that are anchor links: - [text](#anchor)
        anchor_items = re.findall(r'^(?:[-*+]|\d+\.)\s+\[.+\]\(#\S+\)', first_20pct, re.MULTILINE)
        toc_present = len(anchor_items) >= 3

        # Also detect plain anchor links (from HTML nav elements converted to markdown)
        if not toc_present:
            plain_anchors = re.findall(r'\[.+?\]\(#\S+?\)', first_20pct)
            if len(plain_anchors) >= 3:
                toc_present = True
                anchor_items = plain_anchors

        plain_words = len(re.findall(r'\b\w+\b', strip_markdown(markdown)))

        return {
            'toc_present': toc_present,
            'toc_entry_count': len(anchor_items),
            'toc_recommended': plain_words > 1500 and not toc_present,
        }
    except Exception:
        return {
            'toc_present': False,
            'toc_entry_count': 0,
            'toc_recommended': False,
        }


def analyse_author_bio(markdown: str, profile: dict = None) -> dict:
    """Detect a dedicated author bio section."""
    if profile is None:
        profile = LANGUAGE_PROFILES['en']
    try:
        plain = strip_markdown(markdown)
        found_pattern = None
        for pattern in profile['author_bio_patterns']:
            if re.search(pattern, plain, re.IGNORECASE):
                found_pattern = pattern
                break
        return {
            'author_bio_present': found_pattern is not None,
            'detected_pattern': found_pattern,
        }
    except Exception:
        return {
            'author_bio_present': False,
            'detected_pattern': None,
        }


def analyse_passive_voice(text: str) -> dict:
    """Detect passive voice constructions."""
    try:
        plain = strip_markdown(text)
        pattern = r'\b(was|were|is|are|been|being|be)\s+\w+ed\b'
        matches = re.findall(pattern, plain, re.IGNORECASE)
        passive_voice_count = len(matches)
        words = re.findall(r'\b\w+\b', plain)
        total_words = len(words)
        passive_voice_ratio = round(passive_voice_count / total_words, 4) if total_words > 0 else 0.0
        return {
            'passive_voice_count': passive_voice_count,
            'passive_voice_ratio': passive_voice_ratio,
        }
    except Exception:
        return {
            'passive_voice_count': 0,
            'passive_voice_ratio': 0.0,
        }


def analyse_link_types(text: str, meta: dict) -> dict:
    """Classify links as internal vs external."""
    try:
        domain = meta.get('domain', '')
        link_pattern = re.compile(r'\[([^\]]*)\]\(([^)]*)\)')
        matches = link_pattern.findall(text)

        internal_links = 0
        external_links = 0
        internal_urls = []
        external_urls = []

        for anchor_text, url in matches:
            url_stripped = url.strip()
            if url_stripped.startswith('/') or (domain and domain in url_stripped):
                internal_links += 1
                internal_urls.append(url_stripped)
            elif url_stripped.startswith('http://') or url_stripped.startswith('https://'):
                external_links += 1
                external_urls.append(url_stripped)
            else:
                # Relative links treated as internal
                internal_links += 1
                internal_urls.append(url_stripped)

        return {
            'internal_links': internal_links,
            'external_links': external_links,
            'internal_urls': internal_urls,
            'external_urls': external_urls,
        }
    except Exception:
        return {
            'internal_links': 0,
            'external_links': 0,
            'internal_urls': [],
            'external_urls': [],
        }


def analyse_image_alt_text(text: str) -> dict:
    """Analyse image alt text coverage."""
    try:
        image_pattern = re.compile(r'!\[([^\]]*)\]\([^)]*\)')
        matches = image_pattern.findall(text)
        images_total = len(matches)
        images_missing_alt = sum(1 for alt in matches if not alt.strip())
        alt_coverage_ratio = round((images_total - images_missing_alt) / images_total, 4) if images_total > 0 else 1.0
        return {
            'images_total': images_total,
            'images_missing_alt': images_missing_alt,
            'alt_coverage_ratio': alt_coverage_ratio,
        }
    except Exception:
        return {
            'images_total': 0,
            'images_missing_alt': 0,
            'alt_coverage_ratio': 1.0,
        }


def analyse_heading_hierarchy(text: str) -> dict:
    """Check for heading level skips in the document."""
    try:
        headings = extract_headings(text)
        violations = []
        hierarchy_valid = True

        for i in range(1, len(headings)):
            prev_level = headings[i - 1]['level']
            curr_level = headings[i]['level']
            # A skip is when the level jumps by more than 1 downward
            if curr_level > prev_level + 1:
                violations.append({
                    'from': prev_level,
                    'to': curr_level,
                    'heading': headings[i]['text'],
                })
                hierarchy_valid = False

        return {
            'hierarchy_valid': hierarchy_valid,
            'violations': violations,
        }
    except Exception:
        return {
            'hierarchy_valid': True,
            'violations': [],
        }


def analyse_transition_words(text: str, profile: dict = None) -> dict:
    """Count transition words relative to total word count."""
    if profile is None:
        profile = LANGUAGE_PROFILES['en']
    try:
        plain = strip_markdown(text).lower()
        transition_words = profile.get('transition_words', [])
        total_words = len(re.findall(r'\b\w+\b', plain))

        transition_word_count = 0
        for word in transition_words:
            transition_word_count += len(re.findall(r'\b' + re.escape(word) + r'\b', plain))

        transition_word_ratio = round(transition_word_count / total_words, 4) if total_words > 0 else 0.0

        if transition_word_ratio < 0.01:
            transition_label = 'low'
        elif transition_word_ratio < 0.03:
            transition_label = 'moderate'
        else:
            transition_label = 'good'

        return {
            'transition_word_count': transition_word_count,
            'transition_word_ratio': transition_word_ratio,
            'transition_label': transition_label,
        }
    except Exception:
        return {
            'transition_word_count': 0,
            'transition_word_ratio': 0.0,
            'transition_label': 'low',
        }


def analyse_meta_description(meta: dict) -> dict:
    """Analyse the meta description length and status."""
    try:
        description = meta.get('meta_description') or meta.get('description')
        if not description:
            return {
                'meta_description_length': None,
                'meta_description_status': 'missing',
            }
        length = len(description)
        if length < 120:
            status = 'too_short'
        elif length <= 160:
            status = 'optimal'
        else:
            status = 'too_long'
        return {
            'meta_description_length': length,
            'meta_description_status': status,
        }
    except Exception:
        return {
            'meta_description_length': None,
            'meta_description_status': 'missing',
        }


def analyse_top_keywords(text: str, profile: dict = None) -> dict:
    """Return the top 10 most frequent non-stop-word tokens."""
    if profile is None:
        profile = LANGUAGE_PROFILES['en']
    try:
        plain = strip_markdown(text)
        stop_words = profile['stop_words']
        words = tokenize(plain, remove_stop_words=True, stop_words=stop_words)
        total_words = len(words)

        freq: dict = {}
        for w in words:
            freq[w] = freq.get(w, 0) + 1

        sorted_words = sorted(freq.items(), key=lambda x: x[1], reverse=True)[:10]
        top_keywords = [
            {
                'word': word,
                'count': count,
                'percentage': round(count / total_words * 100, 2) if total_words > 0 else 0.0,
            }
            for word, count in sorted_words
        ]

        return top_keywords
    except Exception:
        return []


def analyse_first_paragraph(markdown: str, title: str = '') -> dict:
    """Analyse the opening paragraph: word count, title keyword presence, hook heuristic.

    Skips leading heading lines so the "first paragraph" is the first real
    prose block, not the document title.
    """
    try:
        # Remove heading lines before paragraph-splitting so headings are not
        # treated as standalone paragraphs by strip_markdown.
        no_headings_md = re.sub(r'^\s*#{1,6}\s+.*$', '', markdown, flags=re.MULTILINE)
        plain = strip_markdown(no_headings_md)
        paragraphs = [p.strip() for p in re.split(r'\n\n+', plain) if p.strip()]
        if not paragraphs:
            return {
                'word_count': 0,
                'contains_title_keyword': False,
                'has_hook': False,
            }

        first = paragraphs[0]
        word_count = len(re.findall(r'\b\w+\b', first))

        # Title keyword overlap — any title term (len >= 3, not stop-style) in first paragraph.
        contains_title_keyword = False
        if title:
            title_terms = set(w for w in re.findall(r'\b[a-zA-Z]{3,}\b', title.lower()))
            first_words = set(w for w in re.findall(r'\b[a-zA-Z]{3,}\b', first.lower()))
            contains_title_keyword = bool(title_terms & first_words)

        # Hook heuristics: starts with a question, a quote, or a bold claim.
        stripped = first.lstrip()
        starts_with_question = '?' in stripped[:200]
        starts_with_quote = stripped.startswith(('"', '“', "'", '‘', '«'))
        # "Bold claim" ≈ an initial sentence containing a superlative / absolute word.
        bold_claim_pattern = r'^[^.!?]{0,200}\b(never|always|every|most|best|worst|only|must|will|cannot|impossible|definitely|absolutely|guaranteed)\b'
        has_bold_claim = bool(re.search(bold_claim_pattern, stripped, re.IGNORECASE))
        has_hook = starts_with_question or starts_with_quote or has_bold_claim

        return {
            'word_count': word_count,
            'contains_title_keyword': contains_title_keyword,
            'has_hook': has_hook,
        }
    except Exception:
        return {
            'word_count': 0,
            'contains_title_keyword': False,
            'has_hook': False,
        }


def analyse_top_phrases(text: str, profile: dict = None) -> dict:
    """Extract top repeating 2-word and 3-word phrases (bigrams + trigrams).
    Keeps stop words for natural phrases but filters pure-stopword n-grams."""
    if profile is None:
        profile = LANGUAGE_PROFILES['en']
    try:
        plain = strip_markdown(text)
        stop_words = profile['stop_words']
        # Keep stop words for natural phrases
        words = tokenize(plain, remove_stop_words=False)
        total_bigrams = max(len(words) - 1, 1)
        total_trigrams = max(len(words) - 2, 1)

        def _count_ngrams(n: int) -> list:
            ngrams = extract_ngrams(words, n)
            freq: dict = {}
            for ng in ngrams:
                freq[ng] = freq.get(ng, 0) + 1

            # Filter: must appear ≥2 times, not all stop words,
            # at least one content word (non-stop-word) of 3+ chars
            filtered = []
            for phrase, count in freq.items():
                if count < 2:
                    continue
                parts = phrase.split()
                has_content = any(w not in stop_words and len(w) >= 3 for w in parts)
                if not has_content:
                    continue
                filtered.append((phrase, count))

            filtered.sort(key=lambda x: x[1], reverse=True)
            total = total_bigrams if n == 2 else total_trigrams
            return [
                {
                    'phrase': phrase,
                    'count': count,
                    'percentage': round(count / total * 100, 2) if total > 0 else 0.0,
                }
                for phrase, count in filtered[:10]
            ]

        return {
            'bigrams': _count_ngrams(2),
            'trigrams': _count_ngrams(3),
        }
    except Exception:
        return {'bigrams': [], 'trigrams': []}
