#!/usr/bin/env python3
"""
content_extract.py — lean, language-neutral content extraction.

Reads clean Markdown from stdin, optional meta JSON in argv[1],
emits a single JSON object on stdout.

Philosophy: compute only objective numbers. No EEAT, no passive voice,
no tone, no keyword stuffing, no readability scores, no "quality". Those
are LLM jobs. We provide the cleaned body, every structural count, the
heading outline, link inventory, image inventory. The caller pipes this
to an AI for subjective judgment.

Always emits valid JSON (wraps main in try/except).
"""

import json
import re
import sys
from datetime import datetime
from urllib.parse import urlparse

sys.setrecursionlimit(2000)

# Only infrastructure imports — no heuristic analyzers.
from analysis import LANGUAGE_PROFILES, detect_language, strip_markdown
from analysis.analysers import _percentiles


CJK_LANGS = {'ja', 'zh', 'ko'}
CURRENT_YEAR = datetime.now().year


# ---------------------------------------------------------------------------
# Tokenisation helpers (language-aware, no per-language wordlists)
# ---------------------------------------------------------------------------


def _is_cjk(lang: str) -> bool:
    return lang in CJK_LANGS


def _count_words(text: str, lang: str) -> int:
    """
    Language-aware word count.
    - CJK: characters (excluding whitespace) / 1.5, a conventional approximation.
    - Everything else: whitespace tokenisation via \\b\\w+\\b.
    """
    if not text:
        return 0
    if _is_cjk(lang):
        chars = len(re.sub(r'\s+', '', text))
        return int(round(chars / 1.5))
    return len(re.findall(r'\b\w+\b', text, flags=re.UNICODE))


def _split_sentences(text: str, lang: str) -> list:
    """
    Language-aware sentence splitter.
    - CJK: split on 。！？ (full-width) and ASCII .!?
    - Others: split on [.!?]+ followed by whitespace.
    """
    if not text:
        return []
    if _is_cjk(lang):
        parts = re.split(r'[。！？.!?]+', text)
    else:
        parts = re.split(r'[.!?]+(?:\s+|$)', text)
    return [p.strip() for p in parts if p and p.strip()]


def _tokenise_for_diversity(text: str, lang: str) -> list:
    """Return lowercased tokens for lexical diversity calculation."""
    if _is_cjk(lang):
        # Character-level for CJK.
        return [c for c in re.sub(r'\s+', '', text) if c]
    return [w.lower() for w in re.findall(r'\b\w+\b', text, flags=re.UNICODE)]


# ---------------------------------------------------------------------------
# Markdown structure extraction
# ---------------------------------------------------------------------------


HEADING_RE = re.compile(r'^(#{1,6})\s+(.*?)\s*#*\s*$')
IMAGE_RE = re.compile(r'!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)')
LINK_RE = re.compile(r'(?<!!)\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)')
NAKED_URL_RE = re.compile(r'(?<![(\]])\bhttps?://[^\s<>)\]]+', re.IGNORECASE)
FENCE_RE = re.compile(r'```')
INLINE_CODE_RE = re.compile(r'`[^`\n]+`')
TABLE_ROW_RE = re.compile(r'^\s*\|.+\|\s*$')
TABLE_SEP_RE = re.compile(r'^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$')
ORDERED_LIST_RE = re.compile(r'^\s*\d+\.\s+')
UNORDERED_LIST_RE = re.compile(r'^\s*[-*+]\s+')
BLOCKQUOTE_RE = re.compile(r'^\s*>\s?')
YEAR_RE = re.compile(r'\b(19\d{2}|20\d{2}|21\d{2})\b')
PERCENT_RE = re.compile(r'\d+(?:\.\d+)?%')


def _extract_headings(markdown: str) -> list:
    """Return a flat list of {level, text} in document order. Skips fenced code."""
    headings = []
    in_fence = False
    for line in markdown.split('\n'):
        if FENCE_RE.match(line.strip()):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        m = HEADING_RE.match(line)
        if m:
            level = len(m.group(1))
            text = m.group(2).strip()
            headings.append({'level': level, 'text': text})
    return headings


def _build_outline(headings: list) -> list:
    """Walk headings in order and build a nested tree."""
    root = []
    stack = []  # list of (level, node)
    for h in headings:
        node = {'level': h['level'], 'text': h['text'], 'children': []}
        while stack and stack[-1][0] >= h['level']:
            stack.pop()
        if stack:
            stack[-1][1]['children'].append(node)
        else:
            root.append(node)
        stack.append((h['level'], node))
    return root


def _validate_hierarchy(headings: list) -> tuple:
    """Return (is_valid, skipped_levels_list)."""
    skipped = []
    prev_level = 0
    for h in headings:
        lvl = h['level']
        if prev_level and lvl > prev_level + 1:
            skipped.append(f'H{prev_level}→H{lvl}')
        prev_level = lvl
    return (len(skipped) == 0, skipped)


def _extract_structure(markdown: str) -> dict:
    """Count lists, tables, code blocks, blockquotes."""
    lines = markdown.split('\n')

    # Code blocks (fenced)
    code_blocks = 0
    in_fence = False
    for line in lines:
        if FENCE_RE.match(line.strip()):
            if not in_fence:
                code_blocks += 1
                in_fence = True
            else:
                in_fence = False

    # Inline code
    inline_code = 0
    in_fence = False
    for line in lines:
        if FENCE_RE.match(line.strip()):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        inline_code += len(INLINE_CODE_RE.findall(line))

    # Blockquotes — count contiguous blocks
    blockquotes = 0
    in_quote = False
    in_fence = False
    for line in lines:
        if FENCE_RE.match(line.strip()):
            in_fence = not in_fence
            in_quote = False
            continue
        if in_fence:
            continue
        if BLOCKQUOTE_RE.match(line):
            if not in_quote:
                blockquotes += 1
                in_quote = True
        else:
            if line.strip() == '':
                in_quote = False

    # Lists — count contiguous blocks and total items
    lists_ordered = 0
    lists_unordered = 0
    list_items_total = 0
    in_ordered = False
    in_unordered = False
    in_fence = False
    for line in lines:
        if FENCE_RE.match(line.strip()):
            in_fence = not in_fence
            in_ordered = in_unordered = False
            continue
        if in_fence:
            continue
        if ORDERED_LIST_RE.match(line):
            list_items_total += 1
            if not in_ordered:
                lists_ordered += 1
                in_ordered = True
            in_unordered = False
        elif UNORDERED_LIST_RE.match(line):
            list_items_total += 1
            if not in_unordered:
                lists_unordered += 1
                in_unordered = True
            in_ordered = False
        else:
            if line.strip() == '':
                in_ordered = in_unordered = False

    # Tables — a table is a header row followed by a separator row.
    tables = 0
    table_details = []
    i = 0
    in_fence = False
    while i < len(lines):
        if FENCE_RE.match(lines[i].strip()):
            in_fence = not in_fence
            i += 1
            continue
        if in_fence:
            i += 1
            continue
        if TABLE_ROW_RE.match(lines[i]) and i + 1 < len(lines) and TABLE_SEP_RE.match(lines[i + 1]):
            header = lines[i]
            cols = len([c for c in header.strip().strip('|').split('|')])
            rows = 1  # header
            j = i + 2
            while j < len(lines) and TABLE_ROW_RE.match(lines[j]):
                rows += 1
                j += 1
            tables += 1
            table_details.append({'rows': rows, 'cols': cols})
            i = j
            continue
        i += 1

    return {
        'lists_ordered': lists_ordered,
        'lists_unordered': lists_unordered,
        'list_items_total': list_items_total,
        'tables': tables,
        'table_details': table_details,
        'code_blocks': code_blocks,
        'inline_code': inline_code,
        'blockquotes': blockquotes,
    }


def _extract_images(markdown: str) -> list:
    """Return a list of {src, alt} for every markdown image."""
    images = []
    for m in IMAGE_RE.finditer(markdown):
        alt = m.group(1) or ''
        src = m.group(2) or ''
        images.append({'src': src, 'alt': alt})
    return images


def _extract_links(markdown: str, base_url: str = '') -> tuple:
    """
    Return (link_list, naked_url_count).
    link_list entries: {url, anchor, internal}.
    """
    # Mask out images so their URLs don't leak into the link list.
    md_no_images = IMAGE_RE.sub('', markdown)

    base_host = ''
    if base_url:
        try:
            base_host = urlparse(base_url).hostname or ''
        except Exception:
            base_host = ''

    links = []
    for m in LINK_RE.finditer(md_no_images):
        anchor = m.group(1) or ''
        url = m.group(2) or ''
        internal = False
        if base_host and url:
            try:
                link_host = urlparse(url).hostname or ''
                if not link_host:
                    # Relative URL → same host.
                    internal = True
                else:
                    internal = link_host == base_host
            except Exception:
                internal = False
        links.append({'url': url, 'anchor': anchor, 'internal': internal})

    # Naked URLs — URLs in the body that aren't inside a markdown link.
    # We look at the already-masked (links also stripped) version.
    md_no_links = LINK_RE.sub('', md_no_images)
    naked = NAKED_URL_RE.findall(md_no_links)
    return links, len(naked)


def _extract_paragraphs(plain: str) -> list:
    return [p.strip() for p in re.split(r'\n{2,}', plain) if p.strip()]


def _h1_from_markdown(markdown: str) -> str:
    for line in markdown.split('\n'):
        m = HEADING_RE.match(line)
        if m and len(m.group(1)) == 1:
            return m.group(2).strip()
    return ''


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> None:
    try:
        markdown = sys.stdin.read()
        meta = {}
        if len(sys.argv) > 1:
            try:
                meta = json.loads(sys.argv[1])
            except (json.JSONDecodeError, ValueError):
                meta = {}

        url = meta.get('url', '') or ''
        title = meta.get('title', '') or ''
        meta_description = meta.get('meta_description', '') or ''
        raw_html_word_count = meta.get('raw_html_word_count')

        # Language detection
        plain = strip_markdown(markdown)
        lang_hint = meta.get('lang')
        if lang_hint and isinstance(lang_hint, str):
            # Accept any 2-letter code as a hint — it only drives tokenisation,
            # not heuristic scoring, so CJK codes (ja/zh/ko) are fine even
            # though LANGUAGE_PROFILES only carries en/de/es.
            lang = lang_hint.lower()
        else:
            lang = detect_language(plain, LANGUAGE_PROFILES) or 'en'
            # Heuristic CJK detection: if the plain text is mostly CJK chars,
            # override detect_language (which only knows en/de/es).
            if plain:
                cjk_chars = len(re.findall(r'[\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af]', plain))
                if cjk_chars > len(plain) * 0.3:
                    # Pick ja/zh/ko by character block prevalence.
                    hira_kata = len(re.findall(r'[\u3040-\u30ff]', plain))
                    hangul = len(re.findall(r'[\uac00-\ud7af]', plain))
                    if hangul > cjk_chars * 0.5:
                        lang = 'ko'
                    elif hira_kata > 0:
                        lang = 'ja'
                    else:
                        lang = 'zh'

        # ------ Volume ------
        word_count = _count_words(plain, lang)
        char_count = len(plain)
        char_count_no_spaces = len(re.sub(r'\s+', '', plain))

        paragraphs = _extract_paragraphs(plain)
        paragraph_count = len(paragraphs)
        sentences = _split_sentences(plain, lang)
        sentence_count = len(sentences)

        # ------ Distribution (word counts per paragraph / sentence) ------
        para_word_lens = [_count_words(p, lang) for p in paragraphs]
        sent_word_lens = [_count_words(s, lang) for s in sentences]

        # ------ Derived ------
        if _is_cjk(lang):
            reading_time_minutes = round(char_count_no_spaces / 400, 1) if char_count_no_spaces else 0.0
        else:
            reading_time_minutes = round(word_count / 200, 1) if word_count else 0.0

        tokens = _tokenise_for_diversity(plain, lang)
        total_tokens = len(tokens)
        unique_tokens = len(set(tokens))
        lexical_diversity = round(unique_tokens / total_tokens, 3) if total_tokens else 0.0
        if lexical_diversity < 0.3:
            ld_label = 'low'
        elif lexical_diversity <= 0.5:
            ld_label = 'medium'
        else:
            ld_label = 'high'

        derived = {
            'reading_time_minutes': reading_time_minutes,
            'lexical_diversity': lexical_diversity,
            'lexical_diversity_label': ld_label,
        }
        if isinstance(raw_html_word_count, (int, float)) and raw_html_word_count > 0:
            derived['content_to_chrome_ratio'] = round(word_count / raw_html_word_count, 3)

        # ------ Structure ------
        headings = _extract_headings(markdown)
        h1_count = sum(1 for h in headings if h['level'] == 1)
        h2_count = sum(1 for h in headings if h['level'] == 2)
        h3_count = sum(1 for h in headings if h['level'] == 3)
        h4plus_count = sum(1 for h in headings if h['level'] >= 4)
        hierarchy_valid, skipped_levels = _validate_hierarchy(headings)
        struct = _extract_structure(markdown)

        # ------ Media ------
        images = _extract_images(markdown)
        image_count = len(images)
        images_with_alt = sum(1 for i in images if i['alt'].strip())
        images_missing_alt = image_count - images_with_alt
        alt_coverage = round(images_with_alt / image_count, 3) if image_count else 0.0

        # ------ Links ------
        links, naked_count = _extract_links(markdown, url)
        internal_count = sum(1 for l in links if l['internal'])
        external_count = len(links) - internal_count
        link_stats = {
            'total': len(links),
            'internal': internal_count,
            'external': external_count,
            'naked_urls': naked_count,
        }
        if not url:
            link_stats['note'] = 'no base URL supplied; internal/external split is unreliable'

        # ------ Duplication ------
        def _norm(s: str) -> str:
            return re.sub(r'\s+', ' ', s.strip().lower())

        seen_paras = {}
        dup_paras = 0
        for p in paragraphs:
            n = _norm(p)
            if not n:
                continue
            if n in seen_paras:
                dup_paras += 1
            else:
                seen_paras[n] = True

        seen_sents = {}
        dup_sents = 0
        for s in sentences:
            n = _norm(s)
            if not n or len(n) < 15:  # ignore trivially short sentences
                continue
            if n in seen_sents:
                dup_sents += 1
            else:
                seen_sents[n] = True

        # ------ Patterns ------
        year_hits = set()
        for y in YEAR_RE.findall(plain):
            try:
                yi = int(y)
                if 1900 <= yi <= CURRENT_YEAR + 1:
                    year_hits.add(yi)
            except ValueError:
                pass
        year_mentions = sorted(year_hits)
        percentage_count = len(PERCENT_RE.findall(plain))

        # ------ Outline ------
        outline = _build_outline(headings)

        # ------ Link inventory (capped) ------
        LINK_CAP = 200
        link_inventory = links[:LINK_CAP]
        if len(links) > LINK_CAP:
            link_stats['_truncated'] = True

        # ------ Image inventory (capped) ------
        IMG_CAP = 100
        image_inventory = images[:IMG_CAP]

        result = {
            'metadata': {
                'detected_language': lang,
                'title': title,
                'meta_description': meta_description,
                'h1': _h1_from_markdown(markdown),
                'url': url or None,
                'canonical': meta.get('canonical'),
                'published': meta.get('published'),
                'modified': meta.get('modified'),
            },
            'stats': {
                'volume': {
                    'word_count': word_count,
                    'char_count': char_count,
                    'char_count_no_spaces': char_count_no_spaces,
                    'sentence_count': sentence_count,
                    'paragraph_count': paragraph_count,
                },
                'distribution': {
                    'paragraph_length': _percentiles(para_word_lens),
                    'sentence_length': _percentiles(sent_word_lens),
                },
                'derived': derived,
                'structure': {
                    'h1_count': h1_count,
                    'h2_count': h2_count,
                    'h3_count': h3_count,
                    'h4plus_count': h4plus_count,
                    'heading_hierarchy_valid': hierarchy_valid,
                    'skipped_levels': skipped_levels,
                    **struct,
                },
                'media': {
                    'image_count': image_count,
                    'images_with_alt': images_with_alt,
                    'images_missing_alt': images_missing_alt,
                    'alt_coverage': alt_coverage,
                },
                'links': link_stats,
                'duplication': {
                    'duplicate_paragraphs': dup_paras,
                    'duplicate_sentences': dup_sents,
                },
                'patterns': {
                    'year_mentions': year_mentions,
                    'percentage_count': percentage_count,
                    'url_in_body_count': naked_count,
                },
            },
            'outline': outline,
            'link_inventory': link_inventory,
            'image_inventory': image_inventory,
            'body': markdown,
        }

        print(json.dumps(result, ensure_ascii=False, indent=2))
    except Exception as e:
        error_output = {
            'error': str(e)[:200],
            'metadata': {'detected_language': 'und', 'title': '', 'meta_description': '', 'h1': ''},
            'stats': {},
            'outline': [],
            'link_inventory': [],
            'image_inventory': [],
            'body': '',
        }
        print(json.dumps(error_output))


if __name__ == '__main__':
    main()
